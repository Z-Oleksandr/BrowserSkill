# BrowserSkill — Final Implementation Plan

## Context

BrowserSkill is a Brave/Chrome extension that persists browser session state (tabs, tab groups) to a local FastAPI server backed by an existing MariaDB container. Sessions survive browser restarts and can be accessed across devices.

**Tech stack**: Chrome Manifest V3 extension (vanilla JS) + Python FastAPI + MariaDB (existing) + Docker

**Key design decisions** (confirmed with user):
- **Main window only**: Only the initial/launch window is tracked. All additional windows are ignored entirely.
- **Main window closed**: Last-saved state is preserved on server; restored on next startup.
- **Auto-restore on startup**: On `chrome.runtime.onStartup`, auto-restore the active session.
- **Conflicts**: Last write wins (simple overwrite).
- **UI**: Dark theme popup is the ONLY interface (no separate options page). Settings view is a panel within the popup. Opens on regular click.
- **State format**: Single window object (not array): `{ captured_at, window: { type, state, left, top, width, height, tabs: [...], tab_groups: [...] } }`
- **Save interval**: 30s debounce via `chrome.alarms`. Immediate save if >5s since last save.
- **Brave adaptations**: Filter `brave://` URLs in addition to `chrome://` and `chrome-extension://`.
- **Sessions are shared**: All devices see all sessions. `device_id` tracks creator. One active session per device.
- **MariaDB**: Connection via `.env` file with placeholder env vars.

---

## File Manifest (24 files)

```
BrowserSkill/
├── .gitignore
├── .env.example
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
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
```

---

## Phase 1: Infrastructure (4 files)

**Files**: `.gitignore`, `.env.example`, `docker-compose.yml`, `CLAUDE.md`

- `.env.example` — placeholders: `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`, `DB_PORT=3306`, `API_SERVER_PORT=8000`
- `.gitignore` — `.env`, `__pycache__/`, etc.
- `docker-compose.yml` — single `browserskill-server` service, port `${API_SERVER_PORT:-8000}:8000`, `env_file: .env`, external MariaDB network (placeholder name)
- `CLAUDE.md` — project overview, how to run, key decisions

**Verify**: `docker-compose config` parses without errors

---

## Phase 2: Server Foundation (7 files)

**Files**: `server/Dockerfile`, `server/requirements.txt`, `server/app/__init__.py`, `server/app/database.py`, `server/app/models.py`, `server/app/schemas.py`, `server/app/auth.py`

### `database.py`
- Async SQLAlchemy engine: `mysql+aiomysql://{user}:{pass}@{host}:{port}/{name}`
- `async_sessionmaker`, `get_db()` dependency, `init_db()` creates tables

### `models.py`
- `Device`: id, name, api_key (unique, indexed), created_at
- `Session`: id, device_id (FK, ON DELETE CASCADE), name, state_data (Text/LONGTEXT), is_active (default False), created_at, updated_at
- Relationship: Device.sessions ↔ Session.device

### `schemas.py` (Pydantic v2)
- `DeviceRegisterRequest/Response`, `SessionCreate`, `SessionUpdate`, `SessionListItem`, `SessionDetail`
- `TabState`, `TabGroupState`, `WindowState`, `BrowserState` — single window object

### `auth.py`
- `generate_api_key()` — `secrets.token_urlsafe(32)`
- `get_current_device()` — FastAPI dependency, reads `X-API-Key` header, returns Device or 401

### `requirements.txt`
- fastapi, uvicorn[standard], sqlalchemy, aiomysql, pydantic, pydantic-settings

---

## Phase 3: API Routes + App (4 files)

**Files**: `server/app/routes/__init__.py`, `server/app/routes/devices.py`, `server/app/routes/sessions.py`, `server/app/main.py`

### `devices.py`
- `POST /api/devices/register` — no auth, creates device with generated key

### `sessions.py`
- `GET /api/sessions` — list ALL sessions (shared), exclude state_data from response
- `POST /api/sessions` — create session (device_id = authenticated device)
- `GET /api/sessions/{id}` — get with state_data
- `PUT /api/sessions/{id}` — update name/is_active. When `is_active=True`, deactivate all OTHER sessions for THIS device only
- `DELETE /api/sessions/{id}` — delete, return 204
- `PUT /api/sessions/{id}/state` — save BrowserState JSON, update device_id to saving device
- `GET /api/sessions/{id}/state` — return state or null

