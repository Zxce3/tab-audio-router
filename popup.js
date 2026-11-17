const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage({ target: "background", ...m }).then(
  (r) => r || { ok: false, error: "No response from background worker" },
  (e) => ({ ok: false, error: String(e.message || e) }));
const err = (t) => ($("msg").textContent = t || "");
const host = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
const store = {
  get: () => chrome.storage.local.get({ sites: {}, showAll: false }),
  set: (o) => chrome.storage.local.set(o),
};
const meters = new Map(); // tabId -> meter element
const SEARCH_AT = 6;

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}

async function render() {
  const [devices, tabs, listed, cfg, [cur]] = await Promise.all([
    navigator.mediaDevices.enumerateDevices().then((d) => d.filter((x) => x.kind === "audiooutput")),
    chrome.tabs.query({}),
    send({ type: "list" }),
    store.get(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  if (!listed.ok) err(listed.error);
  const routes = listed.routes || {};
  const named = devices.length > 0 && !!devices[0].label;
  const label = (id) => devices.find((d) => d.deviceId === id)?.label || "Default output";

  $("all").checked = cfg.showAll;
  $("onboard").hidden = named;
  const q = $("search").value.trim().toLowerCase();
  let list = tabs.filter((t) => cfg.showAll || t.audible || routes[t.id] || t.id === cur?.id);
  $("search").hidden = tabs.length < SEARCH_AT && !q;
  if (q) list = tabs.filter((t) => (t.title + " " + t.url).toLowerCase().includes(q));
  list.sort((a, b) => (b.id === cur?.id) - (a.id === cur?.id) || !!routes[b.id] - !!routes[a.id]);

  const wrap = $("tabs");
  wrap.replaceChildren();
  meters.clear();
  if (!list.length) wrap.append(el("div", { className: "empty", textContent: "No tabs to show." }));

  for (const tab of list) {
    const r = routes[tab.id];
    const isCur = tab.id === cur?.id;
    const locked = !r && !isCur; // Chrome only lets us start capture on the tab the popup is opened on.
    const card = el("div", { className: "card" + (isCur ? " current" : "") + (locked ? " disabled" : "") });

    const chip = el("span", { className: "chip" + (r ? (r.fellBack ? " warn" : " on") : ""),
      textContent: r ? (r.fellBack ? "Device gone → default" : label(r.deviceId)) : "Not routed" });
    const mute = el("button", { className: "ghost", hidden: !r, textContent: r?.muted ? "Unmute" : "Mute",
      title: "Mute routed audio", ariaLabel: `Mute ${tab.title}` });
    card.append(el("div", { className: "head" },
      el("img", { src: tab.favIconUrl || "icons/16.png", alt: "" }),
      el("div", { className: "title", textContent: (tab.audible ? "🔊 " : "") + tab.title, title: tab.title }),
      chip, mute));

    const sel = el("select", { disabled: locked, ariaLabel: `Output device for ${tab.title}` });
    sel.add(new Option("Default (no routing)", ""));
    for (const d of devices) sel.add(new Option(d.label || d.deviceId, d.deviceId));
    sel.value = r?.deviceId ?? "";
    const saved = cfg.sites[host(tab.url)];
    if (!r && saved && devices.some((d) => d.deviceId === saved)) sel.title = "Last used on this site: " + label(saved);
    const vol = el("input", { type: "range", min: 0, max: 1, step: 0.05, value: r?.volume ?? 1, disabled: locked, ariaLabel: `Volume for ${tab.title}` });
    const pct = el("span", { className: "pct", textContent: Math.round(vol.value * 100) + "%" });
    card.append(el("div", { className: "row" }, sel), el("div", { className: "row" }, vol, pct));

    if (r) {
      const fill = el("i");
      const m = el("div", { className: "meter", ariaHidden: "true" }, fill);
      meters.set(String(tab.id), m);
      card.append(m);
    }
    if (locked) card.append(el("div", { className: "note", textContent: "Open this popup on that tab to start routing it." }));
    wrap.append(card);

    const state = () => ({ tabId: tab.id, deviceId: sel.value, volume: +vol.value });
    sel.onchange = async () => {
      err();
      if (!sel.value) { await send({ type: "stop", tabId: tab.id }); return render(); }
      const res = await send({ type: r ? "update" : "route", ...state() });
      if (!res.ok) { err(/activeTab|invoked/i.test(res.error) ? "Open this popup on that tab to start routing it." : res.error); return render(); }
      cfg.sites[host(tab.url)] = sel.value;
      store.set({ sites: cfg.sites });
      render();
    };
    vol.oninput = () => {
      pct.textContent = Math.round(vol.value * 100) + "%";
      if (r) send({ type: "update", tabId: tab.id, volume: +vol.value });
    };
    mute.onclick = async () => { await send({ type: "update", tabId: tab.id, muted: !r.muted }); render(); };
  }
}

// Live level meters: poll the audio engine only while the popup is open.
setInterval(async () => {
  if (!meters.size) return;
  const res = await chrome.runtime.sendMessage({ target: "offscreen", type: "levels" }).catch(() => null);
  for (const [id, m] of meters) {
    const peak = res?.levels?.[id] ?? 0;
    m.firstChild.style.width = Math.min(100, Math.round(Math.sqrt(peak) * 100)) + "%";
    m.classList.toggle("hot", peak > 0.9);
  }
}, 100);

$("all").onchange = async (e) => { await store.set({ showAll: e.target.checked }); render(); };
$("search").oninput = render;
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
