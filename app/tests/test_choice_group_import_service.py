"""choice_group_import_service のユニットテスト。"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.choice_group import PatternChoiceGroup, PatternChoiceGroupCandidate
from app.models.department import Department, WorkRuleConfig
from app.models.work_pattern import WorkPattern, WorkPatternGroup
from app.services.choice_group_import_service import import_choice_groups_csv


@pytest_asyncio.fixture
async def dept_with_patterns(client: tuple) -> tuple[Department, dict[str, int]]:
    """部門 + 4 つのパターン (A1, A2, B1, B2) を用意する。"""
    _, session = client
    d = Department(name="CGテスト部門")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))
    grp = WorkPatternGroup(department_id=d.id, name="A", is_auxiliary=False, sort_order=0)
    session.add(grp)
    await session.flush()
    name_to_id: dict[str, int] = {}
    for i, name in enumerate(["A1", "A2", "B1", "B2"]):
        p = WorkPattern(
            group_id=grp.id,
            pattern_name=name,
            shift_type=1,
            shift_start="07:00",
            shift_end="15:30",
            sort_order=i,
        )
        session.add(p)
        await session.flush()
        name_to_id[name] = p.id
    await session.commit()
    return d, name_to_id


@pytest.mark.asyncio
async def test_import_creates_new_groups(client: tuple, dept_with_patterns: tuple):
    """新規行が created に計上される。"""
    _, session = client
    d, _ = dept_with_patterns
    csv_bytes = b"pattern_names,min_count,max_count\nA1;A2,1,1\nB1;B2,1,2\n"

    result = await import_choice_groups_csv(
        session, department_id=d.id, csv_bytes=csv_bytes
    )
    assert result["created"] == 2
    assert result["updated"] == 0
    assert result["errors"] == []

    rows = (
        await session.execute(
            select(PatternChoiceGroup).where(PatternChoiceGroup.department_id == d.id)
        )
    ).scalars().all()
    assert len(rows) == 2
    # sort_order が 0,1 で連番採番される
    sort_orders = sorted([r.sort_order for r in rows])
    assert sort_orders == [0, 1]


@pytest.mark.asyncio
async def test_import_updates_existing_min_max(client: tuple, dept_with_patterns: tuple):
    """同じ候補集合が既存ならば min/max を更新する。"""
    _, session = client
    d, _ = dept_with_patterns
    csv_bytes_1 = b"pattern_names,min_count,max_count\nA1;A2,1,1\n"
    await import_choice_groups_csv(session, department_id=d.id, csv_bytes=csv_bytes_1)

    csv_bytes_2 = b"pattern_names,min_count,max_count\nA1;A2,0,2\n"
    result = await import_choice_groups_csv(
        session, department_id=d.id, csv_bytes=csv_bytes_2
    )
    assert result["created"] == 0
    assert result["updated"] == 1

    row = (
        await session.execute(
            select(PatternChoiceGroup).where(PatternChoiceGroup.department_id == d.id)
        )
    ).scalar_one()
    assert row.min_count == 0
    assert row.max_count == 2


@pytest.mark.asyncio
async def test_import_unknown_pattern_name_skipped(client: tuple, dept_with_patterns: tuple):
    """知らないパターン名はエラー行として skipped に積まれる。"""
    _, session = client
    d, _ = dept_with_patterns
    csv_bytes = b"pattern_names,min_count,max_count\nA1;UNKNOWN,1,1\nA1;A2,1,1\n"

    result = await import_choice_groups_csv(
        session, department_id=d.id, csv_bytes=csv_bytes
    )
    assert result["created"] == 1
    assert result["skipped"] == 1
    assert any("UNKNOWN" in e for e in result["errors"])


@pytest.mark.asyncio
async def test_import_with_day_of_week(client: tuple, dept_with_patterns: tuple):
    """day_of_week 列が値を持つときは数値として保存される。"""
    _, session = client
    d, name_to_id = dept_with_patterns
    csv_bytes = (
        b"pattern_names,min_count,max_count,day_of_week\n"
        b"A1;A2,1,1,3\n"
        b"B1;B2,1,1,\n"
    )
    result = await import_choice_groups_csv(
        session, department_id=d.id, csv_bytes=csv_bytes
    )
    assert result["created"] == 2

    rows = (
        await session.execute(
            select(PatternChoiceGroup).where(PatternChoiceGroup.department_id == d.id)
        )
    ).scalars().all()
    dows = sorted([r.day_of_week if r.day_of_week is not None else -99 for r in rows])
    assert dows == [-99, 3]


@pytest.mark.asyncio
async def test_import_missing_required_columns_raises(client: tuple, dept_with_patterns: tuple):
    """必須列が無いと ValueError が上がる。"""
    _, session = client
    d, _ = dept_with_patterns
    csv_bytes = b"pattern_names,min_count\nA1;A2,1\n"

    with pytest.raises(ValueError):
        await import_choice_groups_csv(
            session, department_id=d.id, csv_bytes=csv_bytes
        )


@pytest.mark.asyncio
async def test_import_invalid_min_max_skipped(client: tuple, dept_with_patterns: tuple):
    """min > max の場合は skipped + errors に積まれる。"""
    _, session = client
    d, _ = dept_with_patterns
    csv_bytes = b"pattern_names,min_count,max_count\nA1;A2,3,1\n"

    result = await import_choice_groups_csv(
        session, department_id=d.id, csv_bytes=csv_bytes
    )
    assert result["created"] == 0
    assert result["skipped"] == 1
    assert any("max_count" in e for e in result["errors"])
