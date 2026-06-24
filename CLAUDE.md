# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NIQ TA Helper is a Chrome Manifest V3 extension for NIQ talent acquisition workflows inside SmartRecruiters. It has three features: **Mr Offer** (XLSX offer letter auto-fill), **Cost Assist** (salary budget screening), and **Keyword Search** (keyword/boolean resume tagging).

**No build step. No npm. No external dependencies.** Source files are shipped directly to Chrome.

## Running Tests

Tests use Node's built-in test runner (`node:test`) — no install needed.

```bash
# Run all tests
node --test tests/*.test.js

# Run a single test file
node --test tests/boolean-parser.test.js
node --test tests/salary-parsing.test.js
node --test tests/keyword-matching.test.js
node --test tests/keyword-expansions.test.js
```

## Loading the Extension

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked" and select this directory

After editing any file, click the refresh icon on the extension card in `chrome://extensions/`.

## Architecture

### Content Script Load Order

`manifest.json` defines two content script groups injected at `document_idle` on `*.smartrecruiters.com/*`. Order within each group matters:

**Group 1 (all frames):** `sr-list-autoscroll.js` → `salary-triage-core.js` → `keyword-expansions.js` → `keyword-triage-core.js`

**Group 2 (main frame only):** `keyword-expansions.js` → `salary-triage-autorun.js` → `keyword-triage-autorun.js`

`keyword-expansions.js` must load before `keyword-triage-core.js` because the core file reads `KEYWORD_EXPANSIONS` and `KEYWORD_TYPO_ALIASES` from the global scope set by the expansions file.

### Feature Split: Core vs Autorun

Each feature is split into two files:

- **`*-core.js`** — pure logic injected into candidate profile pages. Exposes `__sr*` globals. Testable (the test suite imports these directly via `require()`). These files use an IIFE `(function(){ "use strict"; ... })()` and also expose named exports for Node test compatibility.
- **`*-autorun.js`** — state machine that manages the URL queue stored in `sessionStorage`. Reads queue state on page load, calls core functions, then navigates to the next URL.

### Background Service Worker (`background.js`)

Stateless by design. Manages:
- Parallel keyword worker tab orchestration (creates/reuses 2–3 worker tabs, routes messages between them and the popup via `chrome.runtime.onMessage`)
- Completion notifications (`chrome.notifications`) and audio beep (injected into an active SR tab via `chrome.scripting.executeScript`, since `AudioContext` is unavailable in service workers)
- Tab cleanup on queue completion
- **Resume-render focus handshake** — worker tabs are created `active: false`, but pdf.js does not render in hidden tabs (Chrome pauses `requestAnimationFrame` when `visibilityState === "hidden"`), so the resume text layer never appears and extraction falls back to SR profile chrome. The core requests `srRequestResumeFocus` before extracting the resume; the background `resumeFocus` manager briefly foregrounds that worker tab (serialized — one at a time, focus hands off directly between workers), then restores the user's tab on `srReleaseResumeFocus` (or a 25s safety timeout). The core only requests focus when `document.visibilityState !== "visible"`, so single-tab/foreground runs are unaffected.
- **Resume attachment fallback** — when the inline viewer still won't render after the focus handshake + retries, the core clicks the "Resume" attachment (which opens the resume in a new tab) after `srArmResumeCapture`. The background catches that tab by `openerTabId`, foregrounds it so pdf.js renders, extracts text via `chrome.scripting.executeScript`, closes it, and returns the text on `srGetResumeCapture`. Only fires on chrome-only extractions, so it doesn't slow the normal path. The captured resume text lives **only in-memory** in `resumeCapture.results` (a `Map`), is deleted as soon as the worker reads it via `srGetResumeCapture`, and is never persisted to `chrome.storage`; any unread entry dies with the service worker (~30s idle). Arm entries self-expire after 15s. This in-memory-only lifecycle is intentional for GDPR data-minimization — raw resume text never touches disk here.

### Shadow DOM Traversal

