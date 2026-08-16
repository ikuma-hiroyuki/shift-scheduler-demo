from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Employee(TimestampMixin, Base):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # role コード。`roles.code` への FK。デフォルト: CHIEF/DEPUTY/STAFF/FULLPART/MORNINGPART
    role: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("roles.code", ondelete="RESTRICT"),
        nullable=False,
    )
    # 出勤可能曜日をカンマ区切り文字列で保持 ("0,1,2,3,4,5,6")
    available_days: Mapped[str] = mapped_column(String(20), default="0,1,2,3,4,5,6")
    # 出勤可能番型をカンマ区切り文字列で保持 ("1,2,3")
    available_shift_types: Mapped[str] = mapped_column(String(10), default="1,2,3")
    # 連勤可能フラグ。True でも最大 6 連勤、長連勤は -(k-2)² の凸ペナルティで抑制。
    # False は連勤を線形ペナルティで抑制（歯抜け勤務を選好）。
    consecutive_workable: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    pattern_priorities: Mapped[list["EmployeePatternPriority"]] = relationship(
        back_populates="employee", cascade="all, delete-orphan"
    )


class EmployeePatternPriority(Base):
    __tablename__ = "employee_pattern_priorities"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    pattern_id: Mapped[int] = mapped_column(
        ForeignKey("work_patterns.id", ondelete="CASCADE"), nullable=False
    )
    priority: Mapped[int] = mapped_column(Integer, default=5)  # 0〜10

    employee: Mapped[Employee] = relationship(back_populates="pattern_priorities")
