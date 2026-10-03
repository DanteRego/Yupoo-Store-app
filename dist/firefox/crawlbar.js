// Yupoo Library app — "Save whole store" progress, on every page in the app.
// The saving itself runs inside the app (crawl.go), so you can leave the store while it works.
// On the store being saved, the green bar shows the progress (capture.js). Everywhere else
// a small card in the bottom-right corner shows it; "–" shrinks it to a round badge.
(() => {
  if (window.top !== window || window.__kitCrawl) return;

  const bridge = window.__kitBridge;
  const tokenMeta = document.querySelector('meta[name="kit-token"]');
  // Inside the app window pages talk to the app directly; the test mode uses the Library's API.
  async function api(act, opts) {
    if (bridge && bridge.crawl) return bridge.crawl(act, opts);
    if (!tokenMeta) return null;
    const token = tokenMeta.content;
    const res = act === "status"
      ? await fetch("/api/crawl", { headers: { "X-Kit-Token": token } }).then((r) => r.json()).then((s) => ({ status: s }))
      : await fetch("/api/crawl/" + act, {
        method: "POST", headers: { "X-Kit-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ URL: (opts || {}).url, Cookie: (opts || {}).cookie, Mode: (opts || {}).mode, Min: !!(opts || {}).min })
      }).then((r) => r.json());
    return res;
  }

  let st = null, firstStatus = true;
  const subs = [];
  const onStore = () => !!st && location.hostname === st.host;

  // Pages done so far, as 0–1, or null when the number of pages isn't known.
  function fraction(s) {
    if (!s.running && !s.failed && s.msg && s.msg.startsWith("Done")) return 1;
    if (!s.maxPage) return null;
    return Math.min(1, (s.running ? s.page - 1 : s.page) / s.maxPage);
  }
  function detail(s) {
    if (!s.running) return s.msg;
    return `Page ${s.page}${s.maxPage ? " of " + s.maxPage : ""} · ${s.seen} items · ${s.new} new`;
  }

  async function poll() {
    let r = null;
    try { r = await api("status"); } catch (e) {}
    if (r && r.status) set(r.status);
    setTimeout(poll, st && st.running ? 1000 : 2500);
  }
  function set(s) {
    const was = st;
    st = s;
    subs.forEach((fn) => { try { fn(st, was); } catch (e) {} });
    window.dispatchEvent(new CustomEvent("kit-crawl", { detail: { status: st, previous: was } }));
    render(firstStatus);
    firstStatus = false;
  }
  async function act(name, opts) {
    const r = await api(name, opts);
    if (r && r.status) set(r.status);
    return r || {};
  }

  window.__kitCrawl = {
    get status() { return st; },
    subscribe(fn) { subs.push(fn); if (st) fn(st, null); },
    start: (url, cookie) => act("start", { url, cookie }),
    stop: () => act("stop"),
    dismiss: () => act("dismiss"),
    setUI: (mode, min) => act("ui", { mode, min }),
    fraction, detail
  };

  // ---------- the corner card ----------
  let host = null, shadow = null;
  function build() {
    host = document.createElement("div");
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: "Segoe UI", -apple-system, Roboto, Arial, "Microsoft YaHei", "PingFang SC", sans-serif; }
      .wrap { transform-origin: bottom right; }
      .wrap.arrive { animation: arrive .65s cubic-bezier(.2,.8,.2,1); }
      @keyframes arrive {
        from { transform: translateX(calc(-50vw + 16px + 50%)) scale(1.04); opacity: .6; }
        to { transform: none; opacity: 1; }
      }
      .card { width: 300px; background: #1c2321; color: #e7ecea; border-radius: 14px; padding: 12px 14px 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.08); font-size: 13px; }
      .top { display: flex; align-items: center; gap: 8px; }
      .title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dot { width: 9px; height: 9px; border-radius: 50%; background: #3ccf86; flex-shrink: 0; }
      .running .dot { animation: pulse 1.2s ease-in-out infinite; }
      .failed .dot { background: #f0b35a; }
      @keyframes pulse { 50% { opacity: .3; } }
      .icon { cursor: pointer; border: 0; background: transparent; color: #9aa6a1; font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
      .icon:hover { background: rgba(255,255,255,.1); color: #fff; }
      .track { position: relative; height: 8px; border-radius: 99px; background: rgba(255,255,255,.1); overflow: hidden; margin: 10px 0 7px; }
      .fill { position: absolute; inset: 0 auto 0 0; width: 0; border-radius: 99px; background: linear-gradient(90deg, #1f7a4d, #3ccf86); transition: width .6s ease; }
      .fill.unknown { width: 35% !important; animation: slide 1.4s ease-in-out infinite; }
      @keyframes slide { from { left: -35%; } to { left: 100%; } }
      .failed .fill { background: #f0b35a; }
      .detail { color: #9aa6a1; font-size: 12px; line-height: 1.4; }
      .btns { display: flex; gap: 6px; margin-top: 10px; }
      .btn { cursor: pointer; border: 0; border-radius: 8px; padding: 6px 11px; font-size: 12px; font-family: inherit;
        background: rgba(255,255,255,.1); color: #fff; }
      .btn:hover { background: rgba(255,255,255,.2); }
      .btn.main { background: #1f7a4d; }
      .btn.main:hover { background: #26935c; }
      .badge { cursor: pointer; width: 58px; height: 58px; border-radius: 50%; display: grid; place-items: center; border: 0; padding: 0;
        box-shadow: 0 8px 24px rgba(0,0,0,.35); color: #fff; font-size: 13px; font-weight: 700; }
      .badge span { width: 46px; height: 46px; border-radius: 50%; background: #1c2321; display: grid; place-items: center; }
      .badge.unknown { animation: spin 1.4s linear infinite; }
      .badge.unknown span { animation: spin 1.4s linear infinite reverse; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style><div class="wrap"></div>`;
    shadow.addEventListener("click", onClick);
  }

  let shape = "";
  function render(justLoaded) {
    const show = st && st.active && !onStore();
    if (!show) { if (host) host.remove(); return; }
    if (!document.body) { document.addEventListener("DOMContentLoaded", () => render(justLoaded), { once: true }); return; }
    if (!host) build();
    if (!host.isConnected) document.body.appendChild(host);
    const wrap = shadow.querySelector(".wrap");
    const f = fraction(st);
    const pct = f == null ? null : Math.round(f * 100);
    const state = st.running ? "running" : st.failed ? "failed" : "done";
    const unknown = pct == null && st.running;
    // Only rebuild when the layout changes, so the bar glides instead of jumping.
    const newShape = [st.uiMin, state, unknown].join();
    if (newShape !== shape) {
      shape = newShape;
      wrap.innerHTML = st.uiMin
        ? `<button class="badge ${unknown ? "unknown" : ""}" data-act="expand"><span></span></button>`
        : `<div class="card ${state}">
          <div class="top"><span class="dot"></span><span class="title"></span>
            <button class="icon" data-act="min" title="Shrink">–</button>
            ${st.running ? "" : `<button class="icon" data-act="dismiss" title="Close">✕</button>`}</div>
          <div class="track"><div class="fill ${unknown ? "unknown" : ""}"></div></div>
          <div class="detail"></div>
          <div class="btns"><button class="btn main" data-act="open">Open store</button>
            ${st.running ? `<button class="btn" data-act="stop">Stop</button>` : ""}</div></div>`;
    }
    if (st.uiMin) {
      const badge = shadow.querySelector(".badge");
      const ring = st.failed ? "#f0b35a" : "#3ccf86";
      badge.style.background = `conic-gradient(${ring} ${pct == null ? 90 : pct * 3.6}deg, rgba(60,207,134,.18) 0)`;
      badge.title = `${st.running ? "Saving" : "Saved"} ${st.store} — ${detail(st)}\nClick to open`;
      badge.firstElementChild.textContent = st.running ? (pct == null ? "…" : pct + "%") : st.failed ? "!" : "✓";
    } else {
      const title = st.running ? `Saving ${st.store}` : st.failed ? `${st.store} — stopped early` : `Finished saving ${st.store}`;
      const t = shadow.querySelector(".title");
      t.textContent = t.title = title;
      shadow.querySelector(".fill").style.width = (pct == null ? 0 : pct) + "%";
      shadow.querySelector(".detail").textContent = detail(st) + (st.running && pct != null ? ` · ${pct}%` : "");
    }
    // Just left the store page: slide the bar over into the corner.
    if (justLoaded && st.uiMode === "bar") {
      wrap.classList.remove("arrive"); void wrap.offsetWidth; wrap.classList.add("arrive");
    }
    if (st.uiMode !== "corner") { st.uiMode = "corner"; api("ui", { mode: "corner", min: st.uiMin }); }
  }

  function onClick(e) {
    const b = e.target.closest("button");
    if (!b) return;
    const a = b.dataset.act;
    if (a === "min") act("ui", { mode: "corner", min: true });
    else if (a === "expand") act("ui", { mode: "corner", min: false });
    else if (a === "dismiss") act("dismiss");
    else if (a === "stop") act("stop");
    else if (a === "open") location.href = st.link;
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  poll();
})();
