---
description: "Scaffold a feature that integrates the Beast Mode web dashboard (@beast-mode/web) into this project's own app, then hand off to /plan-feature. Usage: /integrate-web-app"
---

You are scaffolding a **new feature** that integrates the `@beast-mode/web` dashboard package into the user's own application — so they can embed a Beast Mode project view inside their app instead of (or alongside) the Discord bridge or standalone server.

This command runs **inside a project** that already has Beast Mode installed (`docs/features/` exists). It writes exactly one file — `requirements.md` — and then hands off. **It does not implement anything.**

---

## Process

### Step 1: Welcome & Overview

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTEGRATE THE BEAST MODE WEB APP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This will:
  - Pick (or create) the right place for this work — inside
    a "dev-ops"-like epic if this project has one, otherwise
    as a top-level feature
  - Look at your app to see whether embedding is feasible
    (a React app? an admin section to put it in?)
  - Write a requirements.md describing the integration
  - Hand off to /plan-feature so the normal Beast Mode
    workflow plans and implements it

This command writes NO implementation code — just the
requirements doc and a clear next step.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Confirm `docs/features/` exists in this project. If not:
```
❌ Beast Mode doesn't appear to be installed in this project.

Run /install-beast-mode first.
```
Stop if missing.

---

### Step 2: Choose the Target Location

**Check for epics first.** List every directory under `docs/features/` that has an `epic-overview.md` (the epic marker):

```bash
for d in docs/features/*/; do [ -f "$d/epic-overview.md" ] && basename "$d"; done
```

If any epics exist, read `.claude/epic-resolution.md` and apply its epic-detection rules (§1) before proceeding — it is the single source of truth for what counts as an epic and how references into it are formed.

**Look for a "dev-ops"-like epic.** For each epic found, read its `epic-overview.md` title and opening description. It's a dev-ops-like epic if the folder name or description matches (case-insensitive) any of: `dev-ops`, `devops`, `platform`, `infra`, `infrastructure`, `tooling`, `internal-tools`, `ops`.

- **Exactly one match** → place the new feature inside it: `docs/features/<epic>/web-app-integration/`. Announce this: `Placing this inside the "<epic>" epic (docs/features/<epic>/web-app-integration/).`
- **More than one match** → use `AskUserQuestion` to ask which epic to use (or "neither, use a top-level feature").
- **No match** → use a top-level feature: `docs/features/web-app-integration/`.

**Confirm the feature name.** Default is `web-app-integration`. If a folder of that name already exists at the chosen location, ask the user for a different name (e.g. `admin-dashboard-integration`) with `AskUserQuestion` rather than overwriting.

Record the resolved reference as `<ref>` (either `web-app-integration` or `<epic>/web-app-integration`) — this is what gets handed to `/plan-feature` in Step 5.

---

### Step 3: Inspect the Current Project for Feasibility

Gather signal about whether — and where — embedding is feasible. None of this writes any file; it's read-only investigation.

