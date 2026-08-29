/**
 * DV Ai — api.js
 * All communication with the Google Apps Script backend.
 *
 * IMPORTANT: Set DV_GAS_URL to your deployed Apps Script Web App URL
 * (ends in /exec) after deployment. See Apps Script Deployment.md.
 *
 * Every exported function here keeps the exact same name and signature
 * as the previous Cloudflare version, so app.js requires no changes.
 */

const DV_GAS_URL = "https://script.google.com/macros/s/AKfycbzj_WL7wnC857ke5zh6dOmj6k0lDHBAzxXsmRWr0gppTdlFhYTbMtThRuYcSPt-Tq8D9w/exec";

const dvApi = (() => {
  function dvGetToken() {
    return dvStorage.dvGetPref("token");
  }

  // Apps Script Web Apps only accept a single POST endpoint (no REST routes,
  // no streaming). Every call sends { action, token, ...params } and gets
  // back { ok, ... } — this wrapper mimics the old dvRequest() shape so
  // callers don't need to know anything changed.
  async function dvCall(action, params = {}) {
    if (!DV_GAS_URL || DV_GAS_URL.indexOf("PASTE_YOUR") !== -1) {
      return { ok: false, error: "Setup incomplete: DV_GAS_URL in scripts/api.js still has the placeholder value. Deploy Code.gs and paste the real /exec URL in." };
    }

    let resp;
    try {
      resp = await fetch(DV_GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight on GAS
        body: JSON.stringify({ action, token: dvGetToken(), ...params })
      });
    } catch {
      return { ok: false, error: "Network error. Check your connection." };
    }

    let data;
    try { data = await resp.json(); } catch { data = { ok: false, error: "Invalid server response." }; }

    if (!data.ok && data.error === "Unauthorized.") {
      dvStorage.dvClearSession();
      if (window.dvApp && typeof window.dvApp.dvHandleSessionExpired === "function") {
        window.dvApp.dvHandleSessionExpired();
      }
    }

    return data;
  }

  async function dvRequestCode(email, deviceName) {
    return dvCall("requestCode", { email, deviceName });
  }

  async function dvVerifyCode(pendingId, code, deviceName) {
    return dvCall("verifyCode", { pendingId, code, deviceName });
  }

  async function dvMe() {
    return dvCall("me");
  }

  async function dvLogout() {
    return dvCall("logout");
  }

  async function dvListDevices() {
    return dvCall("listDevices");
  }

  async function dvRevokeDevice(deviceId) {
    return dvCall("revokeDevice", { deviceId });
  }

  async function dvGetModels() {
    // Apps Script backend uses a single free Gemini model — no multi-provider
    // registry. Return a shape app.js already expects, so nothing downstream breaks.
    return { ok: true, models: {
      chat: [{ id: "gemini", label: "Gemini" }],
      code: [{ id: "gemini", label: "Gemini" }],
      image: []
    }};
  }

  async function dvListChats() {
    return dvCall("listChats");
  }

  async function dvGetChat(chatId) {
    return dvCall("getChat", { chatId });
  }

  async function dvSaveChat(chat) {
    return dvCall("saveChat", chat);
  }

  async function dvDeleteChat(chatId) {
    return dvCall("deleteChat", { chatId });
  }

  async function dvClearAllChats() {
    return dvCall("clearAllChats");
  }

  // NOTE: Apps Script cannot stream responses (it's request/response only,
  // unlike the Cloudflare Worker's SSE streaming). This keeps the same
  // async-generator shape app.js expects, but yields the full reply as one
  // chunk instead of token-by-token — app.js's existing "for await" loop
  // still works unchanged, it just renders in one step instead of live-typing.
  async function* dvStreamAiChat(mode, modelId, messages, useSearch = false) {
    const res = await dvCall("aiChat", { mode, messages });
    if (!res.ok) {
      throw new Error(res.error || "AI request failed.");
    }
    yield res.text || "";
  }

  async function dvGenerateImage(prompt, modelId) {
    // Image generation isn't available on the free Apps Script/Gemini stack yet.
    return { ok: false, error: "Image generation isn't available in this build." };
  }

  return {
    dvRequestCode, dvVerifyCode, dvMe, dvLogout,
    dvListDevices, dvRevokeDevice,
    dvGetModels,
    dvListChats, dvGetChat, dvSaveChat, dvDeleteChat, dvClearAllChats,
    dvStreamAiChat, dvGenerateImage
  };
})();