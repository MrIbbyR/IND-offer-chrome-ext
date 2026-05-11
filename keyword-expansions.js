// keyword-expansions.js — shared expansion table: loaded by popup.html + content scripts
// Exposes globals: KEYWORD_EXPANSIONS, KEYWORD_TYPO_ALIASES, resolveKeywords, buildExpansionTable

/* exported KEYWORD_EXPANSIONS, KEYWORD_TYPO_ALIASES, resolveKeywords, buildExpansionTable,
            parseKeywordsFromString, canonicalizeKeywords, expandKeywords, applyTypoAliases */

var _RD = ["research and development", "research & development", "r and d", "r&d"];

var KEYWORD_EXPANSIONS = {
  // ── R&D ──
  "r&d": _RD, "r and d": _RD, "r & d": _RD,

  // ── ML / AI  — bidirectional so typing the full form also catches abbreviations ──
  "ml":                          ["machine learning", "machine-learning"],
  "machine learning":            ["ml"],
  "dl":                          ["deep learning", "deep-learning"],
  "deep learning":               ["dl", "neural network", "neural networks", "neural net"],
  "ai":                          ["artificial intelligence", "artificial-intelligence"],
  "artificial intelligence":     ["ai"],
  "nlp":                         ["natural language processing", "natural-language processing"],
  "natural language processing": ["nlp"],
  "cv":                          ["computer vision"],
  "computer vision":             ["cv"],

  // ── Cloud — bidirectional ──
  "aws":                  ["amazon web services"],
  "amazon web services":  ["aws"],
  "gcp":                  ["google cloud platform", "google cloud"],
  "google cloud platform":["gcp"],
  "google cloud":         ["gcp"],
  "azure":                ["microsoft azure", "ms azure", "azure devops", "azure cloud"],
  "microsoft azure":      ["azure"],

  // ── Degrees ──
  "phd":                  ["ph.d", "ph.d.", "doctorate", "doctoral", "postdoctoral", "postdoc", "dphil", "doctor of philosophy"],
  "ph.d":                 ["phd", "ph.d.", "doctorate", "doctoral", "postdoctoral", "postdoc"],
  "ph.d.":                ["phd", "ph.d", "doctorate", "doctoral"],
  "doctorate":            ["phd", "ph.d", "doctoral", "postdoctoral", "doctor of philosophy"],
  "doctoral":             ["phd", "ph.d", "doctorate", "postdoctoral"],
  "postdoc":              ["postdoctoral", "phd", "doctoral", "doctorate"],
  "postdoctoral":         ["postdoc", "phd", "doctoral", "doctorate"],
  "dphil":                ["phd", "doctor of philosophy"],
  "doctor of philosophy": ["phd", "ph.d", "ph.d.", "doctorate", "doctoral", "dphil"],
  "ms":                   ["m.s", "m.s.", "master's", "masters", "msc", "m.sc"],
  "bsc":                  ["b.s", "b.s.", "bachelor's", "bachelors", "b.sc"],

  // ── ML frameworks ──
  "pytorch":      ["py torch", "py-torch", "torch", "pytorch lightning"],
  "tensorflow":   ["tensor flow", "tensor-flow", "tensorflow 2", "tf2", "tf.keras", "tf"],
  "tf":           ["tensorflow"],
  "keras":        ["tf.keras"],
  "sklearn":      ["scikit-learn", "scikit learn"],
  "scikit-learn": ["sklearn", "scikit learn"],
  "scikit learn": ["sklearn", "scikit-learn"],
  "xgboost":      ["xgb", "gradient boosting"],
  "xgb":          ["xgboost"],
  "lightgbm":     ["lgbm", "light gbm", "light gradient boosting"],
  "lgbm":         ["lightgbm"],
  "catboost":     ["cat boost", "gradient boosting"],

  // ── LLMs / NLP ──
  "llm":           ["large language model", "llms"],
  "llms":          ["large language models", "llm"],
  "rag":           ["retrieval augmented generation", "retrieval-augmented generation"],
  "transformer":   ["transformers"],
  "transformers":  ["transformer"],
  "bert":          ["roberta", "distilbert", "hugging face transformers"],
  "hugging face":  ["huggingface", "hf transformers"],
  "huggingface":   ["hugging face", "hf transformers"],

  // ── MLOps / DevOps ──
  "mlops":        ["ml ops", "machine learning operations", "ml operations"],
  "ml ops":       ["mlops"],
  "kubernetes":   ["k8s"],
  "k8s":          ["kubernetes"],
  "docker":       ["containerization", "container"],
  "ci/cd":        ["cicd", "ci cd", "continuous integration", "continuous deployment"],
  "cicd":         ["ci/cd", "continuous integration"],

  // ── Data engineering ──
  "pyspark":      ["apache spark", "spark ml", "spark mllib"],
  "apache spark": ["pyspark", "spark"],
  "sql":          ["structured query language"],
  "nosql":        ["no sql", "non-relational"],

  // ── Standards / domain ──
  "iso 45001":  ["iso45001", "iso-45001", "ohsms", "occupational health and safety"],
  "iso 9001":   ["iso9001", "iso-9001", "quality management"],
  "nebsh":      ["nebsh igc", "international general certificate"],
  "ctf":        ["capture the flag", "capture-the-flag"],
  "fmcg":       ["fast moving consumer goods", "fast-moving consumer goods"],
  "cpg":        ["consumer packaged goods", "packaged goods"],

  // ── API / misc ──
  "api":         ["application programming interface", "apis"],
  "ner":         ["named entity recognition"],
  "ocr":         ["optical character recognition"],
  "ir":          ["information retrieval"],
  "idp":         ["intelligent document processing"],
  "resilience":  ["resiliency", "resilient"],
  "resiliency":  ["resilience", "resilient"],
};

var KEYWORD_TYPO_ALIASES = {
  pytroch:       "pytorch",
  pytoch:        "pytorch",
  tensorlfow:    "tensorflow",
  tensorfow:     "tensorflow",
  tenserflow:    "tensorflow",
  azuer:         "azure",
  resilence:     "resilience",
  reslience:     "resilience",
  resliency:     "resiliency",
  scikitlearn:   "scikit-learn",
  sckitlearn:    "scikit-learn",
  hugginface:    "hugging face",
  huggingfaces:  "hugging face",
};

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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    KEYWORD_EXPANSIONS: KEYWORD_EXPANSIONS,
    KEYWORD_TYPO_ALIASES: KEYWORD_TYPO_ALIASES,
    resolveKeywords: resolveKeywords,
    buildExpansionTable: buildExpansionTable,
    parseKeywordsFromString: parseKeywordsFromString,
    canonicalizeKeywords: canonicalizeKeywords,
    expandKeywords: expandKeywords,
    applyTypoAliases: applyTypoAliases,
  };
}
