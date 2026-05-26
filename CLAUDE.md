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
