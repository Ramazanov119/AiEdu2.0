import enum, uuid
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    String,
    Text,
    ForeignKey,
    func,
    Integer,
    CheckConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


ID = String(36).with_variant(UUID(as_uuid=False), "postgresql")


class TaskStatus(str, enum.Enum):
    pending = "pending"
    assigned = "assigned"
    running = "running"
    review = "review"
    awaiting_confirmation = "awaiting_confirmation"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class Profile(Base):
    __tablename__ = "profiles"
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    full_name: Mapped[str | None] = mapped_column(String, nullable=True)
    institution: Mapped[str | None] = mapped_column(String, nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True, index=True)
    role: Mapped[str] = mapped_column(
        String(20), default="teacher", server_default="teacher"
    )
    organization_id: Mapped[str | None] = mapped_column(
        ID,
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )
    subscription_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    daily_limit: Mapped[int] = mapped_column(Integer, default=20, server_default="20")
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=True
    )
    last_active_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    __table_args__ = (
        CheckConstraint(
            "role IN ('teacher','methodist','admin')", name="profile_role_valid"
        ),
        CheckConstraint("daily_limit >= 0", name="profile_limit_valid"),
    )


class PortfolioFile(Base):
    __tablename__ = "portfolio_files"
    id: Mapped[str] = mapped_column(
        ID, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    owner_id: Mapped[str] = mapped_column(
        ID, ForeignKey("profiles.id", ondelete="CASCADE")
    )
    category: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)
    storage_path: Mapped[str] = mapped_column(String)
    mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    structured_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(
        ID, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    owner_id: Mapped[str] = mapped_column(
        ID, ForeignKey("profiles.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")
    assigned_agent: Mapped[str | None] = mapped_column(String, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dependencies: Mapped[list] = mapped_column(JSON, default=list)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class TaskStep(Base):
    __tablename__ = "task_steps"
    id: Mapped[str] = mapped_column(
        ID, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    task_id: Mapped[str] = mapped_column(ID, ForeignKey("tasks.id", ondelete="CASCADE"))
    owner_id: Mapped[str] = mapped_column(
        ID, ForeignKey("profiles.id", ondelete="CASCADE")
    )
    agent: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending")
    depends_on: Mapped[list] = mapped_column(JSON, default=list)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[str] = mapped_column(
        ID, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    owner_id: Mapped[str] = mapped_column(
        ID, ForeignKey("profiles.id", ondelete="CASCADE")
    )
    role: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    attachments: Mapped[list] = mapped_column(JSON, default=list)


class AgentAudit(Base):
    __tablename__ = "agent_audit"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(
        ID, ForeignKey("profiles.id", ondelete="CASCADE")
    )
    agent: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    input: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    prompt_injection_detected: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now()
    )


class Lesson(Base):
    __tablename__ = "lessons"
    id: Mapped[str] = mapped_column(
        ID, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    owner_id: Mapped[str] = mapped_column(
        ID, ForeignKey("profiles.id", ondelete="CASCADE")
    )
    portfolio_file_id: Mapped[str] = mapped_column(
        ID, ForeignKey("portfolio_files.id", ondelete="CASCADE")
    )
    topic: Mapped[str] = mapped_column(String)
    group_name: Mapped[str | None] = mapped_column(String, nullable=True)
    hours: Mapped[str | None] = mapped_column(String, nullable=True)
    lesson_type: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")
    agent_progress: Mapped[dict | None] = mapped_column(
        JSON, nullable=True, default=dict
    )
    created_at: Mapped[DateTime | None] = mapped_column(
        DateTime, nullable=True, default=func.now()
    )


class LessonMaterial(Base):
    __tablename__ = "lesson_materials"
    id: Mapped[str] = mapped_column(
        ID, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    owner_id: Mapped[str] = mapped_column(
        ID, ForeignKey("profiles.id", ondelete="CASCADE")
    )
    lesson_id: Mapped[str] = mapped_column(
        ID, ForeignKey("lessons.id", ondelete="CASCADE")
    )
    material_type: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="pending")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String, nullable=True)


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[str] = mapped_column(
        ID, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(300))
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now()
    )


class GenerationLog(Base):
    __tablename__ = "generation_logs"
    id: Mapped[str] = mapped_column(
        ID, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(ID, ForeignKey("profiles.id"), index=True)
    organization_id: Mapped[str | None] = mapped_column(
        ID,
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    agent_type: Mapped[str] = mapped_column(String(30))
    action_type: Mapped[str] = mapped_column(String(100))
    model_name: Mapped[str] = mapped_column(String(300))
    tokens_used: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    tokens_reported: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    duration_ms: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(10))
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), index=True
    )
    __table_args__ = (
        CheckConstraint("status IN ('success','error')"),
        CheckConstraint(
            "agent_type IN ('coordinator','methodist','creative','assessment')"
        ),
        CheckConstraint("tokens_used >= 0 AND duration_ms >= 0"),
    )


class GenerationReservation(Base):
    __tablename__ = "generation_reservations"
    id: Mapped[str] = mapped_column(
        ID, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(ID, ForeignKey("profiles.id"), index=True)
    organization_id: Mapped[str | None] = mapped_column(
        ID, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"
    id: Mapped[str] = mapped_column(
        ID, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    admin_id: Mapped[str] = mapped_column(ID, ForeignKey("profiles.id"))
    target_user_id: Mapped[str | None] = mapped_column(
        ID, ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(100))
    details: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), index=True
    )
