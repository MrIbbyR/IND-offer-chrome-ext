// background.js — service worker: parallel keyword queue coordinator + tab cleanup (MV3)

// GDPR: queue state lives in chrome.storage.session — extension-isolated, in-memory,
// cleared when the browser closes. Content scripts are "untrusted" contexts, so they
// can only read/write session storage after the access level is widened to include
// them. Without this, the *-core.js seed write is silently denied and the *-autorun.js
// content scripts read null, so no queue ever resumes.
// The access level does not reliably persist across service-worker restarts, so we
// re-apply it on every cold start AND expose an awaitable message (srEnsureSessionAccess)
// so the popup can guarantee it is set BEFORE triggering any content-script seed write.
function ensureSessionAccess() {
  return new Promise((resolve) => {
    try {
      chrome.storage.session.setAccessLevel(
        { accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" },
        () => { void chrome.runtime.lastError; resolve(true); }
      );
    } catch (_) { resolve(false); }
  });
}
ensureSessionAccess();
chrome.runtime.onInstalled.addListener(() => { ensureSessionAccess(); });
chrome.runtime.onStartup.addListener(() => { ensureSessionAccess(); });

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

// Persist remaining URLs + results so the queue survives MV3 service-worker restarts.
function persistQueueUrls() {
  if (!parallelQueue) return;
  // GDPR data-minimization: keep diagLog OUT of this intermediate, restart-survival
  // copy. It has no consumer here (the popup reads diagLog only from the final
  // keywordTriageLastRun, which is purged on a 24h TTL) and would otherwise orphan in
  // chrome.storage.local with no TTL if Chrome is closed mid-run. diagLog still flows
  // to the final results via the in-memory parallelQueue.results push in handleWorkerDone.
  const slimResults = parallelQueue.results.map((r) => {
    if (!r || !r.diagLog) return r;
    const { diagLog, ...rest } = r;
    return rest;
  });
  chrome.storage.local.set({
    srParallelQueueUrls: parallelQueue.urls.slice(),
    srParallelQueueResults: slimResults,
    srParallelQueueReturnUrl: parallelQueue.returnUrl,
    srParallelQueueWorkers: parallelQueue.workers,
    srParallelQueueStartedAt: parallelQueue.startedAt || Date.now(),
  }).catch(() => {});
}

function clearPersistedQueue() {
  chrome.storage.local.remove([
    "srParallelQueueUrls", "srParallelQueueResults",
    "srParallelQueueReturnUrl", "srParallelQueueWorkers",
    "srParallelQueueStartedAt",
  ]).catch(() => {});
}

function resetParallelQueue() {
  if (parallelQueue && parallelQueue.active) {
    for (const tabId of parallelQueue.active.keys()) {
      try {
        chrome.tabs.remove(tabId).catch(() => {});
      } catch (_) {}
    }
  }
  parallelQueue = null;
  clearPersistedQueue();
}

async function launchNextWorker() {
  if (!parallelQueue || parallelQueue.stopped) return;
  if (!parallelQueue.urls.length) {
    if (parallelQueue.active.size === 0) finishParallelQueue();
    return;
  }
  if (parallelQueue.active.size >= parallelQueue.workers) return;

  const url = parallelQueue.urls.shift();
  persistQueueUrls();
  try {
    const tab = await chrome.tabs.create({ url: url, active: false });
    parallelQueue.active.set(tab.id, url);
  } catch (e) {
    if (parallelQueue) { parallelQueue.urls.unshift(url); persistQueueUrls(); }
    setTimeout(launchNextWorker, jitter(1600));
  }
}

function finishParallelQueue() {
  if (!parallelQueue) return;
  const results = parallelQueue.results || [];
  const matched = results.filter(r => r.hitCount > 0).length;
  const returnUrl = parallelQueue.returnUrl || "";

  clearPersistedQueue();
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

// ── Worker done handler (extracted so it can be called after async queue restore) ──
function handleWorkerDone(message, sender, sendResponse) {
  if (!parallelQueue) { sendResponse({ next: false }); return; }
  const tabId = sender.tab && sender.tab.id;
  const url = (tabId && parallelQueue.active.get(tabId)) || "";

  parallelQueue.results.push({
    url: url,
    hitCount: message.hitCount || 0,
    matchedKeywords: message.matchedKeywords || [],
    booleanPass: message.booleanPass,
    notesPosted: !!message.notesPosted,
    notesFailReason: message.notesFailReason || "",
    textStats: message.textStats || null,
    diagLog: message.diagLog || undefined,
  });

  if (tabId) parallelQueue.active.delete(tabId);

  if (parallelQueue.stopped || !parallelQueue.urls.length) {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
    persistQueueUrls();
    if (parallelQueue.active.size === 0) finishParallelQueue();
    sendResponse({ next: false });
    return;
  }

  const nextUrl = parallelQueue.urls.shift();
  parallelQueue.active.set(tabId, nextUrl);
  persistQueueUrls();
  sendResponse({ next: true, url: nextUrl });
  setTimeout(() => {
    if (tabId) {
      chrome.tabs.update(tabId, { url: nextUrl }).catch(() => {
        if (parallelQueue) {
          parallelQueue.active.delete(tabId);
          parallelQueue.urls.unshift(nextUrl);
          persistQueueUrls();
          launchNextWorker();
        }
      });
    }
  }, message.notesPosted ? jitter(2400) : jitter(1600));
}

// ── Resume-render focus manager ──
// pdf.js does NOT render in hidden (background) worker tabs — Chrome pauses
// requestAnimationFrame when document.visibilityState === "hidden", so the resume
// text layer never appears and extraction falls back to SR's profile chrome. To get
// the real resume we briefly foreground the worker tab while it reads the PDF, then
// restore the user's tab. Serialized: only one worker holds focus at a time, and
// focus hands off directly between workers so the user's tab isn't bounced each pass.
const resumeFocus = {
  holder: null,     // tabId currently foregrounded for resume rendering
  userTabId: null,  // the user's tab to restore once no worker needs focus
  queue: [],        // pending [{ tabId, resolve }]
  timer: null,      // safety auto-release (content script may never send release)
};

function _grantResumeFocus(tabId) {
  resumeFocus.holder = tabId;
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    chrome.tabs.update(tabId, { active: true }).catch(() => {});
    // The window must also be focused for visibilityState to become "visible".
    chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  });
  clearTimeout(resumeFocus.timer);
  resumeFocus.timer = setTimeout(() => releaseResumeFocus(tabId), 25000);
}

