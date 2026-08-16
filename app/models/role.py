from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Role(TimestampMixin, Base):
    """役職マスタ。

    rest_days_28_29 / rest_days_30 / rest_days_31 は issue #235 で追加。
    月の日数 (28/29/30/31) ごとに月間最低休日数を保持する。

    データフロー:
        roles 表 ---> loader.build_shift_model_input ---> ShiftModelInput.rest_days_by_role
                  +-- rest_days_for(num_days)        --+
                                                       v
                            cp_sat_model._h3_monthly_rest_days (H3 hard 制約)

    multi-tenant 拡張 (Phase 6) では `role × department` の override 表に
    分離するリファクタを前提。今は global 一律。
    """

    __tablename__ = "roles"

    code: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)

    # issue #235: バケツ別月間最低休日数
    rest_days_28_29: Mapped[int] = mapped_column(Integer, nullable=False)
    rest_days_30: Mapped[int] = mapped_column(Integer, nullable=False)
    rest_days_31: Mapped[int] = mapped_column(Integer, nullable=False)

    def rest_days_for(self, num_days: int) -> int:
        """月の日数に対応する休日数を返す。Feb 28/29 日は同一バケツ。"""
        if num_days == 31:
            return self.rest_days_31
        if num_days == 30:
            return self.rest_days_30
        # 28 or 29 (Feb non-leap / leap)
        return self.rest_days_28_29
