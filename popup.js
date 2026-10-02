const $ = id => document.getElementById(id);

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function send(type, extra = {}) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url) throw new Error("找不到当前标签页");
  if (!/^https:\/\/(www\.)?(x\.com|twitter\.com)\//i.test(tab.url) || !/\/likes(?:[/?#]|$)/i.test(tab.url)) {
    throw new Error("请先打开 X 的 Likes 页面");
  }
  return chrome.tabs.sendMessage(tab.id, { type, ...extra });
}

function setStatus(text) {
  $("status").textContent = "状态：" + text;
}

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function getSelectedLimit() {
  const sel = $("limit").value;
  if (sel === "custom") {
    return Math.max(1, Math.min(100000, Number($("limitCustom").value) || 100));
  }
  return Math.max(1, Math.min(100000, Number(sel) || 100));
}

$("limit").addEventListener("change", () => {
  const isCustom = $("limit").value === "custom";
  $("limitCustomWrap").style.display = isCustom ? "block" : "none";
  if (!isCustom) $("limitDisplay").textContent = $("limit").value;
  else $("limitDisplay").textContent = $("limitCustom").value || "";
});

$("limitCustom").addEventListener("input", () => {
  $("limitDisplay").textContent = $("limitCustom").value || "";
});

function applyStatus(r) {
  if (!r) return;
  const count = r.count ?? 0;
  const limit = r.limit ?? getSelectedLimit();
  $("count").textContent = count;
  $("limitDisplay").textContent = limit;
  const pct = limit > 0 ? Math.min(100, (count / limit) * 100) : 0;
  $("bar").style.width = pct + "%";
  $("discovered").textContent = r.discovered ?? 0;
  $("elapsed").textContent = formatElapsed(r.elapsedMs);
  if (r.state) setStatus(r.state);
}

async function updateFromPage() {
  try {
    const r = await send("GET_STATUS");
    applyStatus(r);
  } catch {}
}

$("start").addEventListener("click", async () => {
  try {
    const speed = Number($("speed").value);
    const limit = getSelectedLimit();
    const r = await send("START_CLEANUP", { speed, limit });
    if (r) applyStatus(r);
    if (r?.message) setStatus(r.message);
    updateFromPage();
  } catch (e) {
    setStatus(e.message || "启动失败");
  }
});

$("pause").addEventListener("click", async () => {
  try {
    const r = await send("PAUSE_CLEANUP");
    if (r) applyStatus(r);
    if (r?.message) setStatus(r.message);
    updateFromPage();
  } catch (e) {
    setStatus(e.message || "暂停失败");
  }
});

$("stop").addEventListener("click", async () => {
  try {
    const r = await send("STOP_CLEANUP");
    if (r) applyStatus(r);
    if (r?.message) setStatus(r.message);
    updateFromPage();
  } catch (e) {
    setStatus(e.message || "停止失败");
  }
});

setInterval(updateFromPage, 600);
updateFromPage();
