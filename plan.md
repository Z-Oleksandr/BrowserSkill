# BrowserSkill — Implementation Plan

## Context

BrowserSkill is a Brave/Chrome extension that persists browser session state (tabs, tab groups, windows) to a local FastAPI server backed by MariaDB. Sessions survive browser restarts and can be accessed across devices. The server runs in a Docker container alongside an existing MariaDB container.

**Tech stack**: Chrome Manifest V3 extension (vanilla JS) + Python FastAPI + MariaDB (existing) + Docker

---

## Data Model (MariaDB)

**`devices`** — id, name, api_key (unique), created_at
**`sessions`** — id, device_id (FK), name, state_data (JSON/LONGTEXT), is_active, created_at, updated_at

State is stored as a JSON blob: `{ captured_at, windows: [{ type, state, left, top, width, height, tabs: [{url, title, pinned, group_id, index, active}], tab_groups: [{local_id, title, color, collapsed}] }] }`

---

## API Endpoints

| Method | Path                       | Auth | Description                      |
| ------ | -------------------------- | ---- | -------------------------------- |
| POST   | `/api/devices/register`    | None | Register device, returns API key |
| GET    | `/api/sessions`            | Key  | List sessions for device         |
| POST   | `/api/sessions`            | Key  | Create session                   |
| GET    | `/api/sessions/{id}`       | Key  | Get session (with state)         |
| PUT    | `/api/sessions/{id}`       | Key  | Update name/is_active            |
| DELETE | `/api/sessions/{id}`       | Key  | Delete session                   |
| PUT    | `/api/sessions/{id}/state` | Key  | Save browser state               |
| GET    | `/api/sessions/{id}/state` | Key  | Load browser state               |

Auth: `X-API-Key` header on all except register.

## UI

The Extention should have a control UI - on click on the extention icon in the browser upper bar a small window should pop up in the top right corner with the control elements

---

## Implementation Phases

### Phase 1: Server Foundation (7 files)

Create all server files:

- `server/app/__init__.py` — empty
- `server/app/database.py` — async SQLAlchemy engine + session factory, `init_db()` creates tables
- `server/app/models.py` — Device, Session ORM models
- `server/app/schemas.py` — Pydantic v2 request/response models (DeviceRegister, SessionCreate, BrowserState, TabState, etc.)
- `server/app/auth.py` — API key generation + `get_current_device` dependency
- `server/app/main.py` — FastAPI app with lifespan handler, mounts routers
- `server/app/routes/__init__.py` — empty

### Phase 2: API Routes (2 files)

- `server/app/routes/devices.py` — POST register endpoint
- `server/app/routes/sessions.py` — All session CRUD + state save/load. When activating a session, deactivate others for that device.

### Phase 3: Docker (3 files)

- `server/requirements.txt` — fastapi, uvicorn, sqlalchemy, aiomysql, pydantic
- `server/Dockerfile` — Python 3.12-slim, install deps, run uvicorn
- `docker-compose.yml` — browserskill-server service on port 8000, connects to external MariaDB network (placeholder name, user will provide actual network name)

### Phase 4: Extension Skeleton (5 files)

- `extension/manifest.json` — MV3, permissions: tabs, tabGroups, storage, alarms. Host permissions for localhost:8000.
- `extension/lib/api.js` — Shared API client (fetch wrapper with X-API-Key header). Used by service worker, popup, and options.
- `extension/options/options.html` — Server URL, device name, API key, register/test buttons
- `extension/options/options.js` — Load/save config from chrome.storage.local, register device
- `extension/options/options.css` — Minimal styles

### Phase 5: Service Worker — Core Logic (1 file)

`extension/background.js` — The most complex file:

- **All event listeners registered synchronously at top level** (MV3 requirement)
- **Events**: tabs.onCreated/Removed/Updated/Moved/Attached/Detached, tabGroups.onCreated/Updated/Removed, windows.onCreated/Removed
- **Debounce**: Immediate save if >5s since last save, otherwise schedule via chrome.alarms (30s min). Uses chrome.storage.session for dirty flag + lastSaveTime.
- **captureBrowserState()**: Queries all windows+tabs+groups, filters chrome:// URLs, maps chrome group IDs to local sequential IDs
- **restoreBrowserState()**: On chrome.runtime.onStartup, fetches state from server, creates windows, opens tabs, pins tabs, creates groups, activates correct tab
- **Message handler**: For popup commands (captureNow, restoreSession, switchSession)

### Phase 6: Popup UI (3 files)

- `extension/popup/popup.html` — Session list, active indicator, action buttons
- `extension/popup/popup.js` — List sessions, create/activate/restore/delete, "Save Now" button
- `extension/popup/popup.css` — 350px wide, clean design

### Phase 7: Icons + CLAUDE.md (4 files)

- `extension/icons/icon16.png`, `icon48.png`, `icon128.png` — Simple placeholder icons
- `CLAUDE.md` — Project documentation for future Claude Code sessions

---

## Key Design Decisions

1. **No "browser close" event**: State saves on every tab/window/group change (debounced), so server always has near-real-time state. Max data loss on crash: ~30 seconds.
2. **Multiple browser window handling**: Sometimes along the main browser window with all the importnat tabs, the user can have a second winodw open with, for example, just a pdf doc. Then that second window can go to background and user can close the main winow, then only the other one is left and the user closes this one with just the pdf. Now on the server this should not delete the tabs from the main window. The server should recognize that the main window was just closed first and at next start should load the tabs from the main window (it is okay to lose that pdf window (pdf was just an example, the secondary window might have different tabs))
3. **Tab group ID mapping**: Chrome's group IDs are session-scoped. We map them to local sequential IDs (1, 2, 3) in the JSON and reconstruct groups on restore.
4. **Filtered URLs**: chrome:// and chrome-extension:// URLs are excluded (can't be programmatically opened). (adapt this to brave browser too)
5. **Restore reuses first window**: On startup, the existing new-tab window is reused for the first restored window to avoid an empty extra window.
6. **One active session per device**: Activating a session deactivates all others for that device.
7. **Sessions are shared**: All authenticated devices can see and restore all sessions (enables cross-device sync). `device_id` tracks who created/last-saved, but doesn't restrict access.
8. **importScripts()**: Service worker uses `importScripts("lib/api.js")` for MV3 compatibility (no ES modules in service workers).

---

## File Manifest (23 files total)

```
BrowserSkill/
├── CLAUDE.md
├── docker-compose.yml
├── server/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── __init__.py
│       ├── main.py
│       ├── database.py
│       ├── models.py
│       ├── schemas.py
│       ├── auth.py
│       └── routes/
│           ├── __init__.py
│           ├── devices.py
│           └── sessions.py
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── lib/
│   │   └── api.js
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── options/
│   │   ├── options.html
│   │   ├── options.js
│   │   └── options.css
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
```

---

## Verification

1. **Server**: `docker-compose up --build`, then `curl http://localhost:8000/api/health` → `{"status":"ok"}`
2. **Register device**: `curl -X POST http://localhost:8000/api/devices/register -H "Content-Type: application/json" -d '{"name":"test"}'` → returns API key
3. **Session CRUD**: Create, list, update, delete sessions via curl with X-API-Key header
4. **Extension**: Load unpacked from `extension/` in chrome://extensions, configure server in options, create a session
5. **End-to-end**: Open tabs + groups → wait 30s → check DB for saved state → close browser → reopen → verify tabs/groups restored
