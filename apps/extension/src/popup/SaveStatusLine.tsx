import { useTranslation } from 'react-i18next';
import { errorCls } from './controlStyles';
import type { SaveStatus } from './saveStatus';

/**
 * The one place a write's outcome is reported, pinned below every tab.
 *
 * Outside the tabs because a write can finish after the tab that made it is
 * gone: a city lookup resolves after the click that blurred the field, and a
 * typed value is flushed when its tab unmounts. An error shown only inside the
 * tab that caused it was invisible to anyone who had already moved on.
 *
 * "Saved" goes to a polite live region that is always mounted, so a screen
 * reader has registered it before its text changes. An error is an `alert`,
 * which is announced at once when it is inserted, so it exists only while
 * there is one.
 */
export function SaveStatusLine({ status }: { status: SaveStatus }) {
  const { t } = useTranslation();
  return (
    <div className='sticky bottom-0 min-h-5 bg-zinc-950 py-1 text-2xs'>
      <p role='status' aria-live='polite' className='text-emerald-300/80'>
        {status.kind === 'saved' ? t('popup.saved') : ''}
      </p>
      {status.kind === 'error' && (
        <p role='alert' className={errorCls}>
          {status.message}
        </p>
      )}
    </div>
  );
}
