# The dsh Web Panel

The dsh web panel puts the whole Beast Mode dashboard inside the dsh web UI. A dsh user reads and writes feature docs, and starts a Beast Mode command, without a second server and a second port.

This guide pins DeepSeek Harness (dsh) version `0.1.5-rc.1`. A later preview build may move a surface this guide names.

---

## The tab

The panel is a "Beast Mode" tab beside the Chat tab, on the `conversation.view` slot. The tab fills the conversation area, and the dashboard scrolls inside it.

The tab finds its workspace in three steps.

1. The current session's id resolves to the workspace whose session list holds it.
2. When no session matches, the tab keeps the workspace it resolved last, while the list still holds that workspace.
3. When nothing resolves and the list holds exactly one workspace, the tab uses that one.

A blank session with no match shows the sentence "Open a session in a workspace to see this panel."

---

## The five render states

| State | What the tab shows |
| --- | --- |
| No workspace resolves | "Open a session in a workspace to see this panel." |
| The host index fetch is in flight | "Loading the Beast Mode panel..." |
| The fetch fails, or no entry matches the workspace | "The Beast Mode panel is not available in this dsh profile." plus a Retry button |
| The entry reports `installed: false` | "Beast Mode is not installed in this workspace. Run /install-beast-mode in a session." plus a Retry button |
| The entry reports `installed: true` | the `<iframe>` that holds the dashboard |

---

## The two routes

One host plugin, `dsh/lib/panel.js`, registers two `webServer` prefix routes on the same origin as the rest of the dsh web UI. No CORS header applies. Both routes sit behind the dsh web gate, which the next section describes.

| Prefix | Serves |
| --- | --- |
| `/beast/api/` | The Beast Mode API, over a `ProjectProvider` built from the dsh workspace registry |
| `/beast/ui/` | The prebuilt dashboard SPA, from `dsh/panel/spa/` |

The `/beast/api/` prefix mounts the full `@beast-mode/web` route set, including `GET /api/tokens/<project>`, and the host's own `BEAST_MODE_CLI` environment variable resolves the CLI for that route the same way the standalone server does.

`GET /beast/api/panel` is the one route the host owns outright. It answers the workspace list, with a derived project name and an `installed` flag per workspace:

```json
{
  "version": 1,
  "beastModeVersion": "5.5.0",
  "workspaces": [
    { "workspaceId": "9f0c...", "title": "beast-mode", "project": "beast-mode", "installed": true }
  ]
}
```

`installed` is the result of one filesystem check on `<workspace path>/docs/features`. The tab reads this one route to pick its render state and to resolve the project name for its `<iframe>` URL.

---

## The dsh web gate

Both routes sit behind the dsh web gate. The dsh gate is per route, and `webServer.register` adds no gate of its own, so each route asks for one.

At request time the route reads the dsh `connection` service with `ctx.get('connection')`. It then calls `requestRejection(req)` before it does any other work. That call applies the Host and Origin fence first, and then the browser session cookie check. It returns one of three values.

| Result | The route answers |
| --- | --- |
| `undefined` | The request passes to the handler |
| `401` | 401, and the handler never runs |
| `403` | 403, and the handler never runs |

`/beast/api/` answers a JSON body for every status, because the API prefix stays JSON only. `/beast/ui/` answers the plain body of the dsh routes, `unauthorized` or `forbidden`.

A `connection` service that is absent, and a gate call that throws, close both routes with 503 and one log line. The 503 takes the same body split: JSON on the API prefix, and the plain body `service unavailable` on the UI prefix. An open route gives every client on the port read and write access to the project files, so a closed panel is the safer failure.

The gate asks the user for no extra step. The dsh page itself sits behind the same gate, so the browser holds the session cookie before the tab renders. The `<iframe>` loads from the same origin, so the cookie travels with the SPA document and with every asset of it.

A direct probe with `curl` needs that cookie. The token URL that `dsh web` prints mints it:

```bash
# Use the exact line that dsh web prints.
curl -s -c /tmp/dsh-cookies.txt -o /dev/null 'http://127.0.0.1:3081/?token=<token>'
curl -s -b /tmp/dsh-cookies.txt http://127.0.0.1:3081/beast/api/panel
```

---

## The project name rule

A workspace title becomes a project name in `dsh/lib/project-map.js`. The rule keeps the characters `A-Z a-z 0-9 . _ -`, and it replaces every other run of characters with one hyphen. It then trims a leading or trailing hyphen. An empty result falls back to the workspace id. A duplicate name gains a `-<first six characters of the id>` suffix, so two workspaces with the same title still resolve to two distinct projects.

---

## The run protocol

A button in the dashboard posts one message to the parent frame. The client plugin validates the message, then starts one new dsh session.

