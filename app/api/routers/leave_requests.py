from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.models.user import User
from app.schemas.leave_request import (
    LeaveRequestCreate,
    LeaveRequestResponse,
    LeaveRequestUpdate,
)

router = APIRouter(prefix="/leave-requests", tags=["leave-requests"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AuthDep = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=list[LeaveRequestResponse])
async def list_leave_requests(
    db: DbDep,
    _: AuthDep,
    year: int | None = None,
    month: int | None = None,
    employee_id: int | None = None,
    department_id: int | None = None,
) -> list[LeaveRequest]:
    stmt = select(LeaveRequest)
    if department_id is not None:
        stmt = stmt.join(Employee, LeaveRequest.employee_id == Employee.id).where(
            Employee.department_id == department_id
        )
    if year is not None:
        stmt = stmt.where(LeaveRequest.year == year)
    if month is not None:
        stmt = stmt.where(LeaveRequest.month == month)
    if employee_id is not None:
        stmt = stmt.where(LeaveRequest.employee_id == employee_id)
    result = await db.execute(stmt.order_by(LeaveRequest.year, LeaveRequest.month, LeaveRequest.day))
    return list(result.scalars().all())


@router.post("", response_model=LeaveRequestResponse, status_code=status.HTTP_201_CREATED)
async def create_leave_request(body: LeaveRequestCreate, db: DbDep, _: AuthDep) -> LeaveRequest:
    req = LeaveRequest(**body.model_dump())
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


@router.get("/{request_id}", response_model=LeaveRequestResponse)
async def get_leave_request(request_id: int, db: DbDep, _: AuthDep) -> LeaveRequest:
    req = await db.get(LeaveRequest, request_id)
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="希望休申請が見つかりません")
    return req


@router.put("/{request_id}", response_model=LeaveRequestResponse)
async def update_leave_request(
    request_id: int, body: LeaveRequestUpdate, db: DbDep, _: AuthDep
) -> LeaveRequest:
    req = await db.get(LeaveRequest, request_id)
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="希望休申請が見つかりません")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(req, field, value)
    await db.commit()
    await db.refresh(req)
    return req


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_leave_request(request_id: int, db: DbDep, _: AuthDep) -> None:
    req = await db.get(LeaveRequest, request_id)
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="希望休申請が見つかりません")
    await db.delete(req)
    await db.commit()
