"""
app/services/assignment_edit_service.py — 稼働表セル手動編集

`apply_cell_edit` がハード制約（H8/H10/H11/H13）を検査し、通過したら
`ShiftAssignment` / `LeaveRequest` を 1 トランザクションで upsert する。

対象制約:
  H8  PatternIncompatibility    — 同日に併用不可な作業パターン対
  H10 MANDATORY 有給             — 有給日を WORK に変更不可
  H11 PatternChoiceGroup         — 該当曜日の候補パターン使用数 min..max
  H13 作業パターングループ 1日1名 — 同日に同グループを 2 名以上に配置不可

ソフト制約（公平性・連勤選好など）は編集時には無視する。人間判断の上書きが目的。
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_type
from typing import Literal

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.choice_group import (
    PatternChoiceGroup,
    PatternChoiceGroupCandidate,
    PatternIncompatibility,
)
from app.models.leave_request import LeaveRequest
from app.models.schedule import ShiftAssignment, ShiftSchedule, ShiftShortageSlot
from app.models.work_pattern import WorkPattern

AssignmentType = Literal["WORK", "REST", "LEAVE"]
LeaveType = Literal["REQUESTED", "TENTATIVE", "MANDATORY"]


class ConstraintViolation(Exception):
    """ハード制約違反。router で 409 に変換される。"""

    def __init__(
        self,
        code: Literal["H8", "H10", "H11", "H13"],
        message: str,
        conflicting: dict | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.conflicting = conflicting or {}
        super().__init__(f"{code}: {message}")


@dataclass
class CellEditPayload:
    employee_id: int
    date: date_type
    assignment_type: AssignmentType
    pattern_id: int | None = None
    leave_type: LeaveType | None = None


def _validate_payload_shape(payload: CellEditPayload) -> None:
    if payload.assignment_type == "WORK" and payload.pattern_id is None:
        raise ValueError("WORK には pattern_id が必須です")
    if payload.assignment_type == "LEAVE" and payload.leave_type is None:
        raise ValueError("LEAVE には leave_type が必須です")
    if payload.assignment_type != "WORK" and payload.pattern_id is not None:
        raise ValueError("WORK 以外では pattern_id は指定できません")


async def apply_cell_edit(
    db: AsyncSession,
    schedule: ShiftSchedule,
    payload: CellEditPayload,
) -> ShiftAssignment:
    """
    1 セルの編集を適用する。検査通過後、ShiftAssignment と必要なら LeaveRequest を更新。

    呼出側のルータで `async with db.begin()` のトランザクション内に包むこと。
    ConstraintViolation が上がった場合は rollback → 409 返却。
    """
    _validate_payload_shape(payload)

    # ---- 既存アサイン取得（upsert 用） ----
    prior = await _load_prior_assignment(
        db, schedule.id, payload.employee_id, payload.date
    )

    # ---- ハード制約検査（H8 → H10 → H11 → H13 の順） ----
    if payload.assignment_type == "WORK":
        assert payload.pattern_id is not None  # 入力整合性でガード済
        await _validate_h8_incompatibility(
            db, schedule, payload.date, payload.pattern_id,
            editing_employee_id=payload.employee_id,
        )
        await _validate_h10_leave(db, payload.employee_id, payload.date)
        await _validate_h13_group_unique(
            db, schedule.id, payload.employee_id, payload.date, payload.pattern_id,
        )

    await _validate_h11_choice_group(
        db,
        schedule=schedule,
        target_date=payload.date,
        editing_employee_id=payload.employee_id,
        prior_pattern_id=prior.pattern_id if prior else None,
        new_pattern_id=payload.pattern_id,
    )

    # ShortageSlot 反映用に prior の WORK 情報をキャプチャ (write 後だと失われる)
    prior_was_work = prior is not None and prior.assignment_type == "WORK"
    prior_pattern_id_for_slot = prior.pattern_id if prior_was_work else None

    # ---- 書き込み ----
    if prior is None:
        assignment = ShiftAssignment(
            schedule_id=schedule.id,
            employee_id=payload.employee_id,
            date=payload.date,
            assignment_type=payload.assignment_type,
            pattern_id=payload.pattern_id,
        )
        db.add(assignment)
    else:
        prior.assignment_type = payload.assignment_type
        prior.pattern_id = payload.pattern_id
        assignment = prior

    # LeaveRequest 同期（LEAVE への/からの遷移）
    await _sync_leave_request(
        db,
        employee_id=payload.employee_id,
        target_date=payload.date,
        new_type=payload.assignment_type,
        new_leave_type=payload.leave_type,
    )

    # PARTIAL 状態の ShortageSlot 連動 (pattern-swap や WORK→REST も正しく扱う)
    if schedule.status == "PARTIAL":
        await _sync_shortage_slot_for_edit(
            db,
            schedule_id=schedule.id,
            target_date=payload.date,
            prior_was_work=prior_was_work,
            prior_pattern_id=prior_pattern_id_for_slot,
            new_is_work=payload.assignment_type == "WORK",
            new_pattern_id=payload.pattern_id,
        )

    await db.flush()
    return assignment


async def apply_batch_edits(
    db: AsyncSession,
    schedule: ShiftSchedule,
    payloads: list[CellEditPayload],
    *,
    force: bool = False,
) -> list[ShiftAssignment]:
    """
    複数セルを一括で適用する。全セル upsert 後にハード制約を検査し、違反があれば
    `ConstraintViolation` を投げて呼出側で rollback させる。

    swap 等の多段編集を可能にするため、H8/H11/H13 は「全 edit 適用後」の DB 状態で
    検査する。H10（MANDATORY 有給 → WORK）は LeaveRequest 同期で消える情報を使うため、
    upsert 前に prior 状態をキャプチャしてから検査する。

    force=True のときは人数系ハード制約（H8/H11/H13）の検査をスキップする
    （issue #245: 人不足を承知で現場が強制確定するため）。ただし H10
    （MANDATORY 有給 → WORK）だけは force でも常に enforce する: 上書きすると
    有給レコードが削除され法的 PTO の記録が失われるため。入力整合性検査
    （_validate_payload_shape）と ShortageSlot 同期は force でも実行する。
    """
    for i, p in enumerate(payloads):
        try:
            _validate_payload_shape(p)
        except ValueError as ve:
            raise ValueError(f"edits[{i}]: {ve}")

    # prior 取得 (H10 用に leave_type、ShiftAssignment upsert 用に prior assignment、
    # ShortageSlot 同期用に WORK/pattern_id のスナップショット)
    # 注: prior_a は upsert ループで mutate されるため、ShortageSlot 同期に必要な
    # 「元の」値はここで scalar として独立にキャプチャする。
    prior_infos: list[tuple[ShiftAssignment | None, str | None]] = []
    prior_work_snapshots: list[tuple[bool, int | None]] = []
    for p in payloads:
        prior_a = await _load_prior_assignment(db, schedule.id, p.employee_id, p.date)
        prior_leave = await _load_prior_leave_type(db, p.employee_id, p.date)
        prior_infos.append((prior_a, prior_leave))
        was_work = prior_a is not None and prior_a.assignment_type == "WORK"
        prior_work_snapshots.append((was_work, prior_a.pattern_id if was_work else None))

    # H10 事前チェック（LeaveRequest 同期で消える前）。
    # H10 は force でも常に enforce する: MANDATORY 有給を WORK にすると
    # _sync_leave_request が LeaveRequest を削除してしまい、法的 PTO の記録が
    # 失われるため (codex review #2 / issue #245 の方針確認で上書き対象から除外)。
    for i, (p, (_, prior_leave)) in enumerate(zip(payloads, prior_infos)):
        if p.assignment_type == "WORK" and prior_leave == "MANDATORY":
            raise ConstraintViolation(
                code="H10",
                message="有給（MANDATORY）の日を WORK に変更することはできません",
                conflicting={"edit_index": i, "employee_id": p.employee_id, "date": p.date.isoformat()},
            )

    # 全 upsert を先に適用
    assignments: list[ShiftAssignment] = []
    for p, (prior_a, _) in zip(payloads, prior_infos):
        if prior_a is None:
            a = ShiftAssignment(
                schedule_id=schedule.id,
                employee_id=p.employee_id,
                date=p.date,
                assignment_type=p.assignment_type,
                pattern_id=p.pattern_id,
            )
            db.add(a)
        else:
            prior_a.assignment_type = p.assignment_type
            prior_a.pattern_id = p.pattern_id
            a = prior_a
        await _sync_leave_request(
            db,
            employee_id=p.employee_id,
            target_date=p.date,
            new_type=p.assignment_type,
            new_leave_type=p.leave_type,
        )
        assignments.append(a)

    await db.flush()

    if not force:
        # H8/H13 は edit 単位で post-state 検査
        for i, p in enumerate(payloads):
            if p.assignment_type == "WORK":
                assert p.pattern_id is not None
                try:
                    await _validate_h8_incompatibility(
                        db, schedule, p.date, p.pattern_id,
                        editing_employee_id=p.employee_id,
                    )
                    await _validate_h13_group_unique(
                        db, schedule.id, p.employee_id, p.date, p.pattern_id,
                    )
                except ConstraintViolation as cv:
                    cv.conflicting["edit_index"] = i
                    raise

        # H11 は影響日単位で post-state 検査（編集中従業員の +1 補正不要）
        affected_dates = {p.date for p in payloads}
        for d in sorted(affected_dates):
            await _validate_h11_post_state(db, schedule, d)

    # PARTIAL 状態のとき、各 edit の prior/new 差分で ShortageSlot を反映。
    # prior_a は upsert ループで mutate されているため、最初に取った
    # prior_work_snapshots を使う (現在値ではなく元値で判定)。
    if schedule.status == "PARTIAL":
        for p, (prior_was_work, prior_pattern_id_for_slot) in zip(
            payloads, prior_work_snapshots
        ):
            await _sync_shortage_slot_for_edit(
                db,
                schedule_id=schedule.id,
                target_date=p.date,
                prior_was_work=prior_was_work,
                prior_pattern_id=prior_pattern_id_for_slot,
                new_is_work=p.assignment_type == "WORK",
                new_pattern_id=p.pattern_id,
            )

    return assignments


async def _sync_shortage_slot_for_edit(
    db: AsyncSession,
    *,
    schedule_id: int,
    target_date: date_type,
    prior_was_work: bool,
    prior_pattern_id: int | None,
    new_is_work: bool,
    new_pattern_id: int | None,
) -> None:
    """1 件のセル編集後、ShortageSlot の `missing_count` を差分で同期する。

    ケース別:
      - prior=WORK A, new=WORK A: 同じパターンなのでスロット変動なし
      - prior=WORK A, new=WORK B (A != B): A の slot を復元 (+1)、B の slot を消費 (-1)
      - prior=WORK A, new=REST/LEAVE: A の slot を復元 (+1)
      - prior=REST/LEAVE, new=WORK B: B の slot を消費 (-1)
      - prior=REST/LEAVE, new=REST/LEAVE: 変動なし

    並列 PATCH の TOCTOU は SELECT FOR UPDATE で抑制。
    """
    same_pattern = (
        prior_was_work and new_is_work and prior_pattern_id == new_pattern_id
    )
    if same_pattern:
        return
    if prior_was_work and prior_pattern_id is not None:
        await _recalc_shortage_slot(db, schedule_id, target_date, prior_pattern_id)
    if new_is_work and new_pattern_id is not None:
        await _recalc_shortage_slot(db, schedule_id, target_date, new_pattern_id)


async def _recalc_shortage_slot(
    db: AsyncSession,
    schedule_id: int,
    target_date: date_type,
    pattern_id: int,
) -> None:
    """該当 ShortageSlot の `missing_count` を実 WORK 割当数から再計算する。

    `missing = max(0, required_min - 実WORK数)`。範囲枠 (required_max) で下限を超えて
    手動追加 (over-fill) した後に削除しても、単純な ±1 ではなく実数ベースで再計算する
    ため phantom shortage (満たしているのに不足表示) が出ない (issue #247)。

    マッチする `ShiftShortageSlot` が無いときは何もしない (元々不足のなかった枠)。
    並列 PATCH の TOCTOU を防ぐため SELECT に `with_for_update()` で行ロックを掛ける。
    実 WORK 数の集計は autoflush により、呼び出し前の同一セッションでの割当変更も
    反映される (caller は本関数の直後に db.flush() する)。CHECK constraint
    `missing_count >= 0 AND <= required_min` (migration 0009 / 列は 0011 で rename)
    が範囲外の永続化を DB レベルでも遮断する。
    """
    result = await db.execute(
        select(ShiftShortageSlot)
        .where(
            ShiftShortageSlot.schedule_id == schedule_id,
            ShiftShortageSlot.date == target_date,
            ShiftShortageSlot.pattern_id == pattern_id,
        )
        .with_for_update()
    )
    slot = result.scalar_one_or_none()
    if slot is None:
        return
    work_count = (
        await db.execute(
            select(func.count())
            .select_from(ShiftAssignment)
            .where(
                ShiftAssignment.schedule_id == schedule_id,
                ShiftAssignment.date == target_date,
                ShiftAssignment.pattern_id == pattern_id,
                ShiftAssignment.assignment_type == "WORK",
            )
        )
    ).scalar_one()
    slot.missing_count = max(0, slot.required_min - work_count)


# ---- プライベートヘルパー ----

async def _load_prior_assignment(
    db: AsyncSession, schedule_id: int, employee_id: int, target_date: date_type,
) -> ShiftAssignment | None:
    result = await db.execute(
        select(ShiftAssignment).where(
            ShiftAssignment.schedule_id == schedule_id,
            ShiftAssignment.employee_id == employee_id,
            ShiftAssignment.date == target_date,
        )
    )
    return result.scalar_one_or_none()


async def _load_prior_leave_type(
    db: AsyncSession, employee_id: int, target_date: date_type,
) -> str | None:
    result = await db.execute(
        select(LeaveRequest.leave_type).where(
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.year == target_date.year,
            LeaveRequest.month == target_date.month,
            LeaveRequest.day == target_date.day,
        )
    )
    return result.scalar_one_or_none()


async def _validate_h11_post_state(
    db: AsyncSession,
    schedule: ShiftSchedule,
    target_date: date_type,
) -> None:
    """
    バッチ編集後の最終状態で H11 人数制約を検査する。編集中従業員の補正は不要
    （upsert 済みで DB に反映されているため）。
    """
    weekday = target_date.weekday()
    groups_result = await db.execute(
        select(PatternChoiceGroup).where(
            PatternChoiceGroup.department_id == schedule.department_id,
            (PatternChoiceGroup.day_of_week.is_(None))
            | (PatternChoiceGroup.day_of_week == weekday),
        )
    )
    groups = list(groups_result.scalars().all())
    if not groups:
        return

    candidates_result = await db.execute(
        select(PatternChoiceGroupCandidate).where(
            PatternChoiceGroupCandidate.choice_group_id.in_([g.id for g in groups])
        )
    )
    by_group: dict[int, set[int]] = {}
    for c in candidates_result.scalars().all():
        by_group.setdefault(c.choice_group_id, set()).add(c.pattern_id)

    same_day_result = await db.execute(
        select(ShiftAssignment).where(
            ShiftAssignment.schedule_id == schedule.id,
            ShiftAssignment.date == target_date,
            ShiftAssignment.assignment_type == "WORK",
        )
    )
    same_day = list(same_day_result.scalars().all())

    for g in groups:
        candidate_pids = by_group.get(g.id, set())
        if not candidate_pids:
            continue
        count = sum(1 for a in same_day if a.pattern_id in candidate_pids)
        if count < g.min_count or count > g.max_count:
            raise ConstraintViolation(
                code="H11",
                message=(
                    f"作業パターン選択グループ(id={g.id}) の人数制約を満たしません "
                    f"(要: {g.min_count}..{g.max_count}, 編集後: {count})"
                ),
                conflicting={
                    "choice_group_id": g.id,
                    "min_count": g.min_count,
                    "max_count": g.max_count,
                    "count_after_edit": count,
                    "date": target_date.isoformat(),
                },
            )


async def _validate_h8_incompatibility(
    db: AsyncSession,
    schedule: ShiftSchedule,
    target_date: date_type,
    new_pattern_id: int,
    editing_employee_id: int,
) -> None:
    incomp_result = await db.execute(
        select(PatternIncompatibility).where(
            PatternIncompatibility.department_id == schedule.department_id,
        )
    )
    pairs = [(i.pattern_id_a, i.pattern_id_b) for i in incomp_result.scalars().all()]
    partners = {b for a, b in pairs if a == new_pattern_id} | {
        a for a, b in pairs if b == new_pattern_id
    }
    if not partners:
        return

    same_day_result = await db.execute(
        select(ShiftAssignment).where(
            ShiftAssignment.schedule_id == schedule.id,
            ShiftAssignment.date == target_date,
            ShiftAssignment.assignment_type == "WORK",
            ShiftAssignment.employee_id != editing_employee_id,
            ShiftAssignment.pattern_id.in_(partners),
        )
    )
    conflict = same_day_result.scalars().first()
    if conflict is not None:
        raise ConstraintViolation(
            code="H8",
            message="同日に併用できない作業パターンが既に配置されています",
            conflicting={
                "partner_pattern_id": conflict.pattern_id,
                "partner_employee_id": conflict.employee_id,
            },
        )


async def _validate_h10_leave(
    db: AsyncSession, employee_id: int, target_date: date_type,
) -> None:
    result = await db.execute(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.year == target_date.year,
            LeaveRequest.month == target_date.month,
            LeaveRequest.day == target_date.day,
            LeaveRequest.leave_type == "MANDATORY",
        )
    )
    if result.scalar_one_or_none() is not None:
        raise ConstraintViolation(
            code="H10",
            message="有給（MANDATORY）の日を WORK に変更することはできません",
        )


async def _validate_h11_choice_group(
    db: AsyncSession,
    schedule: ShiftSchedule,
    target_date: date_type,
    editing_employee_id: int,
    prior_pattern_id: int | None,
    new_pattern_id: int | None,
) -> None:
    # 変更でパターンの増減が無ければ検査不要
    if prior_pattern_id == new_pattern_id:
        return

    weekday = target_date.weekday()
    groups_result = await db.execute(
        select(PatternChoiceGroup).where(
            PatternChoiceGroup.department_id == schedule.department_id,
            (PatternChoiceGroup.day_of_week.is_(None))
            | (PatternChoiceGroup.day_of_week == weekday),
        )
    )
    groups = list(groups_result.scalars().all())
    if not groups:
        return

    candidates_result = await db.execute(
        select(PatternChoiceGroupCandidate).where(
            PatternChoiceGroupCandidate.choice_group_id.in_([g.id for g in groups])
        )
    )
    by_group: dict[int, set[int]] = {}
    for c in candidates_result.scalars().all():
        by_group.setdefault(c.choice_group_id, set()).add(c.pattern_id)

    # 該当日の全 WORK アサイン（編集中従業員は除外し、後で +1 する）
    same_day_result = await db.execute(
        select(ShiftAssignment).where(
            ShiftAssignment.schedule_id == schedule.id,
            ShiftAssignment.date == target_date,
            ShiftAssignment.assignment_type == "WORK",
        )
    )
    same_day = list(same_day_result.scalars().all())

    for group in groups:
        candidate_pids = by_group.get(group.id, set())
        if not candidate_pids:
            continue
        # この group の候補に prior / new が含まれていなければ影響なし
        prior_in = prior_pattern_id in candidate_pids if prior_pattern_id else False
        new_in = new_pattern_id in candidate_pids if new_pattern_id else False
        if not (prior_in or new_in):
            continue

        count = sum(
            1
            for a in same_day
            if a.pattern_id in candidate_pids
            and a.employee_id != editing_employee_id
        )
        if new_in:
            count += 1

        if count < group.min_count or count > group.max_count:
            raise ConstraintViolation(
                code="H11",
                message=(
                    f"作業パターン選択グループ(id={group.id}) の人数制約を満たしません "
                    f"(要: {group.min_count}..{group.max_count}, 編集後: {count})"
                ),
                conflicting={
                    "choice_group_id": group.id,
                    "min_count": group.min_count,
                    "max_count": group.max_count,
                    "count_after_edit": count,
                },
            )


async def _validate_h13_group_unique(
    db: AsyncSession,
    schedule_id: int,
    editing_employee_id: int,
    target_date: date_type,
    new_pattern_id: int,
) -> None:
    group_result = await db.execute(
        select(WorkPattern.group_id).where(WorkPattern.id == new_pattern_id)
    )
    group_id = group_result.scalar_one_or_none()
    if group_id is None:
        return

    same_group_pids_result = await db.execute(
        select(WorkPattern.id).where(WorkPattern.group_id == group_id)
    )
    same_group_pids = [pid for pid in same_group_pids_result.scalars().all()]

    conflict_result = await db.execute(
        select(ShiftAssignment).where(
            ShiftAssignment.schedule_id == schedule_id,
            ShiftAssignment.date == target_date,
            ShiftAssignment.assignment_type == "WORK",
            ShiftAssignment.employee_id != editing_employee_id,
            ShiftAssignment.pattern_id.in_(same_group_pids),
        )
    )
    conflict = conflict_result.scalars().first()
    if conflict is not None:
        raise ConstraintViolation(
            code="H13",
            message="同日に同じ作業パターングループを 2 名以上に配置できません",
            conflicting={
                "group_id": group_id,
                "other_employee_id": conflict.employee_id,
                "other_pattern_id": conflict.pattern_id,
            },
        )


async def _sync_leave_request(
    db: AsyncSession,
    employee_id: int,
    target_date: date_type,
    new_type: AssignmentType,
    new_leave_type: LeaveType | None,
) -> None:
    """
    LEAVE への遷移: LeaveRequest を upsert
    LEAVE からの遷移: LeaveRequest を削除（存在すれば）
    REST は LeaveRequest 非連動（label ロジック上 "割当休日" 扱い）
    """
    existing_result = await db.execute(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.year == target_date.year,
            LeaveRequest.month == target_date.month,
            LeaveRequest.day == target_date.day,
        )
    )
    existing = existing_result.scalar_one_or_none()

    if new_type == "LEAVE":
        assert new_leave_type is not None  # apply_cell_edit でガード済
        if existing is None:
            db.add(LeaveRequest(
                employee_id=employee_id,
                year=target_date.year,
                month=target_date.month,
                day=target_date.day,
                leave_type=new_leave_type,
            ))
        else:
            existing.leave_type = new_leave_type
    else:
        if existing is not None:
            await db.execute(
                delete(LeaveRequest).where(LeaveRequest.id == existing.id)
            )
