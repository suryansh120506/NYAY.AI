"""session presence columns

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-10 15:05:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("user_conns", sa.SmallInteger(), server_default="0", nullable=False))
    op.add_column("sessions", sa.Column("advocate_conns", sa.SmallInteger(), server_default="0", nullable=False))
    op.add_column("sessions", sa.Column("user_last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sessions", sa.Column("advocate_last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_sessions_state", "sessions", ["state"], postgresql_where=sa.text("state IN ('RESERVED','LIVE','ENDING')"))
    op.create_index("ix_sessions_advocate_requested", "sessions", ["advocate_id", "requested_at"])


def downgrade() -> None:
    op.drop_index("ix_sessions_advocate_requested", table_name="sessions")
    op.drop_index("ix_sessions_state", table_name="sessions")
    op.drop_column("sessions", "advocate_last_seen_at")
    op.drop_column("sessions", "user_last_seen_at")
    op.drop_column("sessions", "advocate_conns")
    op.drop_column("sessions", "user_conns")
