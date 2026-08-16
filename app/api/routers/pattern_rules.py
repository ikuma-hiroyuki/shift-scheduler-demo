from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.pattern_rule import (
    PatternTrigger,
    PatternTriggerRequiredGroup,
    SpecialAssignmentRule,
)
from app.models.user import User
from app.schemas.pattern_rule import (
    PatternTriggerCreate,
    PatternTriggerReorderRequest,
    PatternTriggerResponse,
    PatternTriggerUpdate,
    SpecialAssignmentRuleCreate,
    SpecialAssignmentRuleResponse,
    SpecialAssignmentRuleUpdate,
)

router = APIRouter(tags=["pattern-rules"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AuthDep = Annotated[User, Depends(get_current_user)]


def _trigger_to_response(trigger: PatternTrigger) -> PatternTriggerResponse:
    required_ids = [r.group_id for r in trigger.required_groups]
    return PatternTriggerResponse(
        id=trigger.id,
        department_id=trigger.department_id,
        auxiliary_group_id=trigger.auxiliary_group_id,
        required_group_ids=required_ids,
        sort_order=trigger.sort_order,
    )


# --- PatternTrigger ---

@router.get("/pattern-triggers", response_model=list[PatternTriggerResponse])
async def list_triggers(db: DbDep, _: AuthDep) -> list[PatternTriggerResponse]:
    result = await db.execute(
        select(PatternTrigger).order_by(
            PatternTrigger.department_id,
            PatternTrigger.sort_order,
            PatternTrigger.id,
        )
    )
    triggers = result.scalars().all()
    for t in triggers:
        await db.refresh(t, ["required_groups"])
    return [_trigger_to_response(t) for t in triggers]


@router.post(
    "/pattern-triggers",
    response_model=PatternTriggerResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_trigger(
    body: PatternTriggerCreate, db: DbDep, _: AuthDep
) -> PatternTriggerResponse:
    max_order = (
        await db.execute(
            select(func.coalesce(func.max(PatternTrigger.sort_order), -1)).where(
                PatternTrigger.department_id == body.department_id
            )
        )
    ).scalar_one()
    trigger = PatternTrigger(
        department_id=body.department_id,
        auxiliary_group_id=body.auxiliary_group_id,
        sort_order=int(max_order) + 1,
    )
    db.add(trigger)
    await db.flush()
    for gid in body.required_group_ids:
        db.add(PatternTriggerRequiredGroup(trigger_id=trigger.id, group_id=gid))
    await db.commit()
    await db.refresh(trigger, ["required_groups"])
    return _trigger_to_response(trigger)


@router.put("/pattern-triggers/reorder", response_model=list[PatternTriggerResponse])
async def reorder_triggers(
    body: PatternTriggerReorderRequest, db: DbDep, _: AuthDep
) -> list[PatternTriggerResponse]:
    """部門内の発生条件 ID 配列順に sort_order を再採番する。"""
    if len(body.ids) != len(set(body.ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ids に重複が含まれています",
        )

    existing = (
        await db.execute(
            select(PatternTrigger.id).where(
                PatternTrigger.department_id == body.department_id
            )
        )
    ).scalars().all()

    if set(existing) != set(body.ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="並び替え対象の ID 集合が部門内の現存 ID と一致しません",
        )

    for index, tid in enumerate(body.ids):
        await db.execute(
            update(PatternTrigger).where(PatternTrigger.id == tid).values(sort_order=index)
        )
    await db.commit()

    result = await db.execute(
        select(PatternTrigger)
        .where(PatternTrigger.department_id == body.department_id)
        .order_by(PatternTrigger.sort_order, PatternTrigger.id)
    )
    triggers = result.scalars().all()
    for t in triggers:
        await db.refresh(t, ["required_groups"])
    return [_trigger_to_response(t) for t in triggers]


@router.get("/pattern-triggers/{trigger_id}", response_model=PatternTriggerResponse)
async def get_trigger(trigger_id: int, db: DbDep, _: AuthDep) -> PatternTriggerResponse:
    trigger = await db.get(PatternTrigger, trigger_id)
    if trigger is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="トリガーが見つかりません")
    await db.refresh(trigger, ["required_groups"])
    return _trigger_to_response(trigger)


@router.put("/pattern-triggers/{trigger_id}", response_model=PatternTriggerResponse)
async def update_trigger(
    trigger_id: int, body: PatternTriggerUpdate, db: DbDep, _: AuthDep
) -> PatternTriggerResponse:
    trigger = await db.get(PatternTrigger, trigger_id)
    if trigger is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="トリガーが見つかりません")
    if body.auxiliary_group_id is not None:
        # 同部門内で同じ aux を持つ別 trigger があると、import_service の
        # `by_aux: dict[int, PatternTrigger]` が last-wins になり再投入時に挙動が割れる。
        # DB レベルの UNIQUE 制約は他マスタ（day_templates / choice_groups）も未付与なので
        # API レベルで 422 を返す。
        if body.auxiliary_group_id != trigger.auxiliary_group_id:
            dup = (
                await db.execute(
                    select(PatternTrigger.id).where(
                        PatternTrigger.department_id == trigger.department_id,
                        PatternTrigger.auxiliary_group_id == body.auxiliary_group_id,
                        PatternTrigger.id != trigger_id,
                    )
                )
            ).scalar_one_or_none()
            if dup is not None:
                raise HTTPException(
                    status_code=422,
                    detail="同部門内で同じ補助グループの発生条件が既に存在します",
                )
        trigger.auxiliary_group_id = body.auxiliary_group_id
    if body.required_group_ids is not None:
        await db.refresh(trigger, ["required_groups"])
        # `cascade='all, delete-orphan'` を活かす。collection から remove で自動削除させ、
        # 新行は append で同一 collection に追加することで flush 順序の競合を避ける。
        for r in list(trigger.required_groups):
            trigger.required_groups.remove(r)
        await db.flush()
        for gid in body.required_group_ids:
            trigger.required_groups.append(
                PatternTriggerRequiredGroup(trigger_id=trigger.id, group_id=gid)
            )
    await db.commit()
    await db.refresh(trigger, ["required_groups"])
    return _trigger_to_response(trigger)


@router.delete("/pattern-triggers/{trigger_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trigger(trigger_id: int, db: DbDep, _: AuthDep) -> None:
    trigger = await db.get(PatternTrigger, trigger_id)
    if trigger is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="トリガーが見つかりません")
    await db.delete(trigger)
    await db.commit()


# --- SpecialAssignmentRule ---

@router.get("/special-assignment-rules", response_model=list[SpecialAssignmentRuleResponse])
async def list_special_rules(db: DbDep, _: AuthDep) -> list[SpecialAssignmentRule]:
    result = await db.execute(select(SpecialAssignmentRule))
    return list(result.scalars().all())


@router.post(
    "/special-assignment-rules",
    response_model=SpecialAssignmentRuleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_special_rule(
    body: SpecialAssignmentRuleCreate, db: DbDep, _: AuthDep
) -> SpecialAssignmentRule:
    rule = SpecialAssignmentRule(**body.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.get(
    "/special-assignment-rules/{rule_id}", response_model=SpecialAssignmentRuleResponse
)
async def get_special_rule(rule_id: int, db: DbDep, _: AuthDep) -> SpecialAssignmentRule:
    rule = await db.get(SpecialAssignmentRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ルールが見つかりません")
    return rule


@router.put(
    "/special-assignment-rules/{rule_id}", response_model=SpecialAssignmentRuleResponse
)
async def update_special_rule(
    rule_id: int, body: SpecialAssignmentRuleUpdate, db: DbDep, _: AuthDep
) -> SpecialAssignmentRule:
    rule = await db.get(SpecialAssignmentRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ルールが見つかりません")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(rule, field, value)
    # LAST_DAY ルールでは condition_value が常に None である整合性を担保する。
    # `body.condition_type` ではなく setattr 後の `rule.condition_type` を見ることで、
    # 既存 LAST_DAY rule に condition_value だけ送られたケースもカバーする (issue #125)。
    if rule.condition_type == "LAST_DAY":
        rule.condition_value = None
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/special-assignment-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_special_rule(rule_id: int, db: DbDep, _: AuthDep) -> None:
    rule = await db.get(SpecialAssignmentRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ルールが見つかりません")
    await db.delete(rule)
    await db.commit()
