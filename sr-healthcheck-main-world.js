// sr-healthcheck-main-world.js — Injected into the MAIN world via manifest so
// DevTools console can call __srDomHealthcheck() without switching context.
// Communicates with sr-selectors.js (isolated world) via CustomEvents.

(function () {
  "use strict";

  var lastResult = null;

  document.addEventListener("__sr_healthcheck_response", function (e) {
    try { lastResult = JSON.parse(e.detail); } catch (_) { lastResult = null; }
  });

  window.__srDomHealthcheck = function () {
    lastResult = null;
    document.dispatchEvent(new CustomEvent("__sr_healthcheck_request"));
    if (lastResult) return lastResult;
    console.log("%c[SR Healthcheck]%c No response — reload the page and try again.",
      "color:#ff9800;font-weight:bold", "color:inherit");
    return null;
  };
})();
