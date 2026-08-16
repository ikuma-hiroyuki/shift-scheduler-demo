"""
app/api/routers/schedules.py — 稼働表生成・照会・エクスポート・代休提案
"""
from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.models.schedule import ShiftAssignment, ShiftSchedule, ShiftShortageSlot
from app.models.user import User
from app.models.work_pattern import WorkPattern, WorkPatternGroup
from app.services.assignment_edit_service import (
    CellEditPayload,
    ConstraintViolation,
    apply_batch_edits,
    apply_cell_edit,
)
from app.services.assignment_label import cell_label
from app.services.compensatory_service import propose_compensatory
from app.services.export_service import export_schedule_csv_long, export_schedule_xlsx
from app.services.schedule_service import (
    enqueue_generation,
    get_schedule,
    list_schedules,
    request_cancel,
)

logger = logging.getLogger(__name__)

# クライアントへ返すハード制約違反メッセージ。
# 内部コード（H8/H10/H11/H13）と実装詳細（min/max、グループ ID 等）は
# 露出させず、ユーザーが状況を理解できる文言だけを返す。サーバ log には
# code と内部メッセージを残す。
_CONSTRAINT_USER_MESSAGES: dict[str, str] = {
    "H8": "選択した作業パターンは、同じ日に既に配置されている別の作業パターンと併用できません。",
    "H10": "この日は有給休暇のため、勤務に変更できません。",
    "H11": "曜日ごとの作業パターン人数条件を満たせなくなります。別のパターンを選んでください。",
    "H13": "同じ作業パターングループは 1 日 1 名までしか配置できません。",
}
_CONSTRAINT_DEFAULT_MESSAGE = "選択した変更は他の制約と矛盾するため確定できません。"


def _user_facing_message(code: str) -> str:
    return _CONSTRAINT_USER_MESSAGES.get(code, _CONSTRAINT_DEFAULT_MESSAGE)

