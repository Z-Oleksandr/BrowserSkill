# BrowserSkill

Brave(chromium) extension that saves and restores your tabs and tab groups across browser restarts and devices. Backed by a self-hosted FastAPI server with MariaDB.

## Features

- Automatically saves open tabs and tab groups on change
- Restores full browser state on startup
- Syncs sessions across multiple devices
- Manages multiple named sessions
- Works with Brave and Chrome

## Quick Start

### 1. Extension

**Option A** — download from [Releases](../../releases/latest):

1. Download and unzip `BrowserSkill-v*.zip`
2. Open `chrome://extensions` (or `brave://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked** and select the unzipped folder

**Option B** — from source:

1. Clone this repo
2. Load the `extension/` folder as unpacked extension (same steps as above)

### 2. Server

The given setup is custom for existing Docker and MariaDB container, so if you have the intention to deploy for yourself - edit `docker-compose.yml` and `manifest.json`.

```bash
cp .env.example .env   # fill in your DB credentials and a REGISTRATION_SECRET
docker-compose up --build
```

The API starts on the port defined in `.env` (default `8000`).

### 3. Connect

1. Click the BrowserSkill extension icon
2. Go to **Settings**
3. Enter your server URL (e.g. `http://localhost:8000`)
4. Register a device name and API key using your registration secret

Your tabs will now auto-save and can be restored from any connected device.
