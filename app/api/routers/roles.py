from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin, get_current_user, get_db
from app.models.employee import Employee
from app.models.role import Role
from app.models.user import User
from app.schemas.role import (
    RoleCreate,
    RoleReorderRequest,
    RoleResponse,
    RoleUpdate,
)


router = APIRouter(prefix="/roles", tags=["roles"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AuthDep = Annotated[User, Depends(get_current_user)]
AdminDep = Annotated[User, Depends(get_current_admin)]


@router.get("", response_model=list[RoleResponse])
async def list_roles(db: DbDep, _: AuthDep) -> list[Role]:
    """役職一覧。order_index 昇順。一般ユーザーも参照可能。"""
    result = await db.execute(select(Role).order_by(Role.order_index))
    return list(result.scalars().all())


@router.post("", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
async def create_role(body: RoleCreate, db: DbDep, _: AdminDep) -> Role:
    """新規役職追加。order_index は末尾に自動採番。rest_days_* 3 フィールド必須 (issue #235)。"""
    existing = await db.get(Role, body.code)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"役職コード '{body.code}' は既に存在します",
        )
    max_order = (
        await db.execute(select(func.coalesce(func.max(Role.order_index), -1)))
    ).scalar_one()
    role = Role(
        code=body.code,
        name=body.name,
        order_index=int(max_order) + 1,
        rest_days_28_29=body.rest_days_28_29,
        rest_days_30=body.rest_days_30,
        rest_days_31=body.rest_days_31,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    return role


@router.put("/reorder", response_model=list[RoleResponse])
async def reorder_roles(body: RoleReorderRequest, db: DbDep, _: AdminDep) -> list[Role]:
    """codes 配列の順に order_index を 0..N-1 で再採番する。"""
    if len(body.codes) != len(set(body.codes)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="codes に重複が含まれています",
        )
    existing = (await db.execute(select(Role.code))).scalars().all()
    if set(existing) != set(body.codes):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="codes の集合が現存役職と一致しません",
        )

    for index, code in enumerate(body.codes):
        await db.execute(
            update(Role).where(Role.code == code).values(order_index=index)
        )
    await db.commit()

    result = await db.execute(select(Role).order_by(Role.order_index))
    return list(result.scalars().all())


@router.put("/{code}", response_model=RoleResponse)
async def update_role(code: str, body: RoleUpdate, db: DbDep, _: AdminDep) -> Role:
    """name + rest_days_* 3 フィールド更新。code は不変 (issue #235)。"""
    role = await db.get(Role, code)
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="役職が見つかりません",
        )
    role.name = body.name
    role.rest_days_28_29 = body.rest_days_28_29
    role.rest_days_30 = body.rest_days_30
    role.rest_days_31 = body.rest_days_31
    await db.commit()
    await db.refresh(role)
    return role


@router.delete("/{code}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(code: str, db: DbDep, _: AdminDep) -> None:
    """役職削除。従業員が紐付いていると 409。削除後は order_index を詰め直す。"""
    role = await db.get(Role, code)
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="役職が見つかりません",
        )
    employee_count = (
        await db.execute(
            select(func.count())
            .select_from(Employee)
            .where(Employee.role == code)
        )
    ).scalar_one()
    if int(employee_count) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"この役職には従業員 {employee_count} 名が紐付いており削除できません",
        )

    await db.delete(role)
    await db.flush()

    remaining = (
        await db.execute(select(Role).order_by(Role.order_index))
    ).scalars().all()
    for index, r in enumerate(remaining):
        if r.order_index != index:
            r.order_index = index
    await db.commit()
