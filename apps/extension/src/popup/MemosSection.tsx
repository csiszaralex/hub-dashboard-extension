import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { saveSettings } from '../hooks/useSettings';
import { normalizeBaseUrl, originPattern } from '../utils/memos';
import { probe, type MemosFailureReason } from '../utils/memosClient';
import { removeOriginPermission, requestOriginPermission } from '../utils/memosPermissions';
import {
  clearAllMemosData,
  clearServerData,
  getToken,
  setConnectedServer,
  setToken,
  setUser,
} from '../utils/memosStorage';
import { Field, inputCls } from './Field';

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
} as const satisfies Record<MemosFailureReason | 'url', string>;

type ConnectState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; version: string }
  | { kind: 'disconnected' }
  | { kind: 'error'; reason: keyof typeof CONNECT_ERROR_KEY };

// Module scope, like TabNav's TABS and PopupForm's BACKGROUND_SOURCES:
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
 * Connect is its own button rather than part of the form's Save for a concrete
 * reason: `chrome.permissions.request` needs a user gesture, and the gesture
 * does not survive an `await` — `PopupForm.handleSubmit` awaits before it does
 * anything, so a request routed through it would fail silently.
 *
 * Nothing is saved until the permission, the version and the token have all
 * been proved, so a wrong URL or a mistyped token surfaces here instead of as
 * an empty widget on the new tab page.
 *
 * On success everything is persisted here — the token and its account to local
 * storage, then the URL through `saveSettings` — rather than leaving the URL to
 * the form's Save button. Splitting them would let someone press Connect, close
 * the popup, and end up with a token on disk, no URL, and a widget that
 * silently says it is not configured.
 */
export function MemosSection({
  url,
  tag,
  onUrlChange,
  onTagChange,
}: {
  url: string;
  tag: string;
  onUrlChange: (url: string) => void;
  onTagChange: (tag: string) => void;
}) {
  const { t } = useTranslation();
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
  // The `url` prop as it was when the stored token was read — the server that
  // token was saved for. Read once, from inside the effect below.
  const urlAtLoadRef = useRef(url);

  // The token is not a setting, so it is not on this component's props.
  useEffect(() => {
    void getToken().then((stored) => {
      setTokenInput(stored);
      tokenOriginRef.current = stored ? originOf(urlAtLoadRef.current) : null;
    });
  }, []);

  const changeUrl = (value: string) => {
    setDraftUrl(value);
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
        return;
      }

      // Only now that the server has answered for itself: clearing first would
      // throw away a working setup every time a Connect failed — offline, say.
      const previousOrigin = originOf(url);
      const movedServer = previousOrigin !== null && previousOrigin !== new URL(base).origin;
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
      saveSettings({ memosUrl: base });
      // The token just saved belongs to this server now, like a stored one.
      tokenOriginRef.current = originOf(base);
      setDraftUrl(base);
      // Keeps the form's own state coherent, so a later Save does not write back
      // the value the field held before Connect normalised it.
      onUrlChange(base);
      if (movedServer) await removeOriginPermission(`${previousOrigin}/*`);
      setState({ kind: 'ok', version: result.value.version });
    } finally {
      // Cleared on every exit, including a thrown `setToken`/`saveSettings` —
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
      saveSettings({ memosUrl: '' });
      onUrlChange('');
      await clearAllMemosData();
      if (origin) await removeOriginPermission(`${origin}/*`);

      setDraftUrl('');
      setTokenInput('');
      tokenOriginRef.current = null;
      setState({ kind: 'disconnected' });
    } finally {
      connectingRef.current = false;
    }
  };

  return (
    <div className='flex flex-col gap-3'>
      <Field id='memosUrl' label={t('popup.memosUrl')} hint={t('popup.memosUrlHint')}>
        <input
          id='memosUrl'
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
          type='password'
          value={token}
          onChange={(e) => {
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

      {/* Nothing to disconnect from until a server has been saved. */}
      {url && (
        <button
          type='button'
          onClick={() => void disconnect()}
          disabled={state.kind === 'busy'}
          className='w-full border border-white/10 hover:bg-white/10 transition-colors py-2 rounded-md text-sm text-white/70 disabled:opacity-50'
        >
          {t('popup.memosDisconnect')}
        </button>
      )}

      <Field id='memosTag' label={t('popup.memosTag')} hint={t('popup.memosTagHint')}>
        <input
          id='memosTag'
          type='text'
          value={tag}
          onChange={(e) => onTagChange(e.target.value.trim().replace(/^#/, ''))}
          className={inputCls}
          placeholder={TAG_PLACEHOLDER}
        />
      </Field>
    </div>
  );
}
