from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.choice_group import (
    PatternChoiceGroup,
    PatternChoiceGroupCandidate,
    PatternIncompatibility,
)
from app.models.user import User
from app.schemas.choice_group import (
    PatternChoiceGroupCreate,
    PatternChoiceGroupReorderRequest,
    PatternChoiceGroupResponse,
    PatternChoiceGroupUpdate,
    PatternIncompatibilityCreate,
    PatternIncompatibilityReorderRequest,
    PatternIncompatibilityResponse,
    PatternIncompatibilityUpdate,
)

router = APIRouter(tags=["choice-groups"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AuthDep = Annotated[User, Depends(get_current_user)]


def _to_response(group: PatternChoiceGroup) -> PatternChoiceGroupResponse:
    candidate_ids = [c.pattern_id for c in group.candidates]
    return PatternChoiceGroupResponse(
        id=group.id,
        department_id=group.department_id,
        day_of_week=group.day_of_week,
        min_count=group.min_count,
        max_count=group.max_count,
        candidate_pattern_ids=candidate_ids,
        sort_order=group.sort_order,
    )


@router.get("/choice-groups", response_model=list[PatternChoiceGroupResponse])
async def list_choice_groups(db: DbDep, _: AuthDep) -> list[PatternChoiceGroupResponse]:
    result = await db.execute(
        select(PatternChoiceGroup).order_by(
            PatternChoiceGroup.department_id,
            PatternChoiceGroup.sort_order,
            PatternChoiceGroup.id,
        )
    )
    groups = result.scalars().all()
    for g in groups:
        await db.refresh(g, ["candidates"])
    return [_to_response(g) for g in groups]


@router.post(
    "/choice-groups",
    response_model=PatternChoiceGroupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_choice_group(
    body: PatternChoiceGroupCreate, db: DbDep, _: AuthDep
) -> PatternChoiceGroupResponse:
    max_order = (
        await db.execute(
            select(func.coalesce(func.max(PatternChoiceGroup.sort_order), -1)).where(
                PatternChoiceGroup.department_id == body.department_id
            )
        )
    ).scalar_one()
    group = PatternChoiceGroup(
        department_id=body.department_id,
        day_of_week=body.day_of_week,
        min_count=body.min_count,
        max_count=body.max_count,
        sort_order=int(max_order) + 1,
    )
    db.add(group)
    await db.flush()
    for pid in body.candidate_pattern_ids:
        db.add(PatternChoiceGroupCandidate(choice_group_id=group.id, pattern_id=pid))
    await db.commit()
    await db.refresh(group, ["candidates"])
    return _to_response(group)


@router.put("/choice-groups/reorder", response_model=list[PatternChoiceGroupResponse])
async def reorder_choice_groups(
    body: PatternChoiceGroupReorderRequest, db: DbDep, _: AuthDep
) -> list[PatternChoiceGroupResponse]:
    """部門内の選択グループ ID 配列順に sort_order を再採番する。"""
    if len(body.ids) != len(set(body.ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ids に重複が含まれています",
        )

    existing = (
        await db.execute(
            select(PatternChoiceGroup.id).where(
                PatternChoiceGroup.department_id == body.department_id
            )
        )
    ).scalars().all()

    if set(existing) != set(body.ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="並び替え対象の ID 集合が部門内の現存 ID と一致しません",
        )

    for index, gid in enumerate(body.ids):
        await db.execute(
            update(PatternChoiceGroup)
            .where(PatternChoiceGroup.id == gid)
            .values(sort_order=index)
        )
    await db.commit()

    result = await db.execute(
        select(PatternChoiceGroup)
        .where(PatternChoiceGroup.department_id == body.department_id)
        .order_by(PatternChoiceGroup.sort_order, PatternChoiceGroup.id)
    )
    groups = result.scalars().all()
    for g in groups:
        await db.refresh(g, ["candidates"])
    return [_to_response(g) for g in groups]


@router.get("/choice-groups/{group_id}", response_model=PatternChoiceGroupResponse)
async def get_choice_group(group_id: int, db: DbDep, _: AuthDep) -> PatternChoiceGroupResponse:
    group = await db.get(PatternChoiceGroup, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="グループが見つかりません")
    await db.refresh(group, ["candidates"])
    return _to_response(group)


@router.put("/choice-groups/{group_id}", response_model=PatternChoiceGroupResponse)
async def update_choice_group(
    group_id: int, body: PatternChoiceGroupUpdate, db: DbDep, _: AuthDep
) -> PatternChoiceGroupResponse:
    group = await db.get(PatternChoiceGroup, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="グループが見つかりません")
    # day_of_week は「未送信」と「null（毎日）」を区別するため、
    # body.model_fields_set に含まれる場合のみ更新を適用する。
    if "day_of_week" in body.model_fields_set:
        group.day_of_week = body.day_of_week
    if body.min_count is not None:
        group.min_count = body.min_count
    if body.max_count is not None:
        group.max_count = body.max_count
    if body.candidate_pattern_ids is not None:
        await db.refresh(group, ["candidates"])
        for c in list(group.candidates):
            await db.delete(c)
        await db.flush()
        for pid in body.candidate_pattern_ids:
            db.add(PatternChoiceGroupCandidate(choice_group_id=group.id, pattern_id=pid))
    await db.commit()
    await db.refresh(group, ["candidates"])
    return _to_response(group)


@router.delete("/choice-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_choice_group(group_id: int, db: DbDep, _: AuthDep) -> None:
    group = await db.get(PatternChoiceGroup, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="グループが見つかりません")
    await db.delete(group)
    await db.commit()


# --- PatternIncompatibility ---

@router.get(
    "/pattern-incompatibilities", response_model=list[PatternIncompatibilityResponse]
)
async def list_incompatibilities(db: DbDep, _: AuthDep) -> list[PatternIncompatibility]:
    result = await db.execute(
        select(PatternIncompatibility).order_by(
            PatternIncompatibility.department_id,
            PatternIncompatibility.sort_order,
            PatternIncompatibility.id,
        )
    )
    return list(result.scalars().all())


@router.post(
    "/pattern-incompatibilities",
    response_model=PatternIncompatibilityResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_incompatibility(
    body: PatternIncompatibilityCreate, db: DbDep, _: AuthDep
) -> PatternIncompatibility:
    max_order = (
        await db.execute(
            select(func.coalesce(func.max(PatternIncompatibility.sort_order), -1)).where(
                PatternIncompatibility.department_id == body.department_id
            )
        )
    ).scalar_one()
    incomp = PatternIncompatibility(**body.model_dump(), sort_order=int(max_order) + 1)
    db.add(incomp)
    await db.commit()
    await db.refresh(incomp)
    return incomp


@router.put(
    "/pattern-incompatibilities/reorder",
    response_model=list[PatternIncompatibilityResponse],
)
async def reorder_incompatibilities(
    body: PatternIncompatibilityReorderRequest, db: DbDep, _: AuthDep
) -> list[PatternIncompatibility]:
    """部門内の非両立ルール ID 配列順に sort_order を再採番する。"""
    if len(body.ids) != len(set(body.ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ids に重複が含まれています",
        )

    existing = (
        await db.execute(
            select(PatternIncompatibility.id).where(
                PatternIncompatibility.department_id == body.department_id
            )
        )
    ).scalars().all()

    if set(existing) != set(body.ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="並び替え対象の ID 集合が部門内の現存 ID と一致しません",
        )

    for index, iid in enumerate(body.ids):
        await db.execute(
            update(PatternIncompatibility)
            .where(PatternIncompatibility.id == iid)
            .values(sort_order=index)
        )
    await db.commit()

    result = await db.execute(
        select(PatternIncompatibility)
        .where(PatternIncompatibility.department_id == body.department_id)
        .order_by(PatternIncompatibility.sort_order, PatternIncompatibility.id)
    )
    return list(result.scalars().all())


@router.put(
    "/pattern-incompatibilities/{incomp_id}",
    response_model=PatternIncompatibilityResponse,
)
async def update_incompatibility(
    incomp_id: int, body: PatternIncompatibilityUpdate, db: DbDep, _: AuthDep
) -> PatternIncompatibility:
    incomp = await db.get(PatternIncompatibility, incomp_id)
    if incomp is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="非両立ルールが見つかりません"
        )

    new_a = body.pattern_id_a if body.pattern_id_a is not None else incomp.pattern_id_a
    new_b = body.pattern_id_b if body.pattern_id_b is not None else incomp.pattern_id_b
    if new_a == new_b:
        raise HTTPException(
            status_code=422,
            detail="pattern_id_a と pattern_id_b は別々のパターンを指定してください",
        )

    if body.pattern_id_a is not None:
        incomp.pattern_id_a = body.pattern_id_a
    if body.pattern_id_b is not None:
        incomp.pattern_id_b = body.pattern_id_b
    await db.commit()
    await db.refresh(incomp)
    return incomp


@router.delete(
    "/pattern-incompatibilities/{incomp_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_incompatibility(incomp_id: int, db: DbDep, _: AuthDep) -> None:
    incomp = await db.get(PatternIncompatibility, incomp_id)
    if incomp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="非両立ルールが見つかりません")
    await db.delete(incomp)
    await db.commit()
