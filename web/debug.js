// Yupoo Library — the hidden Speed report (/debug): timings from the pages and numbers from the app.
let report = null;

const ms = (v) => (v >= 1000 ? (v / 1000).toFixed(2) + " s" : Math.round(v) + " ms");
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

// Things that are a total count, not a time.
const NOT_TIMES = new Set(["page memory (MB)"]);

function summarize(entries) {
  const by = new Map();
  entries.forEach((e) => {
    if (!by.has(e.name)) by.set(e.name, []);
    by.get(e.name).push(e);
  });
  return [...by].map(([name, es]) => ({
    name, count: es.length, last: es[es.length - 1].ms, median: median(es.map((e) => e.ms)),
    max: Math.max(...es.map((e) => e.ms)), n: es[es.length - 1].n, note: es[es.length - 1].note
  }));
}

async function loadReport() {
  report = await call("GET", "/api/debug");
  const d = report;
  const rows = summarize(d.entries || []);
  const mem = rows.find((r) => r.name === "page memory (MB)");
  const state = rows.find((r) => r.name === "app: build library data for the page");
  $(".facts").innerHTML = [
    ["Items in the library", num(d.items)],
    ["library.json size", (d.libraryBytes / 1048576).toFixed(1) + " MB"],
    ["Library data sent to the page", state ? (state.n / 1048576).toFixed(1) + " MB each time" : "—"],
    ["App memory (Go)", d.goHeapMB.toFixed(0) + " MB in use, " + d.goSysMB.toFixed(0) + " MB reserved"],
    ["Library page memory", mem ? mem.last.toFixed(0) + " MB" : "— (open the Library first)"],
    ["Version", d.version]
  ].map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b><span></span>`).join("");
  const times = rows.filter((r) => !NOT_TIMES.has(r.name));
  const slow = [...times].filter((r) => !/^speed test: |^launch/.test(r.name) || true).sort((a, b) => b.median - a.median);
  $(".slowest").innerHTML = slow.length
    ? `<ol>${slow.slice(0, 3).map((r) => `<li><b>${esc(r.name)}</b> — ${ms(r.median)} (typical), slowest ${ms(r.max)}</li>`).join("")}</ol>`
    : `<p class="hint">Nothing measured yet — open the Library, or press 🏁 Run the speed test.</p>`;
  $(".perftable").innerHTML = `<table class="ptable"><tr><th>What</th><th>Times</th><th>Typical</th><th>Last</th><th>Slowest</th><th>Items</th></tr>` +
    slow.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.count}</td><td>${ms(r.median)}</td><td>${ms(r.last)}</td><td>${ms(r.max)}</td><td>${r.n ? num(r.n) + " " + esc(r.note) : esc(r.note || "")}</td></tr>`).join("") + `</table>`;
}

function reportText() {
  const d = report, rows = summarize(d.entries || []);
  return [`Yupoo Library ${d.version} — speed report, ${new Date().toLocaleString()}`,
    `${d.items} items, library.json ${(d.libraryBytes / 1048576).toFixed(1)} MB, app memory ${d.goHeapMB.toFixed(0)} MB`, ""]
    .concat(rows.sort((a, b) => b.median - a.median).map((r) => `${r.name}: typical ${ms(r.median)}, slowest ${ms(r.max)} (${r.count}×)`)).join("\n");
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "back") location.href = "/";
  else if (act === "reload") loadReport();
  else if (act === "clear") { await fetch("/api/perf/clear", { method: "POST", headers: { "X-Kit-Token": TOKEN } }); loadReport(); }
  else if (act === "run") { await fetch("/api/perf/clear", { method: "POST", headers: { "X-Kit-Token": TOKEN } }); location.href = "/#speedtest"; }
  else if (act === "copy") {
    try { await navigator.clipboard.writeText(reportText()); toast("Report copied."); } catch (err) { prompt("Copy this report:", reportText()); }
  }
});

loadReport().catch((e) => toast("Couldn't load the report: " + e.message));
