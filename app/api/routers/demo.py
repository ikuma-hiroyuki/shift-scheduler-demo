"""ポートフォリオデモ専用: デモデータの初期化エンドポイント。

`seed.py` は「既存行があればスキップ」する冪等性のため、来場者が編集した
デモデータを元に戻すには使えない。ここでは department 以下を CASCADE 削除
してから改めて seed() を実行することで、確実に初期状態へ戻す。

`DEMO_MODE=true` のときのみ有効。本番相当のデプロイでは絶対に有効化しない。
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin, get_db
from app.core.config import settings
from app.models.department import Department
from app.models.user import User
from app.scripts.seed import seed

router = APIRouter(prefix="/demo", tags=["demo"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AdminDep = Annotated[User, Depends(get_current_admin)]


@router.post("/reset", status_code=status.HTTP_200_OK)
async def reset_demo_data(db: DbDep, _: AdminDep) -> dict:
    """デモデータ（部門以下のマスタ・従業員・稼働表）を初期状態に戻す。管理者ユーザーは維持する。"""
    if not settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このエンドポイントは DEMO_MODE=true のときのみ有効です。",
        )

    await db.execute(delete(Department))
    await db.commit()

    await seed(db)

    return {"status": "ok"}
