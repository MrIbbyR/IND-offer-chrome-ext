// background.js — service worker: parallel keyword queue coordinator + tab cleanup (MV3)

/** Randomized delay — returns ms ± ~35% spread to avoid fixed-cadence bot detection. */
function jitter(baseMs) {
  const lo = Math.round(baseMs * 0.65);
  const hi = Math.round(baseMs * 1.35);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** Play a two-tone beep in an active SR tab (service worker has no AudioContext). */
async function playBeepInSRTab(returnUrl) {
  try {
    const urlPat = "*://*.smartrecruiters.com/*";
    const allTabs = await chrome.tabs.query({ url: urlPat });
    let tab = null;
    if (returnUrl) {
      const base = returnUrl.replace(/[?#].*$/, "");
      tab = allTabs.find(t => t.url && t.url.startsWith(base)) || null;
    }
    if (!tab) tab = allTabs.find(t => t.active) || allTabs[0] || null;
    if (!tab) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function () {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx) return;
          const ctx = new AudioCtx();
          function doPlay() {
            [880, 1100].forEach(function (freq, i) {
              const osc = ctx.createOscillator();
              const g = ctx.createGain();
              osc.connect(g); g.connect(ctx.destination);
              osc.type = "sine"; osc.frequency.value = freq;
              const t = ctx.currentTime + i * 0.22;
              g.gain.setValueAtTime(0, t);
              g.gain.linearRampToValueAtTime(0.28, t + 0.02);
              g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
              osc.start(t); osc.stop(t + 0.5);
            });
          }
          if (ctx.state === "suspended") ctx.resume().then(doPlay).catch(() => {});
          else doPlay();
        } catch (_) {}
      },
    });
  } catch (_) {}
}

function showNotification(id, title, message) {
  try {
    chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "icon.png",
      title: title,
      message: message,
      priority: 1,
    });
  } catch (_) {}
}

// ── Parallel queue state ──
let parallelQueue = null; // { urls: [], config: {}, workers: N, returnUrl, results: [], active: Map<tabId, url>, stopped: bool }

function resetParallelQueue() {
  if (parallelQueue && parallelQueue.active) {
    for (const tabId of parallelQueue.active.keys()) {
      try {
        chrome.tabs.remove(tabId).catch(() => {});
      } catch (_) {}
    }
  }
  parallelQueue = null;
}

async function launchNextWorker() {
  if (!parallelQueue || parallelQueue.stopped) return;
  if (!parallelQueue.urls.length) {
    if (parallelQueue.active.size === 0) finishParallelQueue();
    return;
  }
  if (parallelQueue.active.size >= parallelQueue.workers) return;

  const url = parallelQueue.urls.shift();
  try {
    const tab = await chrome.tabs.create({ url: url, active: false });
    parallelQueue.active.set(tab.id, url);
  } catch (e) {
    if (parallelQueue) parallelQueue.urls.unshift(url);
    setTimeout(launchNextWorker, jitter(1600));
  }
}

function finishParallelQueue() {
  if (!parallelQueue) return;
  const results = parallelQueue.results || [];
  const matched = results.filter(r => r.hitCount > 0).length;
  const returnUrl = parallelQueue.returnUrl || "";

  chrome.storage.local
    .set({
      keywordTriageLastRun: {
        finishedAt: Date.now(),
        results: results,
        parallel: true,
      },
      srParallelWorkerActive: false,
    })
    .catch(() => {});

  showNotification(
    "srParallelDone_" + Date.now(),
    "NIQ TA Helper — Keyword search done",
    matched + " profile" + (matched !== 1 ? "s" : "") + " matched out of " + results.length + " scanned."
  );
  playBeepInSRTab(returnUrl);

  parallelQueue = null;
}

