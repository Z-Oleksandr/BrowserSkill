importScripts("lib/api.js");

const api = new BrowserSkillAPI();
const ALARM_NAME = "browserskill-save";
const SAVE_COOLDOWN_MS = 5000;
const FILTERED_PROTOCOLS = ["chrome://", "brave://", "chrome-extension://", "edge://"];

// ---------------------------------------------------------------------------
// Storage helpers (chrome.storage.session for transient state)
// ---------------------------------------------------------------------------

async function getSessionVar(key) {
  const data = await chrome.storage.session.get(key);
  return data[key] ?? null;
}

function setSessionVar(obj) {
  return chrome.storage.session.set(obj);
}

async function getMainWindowId() {
  return await getSessionVar("mainWindowId");
}

async function isRestoring() {
  return (await getSessionVar("isRestoring")) === true;
}

async function getActiveSessionId() {
  const data = await chrome.storage.local.get("activeSessionId");
  return data.activeSessionId ?? null;
}

// ---------------------------------------------------------------------------
// Main window identification
// ---------------------------------------------------------------------------

async function identifyMainWindow() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    if (win && win.id) {
      await setSessionVar({ mainWindowId: win.id });
      return win.id;
    }
  } catch {
    // Fallback: pick first normal window
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    if (windows.length > 0) {
      await setSessionVar({ mainWindowId: windows[0].id });
      return windows[0].id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Debounced save
// ---------------------------------------------------------------------------

async function scheduleSave() {
  if (await isRestoring()) return;
  const mainWinId = await getMainWindowId();
  if (mainWinId === null) return;

  const now = Date.now();
  const lastSave = (await getSessionVar("lastSaveTime")) || 0;

  if (now - lastSave > SAVE_COOLDOWN_MS) {
    await doSave();
  } else {
    await setSessionVar({ isDirty: true });
    await chrome.alarms.clear(ALARM_NAME);
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.5 });
  }
}

let saveInFlight = false;

