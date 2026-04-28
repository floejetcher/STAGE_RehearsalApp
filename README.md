# STAGE Rehearsal App

A two-view web application for stage production teams.

| View | URL | Access |
|------|-----|--------|
| **Admin View** | `/admin` | Password protected (managers, officers, directors) |
| **Student View** | `/` | Always public — students mark their own attendance |

---

## Features

- **Show management** — create, rename, and delete production shows
- **Rehearsal schedule** — add, edit, and delete rehearsal dates/times
- **Cast & Crew management** — full roster with basic info and expandable advanced info (phone, email, grade, guardian details)
- **Groupings** — organise cast or crew into named groups (e.g. Dance Ensemble, Props Crew)
- **Active Attendance recording** — admin starts a session; students check themselves in via the public Student View; admin stops the session when done
- **Pre-excused absences** — mark students absent in advance; visible in attendance records
- **Attendance history** — per-rehearsal breakdown of every session with present/absent/pre-excused status
- **Manual overrides** — admin can edit any attendance record after a session ends

---

## Stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3.11 + Flask |
| Database | SQLite (via Fly persistent volume in production) |
| Auth | bcrypt password hashing + Bearer token session |
| Frontend | Vanilla JS / HTML / CSS (no build step) |
| Hosting | [Fly.io](https://fly.io) |

---

## Local development

```bash
# 1. Create virtual environment
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create the first admin user via environment variables (optional — defaults shown)
#    ADMIN_USERNAME=admin
#    ADMIN_PASSWORD=changeme123
#    ADMIN_ROLE=director

# 4. Run the dev server
python server.py
```

Open `http://localhost:8080` for the Student View and `http://localhost:8080/admin` for the Admin View.

> **Change the default password immediately** before any public deployment.

---

## Deployment (Fly.io)

```bash
# Install flyctl if needed: https://fly.io/docs/hands-on/install-flyctl/

# Authenticate
flyctl auth login

# Set required secrets (do this before first deploy)
flyctl secrets set ADMIN_USERNAME=yourname ADMIN_PASSWORD=strongpassword ADMIN_ROLE=director

# Deploy
flyctl deploy
```

The app name and region are already configured in `fly.toml`.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP port |
| `DB_PATH` | `rehearsal_app.db` | SQLite database path |
| `TOKEN_TTL_HOURS` | `12` | Admin session token lifetime |
| `ADMIN_USERNAME` | `admin` | Bootstrap admin username (only used when no users exist) |
| `ADMIN_PASSWORD` | `changeme123` | Bootstrap admin password |
| `ADMIN_ROLE` | `director` | Bootstrap admin role (`manager`, `officer`, `director`) |

---

## Project structure

```
server.py            — Flask API (admin + student routes)
rehearsal_db.py      — SQLite schema, init, and query helpers
requirements.txt     — Python dependencies
Dockerfile           — Container image definition
fly.toml             — Fly.io deployment configuration
frontend/
  index.html         — Single-page shell (admin + student)
  app.js             — All SPA logic
  styles.css         — Responsive visual styles
```
