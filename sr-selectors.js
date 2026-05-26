// sr-selectors.js — Central registry of every SmartRecruiters DOM selector this extension depends on.
// Loaded as a content script before the core files.  Provides:
//   globalThis.__SR_SEL        – the selector table (read-only reference)
//   globalThis.__srDomHealthcheck(doc?)  – validate selectors against the live DOM

(function () {
  "use strict";

  // ── Selector table ──────────────────────────────────────────────────
  // Each entry: { sel, desc, critical, expect }
  //   sel      — CSS selector string -or- array of fallback selectors
  //   desc     — human-readable purpose (shown in healthcheck output)
  //   critical — true if a failure here breaks a core feature
  //   expect   — optional: { tag, role } the matched element SHOULD have
  //              (healthcheck warns when the element exists but type changed)

  var SEL = {

    // ── Page structure ──
    candidateView:    { sel: "#st-candidateView",    desc: "Candidate view root container",        critical: true  },
    jobDetailsPage:   { sel: "#st-jobDetailsPage",   desc: "Job details / applicant list page",    critical: false },

    // ── Pipeline controls ──
    moveForward:      { sel: "#st-moveForward",      desc: "Move Forward pipeline button",         critical: true  },
    screening:        { sel: "#st-screening",         desc: "Screening questions tab/section",      critical: true  },

    // ── Notes ──
    notesSection: {
      sel: ["#st-notes", '[data-test="notes"]', "sr-notes", "app-notes"],
      desc: "Notes tab or section",
      critical: true,
      expect: { notTag: "spl-tab", notRole: "tab" },
    },
    notesFormElement: {
      sel: '[id^="spl-form-element_"]',
      desc: "SPL form element wrapping notes input + Post button",
      critical: true,
    },
    noteTypeDropdown: {
      sel: "spl-dropdown",
      desc: "Note-type dropdown (Open note / Note to self) inside form element",
      critical: true,
      matchText: /\bnote\b/i,
    },
    notesPostButton: {
      sel: "spl-button",
      desc: "Post button (outside any spl-dropdown, text = Post)",
      critical: true,
      matchText: /^post$/i,
    },
    notesTextarea: {
      sel: "textarea",
      desc: "Notes textarea (may be hidden; contenteditable may replace it)",
      critical: false,
    },
    notesContentEditable: {
      sel: '[contenteditable="true"], div[role="textbox"]',
      desc: "Notes contenteditable input (replaces textarea in newer SR)",
      critical: true,
    },

    // ── Resume viewer ──
    resumeViewer: {
      sel: ["sr-resume-viewer", "sr-candidate-resume", "sr-resume",
            '[data-testid*="resume"]', '[data-testid*="Resume"]',
            '[class*="resume"]', '[id*="resume"]'],
      desc: "Resume viewer / container",
      critical: true,
    },
    pdfTextLayer: {
      sel: [".textLayer span", '[class*="textLayer"] span',
            '[class*="text-layer"] span', ".pdfViewer .page .textLayer span"],
      desc: "pdf.js text layer spans (canvas-rendered resumes)",
      critical: false,
    },

    // ── Candidate header ──
    candidateHeader: {
      sel: ["sr-candidate-header", '[data-testid="candidate-header"]',
            '[data-testid*="candidateHeader"]', '[class*="candidate-header"]',
            '[class*="candidateHeader"]', '[class*="candidate-name"]',
            '[class*="candidateName"]', '[data-testid*="candidate-name"]',
            "sr-candidate-summary", '[class*="candidate-summary"]',
            '[class*="candidateSummary"]'],
      desc: "Candidate header (name, title, top bar)",
      critical: false,
    },

    // ── Profile sections ──
    profileOverview: {
      sel: ['[data-testid*="profile"]', '[data-testid*="Profile"]',
            '[class*="profile"]', '[id*="profile"]',
            '[data-testid*="overview"]', '[class*="overview"]',
            '[class*="skills"]', '[class*="summary"]',
            '[class*="experience"]', '[class*="education"]',
            "sr-candidate-profile", "sr-candidate-details",
            "sr-candidate-overview"],
      desc: "Profile overview sections (skills, experience, education)",
      critical: false,
    },

    // ── Tabs ──
    resumeTab: {
      sel: ['button[data-testid="resume-tab"]', 'button[data-testid="Resume"]',
            '[role="tab"]', 'a[href*="resume"]'],
      desc: "Resume tab button",
      critical: true,
      matchText: /resume|résumé|cv/i,
    },

    // ── Applicant list ──
    applicantName: {
      sel: ['[data-test="applicant-name"]', "spl-truncate.applicant-name--name-truncate"],
      desc: "Applicant name element in list view",
      critical: false,
    },
    applicantLinks: {
      sel: 'a[href*="/app/people/applications/"], a[href*="/app/people/profile/"], sr-link[href*="/app/people/"]',
      desc: "Profile links in applicant table",
      critical: false,
    },

    // ── Excluded regions (stripped from keyword scan) ──
    excludedSidebar: {
      sel: ["sr-job-application-sidebar", "sr-job-application-details",
            "sr-job-application-overview", '[class*="job-application-sidebar"]',
            '[class*="job-application-details"]'],
      desc: "Sidebar / job metadata regions excluded from keyword scan",
      critical: false,
    },
  };

  // ── Healthcheck ─────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    try {
      var s = (el.ownerDocument.defaultView || window).getComputedStyle(el);
      if (!s || s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (_) { return false; }
  }

  function getDeepText(el) {
    var t = "";
    try { t = (el.textContent || el.innerText || "").replace(/\s+/g, " ").trim(); } catch (_) {}
    if (!t && el.shadowRoot) {
      try { t = (el.shadowRoot.textContent || "").replace(/\s+/g, " ").trim(); } catch (_) {}
    }
    return t;
  }

  function queryFirst(doc, selOrArray) {
    var sels = Array.isArray(selOrArray) ? selOrArray : [selOrArray];
    for (var i = 0; i < sels.length; i++) {
      try {
        var el = doc.querySelector(sels[i]);
        if (el) return { el: el, selector: sels[i] };
      } catch (_) {}
    }
    return null;
  }

  function queryAll(doc, selOrArray) {
    var sels = Array.isArray(selOrArray) ? selOrArray : [selOrArray];
    var out = [];
    for (var i = 0; i < sels.length; i++) {
      try {
        var els = doc.querySelectorAll(sels[i]);
        for (var j = 0; j < els.length; j++) out.push({ el: els[j], selector: sels[i] });
      } catch (_) {}
    }
    return out;
  }

  function runHealthcheck(doc) {
    doc = doc || document;
    var results = [];
    var keys = Object.keys(SEL);

    for (var k = 0; k < keys.length; k++) {
      var name = keys[k];
      var entry = SEL[name];
      var found = queryFirst(doc, entry.sel);
      var allFound = queryAll(doc, entry.sel);
      var status = "MISSING";
      var detail = "";
      var warn = false;

      if (found) {
        var el = found.el;
        var tag = (el.tagName || "").toLowerCase();
        var role = el.getAttribute ? el.getAttribute("role") : null;
        var vis = isVisible(el);
        var hasShadow = !!el.shadowRoot;
        status = vis ? "OK" : "HIDDEN";
        detail = "<" + tag + "> via " + found.selector + " (visible=" + vis + ", shadow=" + hasShadow + ", count=" + allFound.length + ")";

        if (entry.expect) {
          if (entry.expect.notTag && tag === entry.expect.notTag) {
            warn = true;
            detail += " ⚠ UNEXPECTED TAG (expected NOT " + entry.expect.notTag + ")";
          }
          if (entry.expect.notRole && role === entry.expect.notRole) {
            warn = true;
            detail += " ⚠ UNEXPECTED ROLE (expected NOT " + entry.expect.notRole + ")";
          }
          if (entry.expect.tag && tag !== entry.expect.tag) {
            warn = true;
            detail += " ⚠ WRONG TAG (expected " + entry.expect.tag + ", got " + tag + ")";
          }
        }

        if (entry.matchText) {
          var foundTextMatch = false;
          for (var ai = 0; ai < allFound.length; ai++) {
            if (entry.matchText.test(getDeepText(allFound[ai].el))) { foundTextMatch = true; break; }
          }
          if (!foundTextMatch) {
            warn = true;
            detail += " ⚠ NO ELEMENT MATCHES TEXT " + entry.matchText;
          }
        }
      }

      results.push({
        name: name,
        desc: entry.desc,
        critical: !!entry.critical,
        status: status,
        warn: warn,
        detail: detail,
      });
    }

    return results;
  }

  function printHealthcheck(doc) {
    var results = runHealthcheck(doc);
    var missing = 0;
    var warnings = 0;

    console.log("%c SR DOM Healthcheck ", "background:#1a1a2e;color:#6ea8ff;font-size:14px;font-weight:bold;padding:4px 8px;border-radius:4px");
    console.log("");

    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var icon = r.status === "OK" ? "✓" : r.status === "HIDDEN" ? "◌" : "✗";
      var color = r.status === "OK" && !r.warn ? "color:#4caf50" : r.status === "MISSING" ? "color:#f44336" : "color:#ff9800";
      var crit = r.critical ? " [CRITICAL]" : "";
      console.log(
        "%c" + icon + " " + r.name + "%c " + r.desc + crit + (r.detail ? "\n    " + r.detail : ""),
        color + ";font-weight:bold", "color:inherit"
      );
      if (r.status === "MISSING") missing++;
      if (r.warn) warnings++;
    }

    console.log("");
    var summary = results.length + " selectors checked — " + missing + " missing, " + warnings + " warnings";
    var critMissing = results.filter(function (r) { return r.critical && r.status === "MISSING"; });
    if (critMissing.length) {
      summary += " — " + critMissing.length + " CRITICAL MISSING: " + critMissing.map(function (r) { return r.name; }).join(", ");
    }
    console.log("%c" + summary, missing > 0 || warnings > 0 ? "color:#ff9800;font-weight:bold" : "color:#4caf50");

    return { total: results.length, missing: missing, warnings: warnings, criticalMissing: critMissing.length, results: results };
  }

  // ── Exports (content-script isolated world) ──────────────────────────

  globalThis.__SR_SEL = SEL;
  globalThis.__srDomHealthcheck = printHealthcheck;
  globalThis.__srDomHealthcheckRaw = runHealthcheck;

  // ── Inject into page main world so DevTools console can call it ──────
  // Content scripts live in an isolated JS world; the console can't see
  // their globals.  We inject a <script> containing the full healthcheck
  // (self-contained — no closure references) so typing
  //   __srDomHealthcheck()
  // in the console just works.
  try {
    var pageScript = document.createElement("script");
    pageScript.textContent = "(" + (function () {
      /* ---- BEGIN page-world healthcheck (must be fully self-contained) ---- */

      var SEL = {
        candidateView:      { sel: "#st-candidateView",                    desc: "Candidate view root container",         critical: true  },
        jobDetailsPage:     { sel: "#st-jobDetailsPage",                   desc: "Job details / applicant list page",     critical: false },
        moveForward:        { sel: "#st-moveForward",                      desc: "Move Forward pipeline button",          critical: true  },
        screening:          { sel: "#st-screening",                        desc: "Screening questions tab/section",       critical: true  },
        notesSection:       { sel: ["#st-notes", '[data-test="notes"]', "sr-notes", "app-notes"],
                              desc: "Notes tab or section",                critical: true,
                              expect: { notTag: "spl-tab", notRole: "tab" } },
        notesFormElement:   { sel: '[id^="spl-form-element_"]',            desc: "SPL form element (notes input + Post)", critical: true  },
        noteTypeDropdown:   { sel: "spl-dropdown",                         desc: "Note-type dropdown (Open note / Note to self)", critical: true, matchText: /\bnote\b/i },
        notesPostButton:    { sel: "spl-button",                           desc: "Post button (text = Post)",             critical: true, matchText: /^post$/i },
        notesContentEditable: { sel: '[contenteditable="true"], div[role="textbox"]',
                              desc: "Notes contenteditable input",         critical: true  },
        resumeViewer:       { sel: ["sr-resume-viewer", "sr-candidate-resume", "sr-resume",
                                    '[data-testid*="resume"]', '[class*="resume"]'],
                              desc: "Resume viewer / container",           critical: true  },
        pdfTextLayer:       { sel: [".textLayer span", '[class*="textLayer"] span'],
                              desc: "pdf.js text layer spans",             critical: false },
        candidateHeader:    { sel: ["sr-candidate-header", '[data-testid="candidate-header"]',
                                    '[class*="candidate-header"]', "sr-candidate-summary"],
                              desc: "Candidate header (name, title)",      critical: false },
        profileOverview:    { sel: ['[data-testid*="profile"]', '[class*="profile"]',
                                    '[class*="skills"]', '[class*="experience"]',
                                    "sr-candidate-profile", "sr-candidate-details"],
                              desc: "Profile overview sections",           critical: false },
        resumeTab:          { sel: ['button[data-testid="resume-tab"]', '[role="tab"]'],
                              desc: "Resume tab button",                   critical: true, matchText: /resume|résumé|cv/i },
        applicantName:      { sel: ['[data-test="applicant-name"]', "spl-truncate.applicant-name--name-truncate"],
                              desc: "Applicant name in list view",         critical: false },
      };

      function isVisible(el) {
        if (!el) return false;
        try {
          var s = getComputedStyle(el);
          if (!s || s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
          var r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        } catch (_) { return false; }
      }

      function getDeepText(el) {
        var t = "";
        try { t = (el.textContent || el.innerText || "").replace(/\s+/g, " ").trim(); } catch (_) {}
        if (!t && el.shadowRoot) {
          try { t = (el.shadowRoot.textContent || "").replace(/\s+/g, " ").trim(); } catch (_) {}
        }
        return t;
      }

      function queryFirst(doc, selOrArray) {
        var sels = Array.isArray(selOrArray) ? selOrArray : [selOrArray];
        for (var i = 0; i < sels.length; i++) {
          try { var el = doc.querySelector(sels[i]); if (el) return { el: el, selector: sels[i] }; } catch (_) {}
        }
        return null;
      }

      function queryAll(doc, selOrArray) {
        var sels = Array.isArray(selOrArray) ? selOrArray : [selOrArray];
        var out = [];
        for (var i = 0; i < sels.length; i++) {
          try { var els = doc.querySelectorAll(sels[i]); for (var j = 0; j < els.length; j++) out.push({ el: els[j], selector: sels[i] }); } catch (_) {}
        }
        return out;
      }

      function runCheck(doc) {
        doc = doc || document;
        var results = [];
        var keys = Object.keys(SEL);
        for (var k = 0; k < keys.length; k++) {
          var name = keys[k], entry = SEL[name];
          var found = queryFirst(doc, entry.sel);
          var allFound = queryAll(doc, entry.sel);
          var status = "MISSING", detail = "", warn = false;
          if (found) {
            var el = found.el, tag = (el.tagName || "").toLowerCase();
            var role = el.getAttribute ? el.getAttribute("role") : null;
            var vis = isVisible(el), hasShadow = !!el.shadowRoot;
            status = vis ? "OK" : "HIDDEN";
            detail = "<" + tag + "> via " + found.selector + " (visible=" + vis + ", shadow=" + hasShadow + ", count=" + allFound.length + ")";
            if (entry.expect) {
              if (entry.expect.notTag && tag === entry.expect.notTag) { warn = true; detail += " ⚠ UNEXPECTED TAG (got " + tag + ")"; }
              if (entry.expect.notRole && role === entry.expect.notRole) { warn = true; detail += " ⚠ UNEXPECTED ROLE (got " + role + ")"; }
            }
            if (entry.matchText) {
              var hasMatch = false;
              for (var ai = 0; ai < allFound.length; ai++) { if (entry.matchText.test(getDeepText(allFound[ai].el))) { hasMatch = true; break; } }
              if (!hasMatch) { warn = true; detail += " ⚠ NO ELEMENT MATCHES TEXT " + entry.matchText; }
            }
          }
          results.push({ name: name, desc: entry.desc, critical: !!entry.critical, status: status, warn: warn, detail: detail });
        }
        return results;
      }

      window.__srDomHealthcheck = function (doc) {
        var results = runCheck(doc);
        var missing = 0, warnings = 0;
        console.log("%c SR DOM Healthcheck ", "background:#1a1a2e;color:#6ea8ff;font-size:14px;font-weight:bold;padding:4px 8px;border-radius:4px");
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          var icon = r.status === "OK" ? "✓" : r.status === "HIDDEN" ? "◌" : "✗";
          var color = r.status === "OK" && !r.warn ? "color:#4caf50" : r.status === "MISSING" ? "color:#f44336" : "color:#ff9800";
          var crit = r.critical ? " [CRITICAL]" : "";
          console.log("%c" + icon + " " + r.name + "%c " + r.desc + crit + (r.detail ? "\n    " + r.detail : ""), color + ";font-weight:bold", "color:inherit");
          if (r.status === "MISSING") missing++;
          if (r.warn) warnings++;
        }
        var critMissing = results.filter(function (r) { return r.critical && r.status === "MISSING"; });
        var summary = results.length + " selectors checked — " + missing + " missing, " + warnings + " warnings";
        if (critMissing.length) summary += " — " + critMissing.length + " CRITICAL: " + critMissing.map(function (r) { return r.name; }).join(", ");
        console.log("%c" + summary, missing > 0 || warnings > 0 ? "color:#ff9800;font-weight:bold" : "color:#4caf50");
        return { total: results.length, missing: missing, warnings: warnings, results: results };
      };
      window.__srDomHealthcheckRaw = runCheck;

      /* ---- END page-world healthcheck ---- */
    }).toString() + ")();";
    (document.head || document.documentElement).appendChild(pageScript);
    pageScript.remove();
  } catch (e) {
    console.warn("[sr-selectors] Could not inject healthcheck into page world:", e.message || e);
    console.info("[sr-selectors] To run the healthcheck, select the extension context from the DevTools console dropdown (instead of 'top').");
  }

})();
