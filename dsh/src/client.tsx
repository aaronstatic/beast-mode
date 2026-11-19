/**
 * The dsh web client plugin of the Beast Mode panel.
 *
 * This file is a build input only. No runtime path loads it. `dsh/build.mjs`
 * bundles it with the `client` target and writes the result to
 * `dsh/panel/client.js`, inside the `window.__ModuleLoader__.load` closure
 * that the dsh module system reads.
 *
 * The plugin registers one entry on the `conversation.view` slot. The entry
 * renders one `<iframe>` over the Beast Mode dashboard, which the host
 * plugin (`dsh/lib/panel.js`) serves at `/beast/ui/` on the same origin. The
 * entry also listens for one message type from that frame, and it turns a
 * validated message into one new dsh session with one queued prompt.
 *
 * Three rules hold this file small.
 *
 * 1. Every import names a member of the frozen dsh module table
 *    (`packages/client/web/src/platform.ts`), plus the shared rules in
 *    `../lib/run-protocol.js`. The bundle therefore carries no second copy
 *    of React (Decision 1).
 * 2. Every rule that a plain Node test can cover lives in
 *    `../lib/run-protocol.js`, not here.
 * 3. Every call into a dsh service sits inside a `try`. A failure logs one
 *    line and never throws into the host UI.
 *
 * See implementation.md sections 3.5 and 3.6 of the
 * `harness-support/dsh-web-panel` feature.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { isRunMessageShape, isTrustedEvent, parseRunMessage } from '../lib/run-protocol.js';

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/** The slot this plugin contributes to. */
const SLOT_NAME = 'conversation.view';

/** The entry id, the tab order, and the tab label of section 3.5. */
const ENTRY_ID = 'beast-mode';
const ENTRY_ORDER = 30;
const ENTRY_LABEL = 'Beast Mode';

/** The prefix every log line of this plugin carries. */
const LOG_PREFIX = '[beast-mode-panel]';

/** The host index route. `dsh/lib/panel.js` answers it. */
const PANEL_INDEX_URL = '/beast/api/panel';

/** The base path of the dashboard SPA. */
const UI_BASE = '/beast/ui/';

/** The API base the SPA prepends to every `/api/...` request. */
const API_BASE = '/beast';

/** The id of the one `<style>` element this plugin adds to the document. */
const STYLE_ELEMENT_ID = 'beast-mode-panel-style';

/**
 * The height rule of section 3.5.
 *
 * The conversation view area sets `flex-basis: auto` and `min-height: auto`
 * while a custom view is active, so a tall child stretches the page. These
 * two rules clamp the panel to the area it sits in. The block holds no other
 * rule, so it never touches the rest of the dsh UI.
 */
const PANEL_CSS = `
.bm-panel-root { height: 100%; min-height: 0; display: flex; flex-direction: column; }
div:has(> .bm-panel-root) { flex: 1 1 0 !important; min-height: 0 !important; overflow: hidden !important; }
`;

/** The exact sentence of each empty state, per section 3.5. */
const MESSAGE_NO_WORKSPACE = 'Open a session in a workspace to see this panel.';
const MESSAGE_UNAVAILABLE = 'The Beast Mode panel is not available in this dsh profile.';
const MESSAGE_NOT_INSTALLED
  = 'Beast Mode is not installed in this workspace. Run /install-beast-mode in a session.';

// ─────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────