router = APIRouter(prefix="/schedules", tags=["schedules"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AuthDep = Annotated[User, Depends(get_current_user)]


# ---- スキーマ ----

class GenerateRequest(BaseModel):
    department_id: int
    year: int
    month: int
    time_limit: float = 120.0
    workers: int = 4


class ShortageRowSchema(BaseModel):
    """PARTIAL 状態の不足ポジ 1 件 (1 日 × 1 作業パターン)。"""

    day: int
    pattern_id: int
    pattern_name: str
    required: int
    assigned: int
    missing: int


class ScheduleResponse(BaseModel):
    id: int
    department_id: int
    year: int
    month: int
    status: str
    generation_attempt: int
    is_active: bool
    diagnosis: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    time_limit: float
    last_heartbeat_at: datetime | None = None
    # PARTIAL 専用フィールド (それ以外の状態では None)
    shortages: list[ShortageRowSchema] | None = None
    # PARTIAL 状態で全不足が埋まったとき True。フロントが「シフトを確定」ボタンを有効化する
    can_finalize: bool = False

    model_config = {"from_attributes": True}


class CompensatoryRequest(BaseModel):
    employee_id: int
    target_date: date


class ProposalItem(BaseModel):
    date: date
    score: int
    reason: str


class CompensatoryResponse(BaseModel):
    proposals: list[ProposalItem]


class DayAssignment(BaseModel):
    day: int
    label: str
    # 構造化フィールド: クライアントは label 文字列の逆引きをやめ、これらを直接使用する。
    # 旧クライアント互換のため label も継続して返す。
    assignment_type: Literal["WORK", "REST", "LEAVE"] | None = None
    pattern_id: int | None = None
    leave_type: Literal["REQUESTED", "TENTATIVE", "MANDATORY"] | None = None


class EmployeeRow(BaseModel):
    id: int
    name: str
    role: str
    days: list[DayAssignment]


class AssignmentsResponse(BaseModel):
    year: int
    month: int
    employees: list[EmployeeRow]


class AssignmentPatchRequest(BaseModel):
    employee_id: int
    date: date
    assignment_type: Literal["WORK", "REST", "LEAVE"]
    pattern_id: int | None = None
    leave_type: Literal["REQUESTED", "TENTATIVE", "MANDATORY"] | None = None


class AssignmentPatchResponse(BaseModel):
    employee_id: int
    day: int
    label: str
    assignment_type: str
    pattern_id: int | None
    leave_type: Literal["REQUESTED", "TENTATIVE", "MANDATORY"] | None = None


class BatchAssignmentPatchRequest(BaseModel):
    edits: list[AssignmentPatchRequest]
    # issue #245: 人数系ハード制約 (H8/H11/H13) を無視して強制確定する。
    # 現場が人不足を承知で編集を保存するための上書きフラグ。
    # H10 (MANDATORY 有給 → WORK) は force でも常にブロック (PTO 記録保護)。
    force: bool = False


class CompensatorySuggestion(BaseModel):
    """REST → WORK 遷移を batch PATCH で検出した際に、backend が自動算出する代休候補。

    issue #91: REST → WORK 検知ロジックを frontend から backend に移管した結果。
    複数遷移ある場合は最初の 1 件のみ提案（旧 frontend 実装と同等の挙動）。
    """

    employee_id: int
    target_date: date
    proposals: list[ProposalItem]
    additional_transition_count: int = 0


class BatchAssignmentPatchResponse(BaseModel):
    results: list[AssignmentPatchResponse]
    compensatory_suggestion: CompensatorySuggestion | None = None


# ---- エンドポイント ----

@router.get("", response_model=list[ScheduleResponse])
async def list_schedules_endpoint(
    db: DbDep,
    _: AuthDep,
    department_id: int | None = None,
) -> list:
    return await list_schedules(db, department_id=department_id)


@router.post("/generate", response_model=ScheduleResponse, status_code=status.HTTP_202_ACCEPTED)
async def generate_schedule(body: GenerateRequest, db: DbDep, _: AuthDep):
    """稼働表生成ジョブをキューに投入する。レスポンスの status は "DRAFT" で返る。"""
    try:
        schedule = await enqueue_generation(
            db,
            department_id=body.department_id,
            year=body.year,
            month=body.month,
            time_limit=body.time_limit,
            workers=body.workers,
        )
    except Exception as exc:
        logger.exception("enqueue_generation_failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="キュー投入に失敗しました",
        )
    return schedule


# issue #196: stale GENERATING を検出する閾値。
# heartbeat の最終更新から time_limit の何倍経過したら worker 異常終了と見做すか。
# 実 solve は time_limit + 数秒で終わる想定なので 2 倍はゆとりを持った値。
_STALE_HEARTBEAT_FACTOR = 2.0
# 最低でもこれだけ経過していなければ stale 判定しない (短い time_limit での誤検出避け)。
_STALE_MIN_GRACE_SECONDS = 30.0


async def _build_schedule_response(
    schedule: ShiftSchedule, db: AsyncSession
) -> ScheduleResponse:
    """ShiftSchedule + PARTIAL 用の派生フィールドを ScheduleResponse に詰める。

    PARTIAL 状態のときのみ:
      - shortages は `ShiftShortageSlot` テーブルから現在値を読む (手動編集で missing_count が変動するため)
      - can_finalize は `ShiftShortageSlot` の残数で計算
    それ以外の状態では shortages=None, can_finalize=False。
    """
    base = ScheduleResponse(
        id=schedule.id,
        department_id=schedule.department_id,
        year=schedule.year,
        month=schedule.month,
        status=schedule.status,
        generation_attempt=schedule.generation_attempt,
        is_active=schedule.is_active,
        diagnosis=schedule.diagnosis,
        created_at=schedule.created_at,
        started_at=schedule.started_at,
        finished_at=schedule.finished_at,
        time_limit=schedule.time_limit,
        last_heartbeat_at=schedule.last_heartbeat_at,
    )
    if schedule.status != "PARTIAL":
        return base

    # pattern_name 引きのため work_patterns を一度ロード
    pattern_result = await db.execute(
        select(WorkPattern).join(WorkPatternGroup).where(
            WorkPatternGroup.department_id == schedule.department_id
        )
    )
    pid_to_name = {p.id: p.pattern_name for p in pattern_result.scalars().all()}

    slot_result = await db.execute(
        select(ShiftShortageSlot).where(
            ShiftShortageSlot.schedule_id == schedule.id
        )
    )
    slots = list(slot_result.scalars().all())
    live_shortages: list[ShortageRowSchema] = []
    remaining_open = 0
    for s in slots:
        if s.missing_count <= 0:
            continue
        remaining_open += 1
        live_shortages.append(ShortageRowSchema(
            day=s.date.day,
            pattern_id=s.pattern_id,
            pattern_name=pid_to_name.get(s.pattern_id, f"pattern#{s.pattern_id}"),
            required=s.required_min,
            assigned=max(0, s.required_min - s.missing_count),
            missing=s.missing_count,
        ))

    # choice_group 由来の不足 (pattern_id<0) は work_patterns FK 制約で ShortageSlot
    # に永続化できないため、生成時 snapshot を diagnosis_json から読む。手動編集連動は
    # 行わず、再生成までは固定値として表示する (現バージョンは表示のみ)。
    dj = schedule.diagnosis_json or {}
    snapshot_shortages = dj.get("shortages")
    if isinstance(snapshot_shortages, list):
        for raw in snapshot_shortages:
            try:
                pid = int(raw.get("pattern_id", 0))
            except (TypeError, ValueError):
                continue
            if pid >= 0:
                continue  # day_template 由来は ShortageSlot に既出
            missing = int(raw.get("missing", 0) or 0)
            if missing <= 0:
                continue
            remaining_open += 1
            live_shortages.append(ShortageRowSchema(
                day=int(raw.get("day", 0)),
                pattern_id=pid,
                pattern_name=str(raw.get("pattern_name", "")),
                required=int(raw.get("required", 0) or 0),
                assigned=int(raw.get("assigned", 0) or 0),
                missing=missing,
            ))

    live_shortages.sort(key=lambda r: (r.day, r.pattern_name))
    base.shortages = live_shortages
    base.can_finalize = remaining_open == 0
    return base


def _is_stale_generating(schedule: ShiftSchedule, now: datetime) -> bool:
    """GENERATING のまま heartbeat が古い行を worker 異常終了とみなすか。

    judgement:
      - status != GENERATING → False
      - started_at が無い → 評価不能、False (起動直後の取り扱い)
      - last_heartbeat_at が無い → started_at から time_limit*factor を超えていれば stale
      - last_heartbeat_at がある → そこから time_limit*factor を超えていれば stale
    """
    if schedule.status != "GENERATING":
        return False
    if schedule.started_at is None:
        return False
    threshold = max(
        _STALE_MIN_GRACE_SECONDS,
        (schedule.time_limit or 120.0) * _STALE_HEARTBEAT_FACTOR,
    )
    last = schedule.last_heartbeat_at or schedule.started_at
    age = (now - last).total_seconds()
    return age > threshold


@router.get("/{schedule_id}", response_model=ScheduleResponse)
async def get_schedule_status(schedule_id: int, db: DbDep, _: AuthDep):
    """スケジュールの現在ステータスを返す。INFEASIBLE/PARTIAL 時は diagnosis も含む。
    PARTIAL 時は shortages / can_finalize も派生フィールドとして含む。

    issue #196: status='GENERATING' のまま heartbeat が古い行は worker
    異常終了とみなして INFEASIBLE に flip し、永久 GENERATING を解消する。
    """
    schedule = await get_schedule(db, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="スケジュールが見つかりません")

    now = datetime.now(timezone.utc)
    if _is_stale_generating(schedule, now):
        logger.warning(
            "stale GENERATING detected: schedule=%d last_heartbeat=%s started=%s time_limit=%.1f",
            schedule_id,
            schedule.last_heartbeat_at,
            schedule.started_at,
            schedule.time_limit,
        )
        schedule.status = "INFEASIBLE"
        schedule.diagnosis = (
            "ワーカーが異常終了した可能性があります "
            "(heartbeat 途絶のためタイムアウト判定)。"
            "再度生成を実行してください。"
        )
        schedule.finished_at = now
        await db.commit()
        await db.refresh(schedule)

    return await _build_schedule_response(schedule, db)


@router.post(
    "/{schedule_id}/cancel",
    response_model=ScheduleResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def cancel_schedule(schedule_id: int, db: DbDep, _: AuthDep):
    """生成中スケジュールに停止要求を送る。

    DRAFT は即時 CANCELLED に確定、GENERATING はフラグのみ立てて worker が
    solver を停止した後に CANCELLED に確定する。それ以外の状態は 409。
    """
    schedule = await get_schedule(db, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="スケジュールが見つかりません")
    if schedule.status not in ("DRAFT", "GENERATING"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="生成中のスケジュールではないため停止できません",
        )

    try:
        updated = await request_cancel(db, schedule_id)
    except Exception as exc:
        logger.exception("cancel_schedule_failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="停止要求の送信に失敗しました",
        )
    if updated is None:
        # request_cancel から見て対象外（race で完了済みなど）
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="生成中のスケジュールではないため停止できません",
        )
    return updated


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(schedule_id: int, db: DbDep, _: AuthDep):
    """スケジュールを物理削除する。ShiftAssignment は CASCADE で自動削除される。"""
    schedule = await get_schedule(db, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="スケジュールが見つかりません")
    await db.execute(delete(ShiftSchedule).where(ShiftSchedule.id == schedule_id))
    await db.commit()


@router.post("/{schedule_id}/finalize", response_model=ScheduleResponse)
async def finalize_schedule(schedule_id: int, db: DbDep, _: AuthDep):
    """PARTIAL 状態のスケジュールを GENERATED に確定する。

    前提:
      - status == 'PARTIAL'
      - `ShiftShortageSlot` が 0 件 (手動編集ですべての不足が埋まっている)

    上記を満たさない場合は 409 を返す。
    """
    schedule = await get_schedule(db, schedule_id)
    if schedule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="スケジュールが見つかりません",
        )
    if schedule.status != "PARTIAL":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="PARTIAL 状態のスケジュールに対してのみ実行できます",
        )

    # ShortageSlot で missing_count > 0 が 1 件でも残っていれば finalize 不可。
    # `with_for_update()` で並列の PATCH/regenerate と直列化し TOCTOU を抑制。
    slot_result = await db.execute(
        select(ShiftShortageSlot)
        .where(
            ShiftShortageSlot.schedule_id == schedule_id,
            ShiftShortageSlot.missing_count > 0,
        )
        .with_for_update()
    )
    remaining = len(slot_result.scalars().all())
    if remaining > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"残り {remaining} 件の不足を解消してから確定してください",
        )

    schedule.status = "GENERATED"
    # diagnosis_json は履歴として残すが、UI 側は status で表示を切り替える
    await db.commit()
    await db.refresh(schedule)
    return await _build_schedule_response(schedule, db)


