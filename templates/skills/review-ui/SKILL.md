---
name: review-ui
description: "Run UI/UX quality review -- layout, a11y, tokens, CSS, and live browser audit via the browser automation tool. Usage: /review-ui [layer]"
argument-hint: "[layer]"
user-invocable: true
---

You have been asked to run a UI/UX quality review on the frontend codebase.

**Target layer:** `$ARGUMENTS`

## Harness

This command runs on any agent harness. Read `.beast-mode/harness.md` first.
It maps the neutral terms in this command to the tools of this harness.
Terms include: ask the user to choose, delegate to an agent, search the web,
and the harness skills directory. Use the mapped tool. Do not use a tool name
from another harness.

## Epic awareness

This command is epic-aware. Before resolving `$ARGUMENTS` to a feature path,
read `.beast-mode/epic-resolution.md` and apply its rules: detect epics by
`epic-overview.md`, resolve `<epic>/<feature>` references, fuzzy-fall-back into
epic folders for bare names, and operate across all of the epic's features when the target is an epic (aggregate findings, keep per-feature attribution).
If no epics exist in `docs/features/`, behave exactly as before.

`.beast-mode/epic-resolution.md` is the single source of truth for epic detection and resolution. This command's body is the review-ui workflow; it does **not** re-specify those rules. `$ARGUMENTS` here is normally a **layer** (`layout` / `css` / `tokens` / `live` / …). Only when it resolves to an **epic** (bare name with `epic-overview.md`, not a layer keyword) follow the **Epic-scope mode** below; the layer keywords and the no-argument full review are unchanged.

### Epic-scope mode (when `$ARGUMENTS` is an epic)

Review the **UI across all of the epic's features**, then aggregate — keeping which feature each finding belongs to.

1. **Read the epic.** Read `docs/features/<epic>/epic-overview.md` (Features table = the feature set) and identify each child feature's UI surface from its `context.md` Key Files.
2. **Run the layers over the union of those surfaces** (layout, utility-class order, CSS a11y, design tokens, Lighthouse, and the optional live audit) — the full review across the epic, not one feature. Design-token and CSS-consistency findings are especially valuable here: drift *between* features (feature A uses the token, feature B hardcodes the hex) is what a single-feature pass misses.
3. **Keep per-feature attribution.** Findings are reported as `[LAYER] File:line` — prefix each with the feature: `[TOKENS] base — components/X.tsx:42`, `[LAYOUT] ux — …`. Group the Findings Summary so each finding stays mapped to its feature (a per-feature sub-grouping, or the `<feature>` prefix on every line). Never a flat list that loses the feature.
4. **One combined Findings Summary** for the epic (the layer status table reflects the worst status across features per layer), then **STOP and ask** exactly as the single-scope flow.

A non-epic `$ARGUMENTS` (a layer keyword, `fix`, or empty for a full single-surface review) is unchanged — follow the Process below.

## What This Reviews (separate from /review-feature and /review-ux)

| Layer | What It Catches |
|-------|----------------|
| **Layout & Viewport Audit** | Hidden buttons, broken scroll, overlapping elements, horizontal overflow, z-index wars |
| **Tailwind / Utility Class Ordering** | Inconsistent class order in `cn()` / `cva()` / `twMerge()` calls |
| **CSS Accessibility** | `outline:none` killing focus indicators, unreadable font sizes, `!important` abuse |
| **Design Token Enforcement** | Hardcoded `#hex`, raw `px`/`rem`, colours outside theme, arbitrary Tailwind values |
| **Lighthouse a11y** | Real-world contrast ratios, tap target sizes, heading order, ARIA validity |
| **Live Browser Audit (browser automation tool)** | Wrong component for a state, computed-style cascade leaks, server response vs visual drift, fidelity contracts (preview = sent output) |

## CRITICAL RULE: Report First, Fix Later

**NEVER auto-fix or implement fixes without explicit user approval.**

The review process is strictly:

