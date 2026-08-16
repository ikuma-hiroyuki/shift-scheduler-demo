"""
app/services/day_template_import_service.py — day_templates.csv の Upsert インポート

CSV フォーマット (UI からの再投入用):
  weekday,pattern_name,required_min,required_max
  -1,A1,1,
  3,B1,2,4

`pattern_name` 列で部門内の作業パターンを名前解決する。
`required_max` は任意列。空欄または列なしのとき NULL（厳格＝ちょうど
required_min 人）。値があれば範囲 required_min〜required_max。
seed.py が扱う `app/scripts/seed_data/day_templates.csv` には `pattern_id`
（CSV 連番ベース）列が含まれるが、UI 経由のテンプレートでは紛らわしさを
避けるため `pattern_name` のみを公式仕様とする。
"""
from __future__ import annotations

import csv
import io

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.day_template import DayTemplate
from app.models.work_pattern import WorkPattern, WorkPatternGroup

REQUIRED_COLUMNS = ("weekday", "pattern_name", "required_min")


async def import_day_templates_csv(
    db: AsyncSession,
    *,
    department_id: int,
    csv_bytes: bytes,
    encoding: str = "utf-8-sig",
) -> dict:
    """
    day_templates.csv を読み込み、(department, day_of_week, pattern) で Upsert する。
    pattern は CSV 行の `pattern_name` 列で部門内の作業パターン名から解決する。
    既存レコードは required_min / required_max を更新、未存在は新規作成する。
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

    next_sort_order = (
        await db.execute(
            select(func.coalesce(func.max(DayTemplate.sort_order), -1)).where(
                DayTemplate.department_id == department_id
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
            weekday = int((row.get("weekday") or "").strip())
            required = int((row.get("required_min") or "").strip())
            rmax_raw = (row.get("required_max") or "").strip()
            required_max = int(rmax_raw) if rmax_raw else None
        except (ValueError, TypeError) as exc:
            errors.append(f"{line_no}行目: 値の解釈に失敗 ({exc})")
            skipped += 1
            continue

        if not (-1 <= weekday <= 7):
            errors.append(f"{line_no}行目: weekday は -1〜7 の範囲です ({weekday})")
            skipped += 1
            continue

        if required < 0:
            errors.append(f"{line_no}行目: required_min は 0 以上です ({required})")
            skipped += 1
            continue

        if required_max is not None and required_max < required:
            errors.append(
                f"{line_no}行目: required_max は required_min 以上です "
                f"({required_max} < {required})"
            )
            skipped += 1
            continue

        pname = (row.get("pattern_name") or "").strip()
        if not pname:
            errors.append(f"{line_no}行目: pattern_name が空です")
            skipped += 1
            continue

        pat_id = name_to_id.get(pname)
        if pat_id is None:
            errors.append(f"{line_no}行目: pattern_name={pname} が部門に存在しません")
            skipped += 1
            continue

        existing = (
            await db.execute(
                select(DayTemplate).where(
                    DayTemplate.department_id == department_id,
                    DayTemplate.day_of_week == weekday,
                    DayTemplate.pattern_id == pat_id,
                )
            )
        ).scalar_one_or_none()

        if existing is None:
            db.add(
                DayTemplate(
                    department_id=department_id,
                    day_of_week=weekday,
                    pattern_id=pat_id,
                    required_min=required,
                    required_max=required_max,
                    sort_order=next_sort_order,
                )
            )
            next_sort_order += 1
            created += 1
        else:
            if (
                existing.required_min != required
                or existing.required_max != required_max
            ):
                existing.required_min = required
                existing.required_max = required_max
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