@router.get("/{schedule_id}/assignments", response_model=AssignmentsResponse)
async def get_schedule_assignments(schedule_id: int, db: DbDep, _: AuthDep):
    """
    生成済み稼働表の従業員×日付グリッドデータを返す。
    各セルのラベル: パターン名(A1等) / ●(希望休) / ○(仮休) / 有給 / 割当休日
    """
    schedule = await get_schedule(db, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="スケジュールが見つかりません")
    if schedule.status not in ("GENERATED", "PARTIAL"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="生成済み (GENERATED / PARTIAL) のスケジュールに対してのみ実行できます",
        )

    year, month = schedule.year, schedule.month

    # 従業員取得（部門でフィルタ・並び順順）
    emp_result = await db.execute(
        select(Employee)
        .where(Employee.department_id == schedule.department_id)
        .order_by(Employee.sort_order, Employee.id)
    )
    employees = list(emp_result.scalars().all())
    emp_ids = [e.id for e in employees]

    # WorkPattern 取得（部門でフィルタ・pattern_id → pattern_name）
    pat_result = await db.execute(
        select(WorkPattern)
        .join(WorkPatternGroup)
        .where(WorkPatternGroup.department_id == schedule.department_id)
    )
    pid_to_name: dict[int, str] = {p.id: p.pattern_name for p in pat_result.scalars().all()}

    # LeaveRequest 取得（LEAVE ラベル復元用）
    lr_result = await db.execute(
        select(LeaveRequest).where(
            LeaveRequest.year == year,
            LeaveRequest.month == month,
            LeaveRequest.employee_id.in_(emp_ids),
        )
    )
    leave_map: dict[tuple[int, int], str] = {
        (lr.employee_id, lr.day): lr.leave_type
        for lr in lr_result.scalars().all()
    }

    # ShiftAssignment 取得
    assign_result = await db.execute(
        select(ShiftAssignment).where(ShiftAssignment.schedule_id == schedule_id)
    )
    # (employee_id, day) → 構造化セル情報
    cell_map: dict[tuple[int, int], dict] = {}
    for a in assign_result.scalars().all():
        leave_type = None
        if a.assignment_type == "LEAVE":
            leave_type = leave_map.get((a.employee_id, a.date.day))
        cell_map[(a.employee_id, a.date.day)] = {
            "label": cell_label(a, leave_map, pid_to_name),
            "assignment_type": a.assignment_type,
            "pattern_id": a.pattern_id,
            "leave_type": leave_type,
        }

    # 従業員行を組み立て
    num_days = calendar.monthrange(year, month)[1]

    employee_rows: list[EmployeeRow] = []
    for e in employees:
        days = []
        for d in range(1, num_days + 1):
            cell = cell_map.get((e.id, d))
            if cell is None:
                days.append(DayAssignment(day=d, label=""))
            else:
                days.append(DayAssignment(day=d, **cell))
        employee_rows.append(EmployeeRow(id=e.id, name=e.name, role=e.role, days=days))

    return AssignmentsResponse(year=year, month=month, employees=employee_rows)