### `main.py`
- FastAPI with async lifespan calling `init_db()`
- Mount routers, `GET /api/health`
- CORS middleware allowing all origins (chrome-extension:// origin)

**Verify**: `docker-compose up --build`, then curl health, register, full CRUD cycle

---

## Phase 4: Extension Skeleton (2 files)

**Files**: `extension/manifest.json`, `extension/lib/api.js`

### `manifest.json`
- MV3, permissions: `tabs`, `tabGroups`, `storage`, `alarms`
- host_permissions: `http://localhost:8000/*`, `http://127.0.0.1:8000/*`
- `action.default_popup`: `popup/popup.html`
- No `options_page` or `options_ui`

### `api.js`
- `self.BrowserSkillAPI = class { ... }` — works in both service worker (`importScripts`) and popup (`<script>`)
- Lazy config loading from `chrome.storage.local`
- Methods: `healthCheck`, `registerDevice`, `listSessions`, `createSession`, `getSession`, `updateSession`, `deleteSession`, `saveState`, `loadState`, `clearConfigCache`

---

## Phase 5: Background Service Worker (1 file) — MOST COMPLEX

**File**: `extension/background.js`

### Top-level structure
```
importScripts("lib/api.js");
// Constants, API init
// ALL event listeners registered synchronously at top level (MV3 requirement)
```

### Main window tracking
- Store `mainWindowId` in `chrome.storage.session` (survives SW restarts, clears on browser restart)
- Set on startup/install to the first `type: "normal"` window
- Clear (set null) when main window is closed — do NOT save

### Event handling — ALL handlers guard against non-main windows
- `tabs.onCreated/Removed/Updated/Moved/Attached/Detached` — check `windowId === mainWindowId`
- `tabGroups.onCreated/Updated/Removed` — check `group.windowId === mainWindowId`
- `windows.onRemoved(id)` — if main window, clear mainWindowId + cancel pending alarm. Do NOT save.
- `onTabRemoved` special: if `removeInfo.isWindowClosing && windowId === mainWindowId`, ignore (don't save partial state)
- `onTabUpdated` special: only save when `changeInfo.status === "complete"`

### Debounce logic
- `chrome.storage.session` stores `lastSaveTime`, `isDirty`
- If `now - lastSaveTime > 5s`, save immediately. Otherwise, `chrome.alarms.create("browserskill-save", { delayInMinutes: 0.5 })`

### `captureBrowserState()`
- `chrome.windows.get(mainWindowId, { populate: true })`
- `chrome.tabGroups.query({ windowId: mainWindowId })` — wrapped in try-catch for browsers without tabGroups API
- Filter `chrome://`, `brave://`, `chrome-extension://`, `edge://` URLs
- Map chrome group IDs → sequential local_ids (1, 2, 3...)
- Return single-window BrowserState object

### `restoreBrowserState(stateData)`
1. Set `isRestoring = true` in `chrome.storage.session` (prevents event handlers from saving during restore)
2. Reuse existing single-tab window or create new one
3. Create tabs in order (all unpinned first, then pin the ones that need pinning)
4. Group tabs: `chrome.tabs.group()` then `chrome.tabGroups.update()` for title/color/collapsed
5. Activate correct tab, remove leftover new-tab page
6. Set `mainWindowId` to the restored window
7. Set `lastSaveTime = now`, clear `isRestoring`
8. Cancel any pending alarm

### `handleStartup()`
- Identify main window (first `type: "normal"`)
- Set `mainWindowId`
- If configured (apiKey exists), auto-restore active session

### Message handler (from popup)
- `captureNow` — immediate save
- `restoreSession` — fetch state + restore
- `getStatus` — return mainWindowId, isDirty, lastSaveTime, activeSessionId
- Return `true` from listener for async `sendResponse`

---

## Phase 6: Popup UI (3 files)

**Files**: `extension/popup/popup.html`, `extension/popup/popup.js`, `extension/popup/popup.css`

### Two views within one popup
- **Sessions view**: session list (cards), "New Session" input + button, "Save Now" button
- **Settings view**: server URL input, device name input, Register button, API key display, Test Connection button
- Toggle via gear/list icon in header

### Behavior
- On open: load settings from `chrome.storage.local`. If not configured → show Settings. If configured → show Sessions + load list.
- Session cards show: name, active indicator, updated_at. Actions: Activate, Restore, Delete (with confirm).
- Active session highlighted with accent color.
- Register stores apiKey in `chrome.storage.local`, calls `api.clearConfigCache()`

### Dark theme design
- Background: `#1a1a2e`, text: `#e0e0e0`, accent: `#00d4aa`
- Width: 350px, min-height: 400px, max-height: 500px, scrollable session list
- System fonts, rounded corners, subtle hover effects

---

## Phase 7: Icons (3 files)

**Files**: `extension/icons/icon16.png`, `icon48.png`, `icon128.png`

- Simple placeholder icons (solid color with "BS" or geometric shape) in teal/cyan accent color
- PNG with transparency, 16x16 / 48x48 / 128x128

---

## Critical Edge Cases

1. **Service worker termination**: All state in `chrome.storage.session/local`, SW is stateless
2. **Race: restore vs pending save**: Restore must cancel pending alarm + set `isRestoring` flag
3. **`isRestoring` flag**: All event handlers check this flag and skip if true
4. **Tab group API unavailability**: Wrap `chrome.tabGroups` calls in try-catch
5. **Network failures**: Save fails silently, `isDirty` stays true, next alarm retries
6. **Empty tab list after filtering**: Valid state, save it. On restore with 0 tabs, do nothing.
7. **Startup before server ready**: Restore fails gracefully (logged), user can manually restore later
8. **`onTabRemoved` during window close**: `isWindowClosing=true` + main window → ignore all
9. **Large sessions (100+ tabs)**: LONGTEXT handles it, list endpoint excludes state_data

---

## Verification (End-to-End)

1. `docker-compose up --build` → server on :8000
2. `curl /api/health` → `{"status":"ok"}`
3. Register device via curl → get API key
4. Load extension unpacked in Brave, configure server URL + register in popup
5. Create a session, activate it
6. Open tabs, create tab groups, pin some tabs
7. Wait 30s → check DB for saved state
8. Click "Save Now" → verify immediate save
9. Open a secondary window, modify tabs → verify NO save triggered for those
10. Close main window (leave secondary open) → verify last state preserved
11. Close browser entirely → reopen → verify tabs/groups auto-restored correctly
12. Pinned tabs still pinned, groups have correct titles/colors
13. Test from a second device: see same sessions, restore from device A's save
