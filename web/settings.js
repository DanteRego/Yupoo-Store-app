// Yupoo Library app — the ⚙ Settings page: language, where cover photos are kept, where files go.
// Shared pieces (talking to the app, theme, messages) are in shared.js; translations in i18n.js.

let info0 = null; // what the app told us (folders, photo count, version…)

// Text written in both languages right in the page (data-en / data-zh).
document.querySelectorAll("[data-en]").forEach((el) => { el.textContent = L(el.dataset.en, el.dataset.zh); });

function renderInfo() {
  const d = info0;
  $(".thumbsdir").textContent = d.thumbsDir;
  $(".photocount").textContent = L(`${num(d.photoCount)} photos`, `${num(d.photoCount)} 张图片`) +
    (d.usingDefault ? L(" · default folder", " · 默认文件夹") : "");
  $('[data-act="default"]').hidden = d.usingDefault;
  $('[data-act="default"]').title = d.defaultThumbsDir;
  $(".datadir").textContent = d.dataDir;
  $(".downloadsdir").textContent = d.downloadsDir;
  $(".version").textContent = L(`Yupoo Library version ${d.version}`, `Yupoo 图库版本 ${d.version}`);
  // The "Browse…" box and "Open folder" only work inside the Windows app.
  $('[data-act="browse"]').textContent = d.canPickFolders ? t("Browse…") : L("Choose a folder…", "选择文件夹…");
  document.querySelectorAll('[data-act="open"]').forEach((b) => { b.hidden = !d.canPickFolders; });
  showMove(d.move);
}

async function loadInfo() {
  info0 = await call("GET", "/api/settings-info");
  renderInfo();
}

// ---------- language ----------
async function setLanguage(lang) {
  S.settings.language = lang;
  try {
    await call("POST", "/api/settings", S.settings);
    try { localStorage.setItem("lang", lang); } catch (e) {}
    location.reload(); // the whole page (and every page after) now uses the new language
  } catch (e) { toast(L("Couldn't save the language: ", "无法保存语言：") + e.message); }
}

// ---------- photos folder ----------
function startChoosing(path) {
  $(".choose").hidden = false;
  $(".newdir").value = path || "";
  $(".movelabel").textContent = L(`Move my ${num(info0.photoCount)} existing photos there too (recommended)`,
    `把现有的 ${num(info0.photoCount)} 张图片也搬过去（推荐）`);
  $(".newdir").focus();
}

async function browse() {
  if (!info0.canPickFolders) { startChoosing(""); return; }
  try {
    const r = await call("POST", "/api/pick-folder", { title: L("Choose a folder for your cover photos", "选择保存封面图片的文件夹") });
    if (r.path) startChoosing(r.path);
  } catch (e) { toast(e.message); startChoosing(""); }
}

async function applyFolder(useDefault) {
  const dir = useDefault ? info0.defaultThumbsDir : $(".newdir").value.trim();
  const move = $(".movephotos").checked;
  if (!dir) { toast(L("Choose or type a folder first.", "请先选择或输入一个文件夹。")); return; }
  if (useDefault && !confirm(L(`Go back to the default photos folder?\n\n${info0.defaultThumbsDir}\n\nYour photos will be moved back there.`,
    `要恢复默认的图片文件夹吗？\n\n${info0.defaultThumbsDir}\n\n你的图片会被搬回那里。`))) return;
  try {
    const r = await call("POST", "/api/thumbs-dir", { dir, default: !!useDefault, move: useDefault ? true : move });
    $(".choose").hidden = true;
    if (r.move && r.move.running) {
      showMove(r.move);
      pollMove();
    } else {
      toast(L("Photos folder changed.", "图片文件夹已更改。"));
      await loadInfo();
    }
  } catch (e) { toast(e.message); }
}

function showMove(m) {
  const box = $(".moving");
  if (!m || (!m.running && !m.message)) { box.hidden = true; return; }
  box.hidden = false;
  const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
  $(".moving .fill").style.width = (m.running ? pct : 100) + "%";
  $(".moving .fill").classList.toggle("unknown", m.running && !m.total);
  if (m.running) {
    $(".movetext").textContent = L(`Moving photos… ${num(m.done)} of ${num(m.total)} (${pct}%). You can keep using the app.`,
      `正在搬图片… ${num(m.done)} / ${num(m.total)}（${pct}%）。你可以继续使用程序。`);
  } else {
    $(".movetext").textContent = m.failed
      ? L(m.message, `已搬 ${num(m.total - m.failed)} 张图片；有 ${num(m.failed)} 张没能搬走，留在原来的文件夹里。`)
      : L(m.message, `已搬好 ${num(m.total)} 张图片。`);
  }
}