1. Run all checks
2. Collect and analyse all findings
3. Present a **Findings Summary** to the user (see format below)
4. **STOP and ask the user** which findings to fix
5. Only implement fixes the user explicitly approves

This applies to ALL review modes -- full review, individual layers, and even when `$ARGUMENTS` is `fix`. Always show what will be changed first.

## Process

1. **Determine What to Run:**
   - If `$ARGUMENTS` is empty -> run ALL layers (full review)
   - If `$ARGUMENTS` is `layout` -> run only layout audit
   - If `$ARGUMENTS` is `format` -> run only Prettier / utility class ordering
   - If `$ARGUMENTS` is `css` -> run only Stylelint CSS accessibility
   - If `$ARGUMENTS` is `tokens` -> run only design token audit
   - If `$ARGUMENTS` is `lighthouse` -> run only Lighthouse accessibility
   - If `$ARGUMENTS` is `live` -> run the Live Browser Audit (the browser automation tool, see section below)
   - If `$ARGUMENTS` is `fix` -> show what would be fixed, then ask before applying

2. **Run static checks via project scripts:**

   Static layers (layout, format, css, tokens, lighthouse) should delegate to the project's own scripts. Common patterns are `npm run ui:review`, `npm run ui:review:<layer>`, or per-tool commands like `npx prettier --check`, `npx stylelint`, `npx playwright`. If the project does not have any UI review scripts wired up, skip the static layers and tell the user which tools you'd recommend wiring in (Prettier, Stylelint, Playwright + axe, Lighthouse).

3. **Analyse Results and Build Findings Summary**

   Parse the output from each layer. Categorise every finding by severity:
   - **CRITICAL**: Must fix -- hidden buttons, broken scroll, overlap, horizontal overflow
   - **WARNING**: Should fix -- hardcoded tokens, CSS a11y issues, class order, tiny tap targets
   - **PASS**: Layer clean
   - **SKIPPED**: Dev server not running (live + layout + lighthouse need it)

4. **Present Findings Summary (MANDATORY before any fixes)**

   ```
   ## /review-ui Findings Summary

   | Layer | Status | Errors | Warnings |
   |-------|--------|--------|----------|
   | Layout & Viewport | PASS/FAIL | X | Y |
   | Utility Class Order | PASS/FAIL | X | Y |
   | CSS Accessibility | PASS/FAIL | X | Y |
   | Design Tokens | PASS/FAIL | X | Y |
   | Lighthouse a11y | PASS/FAIL | X | Y |
   | Live Browser Audit | PASS/FAIL | X | Y |

   ### Critical Findings (must fix)
   1. [LAYER] File:line -- description

   ### Warnings (should fix)
   1. [LAYER] File:line -- description

   ### Auto-fixable
   - X files can be auto-fixed by the project's `--fix` scripts

   ### Manual Fixes Required
   - Each manual fix with the specific code change needed

   ---
   **What would you like to fix?**
   - "fix all" -- apply auto-fixes + manual fixes
   - "auto-fix only" -- formatter + linter --fix
   - "fix [specific items]" -- cherry-pick
   - "none" -- review only, no changes
   ```

5. **Wait for User Response**

   Do NOT proceed with any fixes until the user explicitly tells you what to fix.

---

## Live Browser Audit (the browser automation tool)

`/review-ui live` runs an interactive audit against a running app with the browser automation tool. It catches a class of bugs static analysis fundamentally cannot see:

- **Wrong component rendered for a state** -- a dispatch switches on one field but ignores a second one that should also gate the routing. The static types match; the wrong child renders. Only a real click + a read of what rendered proves which branch fired.
- **Computed-style cascade leaks** -- a CSS variable from a parent theme cascades into a region that should use its own palette. Authored CSS looks fine; `getComputedStyle()` reveals the override.
- **Fidelity drift between two render paths** -- the UI shows a preview rendered by the same code that produces the final output... except an intermediate transform was skipped in one path. The preview looks "close enough" until you call the underlying endpoint directly and diff its response against what the user-facing path produces.
- **Server response vs visual** -- a list shows 5 items but the API returned 7; a button is enabled but the mutation 400s; a form persists state across navigations it shouldn't. Compare DOM to network.

