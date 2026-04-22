// background.js — service worker: parallel keyword queue coordinator + tab cleanup (MV3)

/** Randomized delay — returns ms ± ~35% spread to avoid fixed-cadence bot detection. */
function jitter(baseMs) {
  const lo = Math.round(baseMs * 0.65);
  const hi = Math.round(baseMs * 1.35);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

// ── Parallel queue state ──
let parallelQueue = null; // { urls: [], config: {}, workers: N, returnUrl, results: [], active: Map<tabId, url>, stopped: bool }

function resetParallelQueue() {
  if (parallelQueue && parallelQueue.active) {
    for (const tabId of parallelQueue.active.keys()) {
      try { chrome.tabs.remove(tabId).catch(() => {}); } catch (_) {}
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
    parallelQueue.results.push({ url: url, error: "tab_create_failed: " + (e && e.message) });
    // Try next with jittered delay
    setTimeout(launchNextWorker, jitter(800));
  }
}

function finishParallelQueue() {
  if (!parallelQueue) return;
  const results = parallelQueue.results || [];
  const returnUrl = parallelQueue.returnUrl;

  chrome.storage.local.set({
    keywordTriageLastRun: {
      finishedAt: Date.now(),
      results: results,
      parallel: true,
    },
  }).catch(() => {});

  parallelQueue = null;
}

// ── Message handler ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Close extra profile tabs (existing)
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

  // Start parallel keyword queue
  if (message.type === "srStartParallelKeywordQueue") {
    resetParallelQueue();
    const urls = message.urls || [];
    const workers = Math.max(1, Math.min(3, message.workers || 2));
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

    // Store config so worker tabs can read it
    chrome.storage.local.set({
      srParallelWorkerConfig: config,
      srParallelWorkerActive: true,
    }).then(() => {
      // Stagger tab opens with randomized delays to avoid DataDome triggers
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
    }).catch(() => {});

    sendResponse({ ok: true, queued: urls.length, workers: workers });
    return true;
  }

  // Worker tab finished scanning a profile
  if (message.type === "srWorkerDone") {
    if (!parallelQueue) { sendResponse({ next: false }); return true; }
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
      // Close this worker tab
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      if (parallelQueue.active.size === 0) finishParallelQueue();
      sendResponse({ next: false });
      return true;
    }

    // Assign next URL to this same tab (reuse tab to avoid DataDome)
    const nextUrl = parallelQueue.urls.shift();
    parallelQueue.active.set(tabId, nextUrl);
    sendResponse({ next: true, url: nextUrl });
    // Navigate the tab after a randomized delay
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
    }, jitter(2200));
    return true;
  }

  // Stop parallel queue
  if (message.type === "srStopParallelKeywordQueue") {
    if (parallelQueue) {
      parallelQueue.stopped = true;
      for (const tabId of parallelQueue.active.keys()) {
        chrome.tabs.remove(tabId).catch(() => {});
      }
      parallelQueue.active.clear();
      finishParallelQueue();
    }
    sendResponse({ ok: true });
    return true;
  }

  // Check if parallel queue is active (for autorun to detect worker mode)
  if (message.type === "srIsParallelWorker") {
    sendResponse({ active: !!(parallelQueue && !parallelQueue.stopped) });
    return true;
  }
});

// Clean up if a worker tab is closed unexpectedly
chrome.tabs.onRemoved.addListener((tabId) => {
  if (!parallelQueue || !parallelQueue.active.has(tabId)) return;
  const url = parallelQueue.active.get(tabId);
  parallelQueue.active.delete(tabId);
  parallelQueue.results.push({ url: url, error: "tab_closed" });
  // Launch replacement worker after randomized delay
  setTimeout(() => launchNextWorker(), jitter(1800));
});