async function doSave() {
  if (saveInFlight) {
    await setSessionVar({ isDirty: true });
    return;
  }
  saveInFlight = true;

  try {
    const sessionId = await getActiveSessionId();
    if (!sessionId) return;

    const mainWinId = await getMainWindowId();
    if (mainWinId === null) return;

    const state = await captureBrowserState(mainWinId);
    if (!state) return;
    await api.saveState(sessionId, state);
    await setSessionVar({ lastSaveTime: Date.now(), isDirty: false });
    await chrome.alarms.clear(ALARM_NAME);
  } catch (err) {
    console.error("BrowserSkill: save failed", err);
  } finally {
    saveInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Capture browser state
// ---------------------------------------------------------------------------

async function captureBrowserState(windowId) {
  let win;
  try {
    win = await chrome.windows.get(windowId, { populate: true });
  } catch {
    return null; // window gone
  }

  const tabs = (win.tabs || [])
    .filter((t) => {
      const url = t.pendingUrl || t.url || "";
      return url && !FILTERED_PROTOCOLS.some((p) => url.startsWith(p));
    })
    .map((t) => {
      const url = t.pendingUrl || t.url || "";
      return {
        url,
        title: t.title || "",
        pinned: t.pinned,
        group_id: t.groupId > -1 ? t.groupId : null,
        index: t.index,
        active: t.active,
      };
    });

  let tabGroups = [];
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    // Map chrome group IDs to sequential local IDs
    const groupIdMap = new Map();
    let nextLocalId = 1;
    for (const g of groups) {
      groupIdMap.set(g.id, nextLocalId);
      tabGroups.push({
        local_id: nextLocalId,
        title: g.title || "",
        color: g.color || "grey",
        collapsed: g.collapsed,
      });
      nextLocalId++;
    }
    // Remap tab group_ids
    for (const tab of tabs) {
      if (tab.group_id !== null) {
        tab.group_id = groupIdMap.get(tab.group_id) ?? null;
      }
    }
  } catch {
    // tabGroups API not available
  }

  return {
    captured_at: new Date().toISOString(),
    window: {
      type: win.type,
      state: win.state,
      left: win.left,
      top: win.top,
      width: win.width,
      height: win.height,
      tabs,
      tab_groups: tabGroups,
    },
  };
}

// ---------------------------------------------------------------------------
// Restore browser state
// ---------------------------------------------------------------------------

async function restoreBrowserState(stateData) {
  if (!stateData || !stateData.window) return;

  const win = stateData.window;
  if (!win.tabs || win.tabs.length === 0) return;

  await setSessionVar({ isRestoring: true });

  try {
    await chrome.alarms.clear(ALARM_NAME);
    // Find existing single-tab window to reuse (browser start gives us one)
    const existingWindows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    let targetWindowId;
    const NEW_TAB_URLS = ["chrome://newtab/", "brave://newtab/", "edge://newtab/"];
    const reuseWindow = existingWindows.find(
      (w) => w.tabs.length === 1 && NEW_TAB_URLS.includes(w.tabs[0].url)
    );

    if (reuseWindow) {
      targetWindowId = reuseWindow.id;
      // Update window geometry if state was not maximized
      if (win.state === "normal") {
        await chrome.windows.update(targetWindowId, {
          left: win.left,
          top: win.top,
          width: win.width,
          height: win.height,
        });
      }
    } else {
      const createOpts = { url: "about:blank", type: "normal" };
      if (win.state === "normal") {
        Object.assign(createOpts, {
          left: win.left,
          top: win.top,
          width: win.width,
          height: win.height,
        });
      }
      const newWin = await chrome.windows.create(createOpts);
      targetWindowId = newWin.id;
    }

    // Create all tabs (unpinned first, then pin individually)
    const sortedTabs = [...win.tabs].sort((a, b) => a.index - b.index);
    const createdTabs = [];
    let activeTabId = null;
    const leftoverTabIds = [];

    // Get existing tabs in the window (the new-tab page we want to remove later)
    const existingTabs = await chrome.tabs.query({ windowId: targetWindowId });
    for (const t of existingTabs) {
      leftoverTabIds.push(t.id);
    }

    // Create pinned tabs first to preserve correct ordering
    const pinnedTabs = sortedTabs.filter((t) => t.pinned);
    const unpinnedTabs = sortedTabs.filter((t) => !t.pinned);

    for (const tabData of [...pinnedTabs, ...unpinnedTabs]) {
      try {
        const tab = await chrome.tabs.create({
          windowId: targetWindowId,
          url: tabData.url,
          pinned: tabData.pinned,
          active: false,
        });
        createdTabs.push({ chromeTab: tab, data: tabData });
        if (tabData.active) {
          activeTabId = tab.id;
        }
      } catch (err) {
        console.warn("BrowserSkill: failed to create tab", tabData.url, err);
      }
    }

    // Remove leftover tabs (the original new-tab pages)
    for (const id of leftoverTabIds) {
      try {
        await chrome.tabs.remove(id);
      } catch { /* already closed */ }
    }

    // Create tab groups
    if (win.tab_groups && win.tab_groups.length > 0) {
      for (const groupData of win.tab_groups) {
        const tabIds = createdTabs
          .filter((ct) => ct.data.group_id === groupData.local_id)
          .map((ct) => ct.chromeTab.id);

        if (tabIds.length === 0) continue;

        try {
          const groupId = await chrome.tabs.group({
            tabIds,
            createProperties: { windowId: targetWindowId },
          });
          await chrome.tabGroups.update(groupId, {
            title: groupData.title,
            color: groupData.color,
            collapsed: groupData.collapsed,
          });
        } catch (err) {
          console.error("BrowserSkill: group restore failed", err);
        }
      }
    }

    // Activate the correct tab
    if (activeTabId) {
      await chrome.tabs.update(activeTabId, { active: true });
    }

    // Set window state (maximized, fullscreen, etc.)
    if (win.state && win.state !== "normal") {
      await chrome.windows.update(targetWindowId, { state: win.state });
    }

    // Focus the restored window
    await chrome.windows.update(targetWindowId, { focused: true });

    // Update main window tracking
    await setSessionVar({
      mainWindowId: targetWindowId,
      lastSaveTime: Date.now(),
    });
  } finally {
    await setSessionVar({ isRestoring: false });
  }
}

// ---------------------------------------------------------------------------
// Event listeners — ALL registered synchronously at top level (MV3)
// ---------------------------------------------------------------------------

// Guard: only process events for the main window
async function isMainWindow(windowId) {
  const mainWinId = await getMainWindowId();
  return mainWinId !== null && windowId === mainWinId;
}

// --- Tab events ---

chrome.tabs.onCreated.addListener(async (tab) => {
  if (await isRestoring()) return;
  if (await isMainWindow(tab.windowId)) scheduleSave();
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (await isRestoring()) return;
  // If the main window is closing, don't save partial state
  if (removeInfo.isWindowClosing) return;
  if (await isMainWindow(removeInfo.windowId)) scheduleSave();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (await isRestoring()) return;
  if (changeInfo.status !== "complete") return;
  if (await isMainWindow(tab.windowId)) scheduleSave();
});

chrome.tabs.onMoved.addListener(async (tabId, moveInfo) => {
  if (await isRestoring()) return;
  if (await isMainWindow(moveInfo.windowId)) scheduleSave();
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  if (await isRestoring()) return;
  if (await isMainWindow(attachInfo.newWindowId)) scheduleSave();
});

chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
  if (await isRestoring()) return;
  if (await isMainWindow(detachInfo.oldWindowId)) scheduleSave();
});

