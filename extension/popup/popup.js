const api = new BrowserSkillAPI();

// DOM elements
const sessionsView = document.getElementById("sessionsView");
const settingsView = document.getElementById("settingsView");
const toggleViewBtn = document.getElementById("toggleView");
const gearIcon = document.getElementById("gearIcon");
const listIcon = document.getElementById("listIcon");
const sessionList = document.getElementById("sessionList");
const statusIcon = document.getElementById("statusIcon");
const statusText = document.getElementById("statusText");
const saveNowBtn = document.getElementById("saveNowBtn");
const newSessionName = document.getElementById("newSessionName");
const createSessionBtn = document.getElementById("createSessionBtn");
const serverUrlInput = document.getElementById("serverUrl");
const deviceNameInput = document.getElementById("deviceName");
const regSecretInput = document.getElementById("regSecret");
const registerBtn = document.getElementById("registerBtn");
const testBtn = document.getElementById("testBtn");
const apiKeyDisplay = document.getElementById("apiKeyDisplay");
const apiKeyValue = document.getElementById("apiKeyValue");
const settingsStatus = document.getElementById("settingsStatus");

let currentView = "sessions";

// ---------------------------------------------------------------------------
// View toggling
// ---------------------------------------------------------------------------

toggleViewBtn.addEventListener("click", () => {
  if (currentView === "sessions") {
    showSettings();
  } else {
    showSessions();
  }
});

function showSessions() {
  currentView = "sessions";
  sessionsView.classList.remove("hidden");
  settingsView.classList.add("hidden");
  gearIcon.classList.remove("hidden");
  listIcon.classList.add("hidden");
  loadSessions();
}