@router.get("/{schedule_id}/export")
async def export_schedule(schedule_id: int, db: DbDep, _: AuthDep):
    """生成済み稼働表を xlsx 形式でダウンロードする。"""
    schedule = await get_schedule(db, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="スケジュールが見つかりません")
    if schedule.status not in ("GENERATED", "PARTIAL"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="スケジュールはまだ生成されていません",
        )

    try:
        xlsx_bytes = await export_schedule_xlsx(db, schedule)
    except Exception as exc:
        logger.exception("export_xlsx_failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="エクスポートに失敗しました",
        )

    filename = f"shift_{schedule.year}_{schedule.month:02d}_attempt{schedule.generation_attempt}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{schedule_id}/export/csv")
async def export_schedule_csv(schedule_id: int, db: DbDep, _: AuthDep):
    """生成済み稼働表をロング形式 CSV でダウンロードする。"""
    schedule = await get_schedule(db, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="スケジュールが見つかりません")
    if schedule.status not in ("GENERATED", "PARTIAL"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="スケジュールはまだ生成されていません",
        )

    try:
        csv_bytes = await export_schedule_csv_long(db, schedule)
    except Exception as exc:
        logger.exception("export_csv_failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="エクスポートに失敗しました",
        )

    filename = f"shift_{schedule.year}_{schedule.month:02d}_attempt{schedule.generation_attempt}_long.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=cp932",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch(
    "/{schedule_id}/assignments",
    response_model=AssignmentPatchResponse,
)
async def patch_assignment(
    schedule_id: int,
    body: AssignmentPatchRequest,
    db: DbDep,
    _: AuthDep,
):
    """
    稼働表セルを 1 件手動編集する。

    ハード制約（H8/H10/H11/H13）を検査し、違反時は 409 に構造化エラーを返す。
    """
    schedule = await get_schedule(db, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="スケジュールが見つかりません")
    if schedule.status not in ("GENERATED", "PARTIAL"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="生成済み (GENERATED / PARTIAL) のスケジュールに対してのみ実行できます",
        )
    if body.date.year != schedule.year or body.date.month != schedule.month:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="date がスケジュールの年月と一致しません",
        )

    payload = CellEditPayload(
        employee_id=body.employee_id,
        date=body.date,
        assignment_type=body.assignment_type,
        pattern_id=body.pattern_id,
        leave_type=body.leave_type,
    )

    # SAVEPOINT で囲み、違反時は内側のみ巻き戻す（外側の txn / セッションは維持）
    try:
        async with db.begin_nested():
            assignment = await apply_cell_edit(db, schedule, payload)
    except ConstraintViolation as cv:
        logger.info(
            "constraint_violation code=%s message=%s conflicting=%s",
            cv.code, cv.message, cv.conflicting,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": _user_facing_message(cv.code)},
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

    # ラベル導出に必要な lookup を読む（編集後の値で再構成）
    pid_to_name: dict[int, str] = {}
    if assignment.pattern_id is not None:
        pat = await db.get(WorkPattern, assignment.pattern_id)
        if pat is not None:
            pid_to_name[pat.id] = pat.pattern_name

    leave_map: dict[tuple[int, int], str] = {}
    leave_type_value: str | None = None
    if assignment.assignment_type == "LEAVE":
        lr_result = await db.execute(
            select(LeaveRequest).where(
                LeaveRequest.employee_id == assignment.employee_id,
                LeaveRequest.year == schedule.year,
                LeaveRequest.month == schedule.month,
                LeaveRequest.day == assignment.date.day,
            )
        )
        lr = lr_result.scalar_one_or_none()
        if lr is not None:
            leave_map[(lr.employee_id, lr.day)] = lr.leave_type
            leave_type_value = lr.leave_type

    label = cell_label(assignment, leave_map, pid_to_name)

    await db.commit()

    return AssignmentPatchResponse(
        employee_id=assignment.employee_id,
        day=assignment.date.day,
        label=label,
        assignment_type=assignment.assignment_type,
        pattern_id=assignment.pattern_id,
        leave_type=leave_type_value,
    )


@router.patch(
    "/{schedule_id}/assignments/batch",
    response_model=BatchAssignmentPatchResponse,
)
async def patch_assignments_batch(
    schedule_id: int,
    body: BatchAssignmentPatchRequest,
    db: DbDep,
    user: AuthDep,
):
    """
    稼働表セルを一括で手動編集する。

    全 edit を DB に upsert した後にハード制約（H8/H10/H11/H13）を検査する。
    1 件でも違反があれば rollback して 409 を返す。swap 等の多段編集で
    中間状態がハード制約を一時的に満たさないケースを許容するためのエンドポイント。

    body.force=True のときは人数系ハード制約 (H8/H11/H13) をスキップして強制確定する
    (issue #245)。H10 (MANDATORY 有給 → WORK) は force でも常にブロックし、
    入力整合性違反 (400) も force でも弾く。
    """
    schedule = await get_schedule(db, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="スケジュールが見つかりません")
    if schedule.status not in ("GENERATED", "PARTIAL"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="生成済み (GENERATED / PARTIAL) のスケジュールに対してのみ実行できます",
        )
    if len(body.edits) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="edits が空です")
    for i, e in enumerate(body.edits):
        if e.date.year != schedule.year or e.date.month != schedule.month:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"edits[{i}].date がスケジュールの年月と一致しません",
            )

    payloads = [
        CellEditPayload(
            employee_id=e.employee_id,
            date=e.date,
            assignment_type=e.assignment_type,
            pattern_id=e.pattern_id,
            leave_type=e.leave_type,
        )
        for e in body.edits
    ]

    # 編集前の assignment_type を取得（REST → WORK 遷移の検出用）
    # issue #91: 旧 frontend の restToWork 検知ロジックを backend に集約。
    # SQL 側で employee_id と date の集合に絞り込んでから、Python 側で
    # 厳密な (employee_id, date) タプル一致を確認する 2 段フィルタ。
    edit_keys = {(e.employee_id, e.date) for e in body.edits}
    prior_state: dict[tuple[int, date], str | None] = {}
    if edit_keys:
        edit_emp_ids = {emp_id for emp_id, _ in edit_keys}
        edit_dates = {d for _, d in edit_keys}
        prior_result = await db.execute(
            select(ShiftAssignment).where(
                ShiftAssignment.schedule_id == schedule_id,
                ShiftAssignment.employee_id.in_(edit_emp_ids),
                ShiftAssignment.date.in_(edit_dates),
            )
        )
        for a in prior_result.scalars().all():
            if (a.employee_id, a.date) in edit_keys:
                prior_state[(a.employee_id, a.date)] = a.assignment_type

    # SAVEPOINT で囲み、違反時は内側のみ巻き戻す（外側の txn / セッションは維持）
    try:
        async with db.begin_nested():
            assignments = await apply_batch_edits(db, schedule, payloads, force=body.force)
    except ConstraintViolation as cv:
        logger.info(
            "constraint_violation_batch code=%s message=%s conflicting=%s",
            cv.code, cv.message, cv.conflicting,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": _user_facing_message(cv.code)},
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

    if body.force:
        # 業務ルール (H8/H10/H11/H13) を上書きする操作は誰が実行したか追跡できるよう記録する。
        logger.info(
            "forced_batch_commit user=%s schedule=%s edits=%d "
            "(ハード制約を無視して強制確定)",
            user.id, schedule_id, len(body.edits),
        )

    # ラベル導出用 lookup を構築
    pattern_ids_needed = {a.pattern_id for a in assignments if a.pattern_id is not None}
    pid_to_name: dict[int, str] = {}
    if pattern_ids_needed:
        pat_result = await db.execute(
            select(WorkPattern).where(WorkPattern.id.in_(pattern_ids_needed))
        )
        for p in pat_result.scalars().all():
            pid_to_name[p.id] = p.pattern_name

    leave_map: dict[tuple[int, int], str] = {}
    leave_keys = {
        (a.employee_id, a.date.day) for a in assignments if a.assignment_type == "LEAVE"
    }
    if leave_keys:
        emp_ids = {e for e, _ in leave_keys}
        lr_result = await db.execute(
            select(LeaveRequest).where(
                LeaveRequest.year == schedule.year,
                LeaveRequest.month == schedule.month,
                LeaveRequest.employee_id.in_(emp_ids),
            )
        )
        for lr in lr_result.scalars().all():
            if (lr.employee_id, lr.day) in leave_keys:
                leave_map[(lr.employee_id, lr.day)] = lr.leave_type

    results = [
        AssignmentPatchResponse(
            employee_id=a.employee_id,
            day=a.date.day,
            label=cell_label(a, leave_map, pid_to_name),
            assignment_type=a.assignment_type,
            pattern_id=a.pattern_id,
            leave_type=(
                leave_map.get((a.employee_id, a.date.day))
                if a.assignment_type == "LEAVE"
                else None
            ),
        )
        for a in assignments
    ]

    # REST → WORK 遷移を検出して代休候補を自動算出（issue #91: frontend からの自動呼び出し廃止）。
    rest_to_work_transitions: list[tuple[int, date]] = []
    for a in assignments:
        if a.assignment_type != "WORK":
            continue
        prior = prior_state.get((a.employee_id, a.date))
        if prior is None or prior == "REST":
            rest_to_work_transitions.append((a.employee_id, a.date))

    compensatory_suggestion: CompensatorySuggestion | None = None
    if rest_to_work_transitions:
        first_emp, first_date = rest_to_work_transitions[0]
        proposals = await propose_compensatory(
            db,
            schedule_id=schedule_id,
            employee_id=first_emp,
            target_date=first_date,
        )
        if proposals:
            compensatory_suggestion = CompensatorySuggestion(
                employee_id=first_emp,
                target_date=first_date,
                proposals=[
                    ProposalItem(date=p.date, score=p.score, reason=p.reason)
                    for p in proposals
                ],
                additional_transition_count=max(0, len(rest_to_work_transitions) - 1),
            )

    await db.commit()

    return BatchAssignmentPatchResponse(
        results=results,
        compensatory_suggestion=compensatory_suggestion,
    )


@router.post("/{schedule_id}/compensatory", response_model=CompensatoryResponse)
async def compensatory_proposals(
    schedule_id: int,
    body: CompensatoryRequest,
    db: DbDep,
    _: AuthDep,
):
    """手動調整（REST → WORK）後の代休候補日を最大3件返す。"""
    schedule = await get_schedule(db, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="スケジュールが見つかりません")
    if schedule.status not in ("GENERATED", "PARTIAL"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="生成済み (GENERATED / PARTIAL) のスケジュールに対してのみ実行できます",
        )

    proposals = await propose_compensatory(
        db,
        schedule_id=schedule_id,
        employee_id=body.employee_id,
        target_date=body.target_date,
    )
    return CompensatoryResponse(
        proposals=[ProposalItem(date=p.date, score=p.score, reason=p.reason) for p in proposals]
    )