// ── Message handler ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "srCloseExtraProfileTabs") {
    const keepId = sender.tab && sender.tab.id;
    chrome.tabs.query({ url: "*://*.smartrecruiters.com/*" }, (tabs) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      for (const t of tabs) {
        const u = t.url || "";
        if (!/\/app\/people\/(applications|profile)\//i.test(u)) continue;
        if (keepId != null && t.id === keepId) continue;
        chrome.tabs.remove(t.id).catch(() => {});
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "srStartParallelKeywordQueue") {
    resetParallelQueue();
    const urls = message.urls || [];
    const workers = Math.max(1, Math.min(5, message.workers || 2));
    const config = message.config || {};

    parallelQueue = {
      urls: urls.slice(),
      config: config,
      workers: workers,
      returnUrl: message.returnUrl || "",
      results: [],
      active: new Map(),
      stopped: false,
    };

    chrome.storage.local
      .set({
        srParallelWorkerConfig: config,
        srParallelWorkerActive: true,
      })
      .then(() => {
        let launched = 0;
        function staggerLaunch() {
          if (!parallelQueue || parallelQueue.stopped) return;
          if (launched >= workers || !parallelQueue.urls.length) return;
          launched++;
          launchNextWorker();
          if (launched < workers && parallelQueue.urls.length) {
            setTimeout(staggerLaunch, jitter(2800));
          }
        }
        staggerLaunch();
      })
      .catch(() => {});

    sendResponse({ ok: true, queued: urls.length, workers: workers });
    return true;
  }

  if (message.type === "srWorkerDone") {
    if (!parallelQueue) {
      sendResponse({ next: false });
      return true;
    }
    const tabId = sender.tab && sender.tab.id;
    const url = (tabId && parallelQueue.active.get(tabId)) || "";

    parallelQueue.results.push({
      url: url,
      hitCount: message.hitCount || 0,
      matchedKeywords: message.matchedKeywords || [],
      booleanPass: message.booleanPass,
      notesPosted: !!message.notesPosted,
    });

    if (tabId) parallelQueue.active.delete(tabId);

    if (parallelQueue.stopped || !parallelQueue.urls.length) {
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      if (parallelQueue.active.size === 0) finishParallelQueue();
      sendResponse({ next: false });
      return true;
    }

    const nextUrl = parallelQueue.urls.shift();
    parallelQueue.active.set(tabId, nextUrl);
    sendResponse({ next: true, url: nextUrl });
    setTimeout(() => {
      if (tabId) {
        chrome.tabs.update(tabId, { url: nextUrl }).catch(() => {
          if (parallelQueue) {
            parallelQueue.active.delete(tabId);
            parallelQueue.urls.unshift(nextUrl);
            launchNextWorker();
          }
        });
      }
    }, message.notesPosted ? jitter(2400) : jitter(1600));
    return true;
  }

  if (message.type === "srStopParallelKeywordQueue") {
    if (parallelQueue) {
      const doneCount = parallelQueue.results.length;
      parallelQueue.stopped = true;
      for (const tabId of parallelQueue.active.keys()) {
        chrome.tabs.remove(tabId).catch(() => {});
      }
      parallelQueue.active.clear();
      finishParallelQueue();
      showNotification(
        "srStopped_" + Date.now(),
        "NIQ TA Helper — Search stopped",
        "Stopped after " + doneCount + " profile" + (doneCount !== 1 ? "s" : "") + "."
      );
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "srQueueDone") {
    showNotification(
      "srQueueDone_" + Date.now(),
      "NIQ TA Helper — Keyword search done",
      (message.matchedLen || 0) + " profile" + (message.matchedLen !== 1 ? "s" : "") +
        " matched out of " + (message.resultsLen || 0) + " scanned."
    );
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "srIsParallelWorker") {
    const tabId = sender.tab && sender.tab.id;
    const active =
      !!(
        parallelQueue &&
        !parallelQueue.stopped &&
        tabId != null &&
        parallelQueue.active.has(tabId)
      );
    sendResponse({ active });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!parallelQueue || !parallelQueue.active.has(tabId)) return;
  const url = parallelQueue.active.get(tabId);
  parallelQueue.active.delete(tabId);
  parallelQueue.results.push({ url: url, error: "tab_closed" });
  setTimeout(() => launchNextWorker(), jitter(1800));
});
