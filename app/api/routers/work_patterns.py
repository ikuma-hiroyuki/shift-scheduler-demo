import csv
import io
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.models.work_pattern import WorkPattern, WorkPatternGroup
from app.schemas.work_pattern import (
    GroupReorderRequest,
    PatternReorderRequest,
    WorkPatternCreate,
    WorkPatternGroupCreate,
    WorkPatternGroupResponse,
    WorkPatternGroupUpdate,
    WorkPatternResponse,
    WorkPatternUpdate,
)

router = APIRouter(tags=["work-patterns"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AuthDep = Annotated[User, Depends(get_current_user)]


def _raise_unique_violation(e: IntegrityError) -> None:
    """UNIQUE 制約違反を 409 + 日本語 detail に変換。それ以外は再 raise。"""
    msg = str(e.orig)
    if "uq_work_pattern_groups_dept_name" in msg:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="同じ名称のグループが既に存在します",
        )
    if "uq_work_patterns_dept_pattern_name" in msg:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="同じ名称の作業パターンが既に存在します",
        )
    raise e


# --- WorkPatternGroup ---

@router.get("/work-pattern-groups", response_model=list[WorkPatternGroupResponse])
async def list_groups(
    db: DbDep,
    _: AuthDep,
    department_id: int | None = None,
) -> list[WorkPatternGroup]:
    stmt = select(WorkPatternGroup).order_by(
        WorkPatternGroup.sort_order, WorkPatternGroup.id
    )
    if department_id is not None:
        stmt = stmt.where(WorkPatternGroup.department_id == department_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post(
    "/work-pattern-groups",
    response_model=WorkPatternGroupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_group(body: WorkPatternGroupCreate, db: DbDep, _: AuthDep) -> WorkPatternGroup:
    max_order = (
        await db.execute(
            select(func.coalesce(func.max(WorkPatternGroup.sort_order), -1)).where(
                WorkPatternGroup.department_id == body.department_id
            )
        )
    ).scalar_one()
    group = WorkPatternGroup(**body.model_dump(), sort_order=int(max_order) + 1)
    db.add(group)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        _raise_unique_violation(e)
    await db.refresh(group)
    return group


@router.put(
    "/work-pattern-groups/reorder", response_model=list[WorkPatternGroupResponse]
)
async def reorder_groups(
    body: GroupReorderRequest, db: DbDep, _: AuthDep
) -> list[WorkPatternGroup]:
    """部門内のグループ ID 配列順に sort_order を再採番する。"""
    if len(body.ids) != len(set(body.ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ids に重複が含まれています",
        )
    existing = (
        await db.execute(
            select(WorkPatternGroup.id).where(
                WorkPatternGroup.department_id == body.department_id
            )
        )
    ).scalars().all()
    if set(existing) != set(body.ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="並び替え対象の ID 集合が部門内の現存 ID と一致しません",
        )

    for index, group_id in enumerate(body.ids):
        await db.execute(
            update(WorkPatternGroup)
            .where(WorkPatternGroup.id == group_id)
            .values(sort_order=index)
        )
    await db.commit()

    result = await db.execute(
        select(WorkPatternGroup)
        .where(WorkPatternGroup.department_id == body.department_id)
        .order_by(WorkPatternGroup.sort_order, WorkPatternGroup.id)
    )
    return list(result.scalars().all())


@router.get("/work-pattern-groups/{group_id}", response_model=WorkPatternGroupResponse)
async def get_group(group_id: int, db: DbDep, _: AuthDep) -> WorkPatternGroup:
    group = await db.get(WorkPatternGroup, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="グループが見つかりません")
    return group


@router.put("/work-pattern-groups/{group_id}", response_model=WorkPatternGroupResponse)
async def update_group(
    group_id: int, body: WorkPatternGroupUpdate, db: DbDep, _: AuthDep
) -> WorkPatternGroup:
    group = await db.get(WorkPatternGroup, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="グループが見つかりません")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(group, field, value)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        _raise_unique_violation(e)
    await db.refresh(group)
    return group


@router.delete("/work-pattern-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(group_id: int, db: DbDep, _: AuthDep) -> None:
    group = await db.get(WorkPatternGroup, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="グループが見つかりません")
    await db.delete(group)
    await db.commit()


# --- WorkPattern ---

@router.get(
    "/work-patterns/export.csv",
    responses={
        200: {
            "description": "patterns.csv 形式のエクスポート（BOM 付き UTF-8）",
            "content": {"text/csv": {}},
        }
    },
)
async def export_patterns_csv(
    db: DbDep,
    _: AuthDep,
    department_id: int | None = None,
) -> Response:
    """patterns.csv 形式で作業パターンをエクスポート。

    列: id,group_name,pattern_name,shift_type,shift_start,shift_end,is_auxiliary
    エンコード: BOM 付き UTF-8 (Excel 互換)。
    """
    stmt = (
        select(WorkPattern)
        .join(WorkPatternGroup, WorkPatternGroup.id == WorkPattern.group_id)
        .options(selectinload(WorkPattern.group))
        .order_by(
            WorkPatternGroup.sort_order,
            WorkPatternGroup.id,
            WorkPattern.sort_order,
            WorkPattern.id,
        )
    )
    if department_id is not None:
        stmt = stmt.where(WorkPatternGroup.department_id == department_id)
    result = await db.execute(stmt)
    patterns = list(result.scalars().all())

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow([
        "id",
        "group_name",
        "group_order",
        "pattern_name",
        "pattern_order",
        "shift_type",
        "shift_start",
        "shift_end",
        "is_auxiliary",
    ])
    for p in patterns:
        writer.writerow([
            p.id,
            p.group.name,
            p.group.sort_order,
            p.pattern_name,
            p.sort_order,
            p.shift_type,
            p.shift_start,
            p.shift_end,
            1 if p.group.is_auxiliary else 0,
        ])

    body = buf.getvalue().encode("utf-8-sig")
    filename = "patterns.csv"
    if department_id is not None:
        filename = f"patterns_dept{department_id}.csv"
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/work-patterns", response_model=list[WorkPatternResponse])
async def list_patterns(
    db: DbDep,
    _: AuthDep,
    department_id: int | None = None,
) -> list[WorkPattern]:
    stmt = (
        select(WorkPattern)
        .join(WorkPatternGroup, WorkPatternGroup.id == WorkPattern.group_id)
        .order_by(
            WorkPatternGroup.sort_order,
            WorkPatternGroup.id,
            WorkPattern.sort_order,
            WorkPattern.id,
        )
    )
    if department_id is not None:
        stmt = stmt.where(WorkPatternGroup.department_id == department_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post(
    "/work-patterns",
    response_model=WorkPatternResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_pattern(body: WorkPatternCreate, db: DbDep, _: AuthDep) -> WorkPattern:
    group = await db.get(WorkPatternGroup, body.group_id)
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="グループが見つかりません"
        )
    max_order = (
        await db.execute(
            select(func.coalesce(func.max(WorkPattern.sort_order), -1)).where(
                WorkPattern.group_id == body.group_id
            )
        )
    ).scalar_one()
    pattern = WorkPattern(
        **body.model_dump(),
        department_id=group.department_id,
        sort_order=int(max_order) + 1,
    )
    db.add(pattern)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        _raise_unique_violation(e)
    await db.refresh(pattern)
    return pattern


@router.put("/work-patterns/reorder", response_model=list[WorkPatternResponse])
async def reorder_patterns(
    body: PatternReorderRequest, db: DbDep, _: AuthDep
) -> list[WorkPattern]:
    """グループ内のパターン ID 配列順に sort_order を再採番する。"""
    if len(body.ids) != len(set(body.ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ids に重複が含まれています",
        )
    existing = (
        await db.execute(
            select(WorkPattern.id).where(WorkPattern.group_id == body.group_id)
        )
    ).scalars().all()
    if set(existing) != set(body.ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="並び替え対象の ID 集合がグループ内の現存 ID と一致しません",
        )

    for index, pattern_id in enumerate(body.ids):
        await db.execute(
            update(WorkPattern)
            .where(WorkPattern.id == pattern_id)
            .values(sort_order=index)
        )
    await db.commit()

    result = await db.execute(
        select(WorkPattern)
        .where(WorkPattern.group_id == body.group_id)
        .order_by(WorkPattern.sort_order, WorkPattern.id)
    )
    return list(result.scalars().all())


@router.get("/work-patterns/{pattern_id}", response_model=WorkPatternResponse)
async def get_pattern(pattern_id: int, db: DbDep, _: AuthDep) -> WorkPattern:
    pattern = await db.get(WorkPattern, pattern_id)
    if pattern is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="作業パターンが見つかりません")
    return pattern


@router.put("/work-patterns/{pattern_id}", response_model=WorkPatternResponse)
async def update_pattern(
    pattern_id: int, body: WorkPatternUpdate, db: DbDep, _: AuthDep
) -> WorkPattern:
    pattern = await db.get(WorkPattern, pattern_id)
    if pattern is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="作業パターンが見つかりません")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(pattern, field, value)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        _raise_unique_violation(e)
    await db.refresh(pattern)
    return pattern


@router.delete("/work-patterns/{pattern_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pattern(pattern_id: int, db: DbDep, _: AuthDep) -> None:
    pattern = await db.get(WorkPattern, pattern_id)
    if pattern is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="作業パターンが見つかりません")
    await db.delete(pattern)
    await db.commit()
