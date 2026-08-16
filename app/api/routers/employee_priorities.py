from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.employee import Employee, EmployeePatternPriority
from app.models.user import User
from app.models.work_pattern import WorkPattern, WorkPatternGroup
from app.schemas.employee_priority import (
    EmployeePatternPriorityCreate,
    EmployeePatternPriorityResponse,
    EmployeePatternPriorityUpdate,
)

router = APIRouter(prefix="/employee-priorities", tags=["employee-priorities"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AuthDep = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=list[EmployeePatternPriorityResponse])
async def list_priorities(
    db: DbDep,
    _: AuthDep,
    department_id: int,
) -> list[EmployeePatternPriority]:
    """
    部門配下の従業員 × 作業パターンの優先度一覧。
    employee.department_id および pattern.group.department_id で両側を絞り込む。
    """
    stmt = (
        select(EmployeePatternPriority)
        .join(Employee, Employee.id == EmployeePatternPriority.employee_id)
        .join(WorkPattern, WorkPattern.id == EmployeePatternPriority.pattern_id)
        .join(WorkPatternGroup, WorkPatternGroup.id == WorkPattern.group_id)
        .where(
            Employee.department_id == department_id,
            WorkPatternGroup.department_id == department_id,
        )
        .order_by(EmployeePatternPriority.id)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post(
    "",
    response_model=EmployeePatternPriorityResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_priority(
    body: EmployeePatternPriorityCreate, db: DbDep, _: AuthDep
) -> EmployeePatternPriority:
    if body.priority == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="priority=0 は新規作成できません（未設定と同義）",
        )
    employee = await db.get(Employee, body.employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="従業員が見つかりません")
    pattern = await db.get(WorkPattern, body.pattern_id)
    if pattern is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="作業パターンが見つかりません")

    existing = (
        await db.execute(
            select(EmployeePatternPriority).where(
                EmployeePatternPriority.employee_id == body.employee_id,
                EmployeePatternPriority.pattern_id == body.pattern_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="既に優先度が設定されています（PUT で更新してください）",
        )

    priority = EmployeePatternPriority(**body.model_dump())
    db.add(priority)
    await db.commit()
    await db.refresh(priority)
    return priority


@router.put("/{priority_id}")
async def update_priority(
    priority_id: int,
    body: EmployeePatternPriorityUpdate,
    db: DbDep,
    _: AuthDep,
):
    """
    priority=0 はレコード削除に変換する（loader が priority>0 のみ参照する仕様に合わせる）。
    """
    priority = await db.get(EmployeePatternPriority, priority_id)
    if priority is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="優先度設定が見つかりません")
    if body.priority == 0:
        await db.delete(priority)
        await db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    priority.priority = body.priority
    await db.commit()
    await db.refresh(priority)
    return EmployeePatternPriorityResponse.model_validate(priority)


@router.delete("/{priority_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_priority(priority_id: int, db: DbDep, _: AuthDep) -> None:
    priority = await db.get(EmployeePatternPriority, priority_id)
    if priority is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="優先度設定が見つかりません")
    await db.delete(priority)
    await db.commit()
