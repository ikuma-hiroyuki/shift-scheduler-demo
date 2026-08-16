"""
app/services/choice_group_import_service.py — choice_groups.csv の Upsert インポート

CSV フォーマット (UI からの再投入用):
  pattern_names,min_count,max_count,day_of_week
  A1;A2;A3,1,1,
  B1;B2,1,1,3

`pattern_names` は `;` 区切りで部門内の作業パターン名を並べる。
`day_of_week` は省略 / 空欄で「毎日 (null)」、0=月〜6=日。

`(department_id, day_of_week, candidate_set)` をキーとして既存と一致したら
`min_count` / `max_count` を更新、無ければ新規作成。`pattern_names` 列は
seed.py が扱う `pattern_ids` (CSV 連番ベース) とは別形式 — UI 経由の入力では
名前ベースに統一する。
"""
from __future__ import annotations

import csv
import io

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.choice_group import (
    PatternChoiceGroup,
    PatternChoiceGroupCandidate,
)
from app.models.work_pattern import WorkPattern, WorkPatternGroup

REQUIRED_COLUMNS = ("pattern_names", "min_count", "max_count")


async def import_choice_groups_csv(
    db: AsyncSession,
    *,
    department_id: int,
    csv_bytes: bytes,
    encoding: str = "utf-8-sig",
) -> dict:
    """
    choice_groups.csv を読み込み、(department, day_of_week, candidate_set) で Upsert する。
    既存レコードの min_count / max_count を更新、未存在は新規作成。
    `day_of_week` 列が無い、または空欄なら null（毎日）として扱う。
    """
    text = csv_bytes.decode(encoding, errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    if reader.fieldnames is None:
        raise ValueError("CSV にヘッダ行がありません")

    missing = [c for c in REQUIRED_COLUMNS if c not in reader.fieldnames]
    if missing:
        raise ValueError(f"必須列が不足: {', '.join(missing)}")

    pat_rows = (
        await db.execute(
            select(WorkPattern.id, WorkPattern.pattern_name)
            .join(WorkPatternGroup, WorkPatternGroup.id == WorkPattern.group_id)
            .where(WorkPatternGroup.department_id == department_id)
        )
    ).all()
    name_to_id: dict[str, int] = {row[1]: row[0] for row in pat_rows}

    # 部門内の既存グループを 1 クエリで取得し、(day_of_week, candidate_set) → group の
    # 索引を作る。CSV 行ごとに DB を往復する N+1 を避ける。
    existing_groups = (
        await db.execute(
            select(PatternChoiceGroup)
            .options(selectinload(PatternChoiceGroup.candidates))
            .where(PatternChoiceGroup.department_id == department_id)
        )
    ).scalars().all()
    by_key: dict[tuple[int | None, frozenset[int]], PatternChoiceGroup] = {
        (g.day_of_week, frozenset(c.pattern_id for c in g.candidates)): g
        for g in existing_groups
    }

    next_sort_order = (
        await db.execute(
            select(func.coalesce(func.max(PatternChoiceGroup.sort_order), -1)).where(
                PatternChoiceGroup.department_id == department_id
            )
        )
    ).scalar_one()
    next_sort_order = int(next_sort_order) + 1

    created = 0
    updated = 0
    skipped = 0
    errors: list[str] = []

    for line_no, row in enumerate(reader, start=2):
        try:
            min_c = int((row.get("min_count") or "").strip())
            max_c = int((row.get("max_count") or "").strip())
        except (ValueError, TypeError) as exc:
            errors.append(f"{line_no}行目: 値の解釈に失敗 ({exc})")
            skipped += 1
            continue

        if min_c < 0 or max_c < 0:
            errors.append(f"{line_no}行目: min_count / max_count は 0 以上です")
            skipped += 1
            continue
        if min_c > max_c:
            errors.append(
                f"{line_no}行目: min_count={min_c} が max_count={max_c} を超えています"
            )
            skipped += 1
            continue

        dow_raw = (row.get("day_of_week") or "").strip()
        day_of_week: int | None = None
        if dow_raw:
            try:
                day_of_week = int(dow_raw)
            except ValueError:
                errors.append(f"{line_no}行目: day_of_week が数値ではありません ({dow_raw})")
                skipped += 1
                continue
            if not (0 <= day_of_week <= 6):
                errors.append(
                    f"{line_no}行目: day_of_week は 0〜6 の範囲です ({day_of_week})"
                )
                skipped += 1
                continue

        names_raw = (row.get("pattern_names") or "").strip()
        if not names_raw:
            errors.append(f"{line_no}行目: pattern_names が空です")
            skipped += 1
            continue
        names = [n.strip() for n in names_raw.split(";") if n.strip()]
        if not names:
            errors.append(f"{line_no}行目: pattern_names に有効なパターンがありません")
            skipped += 1
            continue

        unknown = [n for n in names if n not in name_to_id]
        if unknown:
            errors.append(
                f"{line_no}行目: 部門に存在しないパターン名: {', '.join(unknown)}"
            )
            skipped += 1
            continue

        pat_ids = [name_to_id[n] for n in names]
        target_set = frozenset(pat_ids)
        matched = by_key.get((day_of_week, target_set))

        if matched is None:
            cg = PatternChoiceGroup(
                department_id=department_id,
                day_of_week=day_of_week,
                min_count=min_c,
                max_count=max_c,
                sort_order=next_sort_order,
            )
            db.add(cg)
            await db.flush()
            for pid in pat_ids:
                db.add(PatternChoiceGroupCandidate(choice_group_id=cg.id, pattern_id=pid))
            by_key[(day_of_week, target_set)] = cg
            next_sort_order += 1
            created += 1
        else:
            if matched.min_count != min_c or matched.max_count != max_c:
                matched.min_count = min_c
                matched.max_count = max_c
                updated += 1
            else:
                skipped += 1

    await db.commit()
    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
    }
