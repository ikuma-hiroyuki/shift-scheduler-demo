"""
app/core/constants.py — プロジェクト共通定数
"""

# leave_type → 表示ラベル
# REQUESTED=希望休(●) / TENTATIVE=仮休(○) / MANDATORY=有給
LEAVE_TYPE_LABEL: dict[str, str] = {
    "REQUESTED": "●",
    "TENTATIVE": "○",
    "MANDATORY": "有給",
}
