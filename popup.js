const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage({ target: "background", ...m });
const err = (t) => ($("msg").textContent = t || "");
const host = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
const store = {
  get: async () => (await chrome.storage.local.get({ sites: {}, showAll: false })),
  set: (o) => chrome.storage.local.set(o),
};

async function render() {
  const [devices, tabs, listed, cfg, [cur]] = await Promise.all([
    navigator.mediaDevices.enumerateDevices().then((d) => d.filter((x) => x.kind === "audiooutput")),
    chrome.tabs.query({}),
    send({ type: "list" }),
    store.get(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  const routes = listed.routes || {};
  $("all").checked = cfg.showAll;
  if (devices.length && !devices[0].label) err("Device names hidden — click “Grant device access”.");
  const wrap = $("tabs");
  wrap.innerHTML = "";
  const shown = tabs
    .filter((t) => cfg.showAll || t.audible || routes[t.id] || t.id === cur?.id)
    .sort((a, b) => (b.id === cur?.id) - (a.id === cur?.id));
  for (const tab of shown) {
    const r = routes[tab.id];
    const isCur = tab.id === cur?.id;
    const el = document.createElement("div");
    el.className = "tab" + (isCur ? " current" : "");

    const head = document.createElement("div"); head.className = "head";
    const ico = document.createElement("img"); ico.src = tab.favIconUrl || "icons/16.png";
    const title = document.createElement("div"); title.className = "title"; title.textContent = (tab.audible ? "🔊 " : "") + tab.title;
    const mute = document.createElement("button"); mute.textContent = r?.muted ? "🔇" : "🔈"; mute.title = "Mute routed audio";
    mute.hidden = !r;
    head.append(ico, title, mute);

    const sel = document.createElement("select");
    sel.add(new Option("Default (no routing)", ""));
    const saved = cfg.sites[host(tab.url)];
    for (const d of devices) sel.add(new Option(d.label || d.deviceId, d.deviceId));
    sel.value = r?.deviceId ?? "";
    if (!r && saved && devices.some((d) => d.deviceId === saved)) sel.title = "Last used for this site: " + (devices.find((d) => d.deviceId === saved).label);
    const vol = Object.assign(document.createElement("input"), { type: "range", min: 0, max: 1, step: 0.05, value: r?.volume ?? 1 });
    const row = document.createElement("div"); row.className = "row";
    row.append(sel, vol);
    el.append(head, row);
    wrap.append(el);

    const state = () => ({ tabId: tab.id, deviceId: sel.value, volume: +vol.value });
    sel.onchange = async () => {
      err();
      if (!sel.value) { await send({ type: "stop", tabId: tab.id }); delete routes[tab.id]; mute.hidden = true; return; }
      const res = await send({ type: routes[tab.id] ? "update" : "route", ...state() });
      if (!res.ok) { err(res.error.includes("activeTab") || res.error.includes("invoked") ? "Switch to this tab and open the popup there to start routing it." : res.error); sel.value = ""; return; }
      routes[tab.id] = { deviceId: sel.value, volume: +vol.value };
      mute.hidden = false;
      cfg.sites[host(tab.url)] = sel.value; store.set({ sites: cfg.sites });
    };
    vol.oninput = () => routes[tab.id] && send({ type: "update", ...state() });
    mute.onclick = async () => {
      const muted = !routes[tab.id].muted;
      await send({ type: "update", tabId: tab.id, muted });
      routes[tab.id].muted = muted; mute.textContent = muted ? "🔇" : "🔈";
    };
  }
  if (!wrap.children.length) wrap.textContent = "No tabs to show.";
}

$("all").onchange = async (e) => { await store.set({ showAll: e.target.checked }); render(); };
$("stopall").onclick = async () => { await send({ type: "stopAll" }); render(); };
$("perm").onclick = async () => {
  try {
    (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
    err(); render();
  } catch {
    chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
  }
};
render();
