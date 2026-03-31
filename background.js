// background.js — close duplicate SmartRecruiters profile tabs after Cost assist queue (MV3)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "srCloseExtraProfileTabs") {
    return;
  }
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
});
