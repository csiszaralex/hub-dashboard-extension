import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { saveSettings } from '../hooks/useSettings';
import { normalizeBaseUrl, originPattern } from '../utils/memos';
import { probe, type MemosFailureReason } from '../utils/memosClient';
import { requestOriginPermission } from '../utils/memosPermissions';
import { getToken, setToken } from '../utils/memosStorage';
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
  | { kind: 'error'; reason: keyof typeof CONNECT_ERROR_KEY };

// Module scope, like TabNav's TABS and PopupForm's BACKGROUND_SOURCES:
// i18next/no-literal-string's `jsx-attributes.exclude` list does not cover
// `placeholder` or `autoComplete`, and these are example values and an
// attribute token, not prose that belongs in a locale file.
const URL_PLACEHOLDER = 'https://memo.example.com';
const TAG_PLACEHOLDER = 'todo';
const TOKEN_AUTOCOMPLETE = 'off';

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
 * On success both halves are persisted here — the token to local storage and
 * the URL through `saveSettings` — rather than leaving the URL to the form's
 * Save button. Splitting them would let someone press Connect, close the popup,
 * and end up with a token on disk, no URL, and a widget that silently says it
 * is not configured.
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

  // The token is not a setting, so it is not on this component's props.
  useEffect(() => {
    void getToken().then(setTokenInput);
  }, []);

  const connect = async () => {
    const base = normalizeBaseUrl(draftUrl);
    if (!base) {
      setState({ kind: 'error', reason: 'url' });
      return;
    }

    // Synchronously first, while the click's gesture is still live.
    const granted = await requestOriginPermission(originPattern(base));
    if (!granted) {
      setState({ kind: 'error', reason: 'permission' });
      return;
    }

    setState({ kind: 'busy' });
    const result = await probe({ baseUrl: base, token: token.trim() });
    if (!result.ok) {
      setState({ kind: 'error', reason: result.reason });
      return;
    }

    await setToken(token.trim());
    saveSettings({ memosUrl: base });
    setDraftUrl(base);
    // Keeps the form's own state coherent, so a later Save does not write back
    // the value the field held before Connect normalised it.
    onUrlChange(base);
    setState({ kind: 'ok', version: result.value });
  };

  return (
    <div className='flex flex-col gap-3'>
      <Field id='memosUrl' label={t('popup.memosUrl')} hint={t('popup.memosUrlHint')}>
        <input
          id='memosUrl'
          type='url'
          value={draftUrl}
          onChange={(e) => {
            setDraftUrl(e.target.value);
            setState({ kind: 'idle' });
          }}
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
