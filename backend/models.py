from sqlalchemy import Column, Integer, String, Float, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from db import Base

# Миграция со старой схемы (Telegram): ALTER TABLE users RENAME COLUMN telegram_id TO vk_id;
# PIN: ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash VARCHAR;


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    vk_id = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    phone = Column(String, nullable=True)

    # настройки пользователя
    hide_balance = Column(Boolean, default=False)
    notifications_enabled = Column(Boolean, default=True)
    app_theme = Column(String, default="dark")
    language = Column(String, default="ru")
    onboarding_completed = Column(Boolean, default=False)
    created_at = Column(String, nullable=True)
    pin_hash = Column(String, nullable=True)

    accounts = relationship("Account", back_populates="user", cascade="all, delete-orphan")
    operations = relationship("Operation", back_populates="user", cascade="all, delete-orphan")
    applications = relationship("Application", back_populates="user", cascade="all, delete-orphan")
    cards = relationship("Card", back_populates="user", cascade="all, delete-orphan")
    service_requests = relationship("ServiceRequest", back_populates="user", cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")
    favorite_payments = relationship("FavoritePayment", back_populates="user", cascade="all, delete-orphan")
    login_events = relationship("LoginEvent", back_populates="user", cascade="all, delete-orphan")


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_name = Column(String, nullable=False)
    balance = Column(Float, default=0)
    currency = Column(String, default="RUB")
    status = Column(String, default="Активен")

    user = relationship("User", back_populates="accounts")
    operations = relationship("Operation", back_populates="account", cascade="all, delete-orphan")
    cards = relationship("Card", back_populates="account", cascade="all, delete-orphan")


class Card(Base):
    __tablename__ = "cards"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    card_name = Column(String, nullable=False)
    card_number_mask = Column(String, nullable=False)
    full_card_number = Column(String, nullable=False, default="2200123412341234")
    expiry_date = Column(String, nullable=False)
    payment_system = Column(String, nullable=False)
    status = Column(String, nullable=False, default="Активна")

    user = relationship("User", back_populates="cards")
    account = relationship("Account", back_populates="cards")


class Operation(Base):
    __tablename__ = "operations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    title = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    operation_type = Column(String, nullable=False)
    category = Column(String, nullable=False, default="other")
    created_at = Column(String, nullable=False)

    user = relationship("User", back_populates="operations")
    account = relationship("Account", back_populates="operations")


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    product_type = Column(String, nullable=False)
    details = Column(String, nullable=False, default="")
    status = Column(String, nullable=False, default="На рассмотрении")
    created_at = Column(String, nullable=False)

    user = relationship("User", back_populates="applications")


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    sender_type = Column(String, nullable=False)
    message = Column(String, nullable=False)
    created_at = Column(String, nullable=False)

    user = relationship("User")


class ServiceRequest(Base):
    __tablename__ = "service_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    request_type = Column(String, nullable=False)
    details = Column(String, nullable=False)
    status = Column(String, nullable=False, default="Создан")
    created_at = Column(String, nullable=False)

    user = relationship("User", back_populates="service_requests")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    message = Column(String, nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(String, nullable=False)

    user = relationship("User", back_populates="notifications")


class FavoritePayment(Base):
    __tablename__ = "favorite_payments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    template_name = Column(String, nullable=False)
    payment_type = Column(String, nullable=False)   # phone_transfer / service_payment
    recipient_value = Column(String, nullable=False)  # телефон или получатель услуги
    provider_name = Column(String, nullable=True)
    created_at = Column(String, nullable=False)

    user = relationship("User", back_populates="favorite_payments")


class LoginEvent(Base):
    __tablename__ = "login_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    device_name = Column(String, nullable=False)
    platform = Column(String, nullable=False)
    ip_address = Column(String, nullable=True)
    source = Column(String, nullable=False, default="miniapp")
    created_at = Column(String, nullable=False)

    user = relationship("User", back_populates="login_events")
