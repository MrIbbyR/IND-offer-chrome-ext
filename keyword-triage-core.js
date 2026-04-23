// keyword-triage-core.js — SmartRecruiters keyword search on resume + optional Move forward
// Exposes: __srKeywordTriageRun, __srKeywordTriageRunMulti, __srKeywordTriageStartQueue,
//          __srCollectApplicantClickTargets (shared with salary-triage)

(function () {
  "use strict";

  /* ── Keyword expansion table (ported from req.py KEYWORD_EXPANSIONS) ── */
  var _RD = ["research and development", "research & development", "r and d", "r&d"];
  var KEYWORD_EXPANSIONS = {
    "r&d": _RD, "r and d": _RD, "r & d": _RD,
    "ml": ["machine learning", "machine-learning"],
    "nlp": ["natural language processing", "natural-language processing"],
    "ai": ["artificial intelligence", "artificial-intelligence"],
    "dl": ["deep learning", "deep-learning"],
    "cv": ["computer vision"],
    "phd": ["ph.d", "ph.d.", "doctorate", "doctoral"],
    "ms": ["m.s", "m.s.", "master's", "masters", "msc", "m.sc"],
    "bsc": ["b.s", "b.s.", "bachelor's", "bachelors", "b.sc"],
    "iso 45001": ["iso45001", "iso-45001", "ohsms", "occupational health and safety"],
    "iso 9001": ["iso9001", "iso-9001", "quality management"],
    "nebsh": ["nebsh igc", "international general certificate"],
    "ctf": ["capture the flag", "capture-the-flag"],
    "aws": ["amazon web services"],
    "gcp": ["google cloud platform", "google cloud"],
    "api": ["application programming interface", "apis"],
    "pytorch": ["py torch", "py-torch", "torch", "pytorch lightning"],
    "tensorflow": ["tensor flow", "tensor-flow", "tensorflow 2", "tf2", "tf.keras", "tf"],
    "keras": ["tf.keras", "deep learning"],
    "llm": ["large language model", "llms"],
    "llms": ["large language models", "llm"],
    "rag": ["retrieval augmented generation", "retrieval-augmented generation"],
    "transformer": ["transformers"],
    "transformers": ["transformer"],
    "azure": ["microsoft azure", "ms azure", "azure devops", "azure cloud"],
    "resilience": ["resiliency", "resilient"],
    "resiliency": ["resilience", "resilient"],
    "fmcg": ["fast moving consumer goods", "fast-moving consumer goods"],
    "cpg": ["consumer packaged goods", "packaged goods"],
    "ner": ["named entity recognition"],
    "ocr": ["optical character recognition"],
    "ir": ["information retrieval"],
    "idp": ["intelligent document processing"],
  };

  /** Common misspellings / variants → canonical key (lowercase) used before expansion + matching */
  var KEYWORD_TYPO_ALIASES = {
    pytroch: "pytorch",
    pytoch: "pytorch",
    tensorlfow: "tensorflow",
    tensorfow: "tensorflow",
    tenserflow: "tensorflow",
    azuer: "azure",
    resilence: "resilience",
    reslience: "resilience",
    resliency: "resiliency",
  };

  var MOVE_FORWARD_ID = "st-moveForward";

  /* ── Helpers ── */

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function isVisible(el, win) {
    if (!el) return false;
    var style = win.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0)
      return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isDisabledish(el) {
    if (!el) return true;
    try { if (el.disabled === true) return true; } catch (_) {}
    try {
      if (el.getAttribute && el.getAttribute("disabled") != null) return true;
      if (String(el.getAttribute && el.getAttribute("aria-disabled")).toLowerCase() === "true") return true;
    } catch (_) {}
    return false;
  }

  function walkShadow(node, visitor, visited) {
    if (!node || visited.has(node)) return;
    visited.add(node);
    visitor(node);
    if (node.childNodes && node.childNodes.length) {
      for (var i = 0; i < node.childNodes.length; i++) walkShadow(node.childNodes[i], visitor, visited);
    }
    var sr = node.shadowRoot;
    if (sr) walkShadow(sr, visitor, visited);
  }

  function queryDeepSelectorAll(root, win, selector) {
    var out = [];
    var visited = new Set();
    walkShadow(root, function (n) {
      if (n.nodeType === 1) {
        try {
          if (n.matches && n.matches(selector)) out.push(n);
          out.push.apply(out, Array.from(n.querySelectorAll(selector)));
        } catch (_) {}
      }
    }, visited);
    return out.filter(function (el, i, a) { return a.indexOf(el) === i; });
  }

  function collectClickablesDeep(root, win) {
    var sel =
      'button, [role="button"], a[href], spl-button, [class*="button"], input[type="button"], input[type="submit"]';
    var raw = queryDeepSelectorAll(root, win, sel);
    return raw.filter(function (el) { return isVisible(el, win); });
  }

  function findElementByIdDeep(root, id, visited) {
    if (!visited) visited = new Set();
    if (!root || visited.has(root)) return null;
    visited.add(root);
    if (root.nodeType === 1) {
      try {
        if (root.id === id) return root;
        if (root.getAttribute && root.getAttribute("id") === id) return root;
      } catch (_) {}
    }
    if (root.childNodes) {
      for (var i = 0; i < root.childNodes.length; i++) {
        var f = findElementByIdDeep(root.childNodes[i], id, visited);
        if (f) return f;
      }
    }
    if (root.shadowRoot) {
      var f2 = findElementByIdDeep(root.shadowRoot, id, visited);
      if (f2) return f2;
    }
    return null;
  }

  function isCandidateProfilePage(doc) {
    try {
      var p = (doc.location && doc.location.pathname) || "";
      return /\/app\/people\/(?:applications|profile)\/[^/?#]+/i.test(p);
    } catch (_) { return false; }
  }

  /* ── Keyword parsing & expansion (ported from req.py) ── */

  function parseKeywordsFromString(s) {
    if (!s || !s.trim()) return [];
    var lines = s.split(/\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.charAt(0) === "#") continue;
      var parts = line.split(/[,;]+/);
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j].trim();
        if (p) out.push(p);
      }
    }
    return out;
  }

  function canonicalizeKeywords(keywords) {
    var seenLower = {};
    var cleaned = [];
    for (var i = 0; i < keywords.length; i++) {
      var kw = (keywords[i] || "").trim();
      if (!kw) continue;
      var key = kw.toLowerCase();
      if (seenLower[key]) continue;
      seenLower[key] = true;
      cleaned.push(kw);
    }
    return cleaned;
  }

  function buildExpansionTable() {
    var table = {};
    for (var k in KEYWORD_EXPANSIONS) {
      if (Object.prototype.hasOwnProperty.call(KEYWORD_EXPANSIONS, k)) {
        table[k] = KEYWORD_EXPANSIONS[k].slice();
      }
    }
    return table;
  }

  function expandKeywords(keywords, expansionTable) {
    expansionTable = expansionTable || buildExpansionTable();
    var expanded = keywords.slice();
    var expandedLower = {};
    for (var i = 0; i < expanded.length; i++) expandedLower[expanded[i].toLowerCase()] = true;
    for (var k = 0; k < keywords.length; k++) {
      var key = (keywords[k] || "").trim().toLowerCase();
      if (!key) continue;
      var forms = expansionTable[key];
      if (!forms) continue;
      for (var f = 0; f < forms.length; f++) {
        if (!expandedLower[forms[f].toLowerCase()]) {
          expanded.push(forms[f]);
          expandedLower[forms[f].toLowerCase()] = true;
        }
      }
    }
    return expanded;
  }

  function applyTypoAliases(keywords) {
    var out = [];
    for (var i = 0; i < keywords.length; i++) {
      var raw = (keywords[i] || "").trim();
      if (!raw) continue;
      var low = raw.toLowerCase();
      var canon = KEYWORD_TYPO_ALIASES[low];
      out.push(canon ? canon : raw);
    }
    return out;
  }

  function resolveKeywords(rawInput) {
    var table = buildExpansionTable();
    var parsed = parseKeywordsFromString(rawInput);
    var typoFixed = applyTypoAliases(parsed);
    var canon = canonicalizeKeywords(typoFixed);
    var expanded = expandKeywords(canon, table);
    return canonicalizeKeywords(expanded);
  }

  /** Synonym forms for one boolean leaf (same table as comma keywords, plus typo table). */
  function expandOneBooleanTerm(term) {
    var t = (term || "").trim();
    if (!t) return [];
    var low = t.toLowerCase();
    if (KEYWORD_TYPO_ALIASES[low]) t = KEYWORD_TYPO_ALIASES[low];
    var table = buildExpansionTable();
    var out = [];
    var seen = {};
    function push(s) {
      var x = (s || "").trim();
      if (!x) return;
      var k = x.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(x);
    }
    push(t);
    var forms = table[t.toLowerCase()];
    if (forms) {
      for (var i = 0; i < forms.length; i++) push(forms[i]);
    }
    return out;
  }

  /* ── Text normalization (ported from req.py _normalize_for_kw) ── */

  function normalizeForKw(s) {
    if (!s) return "";
    s = String(s);
    try {
      if (typeof s.normalize === "function") s = s.normalize("NFKC");
    } catch (_) {}
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");
    s = s.replace(/\u00AD/g, "");
    s = s.replace(/\u2060/g, "");
    s = s.replace(/\u00A0/g, " ").replace(/\u202F/g, " ").replace(/\u2007/g, " ");
    s = s.replace(/\u00B7/g, " ").replace(/\u2022/g, " ");
    s = s.replace(/\s+/g, " ");
    return s.trim();
  }

  /* ── Excluded regions: sidebar / job metadata that should NOT be scanned ── */

  var EXCLUDED_SELECTORS = [
    "sr-job-application-sidebar",
    "sr-job-application-details",
    "sr-job-application-overview",
    '[class*="job-application-sidebar"]',
    '[class*="job-application-details"]',
    "aside sr-job-application-sidebar",
    "aside",
  ];

  function getExcludedText(doc) {
    var parts = [];
    var root = doc.querySelector("#st-candidateView") || doc.body;
    if (!root) return "";
    for (var i = 0; i < EXCLUDED_SELECTORS.length; i++) {
      try {
        var els = root.querySelectorAll(EXCLUDED_SELECTORS[i]);
        for (var j = 0; j < els.length; j++) {
          var t = (els[j].innerText || els[j].textContent || "").replace(/\s+/g, " ").trim();
          if (t.length > 5) parts.push(t);
        }
      } catch (_) {}
    }
    return parts.join("\n\n");
  }

  function stripExcludedText(allText, excludedText) {
    if (!excludedText || !allText) return allText;
    var phrases = excludedText.split(/\n\n/);
    for (var i = 0; i < phrases.length; i++) {
      var p = phrases[i].trim();
      if (p.length < 10) continue;
      var idx = allText.indexOf(p);
      while (idx >= 0) {
        allText = allText.substring(0, idx) + " " + allText.substring(idx + p.length);
        idx = allText.indexOf(p);
      }
    }
    return allText.replace(/\s+/g, " ").trim();
  }

  /* ── Resume text extraction from DOM (ported from req.py get_dom_resume_text) ── */

  function collectDeepText(root, minChunk) {
    minChunk = minChunk || 30;
    var chunks = [];
    var visited = new Set();

    function push(raw) {
      var t = (raw || "").replace(/\s+/g, " ").trim();
      if (t.length >= minChunk) chunks.push(t);
    }

    function walk(node) {
      if (!node || visited.has(node)) return;
      visited.add(node);
      if (node.nodeType === 1) {
        try { push(node.innerText || node.textContent || ""); } catch (_) {}
      }
      if (node.shadowRoot) walk(node.shadowRoot);
      if (node.childNodes) {
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
      }
    }

    walk(root);
    return chunks;
  }

  function getResumeText(doc) {
    var root = doc.querySelector("#st-candidateView") || doc.body;
    if (!root) return "";
    var selectors = [
      "sr-resume-viewer",
      "sr-candidate-resume",
      "sr-resume",
      '[data-testid*="resume"]',
      '[data-testid*="Resume"]',
      '[class*="resume"]',
      '[id*="resume"]',
    ];
    var chunks = [];
    var minChunk = 30;

    function pushText(raw) {
      var t = (raw || "").replace(/\s+/g, " ").trim();
      if (t.length >= minChunk) chunks.push(t);
    }

    function collectFromEl(el) {
      if (!el) return;
      try {
        pushText(el.innerText || el.textContent || "");
        if (el.shadowRoot) {
          try {
            pushText(el.shadowRoot.innerText || el.shadowRoot.textContent || "");
            var deep = collectDeepText(el.shadowRoot, minChunk);
            for (var d = 0; d < deep.length; d++) chunks.push(deep[d]);
          } catch (_) {}
        }
      } catch (_) {}
    }

    for (var i = 0; i < selectors.length; i++) {
      try {
        var els = root.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length; j++) collectFromEl(els[j]);
      } catch (_) {}
    }

    var fullRoot = (root.innerText || root.textContent || "").replace(/\s+/g, " ").trim();
    var merged = chunks.length ? chunks.join("\n\n") : "";
    if (merged && fullRoot) return merged + "\n\n" + fullRoot;
    return merged || fullRoot;
  }

  function getProfileOverviewText(doc) {
    var root = doc.querySelector("#st-candidateView") || doc.body;
    if (!root) return "";
    var selectors = [
      '[data-testid*="profile"]',
      '[data-testid*="Profile"]',
      '[class*="profile"]',
      '[id*="profile"]',
      '[data-testid*="overview"]',
      '[class*="overview"]',
      '[class*="skills"]',
      '[class*="summary"]',
      '[class*="experience"]',
      '[class*="education"]',
      "sr-candidate-profile",
      "sr-candidate-details",
      "sr-candidate-overview",
    ];
    var chunks = [];

    for (var i = 0; i < selectors.length; i++) {
      try {
        var els = root.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length; j++) {
          try {
            var t = (els[j].innerText || els[j].textContent || "").replace(/\s+/g, " ").trim();
            if (t.length > 30) chunks.push(t);
          } catch (_) {}
          if (els[j].shadowRoot) {
            var deep = collectDeepText(els[j].shadowRoot, 30);
            for (var d = 0; d < deep.length; d++) chunks.push(deep[d]);
          }
        }
      } catch (_) {}
    }
    return chunks.join("\n\n");
  }

  function getFullPageText(doc) {
    var root = doc.querySelector("#st-candidateView") || doc.body || doc.documentElement;
    if (!root) return "";
    var deep = collectDeepText(root, 20);
    if (deep.length) return deep.join("\n\n");
    return (root.innerText || root.textContent || "").replace(/\s+/g, " ").trim();
  }

  function getScreeningText(doc, win) {
    var body = doc.body || doc.documentElement;
    var found = null;
    var visited = new Set();
    function walk(node) {
      if (!node || visited.has(node)) return;
      visited.add(node);
      if (node.nodeType === 1) {
        var t = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (/screening questions/i.test(t) && t.length < 2500) {
          var el2 = node;
          for (var up = 0; up < 18 && el2; up++) {
            var tag = (el2.tagName || "").toLowerCase();
            if (tag === "section" || tag.indexOf("card") >= 0 || tag === "spl-card") {
              found = el2;
              return;
            }
            el2 = el2.parentElement;
          }
          found = node;
        }
      }
      if (node.childNodes) {
        for (var c = 0; c < node.childNodes.length; c++) walk(node.childNodes[c]);
      }
      if (node.shadowRoot) walk(node.shadowRoot);
    }
    walk(body);
    if (found) return (found.innerText || found.textContent || "").trim();
    return "";
  }

  async function ensureResumeTabActive(doc, win) {
    var tabSelectors = [
      'button[data-testid="resume-tab"]',
      'button[data-testid="Resume"]',
      '[role="tab"]',
      'a[href*="resume"]',
      'button',
    ];
    var root = doc.querySelector("#st-candidateView") || doc.body;
    if (!root) return false;

    function findResumeTab(r) {
      for (var s = 0; s < tabSelectors.length; s++) {
        try {
          var els = r.querySelectorAll(tabSelectors[s]);
          for (var i = 0; i < els.length; i++) {
            var txt = (els[i].textContent || els[i].innerText || "").trim().toLowerCase();
            if (txt === "resume" || txt === "résumé" || txt === "cv") return els[i];
          }
        } catch (_) {}
      }
      var visited = new Set();
      var found = null;
      function walkSR(node) {
        if (!node || visited.has(node) || found) return;
        visited.add(node);
        if (node.nodeType === 1) {
          var t = (node.textContent || "").trim().toLowerCase();
          if ((t === "resume" || t === "résumé" || t === "cv") &&
              (node.tagName === "BUTTON" || node.tagName === "A" ||
               (node.getAttribute && node.getAttribute("role") === "tab"))) {
            found = node;
            return;
          }
        }
        if (node.shadowRoot) walkSR(node.shadowRoot);
        if (node.childNodes) {
          for (var c = 0; c < node.childNodes.length; c++) walkSR(node.childNodes[c]);
        }
      }
      walkSR(r);
      return found;
    }

    var tab = findResumeTab(root);
    if (!tab) return false;

    try {
      tab.scrollIntoView({ block: "center", behavior: "instant" });
      await sleep(100);
      tab.click();
      await sleep(1500);
    } catch (_) {}
    return true;
  }

  async function ensureProfileTabActive(doc, win) {
    var root = doc.querySelector("#st-candidateView") || doc.body;
    if (!root) return false;

    function findProfileTab(r) {
      var visited = new Set();
      var found = null;
      function walkSR(node) {
        if (!node || visited.has(node) || found) return;
        visited.add(node);
        if (node.nodeType === 1) {
          var t = (node.textContent || "").trim().toLowerCase();
          if (t === "profile" &&
              (node.tagName === "BUTTON" || node.tagName === "A" ||
               (node.getAttribute && node.getAttribute("role") === "tab"))) {
            found = node;
            return;
          }
        }
        if (node.shadowRoot) walkSR(node.shadowRoot);
        if (node.childNodes) {
          for (var c = 0; c < node.childNodes.length; c++) walkSR(node.childNodes[c]);
        }
      }
      walkSR(r);
      return found;
    }

    var tab = findProfileTab(root);
    if (!tab) return false;
    try {
      tab.scrollIntoView({ block: "center", behavior: "instant" });
      await sleep(100);
      tab.click();
      await sleep(1000);
    } catch (_) {}
    return true;
  }

  /* ── Keyword matching (ported from req.py find_keyword_hits) ── */

  function sepFlexiblePatternSource(kwNorm) {
    var tokens = kwNorm.match(/[A-Za-z]+|\d+/g);
    if (!tokens || !tokens.length) return "";
    var mid = "[\\W_]*";
    var body = tokens
      .map(function (t) {
        return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join(mid);
    if (!body) return "";
    return "(?<![A-Za-z0-9])" + body + "(?![A-Za-z0-9])";
  }

  /** ISO list heuristic: "ISO Standard (9001, 45001)" matches keyword "ISO 45001" */
  function isoListHit(hay, num) {
    if (!num) return false;
    var numRx;
    try {
      var esc = String(num).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      numRx = new RegExp("(?<!\\d)" + esc + "(?!\\d)", "i");
    } catch (_) {
      return false;
    }
    var chunks = hay.split(/[\n•]+/);
    for (var i = 0; i < chunks.length; i++) {
      var ch = chunks[i];
      if (/\bISO\b/i.test(ch) && numRx.test(ch)) return true;
    }
    return false;
  }

  /**
   * @param {string|string[]} texts - haystack(s); joined with space then normalized (Python join)
   * @param {string[]} keywords
   * @param {{ maxItems?: number }} opts
   */
  function findKeywordHits(texts, keywords, opts) {
    opts = opts || {};
    var rawCap = parseInt(opts.maxItems, 10);
    var maxItems = Number.isFinite(rawCap) && rawCap > 0 ? Math.min(15000, rawCap) : 50;
    var scanEveryKeyword = !!(opts && opts.scanEveryKeyword);
    var joined =
      typeof texts === "string"
        ? texts
        : Array.isArray(texts)
          ? texts.filter(Boolean).join(" ")
          : "";
    var hay = normalizeForKw(joined);
    if (!hay) return { hits: [], hitCount: 0 };
    var found = [];
    var seenLower = {};

    for (var i = 0; i < keywords.length; i++) {
      if (!scanEveryKeyword && found.length >= maxItems) break;
      var kwDisp = (keywords[i] || "").trim();
      if (!kwDisp) continue;
      var kwKey = kwDisp;
      if (kwKey.charAt(0) === "(" && kwKey.charAt(kwKey.length - 1) === ")") {
        var inner2 = kwKey.slice(1, -1).trim();
        if (inner2) kwKey = inner2;
      }
      var kwNorm = normalizeForKw(kwKey);
      if (!kwNorm) continue;

      // Trailing * = prefix match (LinkedIn-style wildcard)
      var isWildcard = kwNorm.charAt(kwNorm.length - 1) === "*";
      if (isWildcard) {
        kwNorm = kwNorm.slice(0, -1).replace(/\s+$/, "");
        if (!kwNorm) continue;
      }

      var count = 0;
      var src = sepFlexiblePatternSource(kwNorm);
      if (isWildcard && src) {
        var tail = "(?![A-Za-z0-9])";
        var tailIdx = src.lastIndexOf(tail);
        if (tailIdx >= 0) src = src.slice(0, tailIdx) + "[A-Za-z0-9]*";
      }
      if (src) {
        try {
          var rx = new RegExp(src, "gi");
          var m = hay.match(rx);
          count = m ? m.length : 0;
        } catch (_) {
          count = 0;
        }
      }
      if (count === 0) {
        var toks = kwNorm.match(/[A-Za-z]+|\d+/g);
        if (toks && toks.length && toks[0].toLowerCase() === "iso") {
          var num = "";
          for (var t = 1; t < toks.length; t++) {
            if (/^\d+$/.test(toks[t])) {
              num = toks[t];
              break;
            }
          }
          if (num && isoListHit(hay, num)) count = 1;
        }
      }
      if (count > 0) {
        var key = kwDisp.toLowerCase();
        if (!seenLower[key]) {
          seenLower[key] = true;
          found.push({ keyword: kwDisp, count: count });
        }
      }
    }
    return { hits: found, hitCount: found.length };
  }

  /* ── Boolean search parser (LinkedIn Recruiter–style syntax) ── */

  function tokenizeBoolean(input) {
    var tokens = [];
    var i = 0;
    var s = String(input || "");
    while (i < s.length) {
      if (/\s/.test(s[i])) {
        i++;
        continue;
      }
      if (s[i] === '"' || s[i] === "\u201C" || s[i] === "\u201D") {
        var closeChars = ['"', "\u201C", "\u201D"];
        i++;
        var start = i;
        while (i < s.length && closeChars.indexOf(s[i]) < 0) i++;
        var phrase = s.slice(start, i).trim();
        if (i < s.length) i++;
        if (phrase) tokens.push({ type: "PHRASE", value: phrase });
        continue;
      }
      if (s[i] === "(") {
        tokens.push({ type: "LPAREN" });
        i++;
        continue;
      }
      if (s[i] === ")") {
        tokens.push({ type: "RPAREN" });
        i++;
        continue;
      }
      var wStart = i;
      while (i < s.length && !/\s/.test(s[i]) && s[i] !== "(" && s[i] !== ")" && s[i] !== '"' && s[i] !== "\u201C" && s[i] !== "\u201D")
        i++;
      var word = s.slice(wStart, i);
      if (!word) continue;
      var upper = word.toUpperCase();
      if (upper === "AND") tokens.push({ type: "AND" });
      else if (upper === "OR") tokens.push({ type: "OR" });
      else if (upper === "NOT") tokens.push({ type: "NOT" });
      else tokens.push({ type: "TERM", value: word });
    }
    return tokens;
  }

  function parseBooleanQuery(input) {
    var tokens = tokenizeBoolean(input);
    var pos = 0;

    function peek() {
      return pos < tokens.length ? tokens[pos] : null;
    }
    function consume() {
      return tokens[pos++];
    }

    function parseOr() {
      var left = parseAnd();
      while (peek() && peek().type === "OR") {
        consume();
        var right = parseAnd();
        left = { type: "OR", left: left, right: right };
      }
      return left;
    }

    function parseAnd() {
      var left = parseNot();
      while (peek()) {
        var t = peek();
        if (t.type === "AND") {
          consume();
          var right = parseNot();
          left = { type: "AND", left: left, right: right };
        } else if (t.type === "TERM" || t.type === "PHRASE" || t.type === "LPAREN" || t.type === "NOT") {
          var right2 = parseNot();
          left = { type: "AND", left: left, right: right2 };
        } else {
          break;
        }
      }
      return left;
    }

    function parseNot() {
      if (peek() && peek().type === "NOT") {
        consume();
        var operand = parseAtom();
        return { type: "NOT", operand: operand };
      }
      return parseAtom();
    }

    function parseAtom() {
      var t = peek();
      if (!t) return { type: "TERM", value: "" };

      if (t.type === "LPAREN") {
        consume();
        var expr = parseOr();
        if (peek() && peek().type === "RPAREN") consume();
        return expr;
      }

      if (t.type === "PHRASE") {
        consume();
        return { type: "TERM", value: t.value, quoted: true };
      }

      if (t.type === "TERM") {
        consume();
        return { type: "TERM", value: t.value };
      }

      consume();
      return { type: "TERM", value: "" };
    }

    if (!tokens.length) return { type: "TERM", value: "" };
    return parseOr();
  }

  function extractLeafTerms(ast, negated) {
    negated = !!negated;
    if (!ast) return [];
    if (ast.type === "TERM") {
      if (!ast.value) return [];
      return [{ value: ast.value, negated: negated }];
    }
    if (ast.type === "NOT") {
      return extractLeafTerms(ast.operand, true);
    }
    if (ast.type === "AND" || ast.type === "OR") {
      return extractLeafTerms(ast.left, negated).concat(extractLeafTerms(ast.right, negated));
    }
    return [];
  }

  function evaluateBooleanAst(ast, matchedSet) {
    if (!ast) return false;
    if (ast.type === "TERM") {
      var key = (ast.value || "").toLowerCase();
      return !!matchedSet[key];
    }
    if (ast.type === "NOT") {
      return !evaluateBooleanAst(ast.operand, matchedSet);
    }
    if (ast.type === "AND") {
      return evaluateBooleanAst(ast.left, matchedSet) && evaluateBooleanAst(ast.right, matchedSet);
    }
    if (ast.type === "OR") {
      return evaluateBooleanAst(ast.left, matchedSet) || evaluateBooleanAst(ast.right, matchedSet);
    }
    return false;
  }

  /* ── Move Forward pipeline (same as salary-triage-core.js) ── */

  function resolveMoveForwardClickTarget(doc, win, host) {
    if (!host) return null;
    var candidates = [];
    try { candidates = queryDeepSelectorAll(host, win, 'button, [role="button"], a[href]'); } catch (_) {}
    try { if (host.matches && host.matches('button, [role="button"], a[href]')) candidates.unshift(host); } catch (_) {}

    var bestForward = null;
    var bestLen = 1e9;
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (isDisabledish(el)) continue;
      if (!isVisible(el, win)) continue;
      var txt = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!/\bmove\s+forward\b/.test(txt)) continue;
      if (txt.length < bestLen) { bestLen = txt.length; bestForward = el; }
    }
    if (bestForward) return bestForward;
    for (var j = 0; j < candidates.length; j++) {
      var el2 = candidates[j];
      if (isDisabledish(el2)) continue;
      if (!isVisible(el2, win)) continue;
      var txt2 = (el2.textContent || "").replace(/\s+/g, " ").trim();
      if (txt2.length > 0 && txt2.length < 100) return el2;
    }
    try {
      if (!isDisabledish(host) && isVisible(host, win) && host.matches && host.matches('button, [role="button"], a[href]'))
        return host;
    } catch (_) {}
    return host;
  }

  function dispatchClickAtElementCenter(el, win, xBias) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    var bias = typeof xBias === "number" ? xBias : 0.35;
    var x = r.left + Math.max(4, Math.min(r.width * bias, r.width - 4));
    var y = r.top + r.height / 2;
    var base = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: win, button: 0 };
    try {
      if (typeof win.PointerEvent === "function") {
        el.dispatchEvent(new win.PointerEvent("pointerdown", {
          bubbles: true, cancelable: true, clientX: x, clientY: y, view: win,
          pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1,
        }));
      }
    } catch (_) {}
    try { el.dispatchEvent(new win.MouseEvent("mousedown", base)); } catch (_) {}
    try { el.dispatchEvent(new win.MouseEvent("mouseup", base)); } catch (_) {}
    try {
      if (typeof win.PointerEvent === "function") {
        el.dispatchEvent(new win.PointerEvent("pointerup", {
          bubbles: true, cancelable: true, clientX: x, clientY: y, view: win,
          pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0,
        }));
      }
    } catch (_) {}
    try { el.dispatchEvent(new win.MouseEvent("click", base)); } catch (_) {}
  }

  function fireMoveForwardPipelineClick(win, innerBtn, host) {
    if (!innerBtn) return;
    dispatchClickAtElementCenter(innerBtn, win, 0.32);
    try { if (typeof innerBtn.click === "function") innerBtn.click(); } catch (_) {}
    if (!host || host === innerBtn) return;
    var tag = (host.tagName || "").toLowerCase();
    if (tag.indexOf("spl-") !== 0 && !host.shadowRoot) return;
    dispatchClickAtElementCenter(host, win, 0.32);
    try { if (typeof host.click === "function") host.click(); } catch (_) {}
  }

  function findMoveControl(doc, win) {
    var host = null;
    try { host = doc.getElementById(MOVE_FORWARD_ID); } catch (_) {}
    if (!host) {
      try { host = findElementByIdDeep(doc.documentElement || doc.body, MOVE_FORWARD_ID); } catch (_) {}
    }
    if (host) {
      var target = resolveMoveForwardClickTarget(doc, win, host);
      return { btn: target || host, host: host };
    }
    var clickables = collectClickablesDeep(doc.body || doc.documentElement, win);
    var bestForward = null;
    var bestForwardLen = 1e9;
    for (var i = 0; i < clickables.length; i++) {
      var el = clickables[i];
      var txt = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!txt || txt.length > 120) continue;
      if (/\bmove\s+forward\b/.test(txt)) {
        if (txt.length < bestForwardLen) { bestForwardLen = txt.length; bestForward = el; }
      }
    }
    return bestForward ? { btn: bestForward, host: null } : null;
  }

  function hasSrProfileChrome(doc) {
    var mv = null;
    try { mv = doc.getElementById(MOVE_FORWARD_ID); } catch (_) {}
    if (!mv) {
      try { mv = findElementByIdDeep(doc.documentElement || doc.body, MOVE_FORWARD_ID); } catch (_) {}
    }
    var sc = null;
    try { sc = doc.getElementById("st-screening"); } catch (_) {}
    if (!sc) {
      try { sc = findElementByIdDeep(doc.documentElement || doc.body, "st-screening"); } catch (_) {}
    }
    return !!(mv || sc);
  }

  /* ── URL / click target harvesting (shared with salary-triage) ── */

  function normalizeProfilePath(href) {
    try {
      var u = new URL(href, location.origin);
      var m = u.pathname.match(/^(\/app\/people\/(?:applications|profile)\/[^/]+)\/?/i);
      return m ? u.origin + m[1] + "/" : "";
    } catch (_) { return ""; }
  }

  function hrefFromNode(el) {
    if (!el) return "";
    try {
      var a = el.getAttribute && el.getAttribute("href");
      if (a) return a;
      if (el.href) return String(el.href);
    } catch (_) {}
    return "";
  }

  function harvestProfileUrls(doc, win) {
    var seen = new Set();
    var urls = [];
    function addRaw(raw) {
      var path = normalizeProfilePath(raw);
      if (!path || seen.has(path)) return;
      seen.add(path);
      urls.push(path);
    }
    var broadSel =
      'a[href*="/app/people/applications/"], a[href*="/app/people/profile/"], sr-link[href*="/app/people/applications/"], sr-link[href*="/app/people/profile/"]';
    function harvestSelectorList(root, useDeep) {
      var list = [];
      if (useDeep) {
        list = queryDeepSelectorAll(root, win, broadSel);
      } else {
        try { list = Array.from(root.querySelectorAll(broadSel)); } catch (_) {}
      }
      for (var i = 0; i < list.length; i++) addRaw(hrefFromNode(list[i]));
    }
    var root = doc.body || doc.documentElement;
    harvestSelectorList(root, false);
    harvestSelectorList(root, true);
    try {
      doc.querySelectorAll(
        "#st-jobDetailsPage spl-table a[href*='/app/people/'], " +
        "#st-jobDetailsPage spl-table sr-link[href*='/app/people/'], " +
        "#st-jobDetailsPage app-applicant-list-container a[href*='/app/people/'], " +
        "#st-jobDetailsPage app-applicant-list-container sr-link[href*='/app/people/'], " +
        "#st-jobDetailsPage app-people-tab-applicant-list-container a[href*='/app/people/'], " +
        "#st-jobDetailsPage people-tab-container a[href*='/app/people/']"
      ).forEach(function (n) { addRaw(hrefFromNode(n)); });
    } catch (_) {}
    var nameHosts = new Set();
    try {
      doc.querySelectorAll('[data-test="applicant-name"], spl-truncate.applicant-name--name-truncate').forEach(function (n) { nameHosts.add(n); });
    } catch (_) {}
    try {
      queryDeepSelectorAll(root, win, '[data-test="applicant-name"]').forEach(function (n) { nameHosts.add(n); });
    } catch (_) {}
    nameHosts.forEach(function (host) {
      var el = host;
      for (var up = 0; up < 24 && el; up++) {
        var tag = (el.tagName || "").toUpperCase();
        if (tag === "A" || tag === "SR-LINK") { addRaw(hrefFromNode(el)); break; }
        try {
          var inner = el.querySelector && el.querySelector(broadSel);
          if (inner) { addRaw(hrefFromNode(inner)); break; }
        } catch (_) {}
        el = el.parentElement;
      }
      var row = null;
      try { row = host.closest && host.closest("tr"); } catch (_) {}
      if (!row) { try { row = host.closest && host.closest('[role="row"]'); } catch (_) {} }
      if (row) { try { row.querySelectorAll(broadSel).forEach(function (n) { addRaw(hrefFromNode(n)); }); } catch (_) {} }
    });
    return urls;
  }

  function resolveApplicantClickTarget(host) {
    if (!host) return null;
    try {
      var inJobList = host.closest && host.closest("#st-jobDetailsPage");
      if (inJobList) {
        var directA = host.closest && host.closest("a[href*='/app/people/']");
        if (directA) return directA;
      }
    } catch (_) {}
    try {
      var cell = host.closest && (host.closest("td") || host.closest('[role="gridcell"]'));
      if (cell) {
        var a = cell.querySelector('a[href*="/app/people/"], sr-link[href*="/app/people/"], a[href^="/app/people/"]');
        if (a) return a;
      }
    } catch (_) {}
    var el = host;
    for (var up = 0; up < 32 && el; up++) {
      var tag = (el.tagName || "").toUpperCase();
      if (tag === "A" || tag === "SR-LINK") return el;
      var role = String((el.getAttribute && el.getAttribute("role")) || "").toLowerCase();
      if (role === "link" || role === "button") return el;
      el = el.parentElement;
    }
    return host;
  }

  function collectApplicantClickTargets(doc, win) {
    var out = [];
    var seenClickEl = new Set();
    var seenRow = new WeakSet();
    var seenHost = new Set();
    function rowKeyForSplTable(host) {
      var el = host;
      for (var i = 0; i < 28 && el; i++) {
        var p = el.parentElement;
        if (!p) break;
        if ((p.tagName || "").toLowerCase() === "spl-table") return el;
        el = p;
      }
      return null;
    }
    function markRowAndPush(el, rowHint) {
      if (!el || seenClickEl.has(el)) return;
      if (rowHint) { if (seenRow.has(rowHint)) return; seenRow.add(rowHint); }
      seenClickEl.add(el);
      out.push(el);
    }
    try {
      doc.querySelectorAll(
        "#st-jobDetailsPage spl-table a[href*='/app/people/applications/'], " +
        "#st-jobDetailsPage spl-table a[href*='/app/people/profile/'], " +
        "#st-jobDetailsPage spl-table sr-link[href*='/app/people/'], " +
        "#st-jobDetailsPage app-applicant-list-container a[href*='/app/people/'], " +
        "#st-jobDetailsPage app-applicant-list-container sr-link[href*='/app/people/'], " +
        "#st-jobDetailsPage app-people-tab-applicant-list-container a[href*='/app/people/'], " +
        "#st-jobDetailsPage app-people-tab-applicant-list-container sr-link[href*='/app/people/'], " +
        "#st-jobDetailsPage people-tab-container a[href*='/app/people/'], " +
        "#st-jobDetailsPage people-tab-container sr-link[href*='/app/people/']"
      ).forEach(function (linkEl) {
        var underTable = linkEl.closest && linkEl.closest("spl-table");
        var rowHint = underTable && linkEl.parentElement
          ? linkEl.parentElement
          : linkEl.closest("tr") || linkEl.closest('[role="row"]');
        markRowAndPush(linkEl, rowHint || linkEl);
      });
    } catch (_) {}
    function considerHost(host) {
      if (!host || seenHost.has(host)) return;
      seenHost.add(host);
      var row = null;
      try { row = host.closest && (host.closest("tr") || host.closest('[role="row"]')); } catch (_) {}
      if (!row) { try { row = rowKeyForSplTable(host); } catch (_) {} }
      if (row) { if (seenRow.has(row)) return; seenRow.add(row); }
      var target = resolveApplicantClickTarget(host);
      if (!target || seenClickEl.has(target)) return;
      seenClickEl.add(target);
      out.push(target);
    }
    var root = doc.body || doc.documentElement;
    try { doc.querySelectorAll('[data-test="applicant-name"], spl-truncate.applicant-name--name-truncate').forEach(considerHost); } catch (_) {}
    try { queryDeepSelectorAll(root, win, '[data-test="applicant-name"]').forEach(considerHost); } catch (_) {}
    try {
      doc.querySelectorAll(
        "#st-jobDetailsPage app-applicant-list-container spl-typography-title spl-truncate, " +
        "#st-jobDetailsPage app-people-tab-applicant-list-container spl-typography-title spl-truncate, " +
        "#st-jobDetailsPage people-tab-container spl-typography-title spl-truncate, " +
        "#st-jobDetailsPage spl-table spl-typography-title spl-truncate"
      ).forEach(considerHost);
    } catch (_) {}
    return out;
  }

  function fireClick(win, el) {
    if (!el) return;
    try { el.scrollIntoView({ block: "center", behavior: "instant" }); } catch (_) {}
    try { el.click(); } catch (_) {
      try {
        var r = el.getBoundingClientRect();
        el.dispatchEvent(
          new win.MouseEvent("click", { bubbles: true, cancelable: true, clientX: r.left + Math.min(r.width / 2, 80), clientY: r.top + Math.min(r.height / 2, 20), view: win })
        );
      } catch (_) {}
    }
  }

  /* ── Post keyword hits to the Notes tab on the prospect profile ── */

  /* ── Notes helpers ── */

  function findNotesTab(doc, win) {
    var root = doc.body || doc.documentElement;
    var candidates = [];
    try { candidates = candidates.concat(Array.from(doc.querySelectorAll("a > spl-tab-label > div"))); } catch (_) {}
    try { candidates = candidates.concat(Array.from(doc.querySelectorAll("a > spl-tab-label"))); } catch (_) {}
    try { candidates = candidates.concat(Array.from(doc.querySelectorAll('[role="tab"]'))); } catch (_) {}
    try { candidates = candidates.concat(queryDeepSelectorAll(root, win, "spl-tab-label")); } catch (_) {}
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var txt = ((el.textContent || el.innerText || "") + "").replace(/\s+/g, " ").trim().toLowerCase();
      if (/^notes\b/.test(txt)) {
        var clickTarget = el;
        try {
          var parentA = el.closest && el.closest("a");
          if (parentA) clickTarget = parentA;
        } catch (_) {}
        return clickTarget;
      }
    }
    return null;
  }

  /**
   * Walk shadow DOMs to find every textarea visible in the page.
   * SmartRecruiters wraps Notes in spl-form-element → shadowRoot → div → textarea.
   */
  function findAllDeepTextareas(root, win) {
    var out = [];
    var visited = new Set();
    function walk(node) {
      if (!node || visited.has(node)) return;
      visited.add(node);
      if (node.nodeType === 1) {
        var tag = (node.tagName || "").toLowerCase();
        if (tag === "textarea") { out.push(node); return; }
        if (node.matches) {
          try {
            if (node.matches('[contenteditable="true"], div[role="textbox"]')) out.push(node);
          } catch (_) {}
        }
      }
      if (node.shadowRoot) walk(node.shadowRoot);
      if (node.childNodes) {
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
      }
    }
    walk(root);
    return out.filter(function (el) { return isVisible(el, win); });
  }

  function getNotesSection(doc) {
    var sec = null;
    try { sec = doc.querySelector("#st-notes"); } catch (_) {}
    if (!sec) try { sec = doc.querySelector('[data-test="notes"]'); } catch (_) {}
    if (!sec) try { sec = doc.querySelector("sr-notes"); } catch (_) {}
    if (!sec) try { sec = doc.querySelector("app-notes"); } catch (_) {}
    if (!sec) try { sec = findElementByIdDeep(doc.documentElement || doc.body, "st-notes"); } catch (_) {}
    return sec;
  }

  function findNotesInput(doc, win) {
    var notesSection = getNotesSection(doc);
    if (notesSection) {
      var inSection = findAllDeepTextareas(notesSection, win);
      if (inSection.length) return inSection[0];
    }
    var all = findAllDeepTextareas(doc.body || doc.documentElement, win);
    return all.length ? all[0] : null;
  }

  /**
   * Walk shadow DOMs to find every spl-button / button visible.
   */
  function findAllDeepButtons(root, win) {
    var out = [];
    var visited = new Set();
    function walk(node) {
      if (!node || visited.has(node)) return;
      visited.add(node);
      if (node.nodeType === 1) {
        var tag = (node.tagName || "").toLowerCase();
        if (tag === "spl-button" || tag === "button") out.push(node);
        if (node.matches) {
          try { if (node.matches('[role="button"]')) out.push(node); } catch (_) {}
        }
      }
      if (node.shadowRoot) walk(node.shadowRoot);
      if (node.childNodes) {
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
      }
    }
    walk(root);
    return out.filter(function (el, idx, a) { return a.indexOf(el) === idx; });
  }

  function getDeepText(el) {
    var t = "";
    try { t = (el.textContent || el.innerText || "").replace(/\s+/g, " ").trim(); } catch (_) {}
    if (!t && el.shadowRoot) {
      try { t = (el.shadowRoot.textContent || "").replace(/\s+/g, " ").trim(); } catch (_) {}
    }
    return t.toLowerCase();
  }

  function findNotesPostButton(doc, win) {
    for (var idx = 0; idx <= 5; idx++) {
      try {
        var allBtns = doc.querySelectorAll("#spl-form-element_" + idx + " > div > div > spl-button");
        for (var b = 0; b < allBtns.length; b++) {
          var btn = allBtns[b];
          if (!isVisible(btn, win)) continue;
          if (btn.closest && btn.closest("spl-dropdown")) continue;
          var txt = getDeepText(btn);
          if (/post|save|submit/i.test(txt)) return btn;
        }
      } catch (_) {}
    }
    for (var idx2 = 0; idx2 <= 5; idx2++) {
      try {
        var allBtns2 = doc.querySelectorAll("#spl-form-element_" + idx2 + " spl-button");
        for (var b2 = 0; b2 < allBtns2.length; b2++) {
          if (!isVisible(allBtns2[b2], win)) continue;
          if (allBtns2[b2].closest && allBtns2[b2].closest("spl-dropdown")) continue;
          var txt2 = getDeepText(allBtns2[b2]);
          if (/post|save|submit/i.test(txt2)) return allBtns2[b2];
        }
      } catch (_) {}
    }
    var notesSection = getNotesSection(doc);
    var searchRoot = notesSection || doc.body || doc.documentElement;
    var deepBtns = findAllDeepButtons(searchRoot, win);
    for (var i = 0; i < deepBtns.length; i++) {
      if (isDisabledish(deepBtns[i])) continue;
      if (deepBtns[i].closest && deepBtns[i].closest("spl-dropdown")) continue;
      var dtxt = getDeepText(deepBtns[i]);
      if (/^post$/i.test(dtxt)) return deepBtns[i];
    }
    return null;
  }

  function formatNoteText(hitLabels, hitCount, totalKeywords) {
    return hitLabels.join(", ") + " - Matched " + hitCount + "/" + totalKeywords;
  }

  /**
   * Set the value on a textarea/input/contenteditable and fire all events
   * that Angular/React/Web Component bindings listen to.
   */
  function setNativeInputValue(el, value) {
    try { el.focus(); } catch (_) {}
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "input") {
      try {
        var proto = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var nativeSetter = Object.getOwnPropertyDescriptor(proto, "value");
        if (nativeSetter && nativeSetter.set) {
          nativeSetter.set.call(el, value);
        } else {
          el.value = value;
        }
      } catch (_) {
        el.value = value;
      }
      try { el.dispatchEvent(new Event("input", { bubbles: true, composed: true })); } catch (_) {}
      try { el.dispatchEvent(new Event("change", { bubbles: true, composed: true })); } catch (_) {}
      try { el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true, key: "a" })); } catch (_) {}
    } else {
      try { el.textContent = value; } catch (_) {}
      try { el.innerHTML = value.replace(/\n/g, "<br>"); } catch (_) {}
      try { el.dispatchEvent(new Event("input", { bubbles: true, composed: true })); } catch (_) {}
    }
  }

  /**
   * Simulate actual keyboard typing — works with frameworks that ignore .value sets.
   */
  async function typeIntoElement(el, text, win) {
    try { el.focus(); } catch (_) {}
    await sleep(100);
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var keyCode = ch.charCodeAt(0);
      try {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, code: "Key" + ch.toUpperCase(), keyCode: keyCode, which: keyCode, bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent("keypress", { key: ch, code: "Key" + ch.toUpperCase(), keyCode: keyCode, which: keyCode, bubbles: true, composed: true }));
        el.dispatchEvent(new InputEvent("input", { data: ch, inputType: "insertText", bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, code: "Key" + ch.toUpperCase(), keyCode: keyCode, which: keyCode, bubbles: true, composed: true }));
      } catch (_) {}
    }
  }

  function clickSplButton(el, win) {
    if (!el) return;
    var target = el;
    try {
      if (el.shadowRoot) {
        var inner = el.shadowRoot.querySelector("button, [role='button']");
        if (inner) target = inner;
      }
    } catch (_) {}
    try { target.click(); } catch (_) {
      dispatchClickAtElementCenter(target, win, 0.5);
    }
  }

  /**
   * Try a single click on an element using one specific strategy.
   * Returns nothing — caller must check if the click had the desired effect.
   */
  function singleClick(el, win, strategy) {
    if (!el) return;
    try { el.scrollIntoView({ block: "center", behavior: "instant" }); } catch (_) {}
    if (strategy === "native") {
      try { el.click(); } catch (_) {}
    } else if (strategy === "shadow") {
      var sb = null;
      try { if (el.shadowRoot) sb = el.shadowRoot.querySelector("button, a, [role='button']"); } catch (_) {}
      if (sb) { try { sb.click(); } catch (_) {} }
      else { try { el.click(); } catch (_) {} }
    } else {
      dispatchClickAtElementCenter(el, win, 0.5);
    }
  }

  /** Check if any dropdown menu is currently visible in the DOM. */
  function isDropdownMenuOpen(doc) {
    try {
      var menus = doc.querySelectorAll("[id^='spl-dropdown-menu']");
      for (var i = 0; i < menus.length; i++) {
        var r = menus[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
    } catch (_) {}
    return false;
  }

  /** Find the "Note to self" item from any visible dropdown menu. */
  function findNoteToSelfItem(doc) {
    var menus = doc.querySelectorAll("[id^='spl-dropdown-menu']");
    for (var m = 0; m < menus.length; m++) {
      var items = menus[m].querySelectorAll("spl-dropdown-item");
      for (var i = 0; i < items.length; i++) {
        if (/note\s*to\s*self/i.test(getDeepText(items[i]))) return items[i];
      }
      if (items.length >= 3) return items[2];
    }
    var loose = doc.querySelectorAll("spl-dropdown-item");
    for (var j = 0; j < loose.length; j++) {
      if (/note\s*to\s*self/i.test(getDeepText(loose[j]))) return loose[j];
    }
    return null;
  }

  /**
   * Open the "Open note" dropdown and select "Note to self".
   * Tries one click strategy at a time, checking if the dropdown opened after each.
   */
  async function selectNoteToSelf(doc, win) {
    var splBtn = null;
    for (var idx = 0; idx <= 5; idx++) {
      try {
        var dd = doc.querySelector("#spl-form-element_" + idx + " spl-dropdown");
        if (dd && isVisible(dd, win)) {
          splBtn = dd.querySelector("spl-button");
          if (splBtn) break;
        }
      } catch (_) {}
    }
    if (!splBtn) return false;

    var strategies = ["native", "shadow", "dispatch"];
    for (var s = 0; s < strategies.length; s++) {
      if (isDropdownMenuOpen(doc)) break;
      singleClick(splBtn, win, strategies[s]);
      await sleep(500);
      if (isDropdownMenuOpen(doc)) break;
    }

    if (!isDropdownMenuOpen(doc)) return false;

    var noteItem = findNoteToSelfItem(doc);
    if (!noteItem) {
      await sleep(400);
      noteItem = findNoteToSelfItem(doc);
    }
    if (!noteItem) return false;

    var inner = null;
    try { inner = noteItem.querySelector("div > spl-icon"); } catch (_) {}
    if (!inner) { try { inner = noteItem.querySelector("div > div > spl-typography-body"); } catch (_) {} }
    if (!inner) { try { inner = noteItem.querySelector("div"); } catch (_) {} }

    var clickEl = inner || noteItem;
    singleClick(clickEl, win, "dispatch");
    await sleep(300);

    var triggerText = getDeepText(splBtn);
    if (/note\s*to\s*self/i.test(triggerText)) return true;

    singleClick(clickEl, win, "native");
    await sleep(300);
    triggerText = getDeepText(splBtn);
    if (/note\s*to\s*self/i.test(triggerText)) return true;

    singleClick(noteItem, win, "dispatch");
    await sleep(300);
    return true;
  }

  /**
   * Pre-open the Notes tab and select "Note to self" early,
   * so the input is ready by the time keyword scan finishes.
   */
  async function prepareNotesSection(doc, win) {
    var notesTab = findNotesTab(doc, win);
    if (!notesTab) return false;
    try { notesTab.scrollIntoView({ block: "center", behavior: "instant" }); } catch (_) {}
    await sleep(50);
    dispatchClickAtElementCenter(notesTab, win, 0.5);
    try { notesTab.click(); } catch (_) {}
    await sleep(800);
    var ok = await selectNoteToSelf(doc, win);
    return ok;
  }

  async function postKeywordHitsToNotes(doc, win, hitLabels, hitCount, totalKeywords, log) {
    var input = findNotesInput(doc, win);
    if (!input) {
      var notesTab = findNotesTab(doc, win);
      if (notesTab) {
        try { notesTab.scrollIntoView({ block: "center", behavior: "instant" }); } catch (_) {}
        await sleep(50);
        dispatchClickAtElementCenter(notesTab, win, 0.5);
        try { notesTab.click(); } catch (_) {}
      }
      for (var wait = 0; wait < 2000; wait += 200) {
        await sleep(200);
        input = findNotesInput(doc, win);
        if (input) break;
      }
    }
    if (!input) {
      log.push({ ok: false, msg: "Notes text input not found — could not post." });
      return false;
    }

    var notesSelfOk = false;
    for (var idx = 0; idx <= 5; idx++) {
      try {
        var dd = doc.querySelector("#spl-form-element_" + idx + " spl-dropdown");
        if (dd && isVisible(dd, win)) {
          var ddBtn = dd.querySelector("spl-button");
          if (ddBtn && /note\s*to\s*self/i.test(getDeepText(ddBtn))) { notesSelfOk = true; break; }
        }
      } catch (_) {}
    }
    if (!notesSelfOk) {
      log.push({ ok: true, msg: "Note to self not set — selecting now..." });
      await selectNoteToSelf(doc, win);
    }

    var noteText = formatNoteText(hitLabels, hitCount, totalKeywords);
    setNativeInputValue(input, noteText);
    await sleep(100);

    var itag = (input.tagName || "").toLowerCase();
    if (itag === "textarea" || itag === "input") {
      var curVal = "";
      try { curVal = input.value || ""; } catch (_) {}
      if (curVal.indexOf("Matched") < 0) {
        try { input.value = ""; } catch (_) {}
        await typeIntoElement(input, noteText, win);
        await sleep(100);
      }
    }

    var postBtn = null;
    for (var bw = 0; bw < 1500; bw += 200) {
      postBtn = findNotesPostButton(doc, win);
      if (postBtn) break;
      await sleep(200);
    }
    if (!postBtn) {
      log.push({ ok: false, msg: "Notes post button not found — text entered but not submitted." });
      return false;
    }

    singleClick(postBtn, win, "shadow");

    log.push({ ok: true, msg: "Posted note to self (" + hitCount + " matches)" });
    await sleep(300);
    return true;
  }

  /* ── Core: run keyword triage on a single profile page ── */

  async function runKeywordTriageWithDoc(doc, win, config, options) {
    options = options || {};
    var log = [];
    var subframeTriage = !!options.subframeTriage;

    if (!isCandidateProfilePage(doc) && !subframeTriage) {
      log.push({ ok: false, msg: "Wrong page — open a candidate profile from Applicants." });
      return { log: log, moved: false, skipped: true, matchedKeywords: [], hitCount: 0 };
    }

    var isBooleanMode = config.mode === "boolean" && String(config.booleanQuery || "").trim();
    if (isBooleanMode) {
      return runBooleanTriageWithDoc(doc, win, config, options, log);
    }

    var keywords = resolveKeywords(config.keywords || "");
    var minHits = Math.max(1, parseInt(config.minHits, 10) || 2);
    var dryRun = !!config.dryRun;
    var postToNotes = !!config.postToNotes;

    if (!keywords.length) {
      log.push({ ok: false, msg: "No keywords provided." });
      return { log: log, moved: false, skipped: true, matchedKeywords: [], hitCount: 0 };
    }

    log.push({ ok: true, msg: "Keywords (" + keywords.length + "): " + keywords.slice(0, 8).join(", ") + (keywords.length > 8 ? "..." : "") });
    log.push({ ok: true, msg: "Min hits to move forward: " + minHits });

    var resumeWaitMs = Math.max(1500, parseInt(config.resumeWaitMs, 10) || 3000);
    await sleep(resumeWaitMs);

    var textParts = [];

    try { await ensureResumeTabActive(doc, win); } catch (_) {}
    await sleep(800);

    var resumeText = "";
    try { resumeText = getResumeText(doc); } catch (e) {
      log.push({ ok: false, msg: "Failed to extract resume text: " + (e && e.message) });
    }
    if (resumeText) textParts.push(resumeText);

    try { await ensureProfileTabActive(doc, win); } catch (_) {}
    await sleep(600);

    var profileText = "";
    try { profileText = getProfileOverviewText(doc); } catch (_) {}
    if (profileText) textParts.push(profileText);

    var screeningText = "";
    try { screeningText = getScreeningText(doc, win); } catch (_) {}
    if (screeningText) textParts.push(screeningText);

    var allText = textParts.join("\n\n").trim();

    if (allText.length < 200) {
      var fullPage = "";
      try { fullPage = getFullPageText(doc); } catch (_) {}
      if (fullPage.length > allText.length) allText = fullPage;
    }

    allText = normalizeForKw(allText);
    var excludedKw = "";
    try { excludedKw = getExcludedText(doc); } catch (_) {}
    if (excludedKw) allText = stripExcludedText(allText, excludedKw);
    var textLen = allText.length;
    log.push({ ok: true, msg: "Text extracted: " + textLen + " chars (resume: " + resumeText.length + ", profile: " + (profileText || "").length + ", screening: " + screeningText.length + ")" });

    if (postToNotes) {
      try { await prepareNotesSection(doc, win); } catch (_) {}
    }

    if (textLen < 50) {
      log.push({ ok: false, msg: "Very little text found on page — resume may not have loaded." });
      return { log: log, moved: false, skipped: true, matchedKeywords: [], hitCount: 0 };
    }

    var result = findKeywordHits(allText, keywords);
    var hitLabels = result.hits.map(function (h) {
      return h.count > 1 ? h.keyword + " (x" + h.count + ")" : h.keyword;
    });

    log.push({ ok: true, msg: "Matched " + result.hitCount + "/" + keywords.length + " keywords: " + (hitLabels.length ? hitLabels.join(", ") : "(none)") });

    var notesPosted = false;
    if (postToNotes && result.hitCount > 0) {
      try {
        notesPosted = await postKeywordHitsToNotes(doc, win, hitLabels, result.hitCount, keywords.length, log);
      } catch (e) {
        log.push({ ok: false, msg: "Notes post error: " + ((e && e.message) || String(e)) });
      }
    }

    if (result.hitCount < minHits) {
      log.push({ ok: false, msg: "Below threshold (" + result.hitCount + " < " + minHits + ") — skip" });
      return { log: log, moved: false, skipped: false, matchedKeywords: hitLabels, hitCount: result.hitCount, notesPosted: notesPosted };
    }

    log.push({ ok: true, msg: "Meets threshold — proceeding to Move forward" });

    if (dryRun) {
      log.push({ ok: true, msg: "Dry run: would click Move forward (skipped)" });
      return { log: log, moved: false, skipped: false, matchedKeywords: hitLabels, hitCount: result.hitCount, notesPosted: notesPosted };
    }

    var moveReadyMs = Math.max(800, parseInt(config.moveButtonReadyMs, 10) || 4500);
    var moveSettleMs = Math.max(400, parseInt(config.moveSettleMs, 10) || 1800);
    var step = 200;

    var moveCtrl = null;
    for (var elapsed = 0; elapsed < moveReadyMs; elapsed += step) {
      moveCtrl = findMoveControl(doc, win);
      if (moveCtrl && moveCtrl.btn && isVisible(moveCtrl.btn, win) && !isDisabledish(moveCtrl.btn)) break;
      moveCtrl = null;
      await sleep(step);
    }

    if (!moveCtrl || !moveCtrl.btn) {
      log.push({ ok: false, msg: "Move forward button not found." });
      return { log: log, moved: false, skipped: false, matchedKeywords: hitLabels, hitCount: result.hitCount, notesPosted: notesPosted };
    }
    if (isDisabledish(moveCtrl.btn)) {
      log.push({ ok: false, msg: "Move forward appears disabled — skipped." });
      return { log: log, moved: false, skipped: false, matchedKeywords: hitLabels, hitCount: result.hitCount, notesPosted: notesPosted };
    }

    try { moveCtrl.btn.scrollIntoView({ block: "center", behavior: "instant" }); } catch (_) {}
    await sleep(200);
    try { moveCtrl.btn.focus && moveCtrl.btn.focus(); } catch (_) {}
    await sleep(60);
    fireMoveForwardPipelineClick(win, moveCtrl.btn, moveCtrl.host);
    log.push({ ok: true, msg: "Clicked Move forward" });
    await sleep(moveSettleMs);

    return { log: log, moved: true, skipped: false, matchedKeywords: hitLabels, hitCount: result.hitCount, notesPosted: notesPosted };
  }

  async function runBooleanTriageWithDoc(doc, win, config, options, log) {
    var postToNotes = !!config.postToNotes;
    var booleanQueryRaw = String(config.booleanQuery || "").trim();
    var opens = (booleanQueryRaw.match(/\(/g) || []).length;
    var closes = (booleanQueryRaw.match(/\)/g) || []).length;
    var booleanQuery = booleanQueryRaw;
    if (closes > opens) {
      for (var mo = 0; mo < closes - opens; mo++) booleanQuery = "(" + booleanQuery;
      log.push({ ok: true, msg: "Boolean: prepended " + (closes - opens) + " '(' to balance parentheses in pasted query" });
    } else if (opens > closes) {
      for (var mc = 0; mc < opens - closes; mc++) booleanQuery = booleanQuery + ")";
      log.push({ ok: true, msg: "Boolean: appended " + (opens - closes) + " ')' to balance parentheses" });
    }

    var ast;
    try {
      ast = parseBooleanQuery(booleanQuery);
    } catch (e) {
      log.push({ ok: false, msg: "Boolean parse error: " + ((e && e.message) || String(e)) });
      return { log: log, moved: false, skipped: true, matchedKeywords: [], hitCount: 0 };
    }

    var allLeaves = extractLeafTerms(ast);
    var positiveTerms = [];
    var negativeTerms = [];
    var seenLeaf = {};
    for (var li = 0; li < allLeaves.length; li++) {
      var leaf = allLeaves[li];
      var lKey = leaf.value.toLowerCase();
      if (seenLeaf[lKey]) continue;
      seenLeaf[lKey] = true;
      if (leaf.negated) negativeTerms.push(leaf.value);
      else positiveTerms.push(leaf.value);
    }

    var totalTerms = positiveTerms.length + negativeTerms.length;
    log.push({ ok: true, msg: "Boolean search: " + totalTerms + " terms (" + positiveTerms.length + " positive, " + negativeTerms.length + " NOT)" });
    if (positiveTerms.length) {
      log.push({ ok: true, msg: "Scanning: " + positiveTerms.slice(0, 10).join(", ") + (positiveTerms.length > 10 ? "..." : "") });
    }

    var resumeWaitMs = Math.max(1500, parseInt(config.resumeWaitMs, 10) || 3000);
    await sleep(resumeWaitMs);

    /* ── Aggressive multi-source text extraction ── */
    var textParts = [];

    try { await ensureResumeTabActive(doc, win); } catch (_) {}
    await sleep(800);

    var resumeText = "";
    try { resumeText = getResumeText(doc); } catch (_) {}
    if (resumeText) textParts.push(resumeText);

    try { await ensureProfileTabActive(doc, win); } catch (_) {}
    await sleep(600);

    var profileText = "";
    try { profileText = getProfileOverviewText(doc); } catch (_) {}
    if (profileText) textParts.push(profileText);

    var screeningText = "";
    try { screeningText = getScreeningText(doc, win); } catch (_) {}
    if (screeningText) textParts.push(screeningText);

    var allText = textParts.join("\n\n").trim();

    if (allText.length < 200) {
      log.push({ ok: true, msg: "Low text from targeted selectors (" + allText.length + " chars) — falling back to full page text" });
      var fullPage = "";
      try { fullPage = getFullPageText(doc); } catch (_) {}
      if (fullPage.length > allText.length) allText = fullPage;
    }

    allText = normalizeForKw(allText);
    var excludedBool = "";
    try { excludedBool = getExcludedText(doc); } catch (_) {}
    if (excludedBool) allText = stripExcludedText(allText, excludedBool);
    var textLen = allText.length;
    log.push({ ok: true, msg: "Text extracted: " + textLen + " chars (resume: " + resumeText.length + ", profile: " + profileText.length + ", screening: " + screeningText.length + ")" });

    if (postToNotes) {
      try {
        await prepareNotesSection(doc, win);
      } catch (_) {}
    }

    if (textLen < 50) {
      log.push({ ok: false, msg: "Very little text found on page — resume may not have loaded." });
      if (postToNotes) {
        try {
          await postKeywordHitsToNotes(doc, win, ["[NO TEXT EXTRACTED]"], 0, totalTerms, log);
        } catch (_) {}
      }
      return { log: log, moved: false, skipped: true, matchedKeywords: [], hitCount: 0 };
    }

    var scanLowerToCanons = {};
    var scanLowerDisplay = {};
    function registerBooleanScans(leafValue, negated) {
      var canonKey = leafValue.trim().toLowerCase();
      var forms = expandOneBooleanTerm(leafValue);
      for (var fi = 0; fi < forms.length; fi++) {
        var sc = forms[fi].trim();
        if (!sc) continue;
        var sl = sc.toLowerCase();
        if (!scanLowerDisplay[sl]) scanLowerDisplay[sl] = sc;
        if (!scanLowerToCanons[sl]) scanLowerToCanons[sl] = [];
        var row = { canon: canonKey, negated: negated };
        var dup = false;
        for (var d = 0; d < scanLowerToCanons[sl].length; d++) {
          if (scanLowerToCanons[sl][d].canon === canonKey && scanLowerToCanons[sl][d].negated === negated) {
            dup = true;
            break;
          }
        }
        if (!dup) scanLowerToCanons[sl].push(row);
      }
    }
    for (var pi0 = 0; pi0 < positiveTerms.length; pi0++) registerBooleanScans(positiveTerms[pi0], false);
    for (var ni0 = 0; ni0 < negativeTerms.length; ni0++) registerBooleanScans(negativeTerms[ni0], true);

    var uniqueScans = [];
    for (var slk in scanLowerDisplay) {
      if (Object.prototype.hasOwnProperty.call(scanLowerDisplay, slk)) uniqueScans.push(scanLowerDisplay[slk]);
    }

    var scanResult = findKeywordHits(allText, uniqueScans, { maxItems: 15000, scanEveryKeyword: true });

    var matchedSet = {};
    for (var hi = 0; hi < scanResult.hits.length; hi++) {
      var hk = scanResult.hits[hi].keyword.toLowerCase();
      var metas = scanLowerToCanons[hk];
      if (!metas) continue;
      for (var mi = 0; mi < metas.length; mi++) {
        matchedSet[metas[mi].canon] = true;
      }
    }

    var booleanPass = evaluateBooleanAst(ast, matchedSet);

    /* ── Collect ALL hits for notes — every term found goes in, regardless of NOT ── */
    var allHitLabels = [];
    var seenHitLabel = {};
    for (var pi = 0; pi < scanResult.hits.length; pi++) {
      var hit = scanResult.hits[pi];
      var label = hit.count > 1 ? hit.keyword + " (x" + hit.count + ")" : hit.keyword;
      var lbl = label.toLowerCase();
      if (seenHitLabel[lbl]) continue;
      seenHitLabel[lbl] = true;
      allHitLabels.push(label);
    }

    log.push({ ok: true, msg: "Boolean: " + allHitLabels.length + " terms matched out of " + uniqueScans.length + " scanned" });
    if (allHitLabels.length) {
      log.push({ ok: true, msg: "Hits: " + allHitLabels.join(", ") });
    }

    var notesPosted = false;
    if (postToNotes && allHitLabels.length > 0) {
      try {
        notesPosted = await postKeywordHitsToNotes(doc, win, allHitLabels, allHitLabels.length, totalTerms, log);
      } catch (e) {
        log.push({ ok: false, msg: "Notes post error: " + ((e && e.message) || String(e)) });
      }
    }

    return {
      log: log,
      moved: false,
      skipped: false,
      matchedKeywords: allHitLabels,
      hitCount: allHitLabels.length,
      notesPosted: notesPosted,
      booleanPass: booleanPass,
    };
  }

  async function runKeywordTriageMultiFrame(config) {
    var cfg = config || {};
    var frames = [window];
    try {
      var iframes = document.querySelectorAll("iframe");
      for (var i = 0; i < iframes.length; i++) {
        try { var w = iframes[i].contentWindow; if (w && w !== window) frames.push(w); } catch (_) {}
      }
    } catch (_) {}

    for (var j = 0; j < frames.length; j++) {
      var w2 = frames[j];
      var doc = null;
      try { doc = w2.document; } catch (_) { continue; }
      if (!doc || !doc.documentElement) continue;
      var isTop = w2 === w2.top;
      if (isTop && !isCandidateProfilePage(doc)) continue;
      if (!hasSrProfileChrome(doc)) continue;
      return await runKeywordTriageWithDoc(doc, w2, cfg, { subframeTriage: !isTop });
    }

    return {
      log: [{ ok: false, msg: "No frame had SR controls. Reload and try again." }],
      moved: false, skipped: true, matchedKeywords: [], hitCount: 0,
    };
  }

  async function runKeywordTriage(config) {
    return runKeywordTriageWithDoc(document, window, config || {}, {});
  }

  /* ── Queue bootstrap ── */

  async function startQueueFromPage(config) {
    var doc = document;
    var win = window;
    var log = [];
    var KEY = "sr_ext_keyword_triage_v1";
    var resumeWaitMs = Math.max(1500, parseInt(config.resumeWaitMs, 10) || 3000);
    var moveSettleMs = Math.max(400, parseInt(config.moveSettleMs, 10) || 1800);
    var afterMoveNavigateMs = Math.max(500, parseInt(config.afterMoveNavigateMs, 10) || 1600);
    var moveButtonReadyMs = Math.max(800, parseInt(config.moveButtonReadyMs, 10) || 4500);
    var queueReadyMaxMs = Math.max(2000, parseInt(config.queueReadyMaxMs, 10) || 16000);
    var baseState = {
      returnUrl: win.location.href,
      initialDelayMs: Math.max(400, resumeWaitMs),
      config: {
        mode: config.mode || "keywords",
        booleanQuery: config.booleanQuery || "",
        keywords: config.keywords,
        minHits: config.minHits,
        dryRun: config.mode === "boolean" ? true : config.dryRun,
        postToNotes: !!config.postToNotes,
        resumeWaitMs: resumeWaitMs,
        moveSettleMs: moveSettleMs,
        afterMoveNavigateMs: afterMoveNavigateMs,
        moveButtonReadyMs: moveButtonReadyMs,
        queueReadyMaxMs: queueReadyMaxMs,
      },
      log: [],
      results: [],
      startedAt: Date.now(),
    };

    if (typeof globalThis.__srAutoscrollApplicantListUntilLoaded === "function") {
      try {
        var si = await globalThis.__srAutoscrollApplicantListUntilLoaded();
        if (si && !si.skipped) {
          log.push({
            ok: true,
            msg:
              "Autoscrolled applicant list — " +
              si.uniqueLinks +
              " profile link(s)" +
              (si.expectedTotal != null ? " (list total " + si.expectedTotal + ")" : "") +
              (si.timedOut ? ", stopped at time cap" : "") +
              " in " +
              Math.round(si.ms || 0) +
              "ms",
          });
        }
      } catch (e) {
        log.push({ ok: false, msg: "Autoscroll failed: " + ((e && e.message) || String(e)) });
      }
    }

    var urls = harvestProfileUrls(doc, win);
    if (urls.length) {
      var state = Object.assign({}, baseState, { kind: "urls", queue: urls.slice() });
      try {
        sessionStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
        log.push({ ok: false, msg: "sessionStorage failed: " + (e && e.message) });
        return { ok: false, log: log, queued: 0 };
      }
      log.push({ ok: true, msg: "Queued " + urls.length + " profiles (URL list)" });
      win.location.replace(state.queue[0]);
      return { ok: true, log: log, queued: urls.length, mode: "urls" };
    }

    var targets = collectApplicantClickTargets(doc, win);
    if (!targets.length) {
      log.push({ ok: false, msg: "No applicant rows found — open Applicants, scroll to load names, then try again." });
      return { ok: false, log: log, queued: 0 };
    }

    var state2 = Object.assign({}, baseState, { kind: "click", clickIndex: 0, total: targets.length });
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state2));
    } catch (e) {
      log.push({ ok: false, msg: "sessionStorage failed: " + (e && e.message) });
      return { ok: false, log: log, queued: 0 };
    }
    log.push({ ok: true, msg: "Queued " + targets.length + " applicants (click names)" });
    fireClick(win, targets[0]);
    return { ok: true, log: log, queued: targets.length, mode: "click" };
  }

  /* ── Exports ── */

  globalThis.__srKeywordTriageRun = function (config) {
    return runKeywordTriage(config || {});
  };
  globalThis.__srKeywordTriageRunMulti = function (config) {
    return runKeywordTriageMultiFrame(config || {});
  };
  globalThis.__srKeywordTriageStartQueue = function (config) {
    return startQueueFromPage(config || {});
  };
  if (typeof globalThis.__srCollectApplicantClickTargets !== "function") {
    globalThis.__srCollectApplicantClickTargets = function () {
      return collectApplicantClickTargets(document, window);
    };
  }
  globalThis.__srHarvestProfileUrls = function () {
    return harvestProfileUrls(document, window);
  };
})();
