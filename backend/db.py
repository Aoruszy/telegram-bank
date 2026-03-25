import os
import time
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

POSTGRES_USER = os.getenv("POSTGRES_USER", "bank_user")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "bank_password")
POSTGRES_DB = os.getenv("POSTGRES_DB", "bank_db")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "postgres")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")

DATABASE_URL = (
    f"postgresql+psycopg2://{POSTGRES_USER}:{POSTGRES_PASSWORD}"
    f"@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def wait_for_db():
    max_retries = 20
    retry_delay = 3

    for attempt in range(max_retries):
        try:
            connection = engine.connect()
            connection.close()
            print("Database is ready")
            return
        except Exception as e:
            print(f"Database is not ready yet ({attempt + 1}/{max_retries}): {e}")
            time.sleep(retry_delay)

    raise Exception("Could not connect to the database after multiple attempts")


def _column_exists(connection, table_name: str, column_name: str) -> bool:
    query = text(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = :table_name AND column_name = :column_name
        LIMIT 1
        """
    )
    return connection.execute(
        query, {"table_name": table_name, "column_name": column_name}
    ).scalar() is not None


def apply_legacy_migrations() -> None:
    with engine.begin() as connection:
        users_table_exists = connection.execute(
            text(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_name = 'users'
                LIMIT 1
                """
            )
        ).scalar()

        if not users_table_exists:
            return

        if not _column_exists(connection, "users", "vk_id") and _column_exists(
            connection, "users", "telegram_id"
        ):
            connection.execute(text("ALTER TABLE users RENAME COLUMN telegram_id TO vk_id"))

        if not _column_exists(connection, "users", "pin_hash"):
            connection.execute(text("ALTER TABLE users ADD COLUMN pin_hash VARCHAR"))

        if not _column_exists(connection, "users", "hide_balance"):
            connection.execute(
                text("ALTER TABLE users ADD COLUMN hide_balance BOOLEAN DEFAULT FALSE")
            )

        if not _column_exists(connection, "users", "notifications_enabled"):
            connection.execute(
                text(
                    "ALTER TABLE users ADD COLUMN notifications_enabled BOOLEAN DEFAULT TRUE"
                )
            )

        if not _column_exists(connection, "users", "app_theme"):
            connection.execute(
                text("ALTER TABLE users ADD COLUMN app_theme VARCHAR DEFAULT 'dark'")
            )

        if not _column_exists(connection, "users", "language"):
            connection.execute(text("ALTER TABLE users ADD COLUMN language VARCHAR DEFAULT 'ru'"))

        if not _column_exists(connection, "users", "onboarding_completed"):
            connection.execute(
                text(
                    "ALTER TABLE users ADD COLUMN onboarding_completed BOOLEAN DEFAULT FALSE"
                )
            )

        cards_table_exists = connection.execute(
            text(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_name = 'cards'
                LIMIT 1
                """
            )
        ).scalar()

        if cards_table_exists and not _column_exists(connection, "cards", "cvv_code"):
            connection.execute(text("ALTER TABLE cards ADD COLUMN cvv_code VARCHAR DEFAULT '000'"))
