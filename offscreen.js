// tabId -> { ctx, stream, gain }
const routes = new Map();

async function start({ tabId, deviceId, volume, streamId }) {
  await stop({ tabId });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
  });
  const ctx = new AudioContext({ sinkId: deviceId || "" });
  const gain = ctx.createGain();
  gain.gain.value = volume ?? 1;
  ctx.createMediaStreamSource(stream).connect(gain).connect(ctx.destination);
  routes.set(tabId, { ctx, stream, gain, deviceId, volume: gain.gain.value, muted: false });
}

async function update({ tabId, deviceId, volume, muted }) {
  const r = routes.get(tabId);
  if (!r) return;
  if (volume != null) r.volume = volume;
  if (muted != null) r.muted = muted;
  r.gain.gain.value = r.muted ? 0 : r.volume;
  if (deviceId != null && deviceId !== r.deviceId) { await r.ctx.setSinkId(deviceId); r.deviceId = deviceId; }
}

async function stop({ tabId }) {
  const r = routes.get(tabId);
  if (!r) return;
  r.stream.getTracks().forEach((t) => t.stop());
  await r.ctx.close();
  routes.delete(tabId);
}

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg.target !== "offscreen") return;
  const fn = { route: start, update, stop,
    list: async () => ({ routes: Object.fromEntries([...routes].map(([id, r]) => [id, { deviceId: r.deviceId, volume: r.volume, muted: r.muted }])) }),
  }[msg.type];
  Promise.resolve(fn(msg)).then((r) => send(r || {}), (e) => send({ error: String(e.message || e) }));
  return true;
});

// If a routed device is unplugged, fall back to the default output instead of going silent.
navigator.mediaDevices.addEventListener("devicechange", async () => {
  const ids = new Set((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput").map((d) => d.deviceId));
  for (const r of routes.values()) {
    if (r.deviceId && !ids.has(r.deviceId)) { await r.ctx.setSinkId("").catch(() => {}); r.deviceId = ""; }
  }
});
