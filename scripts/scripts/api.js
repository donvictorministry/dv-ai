/**
 * DV Ai — api.js
 * All communication with the Cloudflare Worker backend.
 *
 * IMPORTANT: Set DV_WORKER_URL to your deployed Worker URL after deployment.
 * Example: "https://dv-ai-worker.yoursubdomain.workers.dev"
 */

const DV_WORKER_URL = "https://dv-ai-worker.YOUR-SUBDOMAIN.workers.dev";

const dvApi = (() => {
  function dvAuthHeaders() {
    const token = dvStorage.dvGetPref("token");
    return token ? { "Authorization": `Bearer ${token}` } : {};
  }

  async function dvRequest(path, options = {}) {
    const resp = await fetch(`${DV_WORKER_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...dvAuthHeaders(),
        ...(options.headers || {})
      }
    });

    if (resp.status === 401) {
      // Session invalid or revoked — force back to gate.
      dvStorage.dvClearSession();
      if (window.dvApp && typeof window.dvApp.dvHandleSessionExpired === "function") {
        window.dvApp.dvHandleSessionExpired();
      }
    }

    let data;
    try { data = await resp.json(); } catch { data = { ok: false, error: "Invalid server response." }; }
    if (!resp.ok && !data.error) data.error = "Request failed.";
    return { status: resp.status, ...data };
  }

  async function dvRequestCode(email, deviceName) {
    return dvRequest("/api/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email, deviceName })
    });
  }

  async function dvVerifyCode(pendingId, code, deviceName) {
    return dvRequest("/api/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({ pendingId, code, deviceName })
    });
  }

  async function dvMe() {
    return dvRequest("/api/auth/me", { method: "GET" });
  }

  async function dvLogout() {
    return dvRequest("/api/auth/logout", { method: "POST" });
  }

  async function dvListDevices() {
    return dvRequest("/api/devices", { method: "GET" });
  }

  async function dvRevokeDevice(deviceId) {
    return dvRequest("/api/devices/revoke", {
      method: "POST",
      body: JSON.stringify({ deviceId })
    });
  }

  async function dvGetModels() {
    return dvRequest("/api/models", { method: "GET" });
  }

  async function dvListChats() {
    return dvRequest("/api/chats", { method: "GET" });
  }

  async function dvGetChat(chatId) {
    return dvRequest(`/api/chats/${chatId}`, { method: "GET" });
  }

  async function dvSaveChat(chat) {
    return dvRequest("/api/chats", { method: "POST", body: JSON.stringify(chat) });
  }

  async function dvDeleteChat(chatId) {
    return dvRequest(`/api/chats/${chatId}`, { method: "DELETE" });
  }

  async function dvClearAllChats() {
    return dvRequest("/api/chats/clear", { method: "POST" });
  }

  // Streaming AI chat/code — returns an async generator yielding text deltas.
  async function* dvStreamAiChat(mode, modelId, messages, useSearch = false) {
    const resp = await fetch(`${DV_WORKER_URL}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...dvAuthHeaders() },
      body: JSON.stringify({ mode, modelId, messages, useSearch })
    });

    if (resp.status === 401) {
      dvStorage.dvClearSession();
      if (window.dvApp && typeof window.dvApp.dvHandleSessionExpired === "function") {
        window.dvApp.dvHandleSessionExpired();
      }
      return;
    }

    if (!resp.ok || !resp.body) {
      throw new Error("AI request failed.");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr) continue;
        try {
          const evt = JSON.parse(dataStr);
          if (evt.delta) yield evt.delta;
          if (evt.done) return;
        } catch { /* ignore malformed chunk */ }
      }
    }
  }

  async function dvGenerateImage(prompt, modelId) {
    return dvRequest("/api/ai/image", {
      method: "POST",
      body: JSON.stringify({ prompt, modelId })
    });
  }

  return {
    dvRequestCode, dvVerifyCode, dvMe, dvLogout,
    dvListDevices, dvRevokeDevice,
    dvGetModels,
    dvListChats, dvGetChat, dvSaveChat, dvDeleteChat, dvClearAllChats,
    dvStreamAiChat, dvGenerateImage
  };
})();