When NOT to use: the user did not ask for a live check, or the question is purely about authored code shape (those go to `/review-feature` / `/review-ux`). The live audit has a real wall-clock + RAM cost (see Memory hygiene).

### Boundary with /review-feature and /review-ux

The three `/review-*` commands target deliberately non-overlapping concerns. Send a finding to the command whose audience would actually read the report it belongs in.

|  | `/review-feature` | `/review-ui` | `/review-ux` |
|---|---|---|---|
| **Asks** | Is the **code** well-written? | Does the **implementation** work correctly? | Does the **experience** feel right to a real user? |
| **Domain** | React / JS patterns, bundle, re-renders, composition, hook discipline | CSS, layout, design tokens, contrast, component-for-state routing, server-vs-visual fidelity | User journeys, cognitive load, focus order, microinteractions, empty/error/interrupted states |
| **Static or Live** | Static only (code-as-text) | Static + optional live browser | Static + optional live browser |
| **Browser automation tool** | Never | `/review-ui live` -- verify component routing, computed styles, server response vs visual | `/review-ux live` -- verify focus order, interaction timing, rendered text in bad-path states |
| **Example bug** | Barrel import dragging 200KB of unused module; useState derived in an effect; missing React.memo on a hot list row | Wrong properties panel rendered for a widget state; CSS variable cascade leak hiding text; preview endpoint silently skipping a transform the sender runs | 6-tap flow that should be 2 with smart defaults; "Something went wrong" error that says nothing actionable; broken keyboard Tab order across a modal |
| **Findings ID** | CR-N | (project convention) | UX-N (dimension) / F-N (friction) |
| **Audience** | Engineer reviewing PRs | Engineer + designer triaging visual quality | Designer + PM + end-user advocate |

Rule of thumb:
- Pattern that violates a Vercel React best practice -> `/review-feature`
- Pattern that produces a CSS / wiring / fidelity bug -> `/review-ui`
- Pattern that produces a worse experience for the persona -> `/review-ux`

If the same finding plausibly fits two commands, ask: **which report would I send it to?** Engineer PR review = CR. Visual-quality triage = UI. Designer / PM strategy review = UX.

### Process

#### 1. Acquire a tab

Open a tab with the browser automation tool, and create a tab group when none exists.

This must be the first call to the tool. It returns the tab IDs you will use for everything else, and it creates a new tab group rather than hijacking the user's existing browser session.

#### 2. Navigate + sign in (if needed)

If the app needs auth and the user is not logged in, ask the user to sign in manually in the browser window, then continue. Do NOT type passwords -- credential entry is a privileged action that belongs to the user.

#### 3. Batch every click + read

Every UI action you would do serially -- click button, wait, read panel, click next button -- compresses into ONE batched call to the browser automation tool. The round-trip cost dominates, and sequential calls are roughly 3-5x slower for the same work.

One batch holds the whole logical step, in order:

1. Click the target element in the tab.
2. Run a JavaScript expression in the same tab that waits ~300ms, then returns the rendered text, for example `document.querySelector("[role=dialog] h3")?.textContent`.
3. Read the page back, scoped to the panel that changed, with a character limit.

Patterns worth keeping handy:

- **Click + small await + read** -- React (and most reactive frameworks) need one tick to re-render after a click. A 200-300ms sleep inside the JS expression is enough.
- **Loop in JS, not in tool calls** -- to click every item in a list and capture the resulting state for each, write ONE JavaScript expression that loops `for (const el of items) { el.click(); await sleep(200); results.push(captureState()); }`. Returning the array is one round trip.
- **Read only what you need** -- scope the page read to one subtree. Drops noise, and lets you read deeper without blowing past the character limit.