function showSettings() {
  currentView = "settings";
  sessionsView.classList.add("hidden");
  settingsView.classList.remove("hidden");
  gearIcon.classList.add("hidden");
  listIcon.classList.remove("hidden");
  loadSettings();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function loadSettings() {
  const data = await chrome.storage.local.get(["serverUrl", "deviceName", "apiKey"]);
  serverUrlInput.value = data.serverUrl || "http://localhost:8000";
  deviceNameInput.value = data.deviceName || "";
  if (data.apiKey) {
    apiKeyValue.textContent = data.apiKey;
    apiKeyDisplay.classList.remove("hidden");
    registerBtn.disabled = true;
    registerBtn.title = "Device already registered";
  }
}

registerBtn.addEventListener("click", async () => {
  const serverUrl = serverUrlInput.value.trim();
  const deviceName = deviceNameInput.value.trim();
  const regSecret = regSecretInput.value.trim();
  if (!serverUrl || !deviceName || !regSecret) {
    setSettingsStatus("Please fill in all fields", "error");
    return;
  }

  await chrome.storage.local.set({ serverUrl, deviceName });
  api.clearConfigCache();

  try {
    setSettingsStatus("Registering...", "");
    const result = await api.registerDevice(deviceName, regSecret);
    await chrome.storage.local.set({ apiKey: result.api_key, deviceId: result.id });
    api.clearConfigCache();
    regSecretInput.value = "";
    apiKeyValue.textContent = result.api_key;
    apiKeyDisplay.classList.remove("hidden");
    registerBtn.disabled = true;
    registerBtn.title = "Device already registered";
    setSettingsStatus("Device registered successfully!", "success");
    setTimeout(() => showSessions(), 1200);
  } catch (err) {
    setSettingsStatus(`Registration failed: ${err.message}`, "error");
  }
});

testBtn.addEventListener("click", async () => {
  const serverUrl = serverUrlInput.value.trim();
  if (!serverUrl) {
    setSettingsStatus("Enter a server URL first", "error");
    return;
  }
  await chrome.storage.local.set({ serverUrl });
  api.clearConfigCache();

  try {
    setSettingsStatus("Testing...", "");
    await api.healthCheck();
    setSettingsStatus("Connection successful!", "success");
  } catch (err) {
    setSettingsStatus(`Connection failed: ${err.message}`, "error");
  }
});

function setSettingsStatus(msg, type) {
  settingsStatus.textContent = msg;
  settingsStatus.className = "status-msg" + (type ? ` ${type}` : "");
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function loadSessions() {
  const data = await chrome.storage.local.get(["apiKey", "activeSessionId"]);
  if (!data.apiKey) {
    setStatus("Not configured — open Settings", null);
    saveNowBtn.disabled = true;
    sessionList.innerHTML = '<div class="empty-state">Configure your server in Settings to get started.</div>';
    return;
  }

  try {
    const bgStatus = await chrome.runtime.sendMessage({ action: "getStatus" });
    if (bgStatus.activeSessionId) {
      if (bgStatus.isDirty) {
        setStatus("Unsaved changes", "notSynced");
      } else {
        setStatus("Synced", "synced");
      }
      saveNowBtn.disabled = false;
    } else {
      setStatus("No active session", null);
      saveNowBtn.disabled = true;
    }

    const sessions = await api.listSessions();
    renderSessions(sessions, data.activeSessionId);
  } catch (err) {
    setStatus("Error loading sessions", "notSynced");
    sessionList.innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

function renderSessions(sessions, activeSessionId) {
  if (sessions.length === 0) {
    sessionList.innerHTML = '<div class="empty-state">No sessions yet. Create one below.</div>';
    return;
  }

  sessionList.innerHTML = sessions
    .map((s) => {
      const isActive = s.id === activeSessionId;
      const updatedAt = new Date(s.updated_at).toLocaleString();
      return `
        <div class="session-card${isActive ? " active" : ""}" data-id="${s.id}">
          <div class="${isActive ? "active-dot" : "inactive-dot"}"></div>
          <div class="session-info">
            <div class="session-name">${escapeHtml(s.name)}</div>
            <div class="session-meta">${updatedAt}</div>
          </div>
          <div class="session-actions">
            ${
              isActive
                ? '<button class="btn btn-small" data-action="deactivate">Deactivate</button>'
                : '<button class="btn btn-small btn-accent" data-action="activate">Activate</button>'
            }
            <button class="btn btn-small" data-action="restore">Restore</button>
            <button class="btn btn-small btn-danger" data-action="delete">Del</button>
          </div>
        </div>
      `;
    })
    .join("");

  // Attach event listeners
  for (const card of sessionList.querySelectorAll(".session-card")) {
    const id = parseInt(card.dataset.id);
    for (const btn of card.querySelectorAll("[data-action]")) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleSessionAction(btn.dataset.action, id);
      });
    }
  }
}

async function handleSessionAction(action, sessionId) {
  try {
    switch (action) {
      case "activate": {
        await api.updateSession(sessionId, { is_active: true });
        await chrome.runtime.sendMessage({
          action: "setActiveSession",
          sessionId,
        });
        await chrome.storage.local.set({ activeSessionId: sessionId });
        break;
      }
      case "deactivate": {
        await api.updateSession(sessionId, { is_active: false });
        await chrome.runtime.sendMessage({ action: "clearActiveSession" });
        await chrome.storage.local.remove("activeSessionId");
        break;
      }
      case "restore": {
        setStatus("Restoring...", null);
        await chrome.runtime.sendMessage({
          action: "restoreSession",
          sessionId,
        });
        setStatus("Restored!", "synced");
        break;
      }
      case "delete": {
        if (!confirm("Delete this session?")) return;
        await api.deleteSession(sessionId);
        const data = await chrome.storage.local.get("activeSessionId");
        if (data.activeSessionId === sessionId) {
          await chrome.runtime.sendMessage({ action: "clearActiveSession" });
          await chrome.storage.local.remove("activeSessionId");
        }
        break;
      }
    }
    loadSessions();
  } catch (err) {
    setStatus(`Error: ${err.message}`, "notSynced");
  }
}

// ---------------------------------------------------------------------------
// Save Now
// ---------------------------------------------------------------------------

saveNowBtn.addEventListener("click", async () => {
  saveNowBtn.disabled = true;
  setStatus("Saving...", null);
  try {
    await chrome.runtime.sendMessage({ action: "captureNow" });
    setStatus("Saved!", "synced");
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, "notSynced");
  }
  saveNowBtn.disabled = false;
});

// ---------------------------------------------------------------------------
// Create session
// ---------------------------------------------------------------------------

createSessionBtn.addEventListener("click", createSession);
newSessionName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createSession();
});

async function createSession() {
  const name = newSessionName.value.trim();
  if (!name) return;

  try {
    await api.createSession(name);
    newSessionName.value = "";
    loadSessions();
  } catch (err) {
    setStatus(`Create failed: ${err.message}`, "notSynced");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setStatus(text, icon) {
  statusText.textContent = text;
  if (icon === "synced") {
    statusIcon.src = "../icons/synced.png";
    statusIcon.classList.remove("hidden");
  } else if (icon === "notSynced") {
    statusIcon.src = "../icons/notSynced.png";
    statusIcon.classList.remove("hidden");
  } else {
    statusIcon.classList.add("hidden");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

(async () => {
  const data = await chrome.storage.local.get("apiKey");
  if (!data.apiKey) {
    showSettings();
  } else {
    showSessions();
  }
})();
