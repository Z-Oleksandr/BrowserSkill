# BrowserSkill

Chrome/Brave MV3 extension + FastAPI server + existing MariaDB container.
Persists browser tab/group state across restarts and devices.

## How to run

1. Copy `.env.example` to `.env` and fill in credentials
2. `docker-compose up --build` — starts the API server on port 8000
3. Load `extension/` as unpacked extension in chrome://extensions (enable Developer mode)
4. Click extension icon → Settings → enter server URL + register device

## Architecture

- `server/` — FastAPI with async SQLAlchemy + aiomysql
- `extension/background.js` — service worker: main window tracking, capture/restore, debounced saves
- `extension/lib/api.js` — shared API client (importScripts in SW, script tag in popup)
- `extension/popup/` — dark-themed popup with Sessions + Settings views

## Key decisions

- **Main window only**: secondary windows completely ignored
- **State format**: single window object, not array
- **Popup is the only UI**: settings embedded in popup, no options page
- **30s debounce** via chrome.alarms, immediate if >5s since last save
- **Auto-restore on startup**, last-write-wins for conflicts
- **Sessions shared across devices**, one active per device
- Auth: X-API-Key header
- Filter brave://, chrome://, chrome-extension://, edge:// URLs
