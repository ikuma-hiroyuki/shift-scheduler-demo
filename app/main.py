from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import auth, employees, work_patterns, day_templates
from app.api.routers import choice_groups, pattern_rules, leave_requests
from app.api.routers import schedules, imports, departments, employee_priorities, users
from app.api.routers import holidays, roles, demo
from app.core.config import settings

app = FastAPI(
    title="Demo Mart Shift Scheduler API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(employees.router, prefix="/api/v1")
app.include_router(employee_priorities.router, prefix="/api/v1")
app.include_router(work_patterns.router, prefix="/api/v1")
app.include_router(day_templates.router, prefix="/api/v1")
app.include_router(choice_groups.router, prefix="/api/v1")
app.include_router(pattern_rules.router, prefix="/api/v1")
app.include_router(leave_requests.router, prefix="/api/v1")
app.include_router(schedules.router, prefix="/api/v1")
app.include_router(imports.router, prefix="/api/v1")
app.include_router(departments.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(holidays.router, prefix="/api/v1")
app.include_router(roles.router, prefix="/api/v1")
app.include_router(demo.router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