```js
window.parent.postMessage({
  source: 'beast-mode-panel',
  type: 'beast-mode:run',
  version: 1,
  command: 'continue-feature',
  ref: 'harness-support/dsh-web-panel',
  project: 'beast-mode',
}, window.location.origin);
```

Five checks run in order. A message that fails any one of them never reaches a session.

1. The event origin equals the page origin.
2. The event source equals the panel frame's `contentWindow`.
3. The body carries the exact envelope: `source`, `type`, and `version`.
4. `command` is a member of the ten-name allow list below.
5. `ref` matches one or two path segments of `A-Z a-z 0-9 . _ -`, and holds no `.` or `..` segment on its own.

A message that fails check 3 stays silent, because another sender on the page may post its own messages. A message that carries the envelope but fails check 4 or check 5 logs one warning.

**The ten buttons.**

| Page | Buttons | Command |
| --- | --- | --- |
| Feature | Continue, Autorun, Update, Review, Evaluate, Fix, Document | `/continue-feature <ref>` and so on |
| Epic | Autorun, Update, Review | `/autorun-epic <ref>` and so on |

No page shows Proceed, because that command only makes sense inside a session that already ran `/continue-feature`.

---

## The four session steps

A validated message runs four steps, in order, guarded by one in-flight flag. A second message during a run logs one line and returns.

1. Create a session in the resolved workspace.
2. Rename it to `<command> <ref>`. A failure here only logs. `rename` and `prompt` return a `RemoteResult`, so the client also checks the `ok` field, not only a thrown error.
3. Queue the command text, `/<command> <ref>`, as user content. dsh scans user text for the skill gesture at each agent step, and this is the one path that loads a Beast Mode skill on dsh.
4. Open the session last, so the user lands on a session that already holds its first turn.

---

## The plain editor

The dashboard normally edits a doc file with a rich Tiptap editor. The panel passes `editor=plain` in its `<iframe>` URL, which swaps that editor for a plain textarea with a Write and Preview toggle. Tiptap never mounts in this mode, so the panel carries no rich-editor weight inside the frame.

---

## `dsh/panel/` is a build output

Every file under `dsh/panel/` comes from `dsh/build.mjs`. No person edits a file there by hand. Git tracks every file, so an npm install, a local path add, or a clone all carry a working panel, with no build step at install time.

| Artifact | Holds |
| --- | --- |
| `dsh/panel/api.js` | The Beast Mode API and the static SPA handler, bundled from `web/src/` |
| `dsh/panel/spa/` | The dashboard SPA, built at the `/beast/ui/` base path |
| `dsh/panel/client.js` | The client plugin, wrapped for the dsh module loader |
| `dsh/panel/build-info.json` | The version stamp of the last build |

## How to rebuild

Run `npm install` once at the repository root. This installs `esbuild`, the one build-time tool the panel needs.

```
node dsh/build.mjs
```

This builds all three targets and rewrites the stamp. Pass `--only=<target>` to build one target alone, where `<target>` is `api`, `spa`, or `client`. The `spa` target still needs `bun` in `web/`, because it runs the reference dashboard's own build.

## The stamp test

`dsh/test/packaging.test.js` reads `dsh/panel/build-info.json` and compares its `beastModeVersion` field against `.claude-plugin/plugin.json`. A release that bumps the version and forgets the rebuild fails this test, so a stale panel never ships silently.

---

## Limits

- **No worktrees and no remotes.** The panel passes `worktrees: false` and passes no auth option to the Beast Mode backend. The dsh web gate authenticates every request before the backend sees it. A user who needs a worktree view runs the standalone `@beast-mode/web` server instead.
- **One project per workspace, with no switcher.** The panel shows the project of the current session's workspace only.
- **A theme change remounts the frame.** The tab reads the theme once per mount and passes it in the `<iframe>` URL. A later theme change gives the frame a new `key`, so the whole frame reloads.

---

## The six dsh surfaces the panel couples to

A preview build of dsh can move any one of these. Each entry names its confirmed source path at `0.1.5-rc.1`.

| Surface | Source path |
| --- | --- |
| The `conversation.view` slot | `packages/client/ui-conversation/src/client/contract/slots.ts:156` |
| `ctx.slots.inject` and `slots.register` | `packages/client/ui-renderer/src/client/registry.ts:172`, `packages/client/ui-slots/src/index.ts:566` |
| The `sessions` service: `create`, `open`, `binding`, `rename`, `prompt` | `packages/api/session-controller/src/client/contract/sessions.ts:35,44,122`, `session.ts:86,119` |
| The `workspaces` service: `list.getSnapshot().items` | `packages/api/workspace-controller/src/client/model.ts:28` |
| The frozen client module table | `packages/client/web/src/platform.ts:8-15` |
| The `connection` service: `requestRejection` | `packages/client/connection/src/rpc-host.ts:97` |

See `docs/features/harness-support/dsh-web-panel/context.md` for the full confirmed-member table and the plan corrections a live check found.
