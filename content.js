(() => {
  let running = false;
  let paused = false;
  let count = 0;
  let limit = 100;
  let baseDelay = 650;
  let noProgressRounds = 0;

  // 0.3.0 新增：已发现帖子（去重，基于帖子 status 链接） + 运行时间统计
  let discovered = new Set();
  let elapsedAccumulatedMs = 0; // 已暂停/停止前累计的运行时长
  let segmentStart = null;      // 当前这一段"运行中"从什么时候开始计时

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function isLikesPage() {
    return /\/likes(?:[/?#]|$)/i.test(location.pathname);
  }

  // ---- 以下为 0.2.0 已验证的核心查找逻辑，未改动判断条件 ----
  function getUnlikeButtons() {
    const result = [];
    const seen = new Set();

    document.querySelectorAll('button[data-testid="unlike"]').forEach(btn => {
      if (!seen.has(btn) && btn.isConnected && !btn.disabled) {
        seen.add(btn);
        result.push(btn);
      }
    });

    document.querySelectorAll('button[aria-label]').forEach(btn => {
      const label = (btn.getAttribute("aria-label") || "").trim().toLowerCase();
      if ((label === "unlike" || label === "liked") && !seen.has(btn) && btn.isConnected && !btn.disabled) {
        seen.add(btn);
        result.push(btn);
      }
    });

    return result;
  }

  // 0.3.0 新增：扫描当前页面已经加载出来的帖子数量（用于"已发现"展示，不代表账号总数）
  function scanDiscovered() {
    document.querySelectorAll('article').forEach(article => {
      const link = article.querySelector('a[href*="/status/"]');
      if (!link) return;
      const m = link.getAttribute("href").match(/status\/(\d+)/);
      if (m) discovered.add(m[1]);
    });
  }

  function currentElapsedMs() {
    if (running && !paused && segmentStart) {
      return elapsedAccumulatedMs + (Date.now() - segmentStart);
    }
    return elapsedAccumulatedMs;
  }

  function pauseTiming() {
    if (segmentStart) {
      elapsedAccumulatedMs += Date.now() - segmentStart;
      segmentStart = null;
    }
  }

  function resumeTiming() {
    segmentStart = Date.now();
  }

  function stateText() {
    if (running && !paused) return `运行中 · 已取消 ${count} 个`;
    if (paused) return `已暂停 · 已取消 ${count} 个`;
    return `已停止 · 已取消 ${count} 个`;
  }

  function statusPayload() {
    return {
      count,
      limit,
      discovered: discovered.size,
      elapsedMs: currentElapsedMs(),
      running,
      paused,
      state: stateText()
    };
  }

  function postStatus() {
    chrome.runtime.sendMessage({ type: "PROGRESS", ...statusPayload() }).catch(() => {});
  }

  async function waitWhilePaused() {
    while (paused && running) await sleep(250);
  }

  async function run() {
    if (running) return;
    if (!isLikesPage()) return;
    running = true;
    paused = false;
    noProgressRounds = 0;
    elapsedAccumulatedMs = 0;
    segmentStart = Date.now();
    scanDiscovered();
    postStatus();

    while (running) {
      if (count >= limit) {
        running = false;
        pauseTiming();
        postStatus();
        alert(`本轮已达到上限：${count} 个。`);
        break;
      }

      await waitWhilePaused();
      if (!running) break;

      scanDiscovered();
      const buttons = getUnlikeButtons();

      if (buttons.length) {
        // 每轮只处理当前 DOM 中第一个可用按钮，避免页面状态在重渲染时乱掉。
        const btn = buttons[0];
        try {
          btn.scrollIntoView({ block: "center", behavior: "auto" });
          await sleep(120);
          if (!running) break;

          btn.click();
          count++;
          noProgressRounds = 0;
          postStatus();

          // 用户可调速度，但始终保留一个明显的停顿；不做并发狂点。
          const jitter = Math.floor(Math.random() * 350);
          await sleep(baseDelay + jitter);
        } catch (e) {
          console.warn("[X Likes Cleaner] click failed:", e);
          await sleep(600);
        }
        continue;
      }

      // 当前页面没有可取消的 Like：向下滚动，让 X 加载更多。
      const beforeHeight = document.documentElement.scrollHeight;
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      await sleep(1200);
      scanDiscovered();

      const afterHeight = document.documentElement.scrollHeight;
      const stillNone = getUnlikeButtons().length === 0;

      if (afterHeight <= beforeHeight && stillNone) {
        noProgressRounds++;
      } else {
        noProgressRounds = 0;
      }

      if (noProgressRounds >= 3) {
        running = false;
        pauseTiming();
        postStatus();
        alert(`本轮结束：没有发现更多可取消的 Likes。\n已取消 ${count} 个。`);
      }
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "START_CLEANUP") {
      if (!isLikesPage()) {
        sendResponse({ message: "请先打开 X 的 Likes 页面。" });
        return;
      }
      limit = Math.max(1, Math.min(100000, Number(msg.limit) || 100));
      baseDelay = Math.max(450, Math.min(1500, Number(msg.speed) || 650));

      if (running) {
        if (paused) {
          paused = false;
          resumeTiming();
        }
        postStatus();
        sendResponse({ message: "已继续运行", ...statusPayload() });
        return true;
      }

      count = 0;
      discovered = new Set();
      paused = false;
      run();
      sendResponse({ message: "已开始" });
      return true;
    }

    if (msg?.type === "PAUSE_CLEANUP") {
      if (running && !paused) {
        paused = true;
        pauseTiming();
      }
      postStatus();
      sendResponse({ message: `已暂停 · 已取消 ${count} 个`, ...statusPayload() });
      return true;
    }

    if (msg?.type === "STOP_CLEANUP") {
      if (running) pauseTiming();
      running = false;
      paused = false;
      postStatus();
      sendResponse({ message: `已停止 · 已取消 ${count} 个`, ...statusPayload() });
      return true;
    }

    if (msg?.type === "GET_STATUS") {
      sendResponse(statusPayload());
      return true;
    }
  });

  console.log("[X Likes Cleaner 0.3.0] loaded");
})();
