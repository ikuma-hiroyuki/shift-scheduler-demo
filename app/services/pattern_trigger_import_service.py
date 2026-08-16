"""
app/services/pattern_trigger_import_service.py — pattern_triggers.csv の Upsert インポート

CSV フォーマット (UI/seed 共通):
  auxiliary_group_name,required_group_names
  C,B;D;E

`required_group_names` は `;` 区切りで部門内の作業パターングループ名を並べる。
キーは `(department_id, auxiliary_group_id)` で、required_group_set が一致なら
変更なし、異なれば required を入れ替える。auxiliary_group_id 単位で 1 トリガを
保持する前提（seed.py の運用に合わせる）。
"""
from __future__ import annotations

import csv
import io

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.pattern_rule import PatternTrigger, PatternTriggerRequiredGroup
from app.models.work_pattern import WorkPatternGroup

REQUIRED_COLUMNS = ("auxiliary_group_name", "required_group_names")


async def import_pattern_triggers_csv(
    db: AsyncSession,
    *,
    department_id: int,
    csv_bytes: bytes,
    encoding: str = "utf-8-sig",
) -> dict:
    """
    pattern_triggers.csv を読み込み、(department, auxiliary_group_id) で Upsert する。
    既存トリガの required_group_set が CSV と異なれば差し替え、同一ならスキップ。
    """
    text = csv_bytes.decode(encoding, errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    if reader.fieldnames is None:
        raise ValueError("CSV にヘッダ行がありません")

    missing = [c for c in REQUIRED_COLUMNS if c not in reader.fieldnames]
    if missing:
        raise ValueError(f"必須列が不足: {', '.join(missing)}")

    grp_rows = (
        await db.execute(
            select(WorkPatternGroup.id, WorkPatternGroup.name).where(
                WorkPatternGroup.department_id == department_id
            )
        )
    ).all()
    name_to_id: dict[str, int] = {row[1]: row[0] for row in grp_rows}

    existing_triggers = (
        await db.execute(
            select(PatternTrigger)
            .options(selectinload(PatternTrigger.required_groups))
            .where(PatternTrigger.department_id == department_id)
        )
    ).scalars().all()
    by_aux: dict[int, PatternTrigger] = {t.auxiliary_group_id: t for t in existing_triggers}

    next_sort_order = (
        await db.execute(
            select(func.coalesce(func.max(PatternTrigger.sort_order), -1)).where(
                PatternTrigger.department_id == department_id
            )
        )
    ).scalar_one()
    next_sort_order = int(next_sort_order) + 1

    created = 0
    updated = 0
    skipped = 0
    errors: list[str] = []

    for line_no, row in enumerate(reader, start=2):
        aux_name = (row.get("auxiliary_group_name") or "").strip()
        if not aux_name:
            errors.append(f"{line_no}行目: auxiliary_group_name が空です")
            skipped += 1
            continue
        if aux_name not in name_to_id:
            errors.append(
                f"{line_no}行目: 部門に存在しないグループ名: {aux_name}"
            )
            skipped += 1
            continue
        aux_gid = name_to_id[aux_name]

        names_raw = (row.get("required_group_names") or "").strip()
        if not names_raw:
            errors.append(f"{line_no}行目: required_group_names が空です")
            skipped += 1
            continue
        names = [n.strip() for n in names_raw.split(";") if n.strip()]
        if not names:
            errors.append(f"{line_no}行目: required_group_names に有効なグループがありません")
            skipped += 1
            continue

        unknown = [n for n in names if n not in name_to_id]
        if unknown:
            errors.append(
                f"{line_no}行目: 部門に存在しないグループ名: {', '.join(unknown)}"
            )
            skipped += 1
            continue

        req_ids = [name_to_id[n] for n in names]
        if aux_gid in req_ids:
            errors.append(
                f"{line_no}行目: auxiliary_group が required_group_names に含まれています ({aux_name})"
            )
            skipped += 1
            continue
        target_set = frozenset(req_ids)

        matched = by_aux.get(aux_gid)
        if matched is None:
            trigger = PatternTrigger(
                department_id=department_id,
                auxiliary_group_id=aux_gid,
                sort_order=next_sort_order,
            )
            db.add(trigger)
            await db.flush()
            for gid in req_ids:
                db.add(PatternTriggerRequiredGroup(trigger_id=trigger.id, group_id=gid))
            by_aux[aux_gid] = trigger
            next_sort_order += 1
            created += 1
        else:
            current_set = frozenset(r.group_id for r in matched.required_groups)
            if current_set == target_set:
                skipped += 1
            else:
                # `cascade='all, delete-orphan'` で collection から remove すれば自動で削除される。
                # `db.delete` 後に `db.add` で別行を作る方法だと、SQLAlchemy が parent.required_groups
                # の旧スナップショットを保ったまま flush 順を解決し、新規行が消える事象が起きる。
                for r in list(matched.required_groups):
                    matched.required_groups.remove(r)
                await db.flush()
                for gid in req_ids:
                    matched.required_groups.append(
                        PatternTriggerRequiredGroup(
                            trigger_id=matched.id, group_id=gid
                        )
                    )
                updated += 1

    await db.commit()
    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
    }
