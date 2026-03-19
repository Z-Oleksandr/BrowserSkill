/**
 * BrowserSkill API client.
 * Works in both service worker (importScripts) and popup (<script> tag).
 */
function friendlyStatus(status) {
    const messages = {
        400: "Bad request — check your input",
        401: "Unauthorized — invalid or missing API key",
        403: "Forbidden — access denied",
        404: "Not found — check your server URL",
        408: "Request timed out",
        429: "Too many requests — try again later",
        500: "Server error — something went wrong on the server",
        502: "Bad gateway — server is down or unreachable",
        503: "Service unavailable — server is starting up or overloaded",
        504: "Gateway timeout — server took too long to respond",
    };
    return messages[status] || `Server returned error ${status}`;
}

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

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        let resp;
        try {
            resp = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal,
            });
        } catch (err) {
            if (err.name === "AbortError") {
                throw new Error(
                    "Request timed out — server not responding",
                );
            }
            throw new Error(
                "Cannot reach server — check the URL and your network",
            );
        } finally {
            clearTimeout(timeout);
        }

        if (!resp.ok) {
            throw new Error(friendlyStatus(resp.status));
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
