"""
app/api/routers/imports.py — 勤務希望 CSV インポート
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.services.choice_group_import_service import import_choice_groups_csv
from app.services.day_template_import_service import import_day_templates_csv
from app.services.employee_import_service import import_employees_csv
from app.services.employee_priority_import_service import (
    import_employee_priorities_csv,
)
from app.services.import_service import import_roster_csv
from app.services.pattern_trigger_import_service import import_pattern_triggers_csv

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/imports", tags=["imports"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AuthDep = Annotated[User, Depends(get_current_user)]


class ImportResult(BaseModel):
    created: int
    skipped: int
    year: int
    month: int


class EmployeeImportResult(BaseModel):
    created: int
    updated: int
    moved: int
    errors: list[str]


class EmployeePriorityImportResult(BaseModel):
    created: int
    updated: int
    deleted: int
    skipped: int
    errors: list[str]


class DayTemplateImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[str]


class ChoiceGroupImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[str]


class PatternTriggerImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[str]


@router.post("/roster", response_model=ImportResult, status_code=status.HTTP_200_OK)
async def import_roster(
    db: DbDep,
    _: AuthDep,
    file: UploadFile = File(...),
    department_id: int = Form(...),
    year: int | None = Form(default=None),
    month: int | None = Form(default=None),
):
    """
    勤務希望 CSV（MonShift形式）をアップロードして LeaveRequest に登録する。
    year/month は省略可能。省略時は CSV の日付列から自動検出する。
    同部門・同年月の既存データは上書きされる。

    CSV フォーマット（MonShift形式）:
      氏名, 役職, 従業員番号, 日付(YYYY/M/D), 休日区分(1=希望休/2=仮休/3=有給)
      ※ 氏名・役職列は任意（なくても可）
    """
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV ファイルをアップロードしてください",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ファイルが空です",
        )

    try:
        result = await import_roster_csv(
            db,
            csv_bytes=content,
            department_id=department_id,
            year=year,
            month=month,
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="CSV の形式が正しくありません。日付列（YYYY/M/D形式）を確認してください。",
        )
    except Exception as exc:
        logger.exception("import_roster_failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="インポートに失敗しました",
        )

    return ImportResult(**result)


@router.post(
    "/employees",
    response_model=EmployeeImportResult,
    status_code=status.HTTP_200_OK,
)
async def import_employees(
    db: DbDep,
    _: AuthDep,
    file: UploadFile = File(...),
    department_id: int = Form(...),
):
    """
    employees.csv をアップロードして従業員マスタを Upsert する。
    employee_number 一致で更新、未存在は新規作成。department_id は全行に適用。

    CSV フォーマット (display_order は任意列):
      employee_number,name,role,available_days,available_shift_types,consecutive_workable[,display_order]
    """
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV ファイルをアップロードしてください",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ファイルが空です",
        )

    try:
        result = await import_employees_csv(
            db,
            department_id=department_id,
            csv_bytes=content,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return EmployeeImportResult(**result)


@router.post(
    "/employee-priorities",
    response_model=EmployeePriorityImportResult,
    status_code=status.HTTP_200_OK,
)
async def import_employee_priorities(
    db: DbDep,
    _: AuthDep,
    file: UploadFile = File(...),
    department_id: int = Form(...),
):
    """
    employee_priorities.csv をアップロードし、(employee, pattern) で Upsert する。
    priority=0 は既存レコードを削除する（loader が priority>0 のみ参照する仕様に合わせる）。

    CSV フォーマット:
      employee_id,pattern_name,priority
    """
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV ファイルをアップロードしてください",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ファイルが空です",
        )

    try:
        result = await import_employee_priorities_csv(
            db,
            department_id=department_id,
            csv_bytes=content,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return EmployeePriorityImportResult(**result)


@router.post(
    "/day-templates",
    response_model=DayTemplateImportResult,
    status_code=status.HTTP_200_OK,
)
async def import_day_templates(
    db: DbDep,
    _: AuthDep,
    file: UploadFile = File(...),
    department_id: int = Form(...),
):
    """
    day_templates.csv をアップロードして曜日別テンプレートを Upsert する。
    キーは (department_id, weekday, pattern_id) で、required_min / required_max を更新する。

    CSV フォーマット:
      weekday,pattern_name,required_min,required_max

    required_max は任意列（空欄＝厳格）。pattern は部門内の作業パターン名で解決する。
    """
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV ファイルをアップロードしてください",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ファイルが空です",
        )

    try:
        result = await import_day_templates_csv(
            db,
            department_id=department_id,
            csv_bytes=content,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return DayTemplateImportResult(**result)


@router.post(
    "/choice-groups",
    response_model=ChoiceGroupImportResult,
    status_code=status.HTTP_200_OK,
)
async def import_choice_groups(
    db: DbDep,
    _: AuthDep,
    file: UploadFile = File(...),
    department_id: int = Form(...),
):
    """
    choice_groups.csv をアップロードして作業パターン選択グループを Upsert する。
    キーは (department_id, day_of_week, candidate_set) で、min_count / max_count を更新する。

    CSV フォーマット:
      pattern_names,min_count,max_count[,day_of_week]

    pattern_names は `;` 区切りで部門内の作業パターン名を並べる。
    day_of_week は省略 / 空欄で「毎日 (null)」、0=月〜6=日。
    """
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV ファイルをアップロードしてください",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ファイルが空です",
        )

    try:
        result = await import_choice_groups_csv(
            db,
            department_id=department_id,
            csv_bytes=content,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return ChoiceGroupImportResult(**result)


@router.post(
    "/pattern-triggers",
    response_model=PatternTriggerImportResult,
    status_code=status.HTTP_200_OK,
)
async def import_pattern_triggers(
    db: DbDep,
    _: AuthDep,
    file: UploadFile = File(...),
    department_id: int = Form(...),
):
    """
    pattern_triggers.csv をアップロードして補助ポジション発生条件を Upsert する。
    キーは (department_id, auxiliary_group_id) で、required_group_set を更新する。

    CSV フォーマット:
      auxiliary_group_name,required_group_names

    required_group_names は `;` 区切りで部門内の作業パターングループ名を並べる。
    """
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV ファイルをアップロードしてください",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ファイルが空です",
        )

    try:
        result = await import_pattern_triggers_csv(
            db,
            department_id=department_id,
            csv_bytes=content,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return PatternTriggerImportResult(**result)
