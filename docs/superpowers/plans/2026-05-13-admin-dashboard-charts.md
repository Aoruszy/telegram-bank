# Admin Dashboard Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two useful charts to the admin dashboard summary page: operations over the last 7 days and current status distributions for applications and service requests.

**Architecture:** Extend `/admin/stats` so the backend returns chart-ready aggregates together with existing summary counters. Render the new datasets in the React admin dashboard using a lightweight charting library and keep the current dark visual style.

**Tech Stack:** FastAPI, SQLAlchemy, React, Vite, Recharts, unittest

---

### Task 1: Add backend test coverage for chart aggregates

**Files:**
- Modify: `C:\Users\kseno\bank-telegram-system\backend\test_admin_security.py`
- Test: `C:\Users\kseno\bank-telegram-system\backend\test_admin_security.py`

- [ ] Add a failing test that seeds operations, applications, and service requests, then asserts `/admin/stats` returns `operations_by_day`, `applications_by_status`, and `service_requests_by_status`.
- [ ] Run `python -m unittest backend.test_admin_security -v` and confirm the new test fails for missing keys.
- [ ] Implement only the minimum seed/test helpers needed.

### Task 2: Extend `/admin/stats` with chart-ready datasets

**Files:**
- Modify: `C:\Users\kseno\bank-telegram-system\backend\main.py`

- [ ] Add a small timestamp parsing helper that can read existing operation date formats used by the project.
- [ ] Add a 7-day operations timeline aggregate.
- [ ] Add status distribution arrays for applications and service requests.
- [ ] Run `python -m unittest backend.test_admin_security -v` and confirm all tests pass.

### Task 3: Render overview charts in the admin panel

**Files:**
- Modify: `C:\Users\kseno\bank-telegram-system\admin-panel\package.json`
- Modify: `C:\Users\kseno\bank-telegram-system\admin-panel\package-lock.json`
- Modify: `C:\Users\kseno\bank-telegram-system\admin-panel\src\App.jsx`
- Modify: `C:\Users\kseno\bank-telegram-system\admin-panel\src\App.css`

- [ ] Add `recharts` as the only new frontend dependency.
- [ ] Render a line/area chart for operations over the last 7 days.
- [ ] Render compact bar charts for application and service request statuses.
- [ ] Keep layout responsive and visually consistent with the current dark admin UI.
- [ ] Run `npm run build` to verify production build success.
