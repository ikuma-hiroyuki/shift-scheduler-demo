"""day_template_import_service のテスト。"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.day_template import DayTemplate
from app.models.department import Department
from app.models.work_pattern import WorkPattern, WorkPatternGroup
from app.services.day_template_import_service import import_day_templates_csv


async def _setup_department_with_patterns(session) -> tuple[int, dict[str, int]]:
    dept = Department(name="鮮魚部門")
    session.add(dept)
    await session.flush()

    grp = WorkPatternGroup(department_id=dept.id, name="A", is_auxiliary=False, sort_order=0)
    session.add(grp)
    await session.flush()

    name_to_id: dict[str, int] = {}
    for i, pname in enumerate(("A1", "A2")):
        pat = WorkPattern(
            group_id=grp.id,
            pattern_name=pname,
            shift_type=1,
            shift_start="07:00",
            shift_end="15:30",
            sort_order=i,
        )
        session.add(pat)
        await session.flush()
        name_to_id[pname] = pat.id

    return dept.id, name_to_id


@pytest.mark.asyncio
async def test_import_creates_new_templates(client):
    """正常な CSV を投入すると新規作成される。"""
    _, session = client
    dept_id, name_to_id = await _setup_department_with_patterns(session)

    csv_bytes = b"weekday,pattern_name,required_min\n-1,A1,1\n3,A2,2\n"
    result = await import_day_templates_csv(
        session, department_id=dept_id, csv_bytes=csv_bytes
    )
    assert result["created"] == 2
    assert result["updated"] == 0
    assert result["skipped"] == 0
    assert result["errors"] == []

    rows = (
        await session.execute(
            select(DayTemplate).where(DayTemplate.department_id == dept_id)
        )
    ).scalars().all()
    assert len(rows) == 2
    sort_orders = sorted(r.sort_order for r in rows)
    assert sort_orders == [0, 1]


@pytest.mark.asyncio
async def test_import_updates_existing_required_min(client):
    """同じ (weekday, pattern) があれば required_min を更新する。"""
    _, session = client
    dept_id, name_to_id = await _setup_department_with_patterns(session)

    session.add(
        DayTemplate(
            department_id=dept_id,
            day_of_week=-1,
            pattern_id=name_to_id["A1"],
            required_min=1,
            sort_order=0,
        )
    )
    await session.flush()

    csv_bytes = b"weekday,pattern_name,required_min\n-1,A1,3\n"
    result = await import_day_templates_csv(
        session, department_id=dept_id, csv_bytes=csv_bytes
    )
    assert result["created"] == 0
    assert result["updated"] == 1


@pytest.mark.asyncio
async def test_import_skips_unknown_pattern(client):
    """未知の pattern_name は errors に積まれてスキップ。"""
    _, session = client
    dept_id, _ = await _setup_department_with_patterns(session)

    csv_bytes = b"weekday,pattern_name,required_min\n0,Unknown,1\n"
    result = await import_day_templates_csv(
        session, department_id=dept_id, csv_bytes=csv_bytes
    )
    assert result["created"] == 0
    assert result["skipped"] == 1
    assert len(result["errors"]) == 1


@pytest.mark.asyncio
async def test_import_rejects_missing_required_columns(client):
    """必須列が欠けると ValueError を発生させる。"""
    _, session = client
    dept_id, _ = await _setup_department_with_patterns(session)

    csv_bytes = b"weekday,required_min\n0,1\n"
    with pytest.raises(ValueError):
        await import_day_templates_csv(
            session, department_id=dept_id, csv_bytes=csv_bytes
        )


@pytest.mark.asyncio
async def test_import_with_required_max(client):
    """required_max 列があれば範囲として取り込む。"""
    _, session = client
    dept_id, _ = await _setup_department_with_patterns(session)

    csv_bytes = b"weekday,pattern_name,required_min,required_max\n-1,A1,2,4\n"
    result = await import_day_templates_csv(
        session, department_id=dept_id, csv_bytes=csv_bytes
    )
    assert result["created"] == 1
    row = (
        await session.execute(
            select(DayTemplate).where(DayTemplate.department_id == dept_id)
        )
    ).scalar_one()
    assert row.required_min == 2
    assert row.required_max == 4


@pytest.mark.asyncio
async def test_import_blank_required_max_is_strict(client):
    """required_max 列が空欄なら NULL（厳格）。"""
    _, session = client
    dept_id, _ = await _setup_department_with_patterns(session)

    csv_bytes = b"weekday,pattern_name,required_min,required_max\n-1,A1,3,\n"
    result = await import_day_templates_csv(
        session, department_id=dept_id, csv_bytes=csv_bytes
    )
    assert result["created"] == 1
    row = (
        await session.execute(
            select(DayTemplate).where(DayTemplate.department_id == dept_id)
        )
    ).scalar_one()
    assert row.required_min == 3
    assert row.required_max is None


@pytest.mark.asyncio
async def test_import_rejects_max_below_min(client):
    """required_max < required_min はスキップして errors に積む。"""
    _, session = client
    dept_id, _ = await _setup_department_with_patterns(session)

    csv_bytes = b"weekday,pattern_name,required_min,required_max\n-1,A1,4,2\n"
    result = await import_day_templates_csv(
        session, department_id=dept_id, csv_bytes=csv_bytes
    )
    assert result["created"] == 0
    assert result["skipped"] == 1
    assert len(result["errors"]) == 1