#### 4. Inspect computed style, not declared CSS

`getComputedStyle(el)` returns what the browser actually renders after the cascade resolves. This is the only way to catch a parent's CSS variable leaking into a child.

Run this in the page with the browser automation tool:

```js
(() => {
  const el = document.querySelector('YOUR_TARGET_SELECTOR');
  const cs = window.getComputedStyle(el);
  const vars = {};
  // List whichever CSS custom properties matter for this region.
  for (const v of ['--primary', '--text', '--bg']) {
    vars[v] = cs.getPropertyValue(v).trim();
  }
  return { color: cs.color, bg: cs.backgroundColor, vars };
})()
```

When the authored styles look correct but the rendered colour is wrong, the answer is almost always in the computed CSS variables -- one theme is overriding another at a higher specificity than the author expected.

#### 5. Verify server response against visual

When the page renders something based on an API response (a preview iframe, a list, a chart), call the same endpoint via `fetch()` from the page context and diff against what is on screen. Cookies and `credentials: 'include'` travel automatically, so authenticated routes Just Work.

Run this in the page with the browser automation tool:

```js
(async () => {
  const res = await fetch('/your/api/endpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ /* same payload the component sends */ })
  });
  const data = await res.json();
  return {
    status: res.status,
    // Pick predicates that prove the transform you expect actually ran.
    hasExpectedShape: /* ... */,
    hasUnexpectedMarker: /* a placeholder that should have been resolved */,
    length: JSON.stringify(data).length
  };
})()
```

This pattern reliably catches "two render paths that were supposed to be identical, aren't" -- e.g. a preview controller skips a step the production sender runs. The visual gives no hint; the fetch reveals the missing transform in the returned payload.

#### 6. When iframes block you, hit the endpoint directly

The browser automation tool refuses to expose iframe `srcdoc` or `contentDocument` for safety (cookie / query-string data could leak through). Do not fight it. If the iframe is rendering a response from an endpoint you control, `fetch()` the endpoint with the same payload the component sends and inspect that. The iframe is just a viewport on the same data.

#### 7. Critical-flow tap-list

For each surface under audit, click through:

- Every tab in the primary nav
- Every modal-opening button (and verify the modal renders + closes)
- Every form's submit, plus cancel / back paths
- Every list item's edit / delete flow

Two clicks deep, minimum. Most fidelity bugs hide inside the second screen, not the home view.

#### 8. Close the browser when done

Close the audit tab with the browser automation tool. Then check the shell for a leftover browser process, and kill it when the tool left one behind.

### Memory hygiene

The browser automation tool holds a browser renderer and a helper process. Together they sit around 1.3 GB resident. Leaving them running between unrelated tasks crowds out the dev server + tests + everything else. The rule:

- Open when you need it
- Do the audit
- Close it immediately

If you are not actively driving the browser within the next minute or two of work, kill it. The startup cost on re-open is a few seconds; the cost of running out of RAM mid-build is much worse.

### Findings report

Add a Live Audit section to the standard report:

```
### Live Audit (browser)
- [PASS/FAIL] Component routing: <which surfaces clicked, which children rendered>
- [PASS/FAIL] Computed-style cascade: <variables verified, leaks found>
- [PASS/FAIL] Server-render fidelity: <endpoints fetched, drift found>
- [Bug] <one-line summary> -- file:line, evidence (computed style / fetch diff)
```

File:line + a one-line repro is mandatory for any live-audit bug -- without it the finding is hard to reproduce later.

---

## Important Notes

- **ALWAYS report before fixing** -- this is the #1 rule
- This is **on-demand only** -- not in git hooks, CI, or PR checks
- Does NOT duplicate `/review-feature` (ESLint, basic a11y, TypeScript) or `/review-ux` (Nielsen heuristics, task flows, journey analysis)
- Browser-based layers (live + layout + lighthouse) require the dev server running
- Authenticated routes need a logged-in browser session before the audit starts
