# Import all models so Alembic autogenerate can detect them
from app.models.base import Base  # noqa: F401
from app.models.user import User  # noqa: F401
from app.models.department import Department, WorkRuleConfig  # noqa: F401
from app.models.work_pattern import WorkPatternGroup, WorkPattern  # noqa: F401
from app.models.day_template import DayTemplate, DayOverride  # noqa: F401
from app.models.choice_group import (  # noqa: F401
    PatternChoiceGroup,
    PatternChoiceGroupCandidate,
    PatternIncompatibility,
)
from app.models.pattern_rule import (  # noqa: F401
    PatternTrigger,
    PatternTriggerRequiredGroup,
    SpecialAssignmentRule,
)
from app.models.role import Role  # noqa: F401
from app.models.employee import Employee, EmployeePatternPriority  # noqa: F401
from app.models.leave_request import LeaveRequest  # noqa: F401
from app.models.schedule import ShiftSchedule, ShiftAssignment, ShiftShortageSlot  # noqa: F401
from app.models.holiday import Holiday  # noqa: F401
