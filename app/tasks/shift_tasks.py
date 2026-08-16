"""
app/tasks/shift_tasks.py — FastAPI プロセス内で実行する稼働表生成タスク

冪等性保証:
  - 実行開始時に status = GENERATING に更新
  - 既に GENERATING / GENERATED の場合は何もしない
  - 成功時に status = GENERATED、失敗時 (CP-SAT 解なし / 入力構築エラー) は INFEASIBLE
  - 停止要求 (schedule_service のプロセス内キャンセルフラグ) があれば solver.stop_search() を呼び CANCELLED
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from ortools.sat.python import cp_model
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.core.config import settings
from app.core.database import PGBOUNCER_CONNECT_ARGS
from app.models.schedule import ShiftAssignment, ShiftSchedule, ShiftShortageSlot
from app.optimizer.adapter import (
    run_capacity_summary,
    run_diagnosis,
    run_optimizer,
    run_partial_solve,
)
from app.optimizer.loader import (
    PriorityMasterError,
    build_shift_model_input,
    preflight_priority_master,
)
from app.services.schedule_service import clear_cancel_flag, is_cancel_requested

logger = logging.getLogger(__name__)

# cancel フラグのポーリング間隔。短いほど停止反応が良い／CPU 負荷増。
_CANCEL_POLL_INTERVAL_SEC = 1.0
# issue #196: heartbeat 更新間隔。短いほど異常検出が速いが DB 書き込み増。
# stale 判定の閾値 (`_STALE_HEARTBEAT_FACTOR * time_limit`, 最低 30 秒) より十分小さくする。
_HEARTBEAT_INTERVAL_SEC = 10.0


async def _watch_and_stop(
    schedule_id: int,
    solver: cp_model.CpSolver,
    cancelled: dict,
    stop_event: asyncio.Event,
) -> None:
    """solver 実行中にキャンセルフラグを監視し、立ったら solver.stop_search() を呼ぶ。"""
    while not stop_event.is_set():
        if is_cancel_requested(schedule_id):
            cancelled["flag"] = True
            try:
                solver.stop_search()
            except Exception:
                logger.exception("solver.stop_search failed for schedule %d", schedule_id)
            return
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=_CANCEL_POLL_INTERVAL_SEC)
        except asyncio.TimeoutError:
            continue


async def _heartbeat_updater(
    Session,
    schedule_id: int,
    stop_event: asyncio.Event,
) -> None:
    """issue #196: solver 実行中、`_HEARTBEAT_INTERVAL_SEC` ごとに DB の
    `last_heartbeat_at` を更新する。worker process が SIGKILL/OOM 等で
    死ぬと heartbeat が止まり、API 側が stale 判定して INFEASIBLE に flip する。

    DB エラーは silent ignore (heartbeat 失敗で solve を止める意味は無い)。
    """
    while not stop_event.is_set():
        try:
            async with Session() as db:
                schedule: ShiftSchedule | None = await db.get(ShiftSchedule, schedule_id)
                if schedule is not None and schedule.status == "GENERATING":
                    schedule.last_heartbeat_at = datetime.now(timezone.utc)
                    await db.commit()
        except Exception:
            logger.warning(
                "heartbeat update failed for schedule %d", schedule_id, exc_info=True
            )
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=_HEARTBEAT_INTERVAL_SEC)
        except asyncio.TimeoutError:
            continue


async def generate_shift(schedule_id: int, time_limit: float = 120.0, workers: int = 4) -> dict:
    """
    schedule_id の稼働表を CP-SAT で生成して DB に保存する。
    `schedule_service._spawn_generation_task` から `asyncio.create_task` で起動される。

    Args:
        schedule_id: 対象 ShiftSchedule の id
        time_limit: CP-SAT タイムアウト（秒）
        workers: 並列ワーカー数
    """
    engine = create_async_engine(
        settings.database_url, pool_pre_ping=True, connect_args=PGBOUNCER_CONNECT_ARGS
    )
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    try:
        async with Session() as db:
            # ---- 冪等性チェック ----
            schedule: ShiftSchedule | None = await db.get(ShiftSchedule, schedule_id)
            if schedule is None:
                logger.error("generate_shift: schedule %d not found", schedule_id)
                return {"status": "NOT_FOUND"}

            if schedule.status in ("GENERATING", "GENERATED", "CANCELLED", "PARTIAL"):
                logger.info("generate_shift: schedule %d already %s, skipping", schedule_id, schedule.status)
                return {"status": schedule.status}

            # タスク起動後・solver 開始前に cancel が来ていれば即時 CANCELLED
            if is_cancel_requested(schedule_id):
                schedule.status = "CANCELLED"
                schedule.finished_at = datetime.now(timezone.utc)
                await db.commit()
                logger.info("generate_shift: schedule %d cancelled before solver", schedule_id)
                return {"status": "CANCELLED"}

            # issue #211: INFEASIBLE / PARTIAL / DRAFT からの再試行は generation_attempt を bump する。
            # 同一 attempt 番号の上書きで診断履歴を degrade させない。
            # `INFEASIBLE`: 前回診断付きで失敗 → ユーザが制約を緩めて再生成 → 新 attempt
            # `PARTIAL`: 部分割当で生成 → 希望休調整して再生成 → 新 attempt
            # `DRAFT`: 初回投入 (attempt=1) または手動 reset → 1 で開始
            if schedule.status in ("INFEASIBLE", "PARTIAL"):
                schedule.generation_attempt = (schedule.generation_attempt or 0) + 1

            # ---- GENERATING に更新 ----
            now_utc = datetime.now(timezone.utc)
            schedule.status = "GENERATING"
            schedule.diagnosis = None
            schedule.diagnosis_json = None
            schedule.started_at = now_utc
            schedule.finished_at = None
            # issue #196: heartbeat 初期化。以降 _heartbeat_updater が更新する。
            schedule.last_heartbeat_at = now_utc
            await db.commit()

        async with Session() as db:
            schedule = await db.get(ShiftSchedule, schedule_id)

            # ---- ShiftModelInput 構築 ----
            try:
                inp = await build_shift_model_input(
                    db, schedule.department_id, schedule.year, schedule.month
                )
                preflight_priority_master(inp)
            except PriorityMasterError as exc:
                # priority マスタが「要求 pattern に candidate ゼロ」状態。
                # 店長にマスタ修正を促す診断文を返す (生成不可)。
                logger.warning(
                    "generate_shift: schedule %d priority master incomplete: %s",
                    schedule_id, exc,
                )
                schedule.status = "INFEASIBLE"
                schedule.diagnosis = (
                    f"優先作業パターンマスタが不完全です。{exc} "
                    "マスタ管理画面から該当作業パターンに priority を設定してから再度生成してください。"
                )
                schedule.finished_at = datetime.now(timezone.utc)
                await db.commit()
                return {"status": "ERROR", "error": "priority_master_incomplete"}
            except Exception as exc:
                logger.exception("generate_shift: failed to build input for schedule %d", schedule_id)
                # 入力構築が DB エラー (例: スキーマ不一致) で失敗した場合、この時点で
                # セッションのトランザクションは abort 済みになっている。そのまま status を
                # commit しようとすると InFailedSQLTransactionError で二次クラッシュし、
                # heartbeat 途絶 → 「ワーカー異常終了」という本来の原因を覆い隠す誤った
                # メッセージになる。先に rollback して abort 状態を解消してから、診断を
                # 確実に永続化する。
                await db.rollback()
                schedule = await db.get(ShiftSchedule, schedule_id)
                if schedule is not None:
                    schedule.status = "INFEASIBLE"
                    schedule.diagnosis = f"入力データ構築エラー: {exc}"
                    schedule.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                return {"status": "ERROR", "error": str(exc)}

            # ---- ソルバー実行（cancel watcher 同伴） ----
            solver = cp_model.CpSolver()
            cancelled: dict = {"flag": False}
            stop_event = asyncio.Event()

            watcher = asyncio.create_task(
                _watch_and_stop(schedule_id, solver, cancelled, stop_event)
            )
            # issue #196: heartbeat updater (常に起動)
            heartbeat = asyncio.create_task(
                _heartbeat_updater(Session, schedule_id, stop_event)
            )

            try:
                status_name, assignments = await asyncio.to_thread(
                    run_optimizer,
                    inp,
                    schedule_id,
                    time_limit,
                    workers,
                    solver,
                )
            finally:
                stop_event.set()
                try:
                    await watcher
                except Exception:
                    logger.exception("cancel watcher errored for schedule %d", schedule_id)
                try:
                    await heartbeat
                except Exception:
                    logger.exception("heartbeat updater errored for schedule %d", schedule_id)

            # レースコンディション対策: watcher が stop_event 経由で退場する際に
            # 直前に設定された cancel フラグを見逃す場合がある。solve 完了後に
            # フラグを直接確認して補完する。
            if not cancelled["flag"] and is_cancel_requested(schedule_id):
                cancelled["flag"] = True

            # cancel が来ていた場合は CANCELLED 確定
            if cancelled["flag"]:
                schedule.status = "CANCELLED"
                schedule.diagnosis = None
                schedule.finished_at = datetime.now(timezone.utc)
                await db.commit()
                logger.info("generate_shift: schedule %d cancelled by user", schedule_id)
                return {"status": "CANCELLED"}

            if status_name in ("OPTIMAL", "FEASIBLE"):
                # 既存アサインを削除して新規保存
                existing = await db.execute(
                    select(ShiftAssignment).where(ShiftAssignment.schedule_id == schedule_id)
                )
                for a in existing.scalars().all():
                    await db.delete(a)
                for a in assignments:
                    db.add(a)
                schedule.status = "GENERATED"
                schedule.diagnosis = None
                schedule.finished_at = datetime.now(timezone.utc)
                await db.commit()
                logger.info("generate_shift: schedule %d generated (%s)", schedule_id, status_name)
                return {"status": "GENERATED", "solver_status": status_name}

            else:
                # 標準 solve が INFEASIBLE: まず solve_partial で部分割当を試みる
                logger.warning(
                    "generate_shift: schedule %d standard INFEASIBLE, trying partial solve",
                    schedule_id,
                )

                # partial solve 用の solver と watcher を別途起動し、
                # 生成中の cancel 要求を停止可能にする。
                partial_solver = cp_model.CpSolver()
                partial_cancelled: dict = {"flag": False}
                partial_stop_event = asyncio.Event()
                partial_watcher = asyncio.create_task(
                    _watch_and_stop(
                        schedule_id, partial_solver,
                        partial_cancelled, partial_stop_event,
                    )
                )

                try:
                    partial_status, partial_assignments, shortages, manager_gap_days = await asyncio.to_thread(
                        run_partial_solve,
                        inp,
                        schedule_id,
                        time_limit,
                        solver=partial_solver,
                    )
                finally:
                    partial_stop_event.set()
                    try:
                        await partial_watcher
                    except Exception:
                        logger.exception(
                            "partial cancel watcher errored for schedule %d", schedule_id
                        )

                logger.warning(
                    "generate_shift: schedule %d partial result: status=%s shortages=%d manager_gaps=%d",
                    schedule_id, partial_status, len(shortages), len(manager_gap_days),
                )

                # partial solve 完了後のレースコンディション補完
                if not partial_cancelled["flag"] and is_cancel_requested(schedule_id):
                    partial_cancelled["flag"] = True

                if partial_cancelled["flag"]:
                    schedule.status = "CANCELLED"
                    schedule.diagnosis = None
                    schedule.diagnosis_json = None
                    schedule.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    logger.info(
                        "generate_shift: schedule %d cancelled during partial solve",
                        schedule_id,
                    )
                    return {"status": "CANCELLED"}

                if (
                    partial_status in ("OPTIMAL", "FEASIBLE")
                    and not shortages
                    and not manager_gap_days
                ):
                    # solve_partial が不足ゼロ + 管理職穴なしで成立 = 完全解。
                    # GENERATED として確定する (PARTIAL/INFEASIBLE 経路には流さない)。
                    logger.info(
                        "generate_shift: schedule %d partial solve reached full coverage",
                        schedule_id,
                    )
                    existing = await db.execute(
                        select(ShiftAssignment).where(
                            ShiftAssignment.schedule_id == schedule_id
                        )
                    )
                    for a in existing.scalars().all():
                        await db.delete(a)
                    for a in partial_assignments:
                        db.add(a)
                    schedule.status = "GENERATED"
                    schedule.diagnosis = None
                    schedule.diagnosis_json = None
                    schedule.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return {"status": "GENERATED", "solver_status": partial_status}

                if partial_status in ("OPTIMAL", "FEASIBLE") and (shortages or manager_gap_days):
                    # PARTIAL: 部分解 + 不足あり → 保存して手動編集 UI に流す
                    logger.info(
                        "generate_shift: schedule %d PARTIAL (%d shortage slots)",
                        schedule_id, len(shortages),
                    )
                    capacity_summary = run_capacity_summary(inp)

                    # 既存 assignments を削除して partial 解を保存
                    existing = await db.execute(
                        select(ShiftAssignment).where(
                            ShiftAssignment.schedule_id == schedule_id
                        )
                    )
                    for a in existing.scalars().all():
                        await db.delete(a)
                    for a in partial_assignments:
                        db.add(a)

                    # 既存 ShortageSlot を削除して新規保存
                    existing_slots = await db.execute(
                        select(ShiftShortageSlot).where(
                            ShiftShortageSlot.schedule_id == schedule_id
                        )
                    )
                    for s in existing_slots.scalars().all():
                        await db.delete(s)
                    from datetime import date as _date
                    # ShortageSlot は work_patterns FK あり。choice_group 由来の
                    # 仮想 pattern_id (負数) は永続化対象外。フロント表示には
                    # diagnosis_json.shortages 経由で渡される。
                    for sr in shortages:
                        if sr.pattern_id <= 0:
                            continue
                        db.add(ShiftShortageSlot(
                            schedule_id=schedule_id,
                            date=_date(schedule.year, schedule.month, sr.day),
                            pattern_id=sr.pattern_id,
                            required_min=sr.required,
                            missing_count=sr.missing,
                        ))

                    schedule.status = "PARTIAL"
                    # 人間可読 diagnosis テキスト (既存フォーマット維持)
                    sections: list[str] = []
                    if capacity_summary:
                        sections.append("【不足日サマリ】\n" + "\n".join(capacity_summary))
                    if manager_gap_days:
                        sections.append(
                            "【管理職不在日】\n"
                            + "\n".join(f"{d}日: 管理職全員 ●/有給" for d in manager_gap_days)
                        )
                    schedule.diagnosis = "\n\n".join(sections) if sections else None
                    # 構造化 diagnosis_json (フロント直接消費)
                    schedule.diagnosis_json = {
                        "shortages": [sr.to_dict() for sr in shortages],
                        "capacity_summary": capacity_summary,
                        "manager_gap_days": manager_gap_days,
                    }
                    schedule.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return {"status": "PARTIAL", "shortage_count": len(shortages)}

                # solve_partial も INFEASIBLE か、shortage 0 件 = 構造的に解けない
                logger.warning(
                    "generate_shift: schedule %d INFEASIBLE (partial=%s), diagnosing",
                    schedule_id, partial_status,
                )
                suspects = run_diagnosis(inp)
                shortage_summary = run_capacity_summary(inp)
                sections: list[str] = []
                if shortage_summary:
                    sections.append("【不足日サマリ】\n" + "\n".join(shortage_summary))
                elif not suspects:
                    sections.append(
                        "【不足日サマリ】\n"
                        "  容量は足りていますが、他の制約"
                        "(連勤上限・月間休日数・残業など)で成立しません。"
                    )
                if suspects:
                    sections.append("【原因の可能性】\n" + "\n".join(suspects))
                schedule.status = "INFEASIBLE"
                schedule.diagnosis = "\n\n".join(sections) if sections else status_name
                schedule.finished_at = datetime.now(timezone.utc)
                await db.commit()
                return {"status": "INFEASIBLE", "diagnosis": suspects}

    finally:
        clear_cancel_flag(schedule_id)
        await engine.dispose()