// --- Tab group events ---

chrome.tabGroups.onCreated.addListener(async (group) => {
  if (await isRestoring()) return;
  if (await isMainWindow(group.windowId)) scheduleSave();
});

chrome.tabGroups.onUpdated.addListener(async (group) => {
  if (await isRestoring()) return;
  if (await isMainWindow(group.windowId)) scheduleSave();
});

chrome.tabGroups.onRemoved.addListener(async (group) => {
  if (await isRestoring()) return;
  if (await isMainWindow(group.windowId)) scheduleSave();
});

// --- Window events ---

chrome.windows.onRemoved.addListener(async (windowId) => {
  const mainWinId = await getMainWindowId();
  if (windowId === mainWinId) {
    // Main window closed — preserve last saved state, don't save
    await setSessionVar({ mainWindowId: null });
    await chrome.alarms.clear(ALARM_NAME);
  }
});

// --- Alarm handler ---

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await doSave();
  }
});

// --- Startup: auto-restore ---

chrome.runtime.onStartup.addListener(async () => {
  const mainWinId = await identifyMainWindow();
  if (!mainWinId) return;

  const sessionId = await getActiveSessionId();
  if (!sessionId) return;

  const config = await chrome.storage.local.get("apiKey");
  if (!config.apiKey) return;

  try {
    const resp = await api.loadState(sessionId);
    if (resp && resp.state) {
      await restoreBrowserState(resp.state);
    }
  } catch (err) {
    console.error("BrowserSkill: auto-restore failed", err);
  }
});

// --- Install: identify main window ---

chrome.runtime.onInstalled.addListener(async () => {
  await identifyMainWindow();
});

// --- Message handler (from popup) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case "captureNow": {
          await doSave();
          sendResponse({ success: true });
          break;
        }
        case "restoreSession": {
          const resp = await api.loadState(message.sessionId);
          if (resp && resp.state) {
            await restoreBrowserState(resp.state);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: "No state data" });
          }
          break;
        }
        case "getStatus": {
          const mainWinId = await getMainWindowId();
          const isDirty = (await getSessionVar("isDirty")) === true;
          const lastSaveTime = (await getSessionVar("lastSaveTime")) || 0;
          const activeSessionId = await getActiveSessionId();
          sendResponse({
            mainWindowId: mainWinId,
            isDirty,
            lastSaveTime,
            activeSessionId,
          });
          break;
        }
        case "setActiveSession": {
          await chrome.storage.local.set({ activeSessionId: message.sessionId });
          // Identify main window if not set
          const mainWinId = await getMainWindowId();
          if (!mainWinId) await identifyMainWindow();
          sendResponse({ success: true });
          break;
        }
        case "clearActiveSession": {
          await chrome.storage.local.remove("activeSessionId");
          await chrome.alarms.clear(ALARM_NAME);
          sendResponse({ success: true });
          break;
        }
        default:
          sendResponse({ error: "Unknown action" });
      }
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  })();
  return true; // keep channel open for async sendResponse
});
