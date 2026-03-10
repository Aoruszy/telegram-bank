import os
import time
from sqlalchemy import create_engine
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