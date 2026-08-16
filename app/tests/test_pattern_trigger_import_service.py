"""pattern_trigger_import_service のユニットテスト。"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.department import Department, WorkRuleConfig
from app.models.pattern_rule import PatternTrigger
from app.models.work_pattern import WorkPatternGroup
from app.services.pattern_trigger_import_service import import_pattern_triggers_csv


@pytest_asyncio.fixture
async def dept_with_groups(client: tuple) -> tuple[Department, dict[str, int]]:
    """部門 + 4 つのグループ (A, B, C(aux), D) を用意する。"""
    _, session = client
    d = Department(name="トリガーテスト部門")
    session.add(d)
    await session.flush()
    session.add(WorkRuleConfig(department_id=d.id))
    name_to_id: dict[str, int] = {}
    specs = [("A", False), ("B", False), ("C", True), ("D", False), ("E", False)]
    for i, (name, aux) in enumerate(specs):
        g = WorkPatternGroup(
            department_id=d.id, name=name, is_auxiliary=aux, sort_order=i
        )
        session.add(g)
        await session.flush()
        name_to_id[name] = g.id
    await session.commit()
    return d, name_to_id


@pytest.mark.asyncio
async def test_import_creates_new_trigger(dept_with_groups, client):
    """新規トリガを作成し sort_order が 0 から始まる。"""
    d, _ = dept_with_groups
    _, session = client
    csv_text = "auxiliary_group_name,required_group_names\nC,B;D;E\n"
    res = await import_pattern_triggers_csv(
        session, department_id=d.id, csv_bytes=csv_text.encode("utf-8-sig")
    )
    assert res["created"] == 1
    assert res["updated"] == 0
    assert res["skipped"] == 0
    assert res["errors"] == []
    triggers = (
        await session.execute(
            select(PatternTrigger)
            .options(selectinload(PatternTrigger.required_groups))
            .where(PatternTrigger.department_id == d.id)
        )
    ).scalars().all()
    assert len(triggers) == 1
    assert triggers[0].sort_order == 0
    assert {r.group_id for r in triggers[0].required_groups} == {
        dept_with_groups[1]["B"],
        dept_with_groups[1]["D"],
        dept_with_groups[1]["E"],
    }


@pytest.mark.asyncio
async def test_import_updates_existing_trigger(dept_with_groups, client):
    """同じ aux で required_set が違うと updated。"""
    d, names = dept_with_groups
    _, session = client
    # 1回目: C → B;D
    await import_pattern_triggers_csv(
        session,
        department_id=d.id,
        csv_bytes=b"auxiliary_group_name,required_group_names\nC,B;D\n",
    )
    # 2回目: C → B;D;E
    res = await import_pattern_triggers_csv(
        session,
        department_id=d.id,
        csv_bytes=b"auxiliary_group_name,required_group_names\nC,B;D;E\n",
    )
    assert res["created"] == 0
    assert res["updated"] == 1
    triggers = (
        await session.execute(
            select(PatternTrigger)
            .options(selectinload(PatternTrigger.required_groups))
            .where(PatternTrigger.department_id == d.id)
        )
    ).scalars().all()
    assert len(triggers) == 1
    assert {r.group_id for r in triggers[0].required_groups} == {
        names["B"],
        names["D"],
        names["E"],
    }


@pytest.mark.asyncio
async def test_import_skips_when_unchanged(dept_with_groups, client):
    """同一内容を再投入したら skipped。"""
    d, _ = dept_with_groups
    _, session = client
    csv = b"auxiliary_group_name,required_group_names\nC,B;D\n"
    await import_pattern_triggers_csv(session, department_id=d.id, csv_bytes=csv)
    res = await import_pattern_triggers_csv(session, department_id=d.id, csv_bytes=csv)
    assert res["created"] == 0
    assert res["updated"] == 0
    assert res["skipped"] == 1


@pytest.mark.asyncio
async def test_import_rejects_unknown_group(dept_with_groups, client):
    """存在しないグループ名はエラー扱い。"""
    d, _ = dept_with_groups
    _, session = client
    res = await import_pattern_triggers_csv(
        session,
        department_id=d.id,
        csv_bytes=b"auxiliary_group_name,required_group_names\nZ,B;D\n",
    )
    assert res["created"] == 0
    assert res["skipped"] == 1
    assert any("Z" in e for e in res["errors"])


@pytest.mark.asyncio
async def test_import_rejects_aux_in_required(dept_with_groups, client):
    """auxiliary が required に含まれていたらエラー。"""
    d, _ = dept_with_groups
    _, session = client
    res = await import_pattern_triggers_csv(
        session,
        department_id=d.id,
        csv_bytes=b"auxiliary_group_name,required_group_names\nC,B;C;D\n",
    )
    assert res["created"] == 0
    assert res["skipped"] == 1
    assert any("auxiliary_group" in e for e in res["errors"])


@pytest.mark.asyncio
async def test_import_rejects_missing_columns(dept_with_groups, client):
    """必須列不足は ValueError。"""
    d, _ = dept_with_groups
    _, session = client
    with pytest.raises(ValueError, match="必須列"):
        await import_pattern_triggers_csv(
            session, department_id=d.id, csv_bytes=b"foo,bar\nA,B\n"
        )
