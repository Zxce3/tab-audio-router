// tabId -> { ctx, stream, gain, deviceId, volume, muted }
const routes = new Map();
// tabId -> promise tail; serializes operations per tab so rapid actions can't interleave or leak.
const locks = new Map();

function serial(tabId, fn) {
  const run = (locks.get(tabId) || Promise.resolve()).catch(() => {}).then(fn);
  locks.set(tabId, run);
  run.finally(() => { if (locks.get(tabId) === run) locks.delete(tabId); }).catch(() => {});
  return run;
}

async function teardown(tabId) {
  const r = routes.get(tabId);
  if (!r) return;
  routes.delete(tabId);
  r.stream.getTracks().forEach((t) => { t.onended = null; t.stop(); });
  await r.ctx.close().catch(() => {});
}

async function start({ tabId, deviceId, volume, streamId }) {
  await teardown(tabId);
  let stream, ctx;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    });
    ctx = new AudioContext({ sinkId: deviceId || "" });
    const gain = ctx.createGain();
    gain.gain.value = volume ?? 1;
    ctx.createMediaStreamSource(stream).connect(gain).connect(ctx.destination);
    routes.set(tabId, { ctx, stream, gain, deviceId, volume: volume ?? 1, muted: false });
    // Capture ended (tab closed / capture revoked): drop the route so state matches reality.
    stream.getAudioTracks()[0].onended = () =>
      serial(tabId, () => teardown(tabId)).then(() => chrome.runtime.sendMessage({ target: "background", type: "badge" }).catch(() => {}));
  } catch (e) {
    // Don't leak a half-built pipeline on failure.
    stream?.getTracks().forEach((t) => t.stop());
    await ctx?.close().catch(() => {});
    throw e;
  }
}

async function update({ tabId, deviceId, volume, muted }) {
  const r = routes.get(tabId);
  if (!r) throw new Error("Tab is not routed");
  if (volume != null) r.volume = volume;
  if (muted != null) r.muted = muted;
  r.gain.gain.value = r.muted ? 0 : r.volume;
  if (deviceId != null && deviceId !== r.deviceId) { await r.ctx.setSinkId(deviceId); r.deviceId = deviceId; }
}

const ops = {
  route: (m) => serial(m.tabId, () => start(m)),
  update: (m) => serial(m.tabId, () => update(m)),
  stop: (m) => serial(m.tabId, () => teardown(m.tabId)),
  list: async () => ({
    routes: Object.fromEntries([...routes].map(([id, r]) => [id, { deviceId: r.deviceId, volume: r.volume, muted: r.muted }])),
  }),
};

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg.target !== "offscreen" || !ops[msg.type]) return;
  Promise.resolve(ops[msg.type](msg)).then(
    (r) => send({ ok: true, ...(r || {}) }),
    (e) => send({ ok: false, error: String(e.message || e) }),
  );
  return true;
});

// If a routed device is unplugged, fall back to the default output instead of going silent.
navigator.mediaDevices.addEventListener("devicechange", async () => {
  const ids = new Set((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput").map((d) => d.deviceId));
  for (const [tabId, r] of routes) {
    if (r.deviceId && !ids.has(r.deviceId)) {
      serial(tabId, async () => { await r.ctx.setSinkId("").catch(() => {}); r.deviceId = ""; });
    }
  }
});
