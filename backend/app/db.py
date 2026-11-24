from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import get_settings
from app.models import Base

settings = get_settings()
engine = create_engine(
    settings.database_url,
    connect_args=(
        {"check_same_thread": False}
        if settings.database_url.startswith("sqlite")
        else {}
    ),
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
# Never create or alter a configured remote database on import. PostgreSQL uses reviewed SQL migrations.
if settings.environment == "local" and settings.database_url.startswith("sqlite"):
    Base.metadata.create_all(engine)

# SQLite is only used for local development. Additive columns keep an existing
# ai_edu.db usable when the lesson schema evolves without a manual reset.
if settings.environment == "local" and settings.database_url.startswith("sqlite"):
    with engine.begin() as conn:

        def ensure_columns(table, definitions):
            existing = {
                row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")
            }
            for name, definition in definitions.items():
                if name not in existing:
                    conn.exec_driver_sql(
                        f"ALTER TABLE {table} ADD COLUMN {name} {definition}"
                    )

        ensure_columns(
            "profiles",
            {
                "email": "VARCHAR(320)",
                "role": "VARCHAR(20) NOT NULL DEFAULT 'teacher'",
                "organization_id": "VARCHAR(36)",
                "is_active": "BOOLEAN NOT NULL DEFAULT 1",
                "subscription_until": "DATETIME",
                "daily_limit": "INTEGER NOT NULL DEFAULT 20",
                "daily_limit_v1": "INTEGER DEFAULT 20",
                "created_at": "DATETIME",
                "last_active_at": "DATETIME",
            },
        )
        ensure_columns("agent_audit", {"created_at": "DATETIME"})
        ensure_columns("lessons", {"agent_progress": "JSON"})
        ensure_columns(
            "lesson_materials",
            {
                "owner_id": "VARCHAR(36)",
                "error": "TEXT",
                "file_path": "VARCHAR",
            },
        )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
