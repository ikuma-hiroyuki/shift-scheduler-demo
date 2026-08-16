"""ユーザー管理 API (issue #141)。

全権管理者 (is_admin=True) のみが操作可能。一般ユーザーは 403 で弾く。
削除/降格時は「自分自身」「最後の管理者」を保護する。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin, get_db
from app.core.security import get_password_hash
from app.models.user import User
from app.schemas.user import UserCreate, UserResponse, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AdminDep = Annotated[User, Depends(get_current_admin)]


async def _admin_count(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count()).select_from(User).where(User.is_admin.is_(True))
    )
    return int(result.scalar_one())


@router.get("", response_model=list[UserResponse])
async def list_users(db: DbDep, _: AdminDep) -> list[User]:
    result = await db.execute(select(User).order_by(User.id))
    return list(result.scalars().all())


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, db: DbDep, _: AdminDep) -> User:
    user = User(
        email=body.email,
        hashed_password=get_password_hash(body.password),
        is_active=body.is_active,
        is_admin=body.is_admin,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="メールアドレスが既に使われています",
        )
    await db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: int, db: DbDep, _: AdminDep) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "ユーザーが見つかりません")
    return user


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int, body: UserUpdate, db: DbDep, me: AdminDep
) -> User:
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(404, "ユーザーが見つかりません")

    # 自分が最後の admin で is_admin=False に降格しようとする → 拒否
    if (
        target.id == me.id
        and target.is_admin
        and body.is_admin is False
        and await _admin_count(db) <= 1
    ):
        raise HTTPException(400, "最後の管理者の権限を解除することはできません")

    data = body.model_dump(exclude_unset=True)
    if data.get("password"):
        target.hashed_password = get_password_hash(data["password"])
    data.pop("password", None)
    for field, value in data.items():
        setattr(target, field, value)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(400, "メールアドレスが既に使われています")
    await db.refresh(target)
    return target


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: int, db: DbDep, me: AdminDep) -> None:
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(404, "ユーザーが見つかりません")
    if target.id == me.id:
        raise HTTPException(400, "自分自身を削除することはできません")
    if target.is_admin and await _admin_count(db) <= 1:
        raise HTTPException(400, "最後の管理者を削除することはできません")
    await db.delete(target)
    await db.commit()