/** Log one warning line. Never throws, so a locked-down console cannot break a render. */
function warn(message: string, detail?: unknown): void {
  try {
    if (detail === undefined) console.warn(`${LOG_PREFIX} ${message}`);
    else console.warn(`${LOG_PREFIX} ${message}`, detail);
  } catch {
    // A console that throws is not a reason to fail the panel.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// The height rule
// ─────────────────────────────────────────────────────────────────────────

/**
 * Add the two height rules to the document, one time.
 *
 * The stable element id makes the function idempotent: a second mount, a
 * second session, and a plugin reload all find the element and return. The
 * element stays in the document after an unmount, because it holds two
 * rules that match nothing without this panel.
 */
function ensurePanelStyles(): void {
  try {
    if (document.getElementById(STYLE_ELEMENT_ID) !== null) return;
    const element = document.createElement('style');
    element.id = STYLE_ELEMENT_ID;
    element.textContent = PANEL_CSS;
    document.head.append(element);
  } catch (error) {
    warn('the panel could not add its height rules', error);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// The theme
// ─────────────────────────────────────────────────────────────────────────

/** The body attribute the dsh theme presenter sets while the dark palette is active. */
const DARK_ATTRIBUTE = 'data-ds-dark-theme';

/**
 * Read the active theme in three steps.
 *
 * 1. The body attribute the dsh theme presenter writes
 *    (`packages/client/ui-layout/src/client/theme-presenter.ts`). It is the
 *    authority while the dsh UI runs.
 * 2. The root `color-scheme` style, which the same presenter writes.
 * 3. The `prefers-color-scheme` media query.
 *
 * The default is `dark`, which matches the dashboard SPA today.
 * @returns the theme name to pass to the frame.
 */
function readTheme(): 'dark' | 'light' {
  try {
    if (document.body !== null && document.body.hasAttribute(DARK_ATTRIBUTE)) return 'dark';
    const scheme = document.documentElement.style.colorScheme;
    if (scheme === 'dark' || scheme === 'light') return scheme;
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  } catch (error) {
    warn('the panel could not read the theme', error);
  }
  return 'dark';
}

/**
 * Watch every source `readTheme` reads, and call the listener on a change.
 *
 * A theme change must reach the frame, because the frame reads the theme one
 * time from its URL. The tab answers the change with a new `key`, which
 * remounts the frame on the new URL (section 3.5).
 * @param listener - called after each possible theme change.
 * @returns the cleanup function.
 */
function subscribeTheme(listener: () => void): () => void {
  const cleanups: Array<() => void> = [];
  try {
    const observer = new MutationObserver(listener);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    if (document.body !== null) {
      observer.observe(document.body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] });
    }
    cleanups.push(() => observer.disconnect());
  } catch (error) {
    warn('the panel could not watch the theme attributes', error);
  }
  try {
    if (typeof window.matchMedia === 'function') {
      const query = window.matchMedia('(prefers-color-scheme: dark)');
      query.addEventListener('change', listener);
      cleanups.push(() => query.removeEventListener('change', listener));
    }
  } catch (error) {
    warn('the panel could not watch the color-scheme query', error);
  }
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

/** The active theme, kept current while the tab is mounted. */
function useTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme);
  useEffect(() => subscribeTheme(() => { setTheme(readTheme()); }), []);
  return theme;
}

// ─────────────────────────────────────────────────────────────────────────
// The two dsh stores
// ─────────────────────────────────────────────────────────────────────────

/**
 * One dsh observable store, read with `useSyncExternalStore`.
 *
 * Both dsh stores cache their snapshot, so the identity stays stable between
 * two changes and React never loops.
 * @param store - a `{ getSnapshot, subscribe }` source.
 * @returns the current snapshot.
 */
function useStoreSnapshot(store: any): any {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Resolve the workspace of this tab, with the four steps of section 3.5.
 *
 * 1. The session of this slot entry, or the current session of the list.
 * 2. The workspace whose `sessionIds` holds that session.
 * 3. The workspace this tab resolved last, while the list still holds it.
 * 4. The only workspace, when the list holds exactly one.
 *
 * Step 3 keeps the frame mounted across a short moment with no bound
 * session, so a session switch inside one workspace never reloads the frame.
 * @param entrySessionId - the `sessionId` prop of the slot entry.
 * @param sessions - the dsh sessions service.
 * @param workspaces - the dsh workspaces service.
 * @returns the workspace id, or undefined when nothing resolves.
 */
function useResolvedWorkspaceId(
  entrySessionId: string | undefined,
  sessions: any,
  workspaces: any,
): string | undefined {
  const sessionList = useStoreSnapshot(sessions.list);
  const workspaceList = useStoreSnapshot(workspaces.list);
  const lastResolved = useRef<string | undefined>(undefined);

  const items: any[] = Array.isArray(workspaceList?.items) ? workspaceList.items : [];
  const sessionId = entrySessionId ?? sessionList?.current;

  let workspaceId: string | undefined;
  if (sessionId !== undefined) {
    workspaceId = items.find((item) => item?.sessionIds?.includes(sessionId))?.workspaceId;
  }
  if (workspaceId === undefined && lastResolved.current !== undefined) {
    const remembered = lastResolved.current;
    if (items.some((item) => item?.workspaceId === remembered)) workspaceId = remembered;
  }
  if (workspaceId === undefined && items.length === 1) workspaceId = items[0]?.workspaceId;

  useEffect(() => {
    if (workspaceId !== undefined) lastResolved.current = workspaceId;
  }, [workspaceId]);

  return workspaceId;
}

// ─────────────────────────────────────────────────────────────────────────
// The host index
// ─────────────────────────────────────────────────────────────────────────

/** One entry of the host index body, per section 3.3. */
interface PanelEntry {
  workspaceId: string;
  title: string;
  project: string;
  installed: boolean;
}

/** The state of the one `GET /beast/api/panel` request. */
interface PanelIndexState {
  status: 'loading' | 'ready' | 'error';
  entry: PanelEntry | undefined;
  retry: () => void;
}

/**
 * Fetch the host index on mount and on a workspace change, then pick the
 * entry of this workspace.
 * @param workspaceId - the resolved workspace, or undefined.
 * @returns the request state, the matching entry, and a retry function.
 */
function usePanelIndex(workspaceId: string | undefined): PanelIndexState {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; entries: PanelEntry[] }>(
    { status: 'loading', entries: [] },
  );
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setAttempt((value) => value + 1); }, []);

  useEffect(() => {
    if (workspaceId === undefined) return undefined;
    let live = true;
    const controller = new AbortController();
    setState({ status: 'loading', entries: [] });

    (async () => {
      try {
        const response = await fetch(PANEL_INDEX_URL, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`the host index answered ${String(response.status)}`);
        const body = await response.json();
        const entries: PanelEntry[] = Array.isArray(body?.workspaces) ? body.workspaces : [];
        if (live) setState({ status: 'ready', entries });
      } catch (error) {
        if (!live || controller.signal.aborted) return;
        warn('the host index is unavailable', error);
        setState({ status: 'error', entries: [] });
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [workspaceId, attempt]);

  const entry = useMemo(
    () => state.entries.find((item) => item?.workspaceId === workspaceId),
    [state.entries, workspaceId],
  );

  return { status: state.status, entry, retry };
}

// ─────────────────────────────────────────────────────────────────────────
// The run sequence
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the four-step run function of section 3.6.
 *
 * The order matters: the prompt lands before the view changes, so the opened
 * session already carries its first turn. One in-flight flag guards the
 * whole sequence, so a double click creates one session and not two.
 * @param sessions - the dsh sessions service.
 * @param workspaceId - the resolved workspace, never a value from the message.
 * @returns a function that runs one validated command.
 */
function useRunCommand(
  sessions: any,
  workspaceId: string | undefined,
): (run: { command: string; ref: string; text: string }) => void {
  const inFlight = useRef(false);

  return useCallback((run: { command: string; ref: string; text: string }) => {
    if (inFlight.current) {
      warn(`a run is already in flight, so "${run.text}" did not start`);
      return;
    }
    if (workspaceId === undefined) {
      warn(`no workspace is resolved, so "${run.text}" did not start`);
      return;
    }
    inFlight.current = true;

    void (async () => {
      try {
        // Step 1. Create the session in the resolved workspace.
        const sessionId = await sessions.create({ workspaceId });

        // Step 2. Rename it. A failure only logs, because the prompt matters
        // more than the title.
        try {
          const renamed = await sessions.binding(sessionId)?.session?.rename(
            `${run.command} ${run.ref}`,
          );
          if (renamed?.ok === false) warn('the session rename failed', renamed.error);
        } catch (error) {
          warn('the session rename failed', error);
        }

        // Step 3. Queue the command as user text. dsh scans user text for the
        // skill gesture at each agent step, which is the path that loads a
        // Beast Mode skill (Decision 8).
        const binding = sessions.binding(sessionId);
        if (binding === undefined || binding === null) {
          warn(`the new session "${String(sessionId)}" has no binding, so the prompt did not send`);
          return;
        }
        const accepted = await binding.session.prompt([{ type: 'text', text: run.text }], 'queue');
        if (accepted?.ok === false) {
          warn('the prompt was rejected, so the panel did not open the session', accepted.error);
          return;
        }

        // Step 4. Open the session last.
        sessions.open(sessionId);
      } catch (error) {
        warn(`the run of "${run.text}" failed`, error);
      } finally {
        inFlight.current = false;
      }
    })();
  }, [sessions, workspaceId]);
}

// ─────────────────────────────────────────────────────────────────────────
// The rendered states
// ─────────────────────────────────────────────────────────────────────────

/** The one root element of every state. The height rules match this class. */
function PanelRoot({ children }: { children: any }) {
  return <div className="bm-panel-root">{children}</div>;
}

/** One centered sentence, with an optional Retry button. */
function PanelNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <PanelRoot>
      <div
        style={{
          flex: '1 1 0',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '24px',
          textAlign: 'center',
          opacity: 0.85,
        }}
      >
        <p style={{ margin: 0, maxWidth: '44ch', lineHeight: 1.5 }}>{message}</p>
        {onRetry === undefined ? null : (
          <button
            type="button"
            onClick={onRetry}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: '1px solid currentColor',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Retry
          </button>
        )}
      </div>
    </PanelRoot>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// The tab
// ─────────────────────────────────────────────────────────────────────────

/**
 * The Beast Mode tab of the conversation view.
 *
 * `props.sessionId` comes from the session standard props of the slot
 * (`packages/client/ui-session/src/client/index.ts`). `props.sessions` and
 * `props.workspaces` come from the registration closure in `apply`.
 */
function PanelTab(props: any) {
  const { sessions, workspaces } = props;
  const theme = useTheme();
  const workspaceId = useResolvedWorkspaceId(props.sessionId, sessions, workspaces);
  const { status, entry, retry } = usePanelIndex(workspaceId);
  const runCommand = useRunCommand(sessions, workspaceId);
  const frameRef = useRef<any>(null);

  useEffect(() => { ensurePanelStyles(); }, []);

  useEffect(() => {
    function onMessage(event: any) {
      const frame = frameRef.current;
      if (frame === null || frame === undefined) return;
      // Check 1 and check 2 of section 3.6. Both reject in silence, because a
      // page holds many message senders.
      if (!isTrustedEvent(event, { origin: window.location.origin, frame: frame.contentWindow })) {
        return;
      }
      const run = parseRunMessage(event.data);
      if (run === null) {
        // A body that carries the envelope but fails a later check names a bad
        // command or a bad reference. That case earns one warning. Every other
        // body belongs to another sender and stays silent.
        if (isRunMessageShape(event.data)) warn('the panel rejected a run message', event.data);
        return;
      }
      runCommand(run);
    }

    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); };
  }, [runCommand]);

  if (workspaceId === undefined) return <PanelNotice message={MESSAGE_NO_WORKSPACE} />;
  if (status === 'loading') return <PanelNotice message="Loading the Beast Mode panel..." />;
  if (status === 'error' || entry === undefined) {
    return <PanelNotice message={MESSAGE_UNAVAILABLE} onRetry={retry} />;
  }
  if (!entry.installed) return <PanelNotice message={MESSAGE_NOT_INSTALLED} onRetry={retry} />;

  const frameUrl = `${UI_BASE}?project=${encodeURIComponent(entry.project)}`
    + `&api=${encodeURIComponent(API_BASE)}`
    + '&runner=dsh&editor=plain'
    + `&theme=${theme}`;

  return (
    <PanelRoot>
      <iframe
        key={theme}
        ref={frameRef}
        src={frameUrl}
        title="Beast Mode"
        style={{ width: '100%', height: '100%', border: 0, display: 'block', flex: '1 1 0', minHeight: 0 }}
      />
    </PanelRoot>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// The plugin
// ─────────────────────────────────────────────────────────────────────────

/** The plugin name the dsh loader reports. */
export const name = 'beast-mode-panel';

/**
 * The dsh client services this plugin needs.
 *
 * Cordis holds `apply` until every named service exists, so the body reads
 * all three with no guard. `slots` carries the registration, `sessions`
 * carries the run sequence, and `workspaces` carries the workspace list.
 */
export const inject = ['slots', 'sessions', 'workspaces'];

/**
 * Register the Beast Mode tab on the conversation view.
 *
 * `slots.inject` waits for the slot declaration, and it removes the entry
 * again on a plugin unload
 * (`packages/client/ui-renderer/src/client/registry.ts`).
 * @param ctx - the dsh client root context.
 */
export function apply(ctx: any): void {
  const sessions = ctx.sessions;
  const workspaces = ctx.workspaces;

  // One stable component identity for the whole plugin lifetime. The closure
  // carries the two services, so the tab needs no context lookup at render
  // time.
  function BeastModeView(props: any) {
    return <PanelTab {...props} sessions={sessions} workspaces={workspaces} />;
  }

  ctx.slots.inject(SLOT_NAME, () => ctx.slots.register(
    { name: SLOT_NAME, id: ENTRY_ID, order: ENTRY_ORDER, label: ENTRY_LABEL },
    BeastModeView,
  ));
}
