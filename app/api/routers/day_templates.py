from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.day_template import DayOverride, DayTemplate
from app.models.user import User
from app.schemas.day_template import (
    DayOverrideCreate,
    DayOverrideReorderRequest,
    DayOverrideResponse,
    DayOverrideUpdate,
    DayTemplateCreate,
    DayTemplateReorderRequest,
    DayTemplateResponse,
    DayTemplateUpdate,
)

router = APIRouter(tags=["day-templates"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AuthDep = Annotated[User, Depends(get_current_user)]


def _apply_range_update(
    obj: DayTemplate | DayOverride,
    body: DayTemplateUpdate | DayOverrideUpdate,
) -> None:
    """tri-state 更新を適用する。

    `exclude_unset=True` で「未送信（不変）」と「明示 null（required_max を
    クリアして厳格化）」を区別する。更新後の required_min / required_max が
    範囲整合 (max >= min) を満たすか、DB の現値も含めて検証する。
    """
    data = body.model_dump(exclude_unset=True)
    # required_max 以外は NOT NULL 列。exclude_unset では明示 null が素通りするため、
    # ここで弾かないと setattr 後の commit で 500 (IntegrityError) になる。
    for field in ("day_of_week", "specific_date", "pattern_id", "required_min"):
        if field in data and data[field] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{field} に null は指定できません",
            )
    new_min = data.get("required_min", obj.required_min)
    new_max = data.get("required_max", obj.required_max)
    if new_max is not None and new_min is not None and new_max < new_min:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="required_max は required_min 以上である必要があります",
        )
    for field, value in data.items():
        setattr(obj, field, value)


# --- DayTemplate ---


@router.get("/day-templates", response_model=list[DayTemplateResponse])
async def list_day_templates(db: DbDep, _: AuthDep) -> list[DayTemplate]:
    result = await db.execute(
        select(DayTemplate).order_by(
            DayTemplate.department_id, DayTemplate.sort_order, DayTemplate.id
        )
    )
    return list(result.scalars().all())


@router.post(
    "/day-templates",
    response_model=DayTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_day_template(body: DayTemplateCreate, db: DbDep, _: AuthDep) -> DayTemplate:
    max_order = (
        await db.execute(
            select(func.coalesce(func.max(DayTemplate.sort_order), -1)).where(
                DayTemplate.department_id == body.department_id
            )
        )
    ).scalar_one()
    tmpl = DayTemplate(**body.model_dump(), sort_order=int(max_order) + 1)
    db.add(tmpl)
    await db.commit()
    await db.refresh(tmpl)
    return tmpl


@router.put("/day-templates/reorder", response_model=list[DayTemplateResponse])
async def reorder_day_templates(
    body: DayTemplateReorderRequest, db: DbDep, _: AuthDep
) -> list[DayTemplate]:
    """部門内の曜日別テンプレート ID 配列順に sort_order を再採番する。"""
    if len(body.ids) != len(set(body.ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ids に重複が含まれています",
        )

    existing = (
        await db.execute(
            select(DayTemplate.id).where(DayTemplate.department_id == body.department_id)
        )
    ).scalars().all()

    if set(existing) != set(body.ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="並び替え対象の ID 集合が部門内の現存 ID と一致しません",
        )

    for index, tmpl_id in enumerate(body.ids):
        await db.execute(
            update(DayTemplate).where(DayTemplate.id == tmpl_id).values(sort_order=index)
        )
    await db.commit()

    result = await db.execute(
        select(DayTemplate)
        .where(DayTemplate.department_id == body.department_id)
        .order_by(DayTemplate.sort_order, DayTemplate.id)
    )
    return list(result.scalars().all())


@router.get("/day-templates/{template_id}", response_model=DayTemplateResponse)
async def get_day_template(template_id: int, db: DbDep, _: AuthDep) -> DayTemplate:
    tmpl = await db.get(DayTemplate, template_id)
    if tmpl is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="テンプレートが見つかりません")
    return tmpl


@router.put("/day-templates/{template_id}", response_model=DayTemplateResponse)
async def update_day_template(
    template_id: int, body: DayTemplateUpdate, db: DbDep, _: AuthDep
) -> DayTemplate:
    tmpl = await db.get(DayTemplate, template_id)
    if tmpl is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="テンプレートが見つかりません")
    _apply_range_update(tmpl, body)
    await db.commit()
    await db.refresh(tmpl)
    return tmpl


@router.delete("/day-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_day_template(template_id: int, db: DbDep, _: AuthDep) -> None:
    tmpl = await db.get(DayTemplate, template_id)
    if tmpl is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="テンプレートが見つかりません")
    await db.delete(tmpl)
    await db.commit()


# --- DayOverride ---


@router.get("/day-overrides", response_model=list[DayOverrideResponse])
async def list_day_overrides(db: DbDep, _: AuthDep) -> list[DayOverride]:
    result = await db.execute(
        select(DayOverride).order_by(
            DayOverride.department_id, DayOverride.sort_order, DayOverride.id
        )
    )
    return list(result.scalars().all())


@router.post(
    "/day-overrides",
    response_model=DayOverrideResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_day_override(body: DayOverrideCreate, db: DbDep, _: AuthDep) -> DayOverride:
    max_order = (
        await db.execute(
            select(func.coalesce(func.max(DayOverride.sort_order), -1)).where(
                DayOverride.department_id == body.department_id
            )
        )
    ).scalar_one()
    override = DayOverride(**body.model_dump(), sort_order=int(max_order) + 1)
    db.add(override)
    await db.commit()
    await db.refresh(override)
    return override


@router.put("/day-overrides/reorder", response_model=list[DayOverrideResponse])
async def reorder_day_overrides(
    body: DayOverrideReorderRequest, db: DbDep, _: AuthDep
) -> list[DayOverride]:
    """部門内の特定日オーバーライド ID 配列順に sort_order を再採番する。"""
    if len(body.ids) != len(set(body.ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ids に重複が含まれています",
        )

    existing = (
        await db.execute(
            select(DayOverride.id).where(DayOverride.department_id == body.department_id)
        )
    ).scalars().all()

    if set(existing) != set(body.ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="並び替え対象の ID 集合が部門内の現存 ID と一致しません",
        )

    for index, override_id in enumerate(body.ids):
        await db.execute(
            update(DayOverride).where(DayOverride.id == override_id).values(sort_order=index)
        )
    await db.commit()

    result = await db.execute(
        select(DayOverride)
        .where(DayOverride.department_id == body.department_id)
        .order_by(DayOverride.sort_order, DayOverride.id)
    )
    return list(result.scalars().all())


@router.get("/day-overrides/{override_id}", response_model=DayOverrideResponse)
async def get_day_override(override_id: int, db: DbDep, _: AuthDep) -> DayOverride:
    override = await db.get(DayOverride, override_id)
    if override is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="オーバーライドが見つかりません")
    return override


@router.put("/day-overrides/{override_id}", response_model=DayOverrideResponse)
async def update_day_override(
    override_id: int, body: DayOverrideUpdate, db: DbDep, _: AuthDep
) -> DayOverride:
    override = await db.get(DayOverride, override_id)
    if override is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="オーバーライドが見つかりません")
    _apply_range_update(override, body)
    await db.commit()
    await db.refresh(override)
    return override


@router.delete("/day-overrides/{override_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_day_override(override_id: int, db: DbDep, _: AuthDep) -> None:
    override = await db.get(DayOverride, override_id)
    if override is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="オーバーライドが見つかりません")
    await db.delete(override)
    await db.commit()
