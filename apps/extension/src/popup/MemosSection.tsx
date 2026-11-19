import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { saveSettings } from '../hooks/useSettings';
import { normalizeBaseUrl, originPattern, sanitizeMemosTag } from '../utils/memos';
import { probe, type MemosFailureReason } from '../utils/memosClient';
import { removeOriginPermission, requestOriginPermission } from '../utils/memosPermissions';
import {
  clearAllMemosData,
  clearServerData,
  getConnectedServer,
  getToken,
  setConnectedServer,
  setToken,
  setUser,
} from '../utils/memosStorage';
import { hintId } from './ariaIds';
import { Field, inputCls } from './Field';
import { useDraftSetting } from './useDraftSetting';

/**
 * Which translation key explains a given Connect failure.
 *
 * A module-scope lookup rather than building the key at runtime (e.g.
 * `` `popup.memosError${suffix}` ``): `i18next.d.ts` types `t()` against the
 * literal keys in `en.json`, so a capitalised runtime string is just `string`
 * and would not typecheck. This also means a future `MemosFailureReason`
 * without an entry here fails the build instead of silently falling back to
 * English at render time.
 *
 * Deliberately separate from `utils/memosFailureMessage.ts`'s `FAILURE_KEY`:
 * that one explains the widget's `memos.*` copy for a dashboard that already
 * has rows on screen, and it has no `url` case because the widget never asks
 * for one. This map's `popup.memosError*` copy is written for someone about
 * to press Connect.
 *
 * Kept unexported: `react-refresh/only-export-components` restricts this
 * component file's exports to components, and an unexported module-scope
 * const is fine.
 */
const CONNECT_ERROR_KEY = {
  url: 'popup.memosErrorUrl',
  permission: 'popup.memosErrorPermission',
  auth: 'popup.memosErrorAuth',
  version: 'popup.memosErrorVersion',
  network: 'popup.memosErrorNetwork',
  server: 'popup.memosErrorServer',
  save: 'popup.memosErrorSave',
} as const satisfies Record<MemosFailureReason | 'url' | 'save', string>;

type ConnectState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; version: string }
  | { kind: 'disconnected' }
  | { kind: 'error'; reason: keyof typeof CONNECT_ERROR_KEY };

// Module scope, like TabNav's TABS and AppearanceSection's BACKGROUND_SOURCES:
// i18next/no-literal-string's `jsx-attributes.exclude` list does not cover
// `placeholder` or `autoComplete`, and these are example values and an
// attribute token, not prose that belongs in a locale file.
const URL_PLACEHOLDER = 'https://memo.example.com';
const TAG_PLACEHOLDER = 'todo';
const TOKEN_AUTOCOMPLETE = 'off';

/** The origin a typed URL would connect to, or null while it is not a usable URL yet. */
const originOf = (value: string): string | null => {
  const base = normalizeBaseUrl(value);
  return base ? new URL(base).origin : null;
};

/**
 * The Memos tab.
 *
 * The URL is the one setting not written as it is typed: it is written by
 * Connect, a button of its own, because `chrome.permissions.request` needs a
 * user gesture, and the gesture does not survive an `await` — a request made
 * after a debounce or a blur would fail silently.
 *
 * Nothing is saved until the permission, the version and the token have all
 * been proved, so a wrong URL or a mistyped token surfaces here instead of as
 * an empty widget on the new tab page.
 *
 * On success everything is persisted together — the token and its account to
 * local storage, then the URL through `saveSettings`. Splitting them would let
 * someone press Connect, close the popup, and end up with a token on disk, no
 * URL, and a widget that silently says it is not configured. The tag is an
 * ordinary setting and is written as it is typed.
 */
