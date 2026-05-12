import importlib
import os
import pathlib
import sys
import unittest
from contextlib import contextmanager

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool


BACKEND_DIR = pathlib.Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def load_test_app():
    import db as db_module  # type: ignore

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    db_module.Base = declarative_base()
    db_module.engine = engine
    db_module.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db_module.wait_for_db = lambda: None
    db_module.apply_legacy_migrations = lambda: None

    for module_name in ["admin_auth", "models", "main"]:
        sys.modules.pop(module_name, None)

    os.environ["ADMIN_BOOTSTRAP_USERNAME"] = "root"
    os.environ["ADMIN_BOOTSTRAP_PASSWORD"] = "secret123"
    os.environ["ADMIN_BOOTSTRAP_FULL_NAME"] = "Root Admin"
    os.environ["ADMIN_COOKIE_SECURE"] = "0"
    os.environ["ADMIN_COOKIE_SAMESITE"] = "lax"
    os.environ["APP_JWT_SECRET"] = "test-secret"

    models = importlib.import_module("models")
    main = importlib.import_module("main")
    return main, models


class AdminSecurityTests(unittest.TestCase):
    def setUp(self):
        self.main, self.models = load_test_app()
        self.client = TestClient(self.main.app)

    @contextmanager
    def db_session(self):
        db = self.main.SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def login(self, username="root", password="secret123"):
        response = self.client.post(
            "/admin/auth/login",
            json={"username": username, "password": password},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response

    def fetch_csrf(self):
        response = self.client.get("/admin/auth/csrf")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["csrf_token"]

    def seed_user_and_application(self):
        with self.db_session() as db:
            user = self.models.User(
                vk_id="vk_1",
                full_name="Client One",
                phone="+79990000000",
                created_at="2026-05-01 10:00:00",
            )
            db.add(user)
            db.commit()
            db.refresh(user)

            application = self.models.Application(
                user_id=user.id,
                product_type="Дебетовая карта",
                details="Тестовая заявка",
                created_at="2026-05-01 10:10:00",
            )
            db.add(application)
            db.commit()
            db.refresh(application)
            return user, application

    def test_bootstrap_superadmin_is_created_from_environment(self):
        with self.db_session() as db:
            staff = db.query(self.models.AdminStaff).filter_by(username="root").one()
            self.assertEqual(staff.role, "superadmin")
            self.assertTrue(staff.is_active)

    def test_login_returns_current_staff_and_sets_cookies(self):
        response = self.login()
        self.assertIn("admin_access_token", response.cookies)
        self.assertIn("admin_refresh_token", response.cookies)

        me = self.client.get("/admin/auth/me")
        self.assertEqual(me.status_code, 200, me.text)
        payload = me.json()
        self.assertEqual(payload["username"], "root")
        self.assertEqual(payload["role"], "superadmin")

    def test_login_rejects_invalid_password(self):
        response = self.client.post(
            "/admin/auth/login",
            json={"username": "root", "password": "wrong-password"},
        )
        self.assertEqual(response.status_code, 401, response.text)

    def test_superadmin_can_create_staff_and_operator_cannot_manage_staff(self):
        self.login()
        csrf_token = self.fetch_csrf()

        created = self.client.post(
            "/admin/staff",
            headers={"X-CSRF-Token": csrf_token},
            json={
                "username": "operator1",
                "full_name": "Operator One",
                "password": "operator-pass",
                "role": "operator",
            },
        )
        self.assertEqual(created.status_code, 200, created.text)

        self.client.post("/admin/auth/logout", headers={"X-CSRF-Token": csrf_token})

        operator_client = TestClient(self.main.app)
        login = operator_client.post(
            "/admin/auth/login",
            json={"username": "operator1", "password": "operator-pass"},
        )
        self.assertEqual(login.status_code, 200, login.text)

        forbidden = operator_client.get("/admin/staff")
        self.assertEqual(forbidden.status_code, 403, forbidden.text)

    def test_csrf_is_required_for_mutating_admin_routes(self):
        self.login()
        _, application = self.seed_user_and_application()

        response = self.client.post(f"/admin/applications/{application.id}/approve")
        self.assertEqual(response.status_code, 403, response.text)

    def test_successful_admin_action_is_written_to_audit_log(self):
        self.login()
        csrf_token = self.fetch_csrf()
        _, application = self.seed_user_and_application()

        approve = self.client.post(
            f"/admin/applications/{application.id}/approve",
            headers={"X-CSRF-Token": csrf_token},
        )
        self.assertEqual(approve.status_code, 200, approve.text)

        logs_response = self.client.get("/admin/audit-logs")
        self.assertEqual(logs_response.status_code, 200, logs_response.text)
        logs = logs_response.json()["items"]
        self.assertTrue(any(item["action_type"] == "application.approve" for item in logs))


if __name__ == "__main__":
    unittest.main()