SmartRecruiters uses web components (`spl-button`, `spl-tab`, `sr-link`). All DOM queries go through:
- `walkShadow(node, visitor, visited)` — depth-first traversal that crosses shadow roots
- `queryDeepSelectorAll(root, win, selector)` — shadow-piercing `querySelectorAll`

Never use plain `document.querySelector` for SR elements — it won't find them inside shadow roots.

### Anti-Detection

All navigation delays use `jitter(baseMs)` (±35% randomization). Worker tabs are reused across URLs rather than opened fresh. Do not replace `jitter()` calls with fixed delays.

### Storage Locations

- `chrome.storage.local` — all user settings and last-run results (persists across sessions)
- `sessionStorage` — URL queues for active Cost Assist and Keyword Search runs (scoped to each worker tab)

### Salary Parsing (`salary-triage-core.js`)

`parseSalaryNumber()` handles: Indian formats (LPA, lakhs, crore, Indian comma grouping), Western formats (k/K suffix, currency symbols, plain numbers), and ranges (always returns upper bound). `scoreQuestion()` uses fuzzy hint matching to identify which form field contains the salary question.

### Keyword Matching (`keyword-triage-core.js` + `keyword-expansions.js`)

Two search modes:
- **Keywords mode**: comma-separated terms with abbreviation expansion via `keyword-expansions.js`, prefix wildcard support (`Python*`), ISO list splitting, and token-index bigram matching
- **Boolean mode**: LinkedIn Recruiter syntax parsed into an AST (`parseBooleanQuery` → `evaluateBooleanAst`). Operator precedence: NOT > AND > OR. Implicit AND between adjacent terms. Quoted phrases are single TERM nodes.

### XLSX Parser (`xlsx-mini.js`)

Self-contained async XLSX parser with no external dependencies (no SheetJS, no DOM parser). Used exclusively by the Mr Offer tab for drag-and-drop offer letter field filling with fuzzy label matching and annual ↔ monthly salary derivation.

## Lessons

### Reported keyword misses: diagnose, don't guess

When a user reports "keyword X missed on profile Y", the matching logic in `keyword-triage-core.js` is rarely the cause. A keyword miss can come from any of three layers, and they need different evidence:

1. **Matching gap** — the canonical/expansion forms in `KEYWORD_EXPANSIONS` don't cover the variant used in the resume. The regex fallback in `sepFlexiblePatternSource` enforces a `(?![A-Za-z0-9])` boundary, so a single-token keyword won't match a longer compound word that contains it (e.g. `docker` won't match `Dockerfile` without an explicit expansion entry). Fix by adding the compound forms to the expansion table.
2. **Extraction failure** — the resume text never reaches `findKeywordHits`. Common in PDF resumes where pdf.js text layers don't render all pages, or where the resume tab isn't activated in time.
3. **Exclusion over-strip** — `stripExcludedText` removes ALL occurrences of any ≥10-char sidebar phrase from `allText`. If the resume and the job-description sidebar happen to share a long phrase, the resume's keywords inside that phrase are also nuked.

Before changing code: open the popup → **Inspect diagnostics** (the per-profile `lastRunDiag_<timestamp>` entries saved in `chrome.storage.local`, capped at 20). For the failing profile, grep `extractedText` and each `textSources.*` segment for the missed keyword:

- Keyword present in `extractedText` → matching bug. Fix in `keyword-expansions.js` or `findKeywordHits`.
- Keyword present in `textSources.fullPage` but not in `extractedText` → exclusion/strip bug. Fix in `stripExcludedText` or `EXCLUDED_SELECTORS`.
- Keyword absent from every source → extraction bug. Fix in the relevant `get*Text` function or the resume-tab/iframe wait logic.

Do not propose fixes from screenshots alone — unit tests with realistic text usually pass even when production fails, because the bug is upstream of matching. The diagnostic capture (added in `runKeywordTriageWithDoc` / `runBooleanTriageWithDoc`) exists specifically to remove that ambiguity.
