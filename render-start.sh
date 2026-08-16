#!/bin/sh
# Render 無料プランには Pre-Deploy Command が無いため、起動のたびに
# マイグレーション + 管理者upsertを実行する（どちらも冪等なので無害）。
set -e
alembic upgrade head
python -m app.scripts.bootstrap_admin
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
