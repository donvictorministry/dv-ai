/**
 * DV Ai — app.js
 * Main application controller: auth flow, chat/code/image modes,
 * drawers, settings, PWA install/share, device management.
 */

const DV_ACCENTS = [
  { name: "Facebook Blue", hex: "#1877F2" },
  { name: "Emerald", hex: "#10B981" },
  { name: "Violet", hex: "#8B5CF6" },
  { name: "Rose", hex: "#F43F5E" },
  { name: "Amber", hex: "#F59E0B" },
  { name: "Teal", hex: "#14B8A6" },
  { name: "Indigo", hex: "#6366F1" },
  { name: "Orange", hex: "#F97316" },
  { name: "Sky", hex: "#0EA5E9" },
  { name: "Crimson", hex: "#DC2626" }
];

const DV_FONT_SCALES = [0.9, 1.0, 1.1, 1.25, 1.4];

const dvApp = (() => {
  // ---- State ----
  let dvState = {
    mode: "chat",
    currentChatId: null,
    messages: [],
    models: { chat: [], code: [], image: [] },
    selectedModel: { chat: null, code: null, image: null },
    pendingId: null,
    deferredInstallPrompt: null,
    imageHistory: [],
    searchEnabled: false
  };

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);

  function dvInit() {
    dvInitTheme();
    dvBindGateEvents();
    dvBindAppEvents();
    dvBindDrawerEvents();
    dvBindConfirmModal();
    dvRegisterServiceWorker();
    dvBindInstallPrompt();

    const token = dvStorage.dvGetPref("token");
    if (token) {
      dvTryResumeSession();
    } else {
      dvShowGate();
    }
  }

  // =========================================================================
  // THEME / PREFERENCES
  // =========================================================================
  function dvInitTheme() {
    const theme = dvStorage.dvGetPref("theme", "light");
    const accent = dvStorage.dvGetPref("accent", DV_ACCENTS[0].hex);
    const fontScaleIdx = dvStorage.dvGetPref("fontScale", "1");

    document.documentElement.setAttribute("data-dv-theme", theme);
    document.documentElement.style.setProperty("--dv-accent", accent);
    document.documentElement.style.setProperty("--dv-accent-rgb", dvHexToRgb(accent));
    document.documentElement.style.setProperty("--dv-font-scale", DV_FONT_SCALES[parseInt(fontScaleIdx, 10)] || 1);

    // Reflect into settings UI once it's in DOM.
    const darkToggle = $("dvDarkModeToggle");
    if (darkToggle) darkToggle.checked = theme === "dark";
    const fontSlider = $("dvFontSlider");
    if (fontSlider) fontSlider.value = fontScaleIdx;

    dvRenderAccentSwatches(accent);
  }

  function dvHexToRgb(hex) {
    const m = hex.replace("#", "");
    const bigint = parseInt(m, 16);
    return `${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}`;
  }

  function dvRenderAccentSwatches(activeHex) {
    const container = $("dvAccentSwatches");
    if (!container) return;
    container.innerHTML = "";
    DV_ACCENTS.forEach(a => {
      const btn = document.createElement("button");
      btn.className = "dv-swatch" + (a.hex.toLowerCase() === activeHex.toLowerCase() ? " dv-swatch-active" : "");
      btn.style.background = a.hex;
      btn.setAttribute("aria-label", a.name);
      btn.addEventListener("click", () => {
        dvStorage.dvSetPref("accent", a.hex);
        document.documentElement.style.setProperty("--dv-accent", a.hex);
        document.documentElement.style.setProperty("--dv-accent-rgb", dvHexToRgb(a.hex));
        dvRenderAccentSwatches(a.hex);
      });
      container.appendChild(btn);
    });
  }

  // =========================================================================
  // GATE / AUTH FLOW
  // =========================================================================
  function dvShowGate() {
    $("dvGate").classList.remove("dv-hidden");
    $("dvApp").classList.add("dv-hidden");
  }

  function dvShowApp() {
    $("dvGate").classList.add("dv-hidden");
    $("dvApp").classList.remove("dv-hidden");
  }

  function dvBindGateEvents() {
    $("dvBtnRequestCode").addEventListener("click", dvHandleRequestCode);
    $("dvBtnVerifyCode").addEventListener("click", dvHandleVerifyCode);
    $("dvBtnBackToEmail").addEventListener("click", () => {
      $("dvGateStep2").classList.add("dv-hidden");
      $("dvGateStep1").classList.remove("dv-hidden");
      $("dvGateMessage").textContent = "";
    });
    $("dvCodeInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") dvHandleVerifyCode();
    });
    $("dvEmailInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") dvHandleRequestCode();
    });
  }

  function dvDeviceLabel() {
    const ua = navigator.userAgent;
    let label = "Android device";
    if (/Pixel/i.test(ua)) label = "Pixel phone";
    else if (/SM-/i.test(ua)) label = "Samsung phone";
    else if (/Tablet/i.test(ua)) label = "Android tablet";
    return `${label} — ${new Date().toLocaleDateString()}`;
  }

  async function dvHandleRequestCode() {
    const email = $("dvEmailInput").value.trim();
    if (!email) { $("dvGateMessage").textContent = "Please enter an email."; return; }

    $("dvBtnRequestCode").disabled = true;
    $("dvGateMessage").textContent = "";
    const res = await dvApi.dvRequestCode(email, dvDeviceLabel());
    $("dvBtnRequestCode").disabled = false;

    if (res.ok) {
      dvState.pendingId = res.pendingId || null;
      $("dvGateStep1").classList.add("dv-hidden");
      $("dvGateStep2").classList.remove("dv-hidden");
      $("dvGateMessage").style.color = "";
      $("dvGateMessage").textContent = res.message || "Code sent if this email is authorized.";
      $("dvCodeInput").focus();
    } else {
      $("dvGateMessage").textContent = res.error || "Unable to send code.";
    }
  }

  async function dvHandleVerifyCode() {
    const code = $("dvCodeInput").value.trim();
    if (!code || code.length !== 6) { $("dvGateMessage").textContent = "Enter the 6-digit code."; return; }
    if (!dvState.pendingId) { $("dvGateMessage").textContent = "Please request a new code."; return; }

    $("dvBtnVerifyCode").disabled = true;
    const res = await dvApi.dvVerifyCode(dvState.pendingId, code, dvDeviceLabel());
    $("dvBtnVerifyCode").disabled = false;

    if (res.ok && res.token) {
      dvStorage.dvSetPref("token", res.token);
      dvStorage.dvSetPref("deviceId", res.deviceId);
      dvStorage.dvSetPref("deviceName", res.deviceName || "");
      await dvPostAuthInit();
    } else {
      $("dvGateMessage").textContent = res.error || "Verification failed.";
    }
  }

  async function dvTryResumeSession() {
    const res = await dvApi.dvMe();
    if (res.ok) {
      await dvPostAuthInit();
    } else {
      dvStorage.dvClearSession();
      dvShowGate();
    }
  }

  async function dvPostAuthInit() {
    dvShowApp();
    await dvLoadModels();
    await dvRefreshChatList();
    dvStartNewChat();
  }

  function dvHandleSessionExpired() {
    dvShowToast("Session ended. Please sign in again.");
    dvShowGate();
  }

  // =========================================================================
  // MODELS
  // =========================================================================
  async function dvLoadModels() {
    const res = await dvApi.dvGetModels();
    if (res.ok && res.models) {
      dvState.models = res.models;
      dvState.selectedModel.chat = res.models.chat?.[0]?.id || null;
      dvState.selectedModel.code = res.models.code?.[0]?.id || null;
      dvState.selectedModel.image = res.models.image?.[0]?.id || null;
    }
  }

  // =========================================================================
  // APP SHELL EVENTS — mode switch, composer, new chat
  // =========================================================================
  function dvBindAppEvents() {
    document.querySelectorAll(".dv-mode-btn").forEach(btn => {
      btn.addEventListener("click", () => dvSwitchMode(btn.dataset.mode));
    });

    $("dvBtnSend").addEventListener("click", dvHandleSend);
    $("dvComposerInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        dvHandleSend();
      }
    });
    $("dvComposerInput").addEventListener("input", dvAutoGrowTextarea);

    $("dvBtnNewChat").addEventListener("click", dvStartNewChat);

    $("dvBtnToggleSearch").addEventListener("click", () => {
      dvState.searchEnabled = !dvState.searchEnabled;
      $("dvBtnToggleSearch").classList.toggle("dv-composer-icon-active", dvState.searchEnabled);
      dvShowToast(dvState.searchEnabled ? "Web search enabled for next message." : "Web search off.");
    });
  }

  function dvAutoGrowTextarea() {
    const el = $("dvComposerInput");
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }

  function dvSwitchMode(mode) {
    dvState.mode = mode;
    document.querySelectorAll(".dv-mode-btn").forEach(b => {
      b.classList.toggle("dv-mode-active", b.dataset.mode === mode);
    });

    const isImage = mode === "image";
    $("dvMessages").classList.toggle("dv-hidden", isImage);
    $("dvImagePanel").classList.toggle("dv-hidden", !isImage);
    $("dvComposerInput").placeholder = mode === "image" ? "Describe an image to generate…" : mode === "code" ? "Ask for code, a fix, or an explanation…" : "Message DV Ai…";
  }

  function dvStartNewChat() {
    dvState.currentChatId = null;
    dvState.messages = [];
    $("dvChatTitle").textContent = "DV Ai";
    dvRenderMessages();
    $("dvImageHistory").innerHTML = "";
    dvState.imageHistory = [];
  }

  // =========================================================================
  // SENDING MESSAGES
  // =========================================================================
  async function dvHandleSend() {
    const input = $("dvComposerInput");
    const text = input.value.trim();
    if (!text) return;

    if (dvState.mode === "image") {
      await dvHandleGenerateImage(text);
      input.value = "";
      dvAutoGrowTextarea();
      return;
    }

    input.value = "";
    dvAutoGrowTextarea();

    const userMsg = { role: "user", content: text, createdAt: Date.now() };
    dvState.messages.push(userMsg);
    dvRenderMessages();
    dvScrollToBottom();

    $("dvTypingIndicator").classList.remove("dv-hidden");

    const aiMsg = { role: "assistant", content: "", createdAt: Date.now() };
    dvState.messages.push(aiMsg);
    let aiIndex = dvState.messages.length - 1;
    let firstChunk = true;

    try {
      const modelId = dvState.selectedModel[dvState.mode];
      const stream = dvApi.dvStreamAiChat(dvState.mode, modelId, dvState.messages.slice(0, -1).map(m => ({ role: m.role, content: m.content })), dvState.searchEnabled);

      for await (const delta of stream) {
        if (firstChunk) {
          $("dvTypingIndicator").classList.add("dv-hidden");
          firstChunk = false;
        }
        dvState.messages[aiIndex].content += delta;
        dvRenderMessages();
        dvScrollToBottom();
      }
    } catch (err) {
      dvState.messages[aiIndex].content = dvState.messages[aiIndex].content || "Sorry, something went wrong generating a response.";
      dvShowToast("AI request failed. Please try again.");
    } finally {
      $("dvTypingIndicator").classList.add("dv-hidden");
      dvRenderMessages();
      await dvPersistCurrentChat();
    }
  }

  async function dvPersistCurrentChat() {
    const title = dvState.messages[0]?.content?.slice(0, 60) || "New chat";
    const payload = {
      chatId: dvState.currentChatId,
      title,
      mode: dvState.mode,
      modelId: dvState.selectedModel[dvState.mode],
      messages: dvState.messages
    };
    const res = await dvApi.dvSaveChat(payload);
    if (res.ok) {
      dvState.currentChatId = res.chatId;
      $("dvChatTitle").textContent = title;
      await dvStorage.dvPutChat({ id: res.chatId, title, mode: dvState.mode, updatedAt: Date.now() });
      await dvStorage.dvPutMessages(res.chatId, dvState.messages);
    }
  }

  // =========================================================================
  // RENDERING — chat/code messages
  // =========================================================================
  function dvRenderMessages() {
    const container = $("dvMessages");
    container.innerHTML = "";
    dvState.messages.forEach((msg, idx) => {
      const wrap = document.createElement("div");
      wrap.className = `dv-msg ${msg.role === "user" ? "dv-msg-user" : "dv-msg-ai"}`;

      const bubble = document.createElement("div");
      bubble.className = "dv-bubble";
      bubble.innerHTML = dvRenderMarkdown(msg.content);
      wrap.appendChild(bubble);

      if (msg.role === "assistant" && msg.content) {
        const actions = document.createElement("div");
        actions.className = "dv-msg-actions";

        const copyBtn = document.createElement("button");
        copyBtn.className = "dv-msg-action-btn";
        copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy';
        copyBtn.addEventListener("click", () => dvCopyText(msg.content));
        actions.appendChild(copyBtn);

        const regenBtn = document.createElement("button");
        regenBtn.className = "dv-msg-action-btn";
        regenBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Regenerate';
        regenBtn.addEventListener("click", () => dvRegenerate(idx));
        actions.appendChild(regenBtn);

        wrap.appendChild(actions);
      }

      container.appendChild(wrap);
    });

    // Wire up code-block copy buttons after render.
    container.querySelectorAll("pre code").forEach((block) => {
      if (window.hljs) { try { hljs.highlightElement(block); } catch { /* ignore */ } }
      const pre = block.parentElement;
      if (pre.parentElement.classList.contains("dv-code-block-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "dv-code-block-wrap";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      const btn = document.createElement("button");
      btn.className = "dv-code-copy-btn";
      btn.textContent = "Copy";
      btn.addEventListener("click", () => dvCopyText(block.textContent));
      wrap.appendChild(btn);
    });
  }

  function dvRenderMarkdown(text) {
    if (!text) return "";
    try {
      if (window.marked) return marked.parse(text);
    } catch { /* fall through */ }
    return text.replace(/</g, "&lt;");
  }

  async function dvRegenerate(idx) {
    // Regenerate the assistant message at idx by re-running from the prior user message.
    if (dvState.messages[idx].role !== "assistant") return;
    const priorMessages = dvState.messages.slice(0, idx);
    dvState.messages = priorMessages;
    dvRenderMessages();
    $("dvTypingIndicator").classList.remove("dv-hidden");

    const aiMsg = { role: "assistant", content: "", createdAt: Date.now() };
    dvState.messages.push(aiMsg);
    const aiIndex = dvState.messages.length - 1;
    let firstChunk = true;

    try {
      const modelId = dvState.selectedModel[dvState.mode];
      const stream = dvApi.dvStreamAiChat(dvState.mode, modelId, priorMessages.map(m => ({ role: m.role, content: m.content })), dvState.searchEnabled);
      for await (const delta of stream) {
        if (firstChunk) { $("dvTypingIndicator").classList.add("dv-hidden"); firstChunk = false; }
        dvState.messages[aiIndex].content += delta;
        dvRenderMessages();
        dvScrollToBottom();
      }
    } catch {
      dvShowToast("Regeneration failed.");
    } finally {
      $("dvTypingIndicator").classList.add("dv-hidden");
      dvRenderMessages();
      await dvPersistCurrentChat();
    }
  }

  function dvScrollToBottom() {
    const c = $("dvMessages");
    c.scrollTop = c.scrollHeight;
  }

  async function dvCopyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      dvShowToast("Copied to clipboard.");
    } catch {
      dvShowToast("Unable to copy.");
    }
  }

  // =========================================================================
  // IMAGE MODE
  // =========================================================================
  async function dvHandleGenerateImage(prompt) {
    $("dvImageProgress").classList.remove("dv-hidden");
    const modelId = dvState.selectedModel.image;
    const res = await dvApi.dvGenerateImage(prompt, modelId);
    $("dvImageProgress").classList.add("dv-hidden");

    if (!res.ok) {
      dvShowToast(res.error || "Image generation failed.");
      return;
    }

    const src = `data:${res.mime || "image/png"};base64,${res.imageBase64}`;
    dvState.imageHistory.unshift({ src, prompt, createdAt: Date.now() });
    dvRenderImageHistory();
  }

  function dvRenderImageHistory() {
    const container = $("dvImageHistory");
    container.innerHTML = "";
    dvState.imageHistory.forEach((img) => {
      const card = document.createElement("div");
      card.className = "dv-image-card";

      const imgEl = document.createElement("img");
      imgEl.src = img.src;
      imgEl.alt = img.prompt;
      card.appendChild(imgEl);

      const actions = document.createElement("div");
      actions.className = "dv-image-card-actions";

      const saveBtn = document.createElement("button");
      saveBtn.className = "dv-msg-action-btn";
      saveBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
      saveBtn.addEventListener("click", () => dvSaveImage(img.src));
      actions.appendChild(saveBtn);

      const shareBtn = document.createElement("button");
      shareBtn.className = "dv-msg-action-btn";
      shareBtn.innerHTML = '<i class="fa-solid fa-share-nodes"></i>';
      shareBtn.addEventListener("click", () => dvShareImage(img.src, img.prompt));
      actions.appendChild(shareBtn);

      const regenBtn = document.createElement("button");
      regenBtn.className = "dv-msg-action-btn";
      regenBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
      regenBtn.addEventListener("click", () => dvHandleGenerateImage(img.prompt));
      actions.appendChild(regenBtn);

      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  function dvSaveImage(dataUrl) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `dv-ai-image-${Date.now()}.png`;
    a.click();
    dvShowToast("Image saved.");
  }

  async function dvShareImage(dataUrl, prompt) {
    try {
      if (navigator.share) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], "dv-ai-image.png", { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "DV Ai Image", text: prompt });
          return;
        }
      }
      await navigator.clipboard.writeText(dataUrl);
      dvShowToast("Share unsupported — image link copied.");
    } catch {
      dvShowToast("Unable to share image.");
    }
  }

  // =========================================================================
  // DRAWERS
  // =========================================================================
  function dvBindDrawerEvents() {
    $("dvBtnLeftDrawer").addEventListener("click", () => dvOpenDrawer("left"));
    $("dvBtnCloseLeftDrawer").addEventListener("click", () => dvCloseDrawer("left"));
    $("dvLeftDrawerOverlay").addEventListener("click", () => dvCloseDrawer("left"));

    $("dvBtnRightDrawer").addEventListener("click", () => dvOpenDrawer("right"));
    $("dvBtnCloseRightDrawer").addEventListener("click", () => dvCloseDrawer("right"));
    $("dvRightDrawerOverlay").addEventListener("click", () => dvCloseDrawer("right"));

    document.querySelectorAll(".dv-drawer-item[data-panel]").forEach(btn => {
      btn.addEventListener("click", () => dvOpenPanel(btn.dataset.panel));
    });

    $("dvBtnClosePanel").addEventListener("click", dvClosePanel);
    $("dvPanelOverlay").addEventListener("click", (e) => {
      if (e.target === $("dvPanelOverlay")) dvClosePanel();
    });

    $("dvDarkModeToggle").addEventListener("change", (e) => {
      const theme = e.target.checked ? "dark" : "light";
      dvStorage.dvSetPref("theme", theme);
      document.documentElement.setAttribute("data-dv-theme", theme);
    });

    $("dvFontSlider").addEventListener("input", (e) => {
      dvStorage.dvSetPref("fontScale", e.target.value);
      document.documentElement.style.setProperty("--dv-font-scale", DV_FONT_SCALES[parseInt(e.target.value, 10)]);
    });

    $("dvBtnInstallApp").addEventListener("click", dvHandleInstallApp);
    $("dvBtnShareApp").addEventListener("click", dvHandleShareApp);
    $("dvBtnLogout").addEventListener("click", dvHandleLogout);
  }

  function dvOpenDrawer(side) {
    const drawer = side === "left" ? $("dvLeftDrawer") : $("dvRightDrawer");
    const overlay = side === "left" ? $("dvLeftDrawerOverlay") : $("dvRightDrawerOverlay");
    overlay.classList.remove("dv-hidden");
    drawer.classList.add("dv-drawer-open");
  }

  function dvCloseDrawer(side) {
    const drawer = side === "left" ? $("dvLeftDrawer") : $("dvRightDrawer");
    const overlay = side === "left" ? $("dvLeftDrawerOverlay") : $("dvRightDrawerOverlay");
    overlay.classList.add("dv-hidden");
    drawer.classList.remove("dv-drawer-open");
  }

  // =========================================================================
  // PANELS (info pages, account, storage, search, model)
  // =========================================================================
  const DV_INFO_PANELS = {
    "about-us": {
      title: "About Us",
      html: `<h3>About Us</h3><p>DV Ai is a private, single-owner AI workspace built for personal productivity — chat, code assistance, and image generation in one focused Android application.</p>`
    },
    "about-developer": {
      title: "About Developer",
      html: `<h3>About Developer</h3><p>DV Ai is developed and maintained under Chris Ministries Online Community (CEAM) by its lead developer.</p>`
    },
    "terms": {
      title: "Terms of Use",
      html: `<h3>Terms of Use</h3><p>This application is a private, single-owner workspace. Access is restricted to one pre-authorized owner email. Unauthorized access attempts are not permitted and are not supported. All data belongs to the owner and is stored for the owner's use only.</p>`
    },
    "roadmap": {
      title: "Roadmap",
      html: `<h3>Roadmap</h3><ul><li>Additional model providers</li><li>Voice input</li><li>File attachments in chat</li><li>Expanded image editing tools</li></ul>`
    },
    "proprietary": {
      title: "Proprietary Software Notice",
      html: `<h3>Proprietary Software Notice</h3><p>DV Ai is proprietary software. All source code, design, and branding are private property. Redistribution, cloning, or unauthorized use is prohibited.</p>`
    }
  };

  async function dvOpenPanel(panelKey) {
    dvCloseDrawer("left");
    dvCloseDrawer("right");
    $("dvPanelOverlay").classList.remove("dv-hidden");

    if (DV_INFO_PANELS[panelKey]) {
      $("dvPanelTitle").textContent = DV_INFO_PANELS[panelKey].title;
      $("dvPanelBody").innerHTML = DV_INFO_PANELS[panelKey].html;
      return;
    }

    if (panelKey === "account") return dvRenderAccountPanel();
    if (panelKey === "storage") return dvRenderStoragePanel();
    if (panelKey === "search") return dvRenderSearchPanel();
    if (panelKey === "model") return dvRenderModelPanel();
  }

  function dvClosePanel() {
    $("dvPanelOverlay").classList.add("dv-hidden");
  }

  async function dvRenderAccountPanel() {
    $("dvPanelTitle").textContent = "User Account";
    $("dvPanelBody").innerHTML = `<div class="dv-spinner" style="margin:20px auto;"></div>`;

    const [meRes, devicesRes] = await Promise.all([dvApi.dvMe(), dvApi.dvListDevices()]);

    let html = "";
    if (meRes.ok) {
      html += `<p><strong>Email:</strong> ${dvEscapeHtml(meRes.email)}</p>`;
    }
    html += `<h3 style="margin-top:20px;">Devices</h3>`;
    if (devicesRes.ok && devicesRes.devices) {
      devicesRes.devices.forEach(d => {
        html += `<div class="dv-device-item">
          <div>
            <div>${dvEscapeHtml(d.deviceName)}</div>
            <div style="font-size:0.8rem;color:var(--dv-text-secondary);">Last seen ${new Date(d.lastSeen).toLocaleString()}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            ${d.isCurrent ? '<span class="dv-tag dv-tag-current">This device</span>' : `<button class="dv-msg-action-btn dv-revoke-btn" data-device-id="${d.id}"><i class="fa-solid fa-ban"></i> Revoke</button>`}
          </div>
        </div>`;
      });
    }
    $("dvPanelBody").innerHTML = html;

    $("dvPanelBody").querySelectorAll(".dv-revoke-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        dvShowConfirm("Revoke this device? It will be signed out immediately.", async () => {
          const res = await dvApi.dvRevokeDevice(btn.dataset.deviceId);
          if (res.ok) {
            dvShowToast("Device revoked.");
            dvRenderAccountPanel();
          } else {
            dvShowToast(res.error || "Unable to revoke device.");
          }
        });
      });
    });
  }

  async function dvRenderStoragePanel() {
    $("dvPanelTitle").textContent = "Chat Storage";
    const listRes = await dvApi.dvListChats();
    let html = `<button id="dvClearAllBtn" class="dv-btn dv-btn-danger" style="margin-bottom:16px;">Clear all chat history</button>`;
    if (listRes.ok && listRes.chats?.length) {
      listRes.chats.forEach(c => {
        html += `<div class="dv-chat-list-item">
          <div>
            <div>${dvEscapeHtml(c.title)}</div>
            <div style="font-size:0.8rem;color:var(--dv-text-secondary);">${new Date(c.updated_at).toLocaleString()}</div>
          </div>
          <button class="dv-msg-action-btn dv-open-chat-btn" data-chat-id="${c.id}"><i class="fa-solid fa-arrow-right"></i></button>
        </div>`;
      });
    } else {
      html += `<p style="color:var(--dv-text-secondary);">No saved chats yet.</p>`;
    }
    $("dvPanelBody").innerHTML = html;

    $("dvClearAllBtn").addEventListener("click", () => {
      dvShowConfirm("Clear all chat history? This cannot be undone.", async () => {
        const res = await dvApi.dvClearAllChats();
        if (res.ok) {
          await dvStorage.dvClearAllChats();
          dvShowToast("Chat history cleared.");
          dvStartNewChat();
          dvClosePanel();
        } else {
          dvShowToast(res.error || "Unable to clear history.");
        }
      });
    });

    $("dvPanelBody").querySelectorAll(".dv-open-chat-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        await dvOpenChatById(btn.dataset.chatId);
        dvClosePanel();
      });
    });
  }

  async function dvOpenChatById(chatId) {
    const res = await dvApi.dvGetChat(chatId);
    if (!res.ok) { dvShowToast("Unable to load chat."); return; }
    dvState.currentChatId = chatId;
    dvState.mode = res.chat.mode || "chat";
    dvSwitchMode(dvState.mode);
    dvState.messages = (res.messages || []).map(m => ({ role: m.role, content: m.content, createdAt: m.created_at }));
    $("dvChatTitle").textContent = res.chat.title;
    dvRenderMessages();
    dvScrollToBottom();
  }

  function dvRenderSearchPanel() {
    $("dvPanelTitle").textContent = "Search Chats";
    $("dvPanelBody").innerHTML = `
      <input id="dvSearchInput" class="dv-input" type="text" placeholder="Search by title…" style="margin-bottom:12px;" />
      <div id="dvSearchResults"></div>
    `;

    let allChats = [];
    dvApi.dvListChats().then(res => {
      if (res.ok) allChats = res.chats || [];
      dvRenderSearchResults(allChats);
    });

    $("dvSearchInput").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = q ? allChats.filter(c => c.title.toLowerCase().includes(q)) : allChats;
      dvRenderSearchResults(filtered);
    });
  }

  function dvRenderSearchResults(chats) {
    const container = $("dvSearchResults");
    if (!container) return;
    if (!chats.length) {
      container.innerHTML = `<p style="color:var(--dv-text-secondary);">No chats found.</p>`;
      return;
    }
    container.innerHTML = chats.map(c => `
      <div class="dv-chat-list-item">
        <div>${dvEscapeHtml(c.title)}</div>
        <button class="dv-msg-action-btn dv-open-chat-btn" data-chat-id="${c.id}"><i class="fa-solid fa-arrow-right"></i></button>
      </div>
    `).join("");
    container.querySelectorAll(".dv-open-chat-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        await dvOpenChatById(btn.dataset.chatId);
        dvClosePanel();
      });
    });
  }

  function dvRenderModelPanel() {
    $("dvPanelTitle").textContent = "AI Model";
    const modeModels = dvState.models[dvState.mode === "image" ? "image" : dvState.mode] || [];
    let html = `<p style="color:var(--dv-text-secondary);">Model for current mode: <strong>${dvState.mode}</strong></p>`;
    if (!modeModels.length) {
      html += `<p>No models configured for this mode yet.</p>`;
    } else {
      modeModels.forEach(m => {
        const active = dvState.selectedModel[dvState.mode] === m.id;
        html += `<button class="dv-drawer-item dv-model-choice-btn" data-model-id="${m.id}" style="${active ? 'color:var(--dv-accent);font-weight:700;' : ''}">
          <i class="fa-solid ${active ? 'fa-circle-check' : 'fa-circle'}"></i> ${dvEscapeHtml(m.label)}
        </button>`;
      });
    }
    $("dvPanelBody").innerHTML = html;

    $("dvPanelBody").querySelectorAll(".dv-model-choice-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        dvState.selectedModel[dvState.mode] = btn.dataset.modelId;
        dvShowToast("Model updated.");
        dvRenderModelPanel();
      });
    });
  }

  function dvEscapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  // =========================================================================
  // CONFIRM MODAL (replaces confirm())
  // =========================================================================
  let dvConfirmCallback = null;

  function dvBindConfirmModal() {
    $("dvConfirmCancel").addEventListener("click", () => {
      $("dvConfirmOverlay").classList.add("dv-hidden");
      dvConfirmCallback = null;
    });
    $("dvConfirmOk").addEventListener("click", () => {
      $("dvConfirmOverlay").classList.add("dv-hidden");
      if (dvConfirmCallback) dvConfirmCallback();
      dvConfirmCallback = null;
    });
  }

  function dvShowConfirm(message, onConfirm) {
    $("dvConfirmMessage").textContent = message;
    dvConfirmCallback = onConfirm;
    $("dvConfirmOverlay").classList.remove("dv-hidden");
  }

  // =========================================================================
  // TOASTS
  // =========================================================================
  function dvShowToast(message) {
    const container = $("dvToastContainer");
    const toast = document.createElement("div");
    toast.className = "dv-toast";
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // =========================================================================
  // CHAT LIST REFRESH (for offline cache warm-up)
  // =========================================================================
  async function dvRefreshChatList() {
    const res = await dvApi.dvListChats();
    if (res.ok && res.chats) {
      for (const c of res.chats) {
        await dvStorage.dvPutChat({ id: c.id, title: c.title, mode: c.mode, updatedAt: c.updated_at });
      }
    }
  }

  // =========================================================================
  // LOGOUT
  // =========================================================================
  async function dvHandleLogout() {
    dvShowConfirm("Log out of DV Ai on this device?", async () => {
      await dvApi.dvLogout();
      dvStorage.dvClearSession();
      dvShowToast("Logged out.");
      dvShowGate();
      $("dvEmailInput").value = "";
      $("dvCodeInput").value = "";
      $("dvGateStep1").classList.remove("dv-hidden");
      $("dvGateStep2").classList.add("dv-hidden");
      $("dvGateMessage").textContent = "";
    });
  }

  // =========================================================================
  // PWA — install, share, service worker
  // =========================================================================
  function dvRegisterServiceWorker() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => { /* ignore */ });
      });
    }
  }

  function dvBindInstallPrompt() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      dvState.deferredInstallPrompt = e;
    });
  }

  async function dvHandleInstallApp() {
    if (dvState.deferredInstallPrompt) {
      dvState.deferredInstallPrompt.prompt();
      const { outcome } = await dvState.deferredInstallPrompt.userChoice;
      dvState.deferredInstallPrompt = null;
      dvShowToast(outcome === "accepted" ? "App installed." : "Install dismissed.");
    } else {
      dvShowToast("Use your browser menu to Add to Home screen.");
    }
  }

  async function dvHandleShareApp() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: "DV Ai", text: "DV Ai — private AI workspace", url });
      } else {
        await navigator.clipboard.writeText(url);
        dvShowToast("Link copied to clipboard.");
      }
    } catch { /* user cancelled share — no-op */ }
  }

  return { dvInit, dvHandleSessionExpired };
})();

document.addEventListener("DOMContentLoaded", dvApp.dvInit);