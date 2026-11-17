// Brokers requests between the popup and the offscreen audio engine.
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

// Every call to the offscreen document goes through here so failures are never reported as success.
async function toOffscreen(msg) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: "offscreen", ...msg });
  if (!res) throw new Error("Audio engine did not respond");
  if (res.ok === false || res.error) throw new Error(res.error || "Audio engine error");
  return res;
}

async function listRoutes() {
  const { routes = {} } = await toOffscreen({ type: "list" });
  return routes;
}

async function updateBadge() {
  const n = Object.keys(await listRoutes()).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
  await chrome.action.setBadgeText({ text: n ? String(n) : "" });
}

const handlers = {
  async route({ tabId, deviceId, volume }) {
    await ensureOffscreen();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    return toOffscreen({ type: "route", tabId, deviceId, volume, streamId });
  },
  update: ({ tabId, deviceId, volume, muted }) => toOffscreen({ type: "update", tabId, deviceId, volume, muted }),
  stop: ({ tabId }) => toOffscreen({ type: "stop", tabId }),
  async stopAll() {
    for (const id of Object.keys(await listRoutes())) await toOffscreen({ type: "stop", tabId: +id });
    return {};
  },
  async list() { return { routes: await listRoutes() }; },
};

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg.target === "background" && msg.type === "badge") { updateBadge().catch(() => {}); return; }
  if (msg.target !== "background" || !handlers[msg.type]) return;
  handlers[msg.type](msg)
    .then(async (r) => { if (msg.type !== "list") await updateBadge().catch(() => {}); send({ ok: true, ...(r || {}) }); })
    .catch((e) => send({ ok: false, error: String(e.message || e) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  toOffscreen({ type: "stop", tabId }).then(updateBadge).catch(() => {});
});

// If the browser restarts or the offscreen doc was killed, the badge must not lie.
chrome.runtime.onStartup.addListener(() => chrome.action.setBadgeText({ text: "" }));
chrome.runtime.onInstalled.addListener(() => chrome.action.setBadgeText({ text: "" }));