function acquireResumeFocus(tabId) {
  return new Promise((resolve) => {
    if (resumeFocus.holder === tabId) { resolve(); return; }
    if (resumeFocus.holder != null) { resumeFocus.queue.push({ tabId, resolve }); return; }
    // First steal — remember the user's (non-worker) tab so we can restore it later.
    if (resumeFocus.userTabId == null) {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const t = tabs && tabs[0];
        if (t && !(parallelQueue && parallelQueue.active.has(t.id))) resumeFocus.userTabId = t.id;
        _grantResumeFocus(tabId);
        resolve();
      });
      return;
    }
    _grantResumeFocus(tabId);
    resolve();
  });
}

function releaseResumeFocus(tabId) {
  if (resumeFocus.holder !== tabId) {
    // Tab was queued but never got focus — drop it from the queue.
    resumeFocus.queue = resumeFocus.queue.filter((q) => q.tabId !== tabId);
    return;
  }
  clearTimeout(resumeFocus.timer);
  resumeFocus.holder = null;
  const next = resumeFocus.queue.shift();
  if (next) {
    _grantResumeFocus(next.tabId);
    next.resolve();
  } else if (resumeFocus.userTabId != null) {
    // Nobody waiting — restore the user's tab.
    chrome.tabs.update(resumeFocus.userTabId, { active: true }).catch(() => {});
    resumeFocus.userTabId = null;
  }
}

// ── Resume attachment fallback ──
// When the inline resume viewer never renders (even with foreground focus), the
// content script clicks the "Resume" attachment, which opens the full resume in a
// NEW tab. A content script can't read another tab's DOM, so the background catches
// that tab (by openerTabId), foregrounds it so pdf.js renders, extracts the text via
// chrome.scripting, closes it, and hands the text back to the worker.
const resumeCapture = {
  pending: new Map(), // workerTabId -> { armedAt, priorActiveTabId }
  results: new Map(), // workerTabId -> { done, text }
};

// Injected into the resume tab (all frames). Prefers pdf.js text-layer spans, else
// a shadow-piercing text walk. Self-contained — runs in the page's isolated world.
function _extractResumeTextInPage() {
  try {
    var spans = document.querySelectorAll('.textLayer span, [class*="textLayer"] span');
    if (spans.length > 20) {
      var parts = [];
      for (var i = 0; i < spans.length; i++) { var t = (spans[i].textContent || "").trim(); if (t) parts.push(t); }
      if (parts.join(" ").length > 200) return parts.join(" ");
    }
  } catch (_) {}
  function deepText(root) {
    var out = [], seen = new Set();
    (function walk(n) {
      if (!n || seen.has(n)) return; seen.add(n);
      if (n.nodeType === 3) { var t = (n.nodeValue || "").trim(); if (t) out.push(t); return; }
      if (n.shadowRoot) walk(n.shadowRoot);
      var k = n.childNodes; if (k) for (var i = 0; i < k.length; i++) walk(k[i]);
    })(root);
    return out.join(" ");
  }
  try { return deepText(document.body || document.documentElement); } catch (_) { return ""; }
}

