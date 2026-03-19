/**
 * BrowserSkill API client.
 * Works in both service worker (importScripts) and popup (<script> tag).
 */
self.BrowserSkillAPI = class BrowserSkillAPI {
    constructor() {
        this._config = null;
    }

    async _getConfig() {
        if (this._config) return this._config;
        const data = await chrome.storage.local.get(["serverUrl", "apiKey"]);
        this._config = {
            serverUrl: (data.serverUrl || "http://localhost:8008").replace(
                /\/+$/,
                "",
            ),
            apiKey: data.apiKey || null,
        };
        return this._config;
    }

    clearConfigCache() {
        this._config = null;
    }

    async _request(path, options = {}) {
        const config = await this._getConfig();
        const url = `${config.serverUrl}${path}`;
        const headers = {
            "Content-Type": "application/json",
            ...options.headers,
        };
        if (config.apiKey) {
            headers["X-API-Key"] = config.apiKey;
        }
        const resp = await fetch(url, { ...options, headers });
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            throw new Error(`API ${resp.status}: ${text}`);
        }
        if (resp.status === 204) return null;
        return resp.json();
    }

    healthCheck() {
        return this._request("/api/health");
    }

    registerDevice(name, secret) {
        return this._request("/api/devices/register", {
            method: "POST",
            body: JSON.stringify({ name, secret }),
        });
    }

    listSessions() {
        return this._request("/api/sessions");
    }

    createSession(name) {
        return this._request("/api/sessions", {
            method: "POST",
            body: JSON.stringify({ name }),
        });
    }

    getSession(id) {
        return this._request(`/api/sessions/${id}`);
    }

    updateSession(id, data) {
        return this._request(`/api/sessions/${id}`, {
            method: "PUT",
            body: JSON.stringify(data),
        });
    }

    deleteSession(id) {
        return this._request(`/api/sessions/${id}`, { method: "DELETE" });
    }

    saveState(id, state) {
        return this._request(`/api/sessions/${id}/state`, {
            method: "PUT",
            body: JSON.stringify(state),
        });
    }

    loadState(id) {
        return this._request(`/api/sessions/${id}/state`);
    }
};