export function MemosSection({
  url,
  tag: storedTag,
}: {
  /** The stored `memosUrl`, which changes as Connect and Disconnect write it. */
  url: string;
  /** The stored `memosTag`, read once when the section mounts. */
  tag: string;
}) {
  const { t } = useTranslation();
  const tag = useDraftSetting(storedTag, (value) => ({ memosTag: value }));
  const [draftUrl, setDraftUrl] = useState(url);
  const [token, setTokenInput] = useState('');
  const [state, setState] = useState<ConnectState>({ kind: 'idle' });
  // A ref, not `state.kind === 'busy'`: a second click can land before React
  // re-renders with the first click's `setState`, and reading `state` at that
  // point would still see the stale, pre-click closure. The ref is updated
  // synchronously, so the second call sees the first one's guard immediately.
  const connectingRef = useRef(false);

  // The origin the token in the field was saved for, or null when the field
  // holds nothing that belongs to a server. A token is a credential for one
  // server: pre-filling it and then letting Connect send it to whatever host is
  // typed next would hand one server's secret to another.
  const tokenOriginRef = useRef<string | null>(null);
  // What the URL field shows right now, for the stored-token read below to
  // compare against when it lands — the user may have typed by then, and the
  // effect's closure would only see the first render's value.
  const draftUrlRef = useRef(url);
  // Set once the token field holds something newer than the stored token: a
  // keystroke in it, a Connect, a Disconnect. The read below then has nothing
  // left to fill in, and landing late must not overwrite that.
  const tokenSettledRef = useRef(false);

  // The pressed button is replaced by the confirmation, and the confirmation
  // by the button, so focus would fall back to `body` each time. It goes to
  // Cancel, the harmless choice, and back to Disconnect when cancelled. Only
  // after a click: mounting the tab must not move focus.
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const cancelDisconnectRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);
  useEffect(() => {
    if (confirmingDisconnect) cancelDisconnectRef.current?.focus();
    else if (returnFocusRef.current) disconnectRef.current?.focus();
    returnFocusRef.current = false;
  }, [confirmingDisconnect]);

  const showUrl = (value: string) => {
    draftUrlRef.current = value;
    setDraftUrl(value);
  };

  // The token is not a setting, so it is not on this component's props. It is
  // read with the server it was saved for (`getConnectedServer`), not paired
  // with the `url` prop: that is the synced `memosUrl`, which a settings import
  // or another machine can point elsewhere while this machine's token stays.
  // Only a field already showing the token's own server gets it; anywhere else,
  // Connect can send only a token the user typed for the server on screen.
  useEffect(() => {
    void Promise.all([getToken(), getConnectedServer()]).then(([stored, server]) => {
      if (tokenSettledRef.current || !stored) return;
      const origin = originOf(server);
      if (origin === null || origin !== originOf(draftUrlRef.current)) return;
      setTokenInput(stored);
      tokenOriginRef.current = origin;
    });
  }, []);

  const changeUrl = (value: string) => {
    showUrl(value);
    setState({ kind: 'idle' });

    // Only a URL that resolves to a different origin counts: a half-typed one
    // resolves to nothing yet, and another path on the same origin is still
    // the server the token is for. Once cleared, the origin is forgotten, so
    // editing back does not bring the token back either.
    const origin = originOf(value);
    if (tokenOriginRef.current !== null && origin !== null && origin !== tokenOriginRef.current) {
      tokenOriginRef.current = null;
      setTokenInput('');
    }
  };

  const connect = async () => {
    if (connectingRef.current) return;

    const base = normalizeBaseUrl(draftUrl);
    if (!base) {
      setState({ kind: 'error', reason: 'url' });
      return;
    }

    connectingRef.current = true;
    // Set synchronously, before the permission request: `chrome.permissions.request`
    // shows a real native dialog on a first-time grant, and the click's gesture
    // does not survive an `await` — `setState` does not yield, so disabling the
    // button here still happens inside the same click.
    setState({ kind: 'busy' });

    const previousOrigin = originOf(url);
    const nextOrigin = new URL(base).origin;
    const movedServer = previousOrigin !== null && previousOrigin !== nextOrigin;
    /**
     * Gives back a grant this attempt asked for, when the attempt then failed.
     *
     * Only one it asked for: a grant the user already had for the server they
     * are reconnecting to is not this failure's to take away. Without this, a
     * mistyped token would leave the extension holding access to a host it
     * never managed to use — and on a fresh install there is not even a
     * Disconnect button yet to hand it back with.
     */
    const releaseNewGrant = async () => {
      if (previousOrigin !== nextOrigin) await removeOriginPermission(originPattern(base));
    };

    try {
      // Still inside the click's gesture — the guard above and the `busy` state
      // it set are what stop a second click during the time this is open.
      const granted = await requestOriginPermission(originPattern(base));
      if (!granted) {
        setState({ kind: 'error', reason: 'permission' });
        return;
      }

      const result = await probe({ baseUrl: base, token: token.trim() });
      if (!result.ok) {
        setState({ kind: 'error', reason: result.reason });
        await releaseNewGrant();
        return;
      }

      // Only now that the server has answered for itself: clearing first would
      // throw away a working setup every time a Connect failed — offline, say.
      // The old server's memos are not this one's, and its check would keep new
      // tabs from asking this one for minutes. The draft stays: it is text the
      // user typed, not the old server's data.
      if (movedServer) await clearServerData();

      // In this order, and the server first of all. An already-open tab reloads
      // on each of these local writes and asks nothing while the stored server
      // and its own `memosUrl` disagree — so writing the token before the
      // server would leave a window in which that tab pairs the new token with
      // the old URL and sends the credential to the host being left behind.
      // The URL comes last for the mirror reason: it is what sends the tab
      // looking, and the credentials have to be there before it does.
      await setConnectedServer(base);
      await setToken(token.trim());
      await setUser(result.value.user);
      // Refused only when the rest of the synced settings fill the quota. The
      // credentials stay as written: they pair with this server, and no tab
      // sends anything while `memosUrl` still names another, so pressing
      // Connect again once there is room completes the same setup.
      try {
        await saveSettings({ memosUrl: base });
      } catch {
        setState({ kind: 'error', reason: 'save' });
        return;
      }
      // The token just saved belongs to this server now, like a stored one.
      tokenSettledRef.current = true;
      tokenOriginRef.current = originOf(base);
      showUrl(base);
      if (movedServer) await removeOriginPermission(`${previousOrigin}/*`);
      setState({ kind: 'ok', version: result.value.version });
    } finally {
      // Cleared on every exit, including a thrown `setToken` —
      // otherwise a failed write would leave Connect permanently disabled,
      // worse than today's behaviour where editing a field re-enables it.
      connectingRef.current = false;
    }
  };

  /**
   * Gives the server up entirely: everything this machine stored for it, the
   * synced URL, and the host permission.
   *
   * All of it is local, so it works with the server unreachable — which is
   * often exactly when someone wants to be rid of it. It is also the only way
   * to remove the token short of uninstalling the extension.
   */
  const disconnect = async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    // Same guard and the same visible state as Connect, so neither button can
    // be pressed into the other's work.
    setState({ kind: 'busy' });
    try {
      const origin = originOf(url);
      // Started first, as before, but its outcome is read last: a refused URL
      // write must not stop the token and the grant from being given up, which
      // is the part of disconnecting that matters on this machine.
      const urlCleared = saveSettings({ memosUrl: '' }).then(
        () => true,
        () => false,
      );
      await clearAllMemosData();
      if (origin) await removeOriginPermission(`${origin}/*`);

      showUrl('');
      setTokenInput('');
      tokenSettledRef.current = true;
      tokenOriginRef.current = null;
      setState((await urlCleared) ? { kind: 'disconnected' } : { kind: 'error', reason: 'save' });
    } finally {
      connectingRef.current = false;
    }
  };

  return (
    <div className='flex flex-col gap-3'>
      <Field id='memosUrl' label={t('popup.memosUrl')} hint={t('popup.memosUrlHint')}>
        <input
          id='memosUrl'
          aria-describedby={hintId('memosUrl')}
          type='url'
          value={draftUrl}
          onChange={(e) => changeUrl(e.target.value)}
          className={inputCls}
          placeholder={URL_PLACEHOLDER}
        />
      </Field>

      <Field id='memosToken' label={t('popup.memosToken')} hint={t('popup.memosTokenHint')}>
        <input
          id='memosToken'
          aria-describedby={hintId('memosToken')}
          type='password'
          value={token}
          onChange={(e) => {
            tokenSettledRef.current = true;
            setTokenInput(e.target.value);
            setState({ kind: 'idle' });
          }}
          className={inputCls}
          autoComplete={TOKEN_AUTOCOMPLETE}
        />
      </Field>

      <button
        type='button'
        onClick={() => void connect()}
        disabled={state.kind === 'busy'}
        className='w-full bg-white/10 hover:bg-white/20 transition-colors py-2 rounded-md text-sm font-semibold disabled:opacity-50'
      >
        {state.kind === 'busy' ? t('popup.memosConnecting') : t('popup.memosConnect')}
      </button>

      {state.kind === 'ok' && (
        <p className='text-[10px] text-emerald-300/80'>
          {t('popup.memosConnected', { version: state.version })}
        </p>
      )}
      {state.kind === 'error' && (
        <p className='text-[10px] text-red-300/80'>{t(CONNECT_ERROR_KEY[state.reason])}</p>
      )}
      {state.kind === 'disconnected' && (
        <p className='text-[10px] text-white/50'>{t('popup.memosDisconnected')}</p>
      )}

      {/*
        Nothing to disconnect from until a server has been saved. Two steps,
        because the token goes with it and Memos shows a token only once, when
        it is created: one stray click could cost a new token and a Connect.
      */}
      {url &&
        (confirmingDisconnect ? (
          <div className='flex flex-col gap-2 rounded-md border border-white/10 p-2'>
            <p className='text-xs text-white/70'>{t('popup.memosDisconnectConfirm')}</p>
            <div className='flex gap-2'>
              <button
                type='button'
                onClick={() => {
                  setConfirmingDisconnect(false);
                  void disconnect();
                }}
                disabled={state.kind === 'busy'}
                className='flex-1 bg-white/10 hover:bg-white/20 transition-colors py-1.5 rounded-md text-sm font-semibold disabled:opacity-50'
              >
                {t('popup.memosDisconnect')}
              </button>
              <button
                ref={cancelDisconnectRef}
                type='button'
                onClick={() => {
                  setConfirmingDisconnect(false);
                  returnFocusRef.current = true;
                }}
                className='flex-1 border border-white/10 hover:bg-white/10 transition-colors py-1.5 rounded-md text-sm text-white/70'
              >
                {t('popup.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            ref={disconnectRef}
            type='button'
            onClick={() => setConfirmingDisconnect(true)}
            disabled={state.kind === 'busy'}
            className='w-full border border-white/10 hover:bg-white/10 transition-colors py-2 rounded-md text-sm text-white/70 disabled:opacity-50'
          >
            {t('popup.memosDisconnect')}
          </button>
        ))}

      <Field id='memosTag' label={t('popup.memosTag')} hint={t('popup.memosTagHint')}>
        <input
          id='memosTag'
          aria-describedby={hintId('memosTag')}
          type='text'
          value={tag.draft}
          onChange={(e) => tag.change(sanitizeMemosTag(e.target.value))}
          onBlur={tag.flush}
          className={inputCls}
          placeholder={TAG_PLACEHOLDER}
        />
      </Field>
    </div>
  );
}