async function captureResumeFromTab(workerTabId, resumeTabId) {
  const info = resumeCapture.pending.get(workerTabId) || {};
  let text = "";
  try {
    // Wait for the resume tab to finish loading.
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; chrome.tabs.onUpdated.removeListener(onUpd); clearTimeout(to); resolve(); } };
      const to = setTimeout(finish, 10000);
      function onUpd(tid, ch) { if (tid === resumeTabId && ch.status === "complete") finish(); }
      chrome.tabs.onUpdated.addListener(onUpd);
      chrome.tabs.get(resumeTabId, (t) => { if (!chrome.runtime.lastError && t && t.status === "complete") finish(); });
    });
    // Foreground so pdf.js renders, then give it time to paint the text layer.
    await chrome.tabs.update(resumeTabId, { active: true }).catch(() => {});
    const rt = await chrome.tabs.get(resumeTabId).catch(() => null);
    if (rt) await chrome.windows.update(rt.windowId, { focused: true }).catch(() => {});
    await new Promise((r) => setTimeout(r, 6000));
    let results = [];
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: resumeTabId, allFrames: true },
        func: _extractResumeTextInPage,
      });
    } catch (_) {}
    for (const r of results || []) { if (r && r.result && r.result.length > text.length) text = r.result; }
  } catch (_) {}
  try { await chrome.tabs.remove(resumeTabId); } catch (_) {}
  if (info.priorActiveTabId != null) chrome.tabs.update(info.priorActiveTabId, { active: true }).catch(() => {});
  resumeCapture.results.set(workerTabId, { done: true, text: text });
  resumeCapture.pending.delete(workerTabId);
}

chrome.tabs.onCreated.addListener((tab) => {
  const opener = tab.openerTabId;
  if (opener != null && resumeCapture.pending.has(opener)) {
    captureResumeFromTab(opener, tab.id);
  }
});

// ── Message handler ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "srEnsureSessionAccess") {
    // Popup awaits this before seeding a queue so the content-script write to
    // chrome.storage.session is not denied by a not-yet-applied access level.
    ensureSessionAccess().then((ok) => sendResponse({ ok }));
    return true;
  }

  if (message.type === "srArmResumeCapture") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) { sendResponse({ ok: false }); return; }
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const prior = tabs && tabs[0] ? tabs[0].id : null;
      resumeCapture.pending.set(tabId, { armedAt: Date.now(), priorActiveTabId: prior });
      resumeCapture.results.delete(tabId);
      // Expire a stale arm if the expected tab never opened.
      setTimeout(() => {
        const p = resumeCapture.pending.get(tabId);
        if (p && Date.now() - p.armedAt >= 14000) resumeCapture.pending.delete(tabId);
      }, 15000);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "srGetResumeCapture") {
    const tabId = sender.tab && sender.tab.id;
    const res = tabId != null ? resumeCapture.results.get(tabId) : null;
    if (res && res.done) { resumeCapture.results.delete(tabId); sendResponse({ done: true, text: res.text }); }
    else sendResponse({ done: false });
    return true;
  }

  if (message.type === "srRequestResumeFocus") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) { sendResponse({ ok: false }); return; }
    acquireResumeFocus(tabId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "srReleaseResumeFocus") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId != null) releaseResumeFocus(tabId);
    sendResponse({ ok: true });
    return true;
  }

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
      startedAt: Date.now(),
    };

    chrome.storage.local
      .set({
        srParallelWorkerConfig: config,
        srParallelWorkerActive: true,
        srParallelQueueStartedAt: parallelQueue.startedAt,
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
    // If the service worker was killed and restarted, parallelQueue is null.
    // Try to restore from persisted storage so the run can continue.
    if (!parallelQueue) {
      chrome.storage.local.get(
        ["srParallelWorkerActive", "srParallelWorkerConfig", "srParallelQueueUrls",
         "srParallelQueueResults", "srParallelQueueReturnUrl", "srParallelQueueWorkers",
         "srParallelQueueStartedAt"],
        (stored) => {
          if (chrome.runtime.lastError || !stored.srParallelWorkerActive || !stored.srParallelQueueUrls) {
            sendResponse({ next: false });
            return;
          }
          // GDPR: abandon stale queues (e.g. Chrome closed mid-run) so candidate
          // URLs/results don't persist indefinitely. No real run exceeds 2 hours.
          const startedAt = stored.srParallelQueueStartedAt || 0;
          if (startedAt && Date.now() - startedAt > 2 * 60 * 60 * 1000) {
            clearPersistedQueue();
            chrome.storage.local.set({ srParallelWorkerActive: false }).catch(() => {});
            sendResponse({ next: false });
            return;
          }
          parallelQueue = {
            urls: stored.srParallelQueueUrls,
            config: stored.srParallelWorkerConfig || {},
            workers: stored.srParallelQueueWorkers || 2,
            returnUrl: stored.srParallelQueueReturnUrl || "",
            results: stored.srParallelQueueResults || [],
            active: new Map(),
            stopped: false,
            startedAt: startedAt || Date.now(),
          };
          handleWorkerDone(message, sender, sendResponse);
        }
      );
      return true;
    }
    handleWorkerDone(message, sender, sendResponse);
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
  // Free the resume-focus lock if a holding/queued worker tab is closed.
  if (resumeFocus.holder === tabId || resumeFocus.queue.some((q) => q.tabId === tabId)) {
    releaseResumeFocus(tabId);
  }
  if (!parallelQueue || !parallelQueue.active.has(tabId)) return;
  const url = parallelQueue.active.get(tabId);
  parallelQueue.active.delete(tabId);
  parallelQueue.results.push({ url: url, error: "tab_closed" });
  setTimeout(() => launchNextWorker(), jitter(1800));
});