let moveTimer = null;
async function pollMove() {
  clearTimeout(moveTimer);
  try {
    const m = await call("GET", "/api/thumbs-move");
    showMove(m);
    if (m.running) { moveTimer = setTimeout(pollMove, 700); return; }
    await loadInfo();
  } catch (e) { moveTimer = setTimeout(pollMove, 2000); }
}

// ---------- 🩺 check-up ----------
let lastReport = null;
async function runCheckup(btn) {
  btn.disabled = true;
  const box = $(".diag");
  box.innerHTML = `<div class="diagrow running">${L("Checking… (this takes a few seconds)", "正在检查…（需要几秒钟）")}</div>`;
  try {
    const d = await call("GET", "/api/diagnose");
    lastReport = d;
    const icon = { ok: "✅", warn: "⚠️", fail: "❌" };
    const problems = d.checks.filter((c) => c.status !== "ok").length;
    box.innerHTML = `<div class="diagsum ${problems ? "bad" : "good"}">${problems
      ? L(`Found ${problems} thing${problems === 1 ? "" : "s"} to look at.`, `发现 ${problems} 个需要注意的地方。`)
      : L("Everything looks fine.", "一切正常。")}</div>` +
      d.checks.map((c) => `<div class="diagrow ${c.status}"><span class="ic">${icon[c.status]}</span>
        <span class="txt"><b>${esc(L(c.name, c.nameZh))}</b><br>${esc(L(c.detail, c.detailZh))}</span></div>`).join("");
    $('[data-act="copyreport"]').hidden = false;
  } catch (e) {
    box.innerHTML = `<div class="diagrow fail"><span class="ic">❌</span><span class="txt">${esc(L("The check-up itself failed: ", "检查本身失败了：") + e.message)}</span></div>`;
  }
  btn.disabled = false;
}

// A plain-text report you can paste into a message (e.g. to Claude Code) when asking for help.
async function copyReport() {
  if (!lastReport) return;
  const icon = { ok: "OK  ", warn: "WARN", fail: "FAIL" };
  const text = [`Yupoo Library ${lastReport.version} — check-up ${lastReport.time} (${lastReport.system})`, ""]
    .concat(lastReport.checks.map((c) => `[${icon[c.status]}] ${c.name}: ${c.detail}`)).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast(L("Report copied — paste it wherever you're asking for help.", "报告已复制——粘贴到你求助的地方即可。"));
  } catch (e) {
    // Clipboard not allowed: show it so it can be copied by hand.
    prompt(L("Copy this report:", "复制这份报告："), text);
  }
}

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "back") location.href = "/";
  else if (act === "browse") browse();
  else if (act === "apply") applyFolder(false);
  else if (act === "cancel") $(".choose").hidden = true;
  else if (act === "default") applyFolder(true);
  else if (act === "open") { try { await call("POST", "/api/open-folder", { which: b.dataset.which }); } catch (err) { toast(err.message); } }
  else if (act === "diagnose") runCheckup(b);
  else if (act === "copyreport") copyReport();
  else if (act === "update") {
    toast(L("Checking for updates…", "正在检查更新…"));
    try { window.__kitBridge.checkUpdate(); } catch (err) { toast(err.message); }
  }
});
document.addEventListener("change", (e) => {
  if (e.target.name === "lang" && e.target.value !== LANG) setLanguage(e.target.value);
});
$(".newdir").addEventListener("keydown", (e) => { if (e.key === "Enter") applyFolder(false); });

const canUpdate = !!(window.__kitBridge && window.__kitBridge.checkUpdate);
$('[data-act="update"]').hidden = !canUpdate;

load().then(async () => {
  const radio = document.querySelector(`input[name="lang"][value="${LANG}"]`);
  if (radio) radio.checked = true;
  await loadInfo();
  if (info0.move && info0.move.running) pollMove();
}).catch((e) => toast(L("Couldn't load the settings: ", "无法加载设置：") + e.message));