1. **Is this a React app?**
   ```bash
   grep -E '"react"|"react-dom"' package.json 2>/dev/null
   ```
   Note the React major version if found (the package's peer range is `^18 || ^19`). If there's no `package.json` or no React dependency, note that plainly — integration may still be possible via the backend alone, or the frontend recipe becomes aspirational (documented but not directly embeddable yet).

2. **Is there a router, and which one?** Check for `react-router-dom`, Next.js (`next` in `package.json` + `app/`/`pages/` directory), or another routing setup. This determines what `RoutingAdapter` the requirements should call for.

3. **Is there an existing admin/internal section?** Look for common patterns:
   ```bash
   find . -maxdepth 4 -type d \( -iname "admin" -o -iname "internal" -o -iname "dashboard" \) -not -path "*/node_modules/*" 2>/dev/null
   grep -rniE "path.{0,10}[\"']\/admin|route.{0,10}[\"']\/admin" --include="*.tsx" --include="*.ts" --include="*.jsx" --include="*.js" -l . 2>/dev/null | grep -v node_modules | head -10
   ```
   Record the best candidate directory/route (e.g. `src/admin/`, `app/admin/`, a `/admin` route defined in a router config) — this becomes the suggested mount point. If nothing is found, note explicitly that **no admin section was detected** and that the requirements should propose a new route/page instead.

4. **Is there an existing auth system to inject?** Look for an obvious auth context/provider/hook (`AuthProvider`, `useAuth`, `authContext`, a `next-auth` config, etc.). Note what's found (or that none was found, in which case the default no-auth adapter applies).

5. **Package manager / how the project would consume `@beast-mode/web`.** Check for `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, or `bun.lock` to know what install command to suggest in the requirements (`npm install`/`yarn add`/`pnpm add`/`bun add @beast-mode/web`).

Summarize findings before writing the doc:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT INSPECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

React:          [version, or "not detected"]
Router:         [react-router-dom vX / Next.js / none detected]
Admin section:  [path found, or "none detected — will propose a new route"]
Existing auth:  [what was found, or "none detected — default no-auth adapter"]
Package mgr:    [npm/yarn/pnpm/bun]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### Step 4: Write `requirements.md`

Write `docs/features/<ref>/requirements.md` (creating the directory if needed). Use this shape — **Overview / Requirements / Dependencies / Out of Scope** — filled in with the Step 3 findings:

```markdown
# Web App Integration — Requirements

**Status:** Proposed
**Created:** <today's date>

---

## Overview

Embed a Beast Mode project view directly into this app using
`@beast-mode/web`, so [team/users] can see feature boards, bugs,
git status[, and epics] without leaving [the app name] or needing
the Discord bridge / standalone server.

[One or two sentences tailored to what Step 3 found — e.g. "This
app is a React <version> app using <router>, with an existing
admin section at <path>." or, if nothing was detected, "This app
does not currently have a dedicated admin/internal section or an
existing React frontend — this integration may require adding
one, or exposing the backend only."]

---

## Requirements

### Frontend

1. **Add the project view** via `@beast-mode/web/frontend`:
   - Single-project embed: `<BeastWebProvider singleProject="<project-name>"><ProjectDashboard /></BeastWebProvider>`
   - Or the full multi-page shell: `<BeastWebProvider><BeastWebApp /></BeastWebProvider>` (only if this app wants the complete dashboard, not just one view)
   - Import `@beast-mode/web/styles.css` (prebuilt CSS) or the `@beast-mode/web/tailwind-preset` if this app already builds Tailwind.

2. **Placement:** [`Mount inside the detected admin section at <path>` OR, if none was found, `Add a new route (e.g. /admin or /internal/beast-mode) since no existing admin section was detected`].

3. **Inject this app's own adapters** (the library is batteries-included but overridable — nothing here is mandatory to accept):
   - **Auth adapter** (`AuthAdapter`: `getUser`/`login`/`logout`) — wire to [the auth system found in Step 3, or "no existing auth found; default no-auth adapter is acceptable for an internal-only route"].
   - **Routing adapter** (`RoutingAdapter`) — wire to [the router found in Step 3, or "the default react-router adapter, since react-router-dom is already a dependency" / "a custom adapter, since this app uses <framework>'s own router"].
   - **API client** (`apiClient`/`baseUrl`) — default fetch client is fine if the API route (below) is same-origin; override only if the backend lives elsewhere.

### Backend

4. **Wire an API route** using `@beast-mode/web/backend`'s `createBeastBackend({ context, auth })`:
   - Supply a `ProjectProvider` that resolves to this app's own project path(s) (single-project is the common case: one `ProjectRef` for this repo).
   - Supply an `AuthMiddleware` built from this app's existing auth (or omit it for an open, internal-only route).
   - Mount `.handle(req, url)` at `/api/beast-mode/*` (or this app's preferred internal API prefix) in [this app's existing server / API route framework].
   - **Alternative:** if this app has no natural place to host an API route, point the frontend's `apiClient` at a separately-run `@beast-mode/web/server` standalone instance instead (see `/setup-web-app`) rather than embedding the backend in-process.

### General

5. The library still exposes the full multi-project view and endpoints — `singleProject` only hides the switcher in the frontend; nothing needs to change on the backend to support a single project.
6. Follow this app's own conventions for the actual mount (component naming, folder structure, lint rules) — the library provides the pieces, not the wiring style.

---

## Dependencies

- **`@beast-mode/web`** (workspace/local link for now — the package is publish-ready but not yet published to a registry). Install via `<npm install|yarn add|pnpm add|bun add> @beast-mode/web` once a consumable build is available (file link, tarball, or registry, depending on how this repo and the Beast Mode plugin repo relate).
- **Peers:** `react` ^18 || ^19, `react-dom` ^18 || ^19 (already present in this app). `react-router-dom` ^7 only if using the default `<BeastWebApp>` shell or its routing adapter — [present / not present] in this app.
- **Detected admin section:** [path, or "none — a new route/page is required"].
- **Detected auth system:** [what was found, or "none — default no-auth adapter"].

---

## Out of Scope

- **Implementation.** This doc only captures requirements — no code is written by this command. Implementation happens under `/plan-feature <ref>`.
- **Publishing `@beast-mode/web` to a package registry.** Out of scope for this integration; consume it however this app and the Beast Mode plugin repo are already related (local link, workspace, or a private registry if one exists).
- **Changing the Beast Mode plugin's Discord bridge or standalone server.** This integration is additive to this app only.
- **Styling beyond the shipped preset/CSS**, unless this app's design system requires deeper theming — call that out separately if so.
```

Fill in every bracketed placeholder with the real values from Step 2/3 — do not leave literal `[...]` text in the written file.

Show the user:
```
📝 Wrote docs/features/<ref>/requirements.md
```

---

### Step 5: Hand Off

Do **not** implement anything and do **not** run `/plan-feature` yourself. Tell the user exactly what to run next:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIREMENTS READY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Wrote: docs/features/<ref>/requirements.md

Next step — let Beast Mode plan the integration:

  /plan-feature <ref>

This will read the requirements above, ask any clarifying
questions, and produce an implementation.md before any code
is written.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use the real resolved `<ref>` value (e.g. `web-app-integration` or `dev-ops/web-app-integration`), not the literal placeholder.

---

## Epic awareness

This command is epic-aware. Before choosing where to write `requirements.md`,
read `.claude/epic-resolution.md` and apply its rules: detect epics by
`epic-overview.md`, and — if a dev-ops-like epic exists — place the new
feature at `<epic>/web-app-integration` per its `<epic>/<feature>` reference
convention. If no epics exist in `docs/features/`, use a top-level feature
(`web-app-integration`) exactly as before.

---

## Important Notes

1. **Writes exactly one file.** `docs/features/<ref>/requirements.md` — nothing else. No `implementation.md`, no `context.md`, no `tasks.md`, no source code. Those are `/plan-feature`'s and `/start-feature`'s job.
2. **Read-only inspection.** Step 3's detection (React, router, admin section, auth) only reads the project — it never modifies source files.
3. **If nothing looks embeddable** (no React app, no obvious place to mount anything), still write the requirements — just say so plainly in the Overview and Dependencies sections instead of guessing. The user (and `/plan-feature`) can decide how to proceed from there.
4. **Do not touch `bot/`, `web/`, or the Beast Mode plugin repo itself** — this command runs inside the *consumer* project and only ever writes into that project's own `docs/features/`.
