from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.models.role import Role
from app.models.schedule import ShiftAssignment
from app.models.user import User
from app.schemas.employee import (
    EmployeeCreate,
    EmployeeResponse,
    EmployeeUpdate,
    ReorderRequest,
    SortByRoleRequest,
)


class EmployeeUsage(BaseModel):
    """従業員削除時にカスケード削除される関連レコード件数。"""

    assignment_count: int
    schedule_count: int
    leave_request_count: int

router = APIRouter(prefix="/employees", tags=["employees"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AuthDep = Annotated[User, Depends(get_current_user)]


async def _ensure_role_exists(db: AsyncSession, code: str) -> None:
    """role コードが roles テーブルに存在することを保証。なければ 400。"""
    role = await db.get(Role, code)
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"役職コード '{code}' は存在しません",
        )


async def _reassign_sort_order(db: AsyncSession, ordered_ids: list[int]) -> None:
    """与えられた ID 順に sort_order を 0 から再採番する。commit は呼び出し側責務。"""
    for index, employee_id in enumerate(ordered_ids):
        await db.execute(
            update(Employee).where(Employee.id == employee_id).values(sort_order=index)
        )


@router.get("", response_model=list[EmployeeResponse])
async def list_employees(db: DbDep, _: AuthDep) -> list[Employee]:
    result = await db.execute(
        select(Employee).order_by(
            Employee.department_id, Employee.sort_order, Employee.id
        )
    )
    return list(result.scalars().all())


@router.post("", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
async def create_employee(body: EmployeeCreate, db: DbDep, _: AuthDep) -> Employee:
    await _ensure_role_exists(db, body.role)
    max_order = (
        await db.execute(
            select(func.coalesce(func.max(Employee.sort_order), -1)).where(
                Employee.department_id == body.department_id
            )
        )
    ).scalar_one()
    employee = Employee(**body.model_dump(), sort_order=int(max_order) + 1)
    db.add(employee)
    await db.commit()
    await db.refresh(employee)
    return employee


@router.put("/reorder", response_model=list[EmployeeResponse])
async def reorder_employees(
    body: ReorderRequest, db: DbDep, _: AuthDep
) -> list[Employee]:
    """部門内の従業員 ID 配列順に sort_order を再採番する。"""
    if len(body.ids) != len(set(body.ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ids に重複が含まれています",
        )

    existing = (
        await db.execute(
            select(Employee.id).where(Employee.department_id == body.department_id)
        )
    ).scalars().all()
    existing_set = set(existing)

    if existing_set != set(body.ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="並び替え対象の ID 集合が部門内の現存 ID と一致しません",
        )

    await _reassign_sort_order(db, body.ids)
    await db.commit()

    result = await db.execute(
        select(Employee)
        .where(Employee.department_id == body.department_id)
        .order_by(Employee.sort_order, Employee.id)
    )
    return list(result.scalars().all())


@router.post("/sort-by-role", response_model=list[EmployeeResponse])
async def sort_employees_by_role(
    body: SortByRoleRequest, db: DbDep, _: AuthDep
) -> list[Employee]:
    """部門内 sort_order を「役職並び順 → 社員番号 ASC」で再採番する。"""
    role_rows = (await db.execute(select(Role))).scalars().all()
    role_index = {r.code: r.order_index for r in role_rows}

    employees = (
        await db.execute(
            select(Employee).where(Employee.department_id == body.department_id)
        )
    ).scalars().all()

    sorted_emps = sorted(
        employees,
        key=lambda e: (role_index.get(e.role, 10**9), e.employee_number),
    )
    await _reassign_sort_order(db, [e.id for e in sorted_emps])
    await db.commit()

    result = await db.execute(
        select(Employee)
        .where(Employee.department_id == body.department_id)
        .order_by(Employee.sort_order, Employee.id)
    )
    return list(result.scalars().all())


@router.get("/{employee_id}", response_model=EmployeeResponse)
async def get_employee(employee_id: int, db: DbDep, _: AuthDep) -> Employee:
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="従業員が見つかりません")
    return employee


@router.put("/{employee_id}", response_model=EmployeeResponse)
async def update_employee(
    employee_id: int, body: EmployeeUpdate, db: DbDep, _: AuthDep
) -> Employee:
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="従業員が見つかりません")
    payload = body.model_dump(exclude_none=True)
    if "role" in payload:
        await _ensure_role_exists(db, payload["role"])
    for field, value in payload.items():
        setattr(employee, field, value)
    await db.commit()
    await db.refresh(employee)
    return employee


@router.get("/{employee_id}/usage", response_model=EmployeeUsage)
async def get_employee_usage(
    employee_id: int, db: DbDep, _: AuthDep,
) -> EmployeeUsage:
    """
    削除時に CASCADE で消える関連レコード件数を返す。
    削除前確認ダイアログで利用者にインパクトを提示するための情報。
    """
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="従業員が見つかりません")

    assignment_count = (
        await db.execute(
            select(func.count())
            .select_from(ShiftAssignment)
            .where(ShiftAssignment.employee_id == employee_id)
        )
    ).scalar_one()
    schedule_count = (
        await db.execute(
            select(func.count(func.distinct(ShiftAssignment.schedule_id)))
            .where(ShiftAssignment.employee_id == employee_id)
        )
    ).scalar_one()
    leave_request_count = (
        await db.execute(
            select(func.count())
            .select_from(LeaveRequest)
            .where(LeaveRequest.employee_id == employee_id)
        )
    ).scalar_one()
    return EmployeeUsage(
        assignment_count=int(assignment_count),
        schedule_count=int(schedule_count),
        leave_request_count=int(leave_request_count),
    )


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_employee(employee_id: int, db: DbDep, _: AuthDep) -> None:
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="従業員が見つかりません")
    await db.delete(employee)
    await db.commit()
