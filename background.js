// Per-tab routing state lives in the offscreen document; this worker brokers requests.
const OFFSCREEN = "offscreen.html";

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: ["USER_MEDIA"],
    justification: "Play captured tab audio through a chosen output device.",
  });
}

async function route(tabId, deviceId, volume) {
  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  return chrome.runtime.sendMessage({ target: "offscreen", type: "route", tabId, deviceId, volume, streamId });
}

async function update(tabId, deviceId, volume) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: "offscreen", type: "update", tabId, deviceId, volume });
}

async function stop(tabId) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: "offscreen", type: "stop", tabId });
}

async function updateBadge() {
  const { routes = {} } = (await chrome.runtime.sendMessage({ target: "offscreen", type: "list" })) || {};
  const n = Object.keys(routes).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
  await chrome.action.setBadgeText({ text: n ? String(n) : "" });
}

async function stopAll() {
  await ensureOffscreen();
  const { routes = {} } = await chrome.runtime.sendMessage({ target: "offscreen", type: "list" });
  for (const id of Object.keys(routes)) await stop(+id);
}

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg.target !== "background") return;
  const run = {
    route: () => route(msg.tabId, msg.deviceId, msg.volume),
    update: () => update(msg.tabId, msg.deviceId, msg.volume),
    stop: () => stop(msg.tabId),
    stopAll,
    list: async () => {
      await ensureOffscreen();
      return chrome.runtime.sendMessage({ target: "offscreen", type: "list" });
    },
  }[msg.type];
  run().then(async (r) => { if (msg.type !== "list") await updateBadge().catch(() => {}); send({ ok: true, ...(r || {}) }); }, (e) => send({ ok: false, error: String(e.message || e) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => stop(tabId).then(updateBadge).catch(() => {}));
