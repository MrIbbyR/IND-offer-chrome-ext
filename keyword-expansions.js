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

  // ── Cloud / Kubernetes managed services ──
  // Abbreviations a recruiter types that the resume may write in full.
  "gke":                       ["google kubernetes engine"],
  "google kubernetes engine":  ["gke"],
  "eks":                       ["amazon elastic kubernetes service"],
  "amazon elastic kubernetes service": ["eks"],
  "aks":                       ["azure kubernetes service"],
  "azure kubernetes service":  ["aks"],

  // ── IAM protocol / standard abbreviations ──
  "sso":                       ["single sign-on", "single sign on"],
  "single sign-on":            ["sso"],
  "single sign on":            ["sso"],
  "mfa":                       ["multi-factor authentication", "multifactor authentication", "two-factor authentication", "2fa"],
  "2fa":                       ["mfa", "multi-factor authentication", "two-factor authentication"],
  "multi-factor authentication": ["mfa", "2fa"],
  "saml":                      ["security assertion markup language"],
  "oauth":                     ["oauth 2.0", "open authorization"],
  "oidc":                      ["openid connect"],
  "openid connect":            ["oidc"],
  "ldap":                      ["lightweight directory access protocol"],
  "active directory":          ["microsoft active directory"],
  "azure ad":                  ["azure active directory", "entra id", "microsoft entra"],
  "entra":                     ["entra id", "azure ad", "azure active directory"],
  "entra id":                  ["azure ad", "azure active directory", "microsoft entra"],

  // ── PAM / identity governance tools ──
  "cyberark":                  ["cyber ark"],
  "cyber ark":                 ["cyberark"],
  "forgerock":                 ["forge rock"],
  "forge rock":                ["forgerock"],
  "beyondtrust":               ["beyond trust"],
  "beyond trust":              ["beyondtrust"],
  "pam":                       ["privileged access management"],
  "privileged access management": ["pam"],
  "iga":                       ["identity governance and administration", "identity governance"],
  "identity governance":       ["iga"],

  // ── IAM / Identity & Access Management tools ──
  // ping / pingidentity: typed as one word but resumes often write "Ping Identity" (two words).
  // "ping" expands to compound forms; "pingidentity" expands to the spaced two-word form
  // so both canonicals hit for any way a resume can write the product name.
  "ping":            ["pingidentity", "ping federate", "pingfederate", "ping one"],
  "pingidentity":    ["ping identity", "ping federate", "pingfederate"],
  "ping federate":   ["pingfederate"],
  "pingfederate":    ["ping federate"],
  // sailpoint: SailPoint is almost always written as one CamelCase word ("SailPoint") or two
  // words ("Sail Point"); the regex catches SailPoint but misses the spaced form.
  "sailpoint":       ["sail point", "sailpoint iiq", "sailpoint identitynow"],
  "sail point":      ["sailpoint"],
  // okta: single token, matches all case forms natively — minimal expansions for sub-products.
  "okta":            ["okta workforce", "okta verify", "okta sso"],
  // ciam: the spelled-out form appears frequently in job descriptions and resumes.
  "ciam":            ["customer identity and access management",
                      "consumer identity and access management",
                      "customer iam"],
  // iam: general IAM — useful when recruiter types the abbreviation.
  "iam":             ["identity and access management", "identity access management"],
  "identity and access management": ["iam"],
};

var KEYWORD_TYPO_ALIASES = {
  pytroch:         "pytorch",
  pytoch:          "pytorch",
  tensorlfow:      "tensorflow",
  tensorfow:       "tensorflow",
  tenserflow:      "tensorflow",
  azuer:           "azure",
  resilence:       "resilience",
  reslience:       "resilience",
  resliency:       "resiliency",
  scikitlearn:     "scikit-learn",
  sckitlearn:      "scikit-learn",
  hugginface:      "hugging face",
  huggingfaces:    "hugging face",
  sailpiont:       "sailpoint",
  salipoint:       "sailpoint",
  pingidentiy:     "pingidentity",
  pingidentitiy:   "pingidentity",
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

/**
 * Like resolveKeywords but also returns a canonicalMap so callers can fold
 * expansion aliases back to the keyword the user actually typed.
 *
 * Returns:
 *   keywords    — full expanded + deduped list (same as resolveKeywords)
 *   canonicalMap — { [lowerForm]: userTypedCanonical }
 *   userCount   — number of keywords before expansion (the user-typed set)
 *
 * Rules:
 *   • Every user-typed keyword maps to itself.
 *   • Every auto-expansion maps to the user keyword that generated it,
 *     UNLESS it was also typed directly by the user (in which case it maps
 *     to itself and is its own canonical group).
 */
function resolveKeywordsWithMeta(rawInput) {
  var table = buildExpansionTable();
  var parsed = parseKeywordsFromString(rawInput);
  var typoFixed = applyTypoAliases(parsed);
  var userKeywords = canonicalizeKeywords(typoFixed);

  var canonicalMap = Object.create(null);
  for (var i = 0; i < userKeywords.length; i++) {
    canonicalMap[userKeywords[i].toLowerCase()] = userKeywords[i];
  }

  var expanded = userKeywords.slice();
  var expandedLower = Object.create(null);
  for (var ei = 0; ei < expanded.length; ei++) expandedLower[expanded[ei].toLowerCase()] = true;

  for (var k = 0; k < userKeywords.length; k++) {
    var key = userKeywords[k].toLowerCase();
    var forms = table[key];
    if (!forms) continue;
    for (var f = 0; f < forms.length; f++) {
      var fl = forms[f].toLowerCase();
      if (expandedLower[fl]) continue;
      expanded.push(forms[f]);
      expandedLower[fl] = true;
      if (!canonicalMap[fl]) canonicalMap[fl] = userKeywords[k];
    }
  }

  return {
    keywords: canonicalizeKeywords(expanded),
    canonicalMap: canonicalMap,
    userCount: userKeywords.length,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    KEYWORD_EXPANSIONS: KEYWORD_EXPANSIONS,
    KEYWORD_TYPO_ALIASES: KEYWORD_TYPO_ALIASES,
    resolveKeywords: resolveKeywords,
    resolveKeywordsWithMeta: resolveKeywordsWithMeta,
    buildExpansionTable: buildExpansionTable,
    parseKeywordsFromString: parseKeywordsFromString,
    canonicalizeKeywords: canonicalizeKeywords,
    expandKeywords: expandKeywords,
    applyTypoAliases: applyTypoAliases,
  };
}
