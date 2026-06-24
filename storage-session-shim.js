// storage-session-shim.js — thin async wrapper over chrome.storage.session
// Replaces sessionStorage for queue state (GDPR: extension-isolated)
(function () {
  "use strict";
  var STORAGE = (typeof chrome !== "undefined" && chrome.storage &&
                 chrome.storage.session) || null;

  globalThis.__srSessionGet = function (key) {
    if (!STORAGE) return Promise.resolve(null);
    return new Promise(function (resolve) {
      STORAGE.get([key], function (result) {
        // Surface access-denied (and any other) errors as a miss rather than
        // pretending success — see __srSessionSet for why this matters.
        var err = null;
        try { err = chrome.runtime.lastError; } catch (_) {}
        if (err) { resolve(null); return; }
        var val = result && result[key];
        resolve(val != null ? JSON.stringify(val) : null);
      });
    });
  };

  globalThis.__srSessionSet = function (key, jsonString) {
    if (!STORAGE) return Promise.resolve(false);
    var val;
    try { val = JSON.parse(jsonString); } catch (_) { return Promise.resolve(false); }
    var payload = {};
    payload[key] = val;
    return new Promise(function (resolve) {
      STORAGE.set(payload, function () {
        // chrome.storage.session exists in content scripts but writes are DENIED
        // until the background widens the access level (setAccessLevel). Must
        // resolve false on lastError — otherwise a denied write looks successful,
        // the page navigates, and the next page reads an empty queue and stalls.
        var err = null;
        try { err = chrome.runtime.lastError; } catch (_) {}
        resolve(!err);
      });
    });
  };

  globalThis.__srSessionRemove = function (key) {
    if (!STORAGE) return Promise.resolve();
    return new Promise(function (resolve) {
      STORAGE.remove([key], function () {
        try { void chrome.runtime.lastError; } catch (_) {}
        resolve();
      });
    });
  };
})();
