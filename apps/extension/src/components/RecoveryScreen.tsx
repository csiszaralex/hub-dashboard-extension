import { useState } from 'react';
import i18n from '../i18n/i18n';
import en from '../i18n/locales/en.json';
import { clearRecoverableData } from '../utils/recovery';

type RecoveryKey = keyof typeof en.recovery;

/**
 * Translation that cannot throw.
 *
 * This screen is the root boundary's fallback, so nothing above it catches a
 * second error: if it threw, the page would be blank again. It therefore calls
 * `i18n.t` directly rather than through `useTranslation`, and falls back to the
 * English locale file when the lookup throws or hands back the bare key.
 */
const t = (key: RecoveryKey): string => {
  const path = `recovery.${key}` as const;
  try {
    const value: unknown = i18n.t(path);
    if (typeof value === 'string' && value !== '' && value !== path) return value;
  } catch {
    // Fall through to the bundled English string.
  }
  return en.recovery[key];
};

const BUTTON =
  'px-4 py-2 rounded-md text-sm transition-colors disabled:opacity-50 bg-white/10 hover:bg-white/20';

/** Full-screen way out when `App` itself failed to render. */
export const RecoveryScreen = () => {
  const [clearing, setClearing] = useState(false);

  const clearAndReload = () => {
    setClearing(true);
    // `clearRecoverableData` never rejects; `finally` is the belt for a reload
    // that must happen whatever it does.
    void clearRecoverableData().finally(() => location.reload());
  };

  return (
    <main className='w-screen h-screen flex items-center justify-center bg-black text-white p-6'>
      <div className='max-w-md flex flex-col items-center gap-4 text-center'>
        <h1 className='text-xl font-light'>{t('title')}</h1>
        <p className='text-sm text-white/70'>{t('message')}</p>
        <div className='flex flex-wrap justify-center gap-3'>
          <button type='button' className={BUTTON} onClick={() => location.reload()}>
            {t('reload')}
          </button>
          <button type='button' className={BUTTON} disabled={clearing} onClick={clearAndReload}>
            {t(clearing ? 'clearing' : 'clearAndReload')}
          </button>
        </div>
      </div>
    </main>
  );
};
