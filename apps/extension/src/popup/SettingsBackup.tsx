import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HubSettings } from '../hooks/useSettings';
import { buildBackup, countChangedSettings, parseBackup } from '../utils/settingsBackup';
import { Field } from './Field';

const buttonCls =
  'flex-1 px-3 py-1.5 rounded text-xs font-semibold transition-colors bg-white/10 hover:bg-white/20';

interface Props {
  settings: HubSettings;
  onImport: (settings: Partial<HubSettings>) => Promise<void>;
}

/**
 * Writes the dashboard's configuration to a file and reads it back.
 *
 * Chrome already syncs these settings between signed-in machines, which is why
 * this is a convenience rather than a necessity — but sync propagates the
 * current state, including a bad one, and offers no way back to a configuration
 * that took a while to get right. It also makes what the extension stores about
 * you something you can open and read, which is a stronger answer than a
 * paragraph in the privacy policy.
 *
 * The custom background image is deliberately not included; it is not a setting
 * and lives in the Cache API. The hint says so, because a user who reads
 * "backup" and loses their wallpaper anyway has been misled.
 */
export function SettingsBackup({ settings, onImport }: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  /** A file read and validated, waiting for Apply or Cancel. */
  const [pending, setPending] = useState<{
    settings: Partial<HubSettings>;
    changed: number;
  } | null>(null);

  const handleExport = () => {
    const blob = new Blob([buildBackup(settings)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hub-settings-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File | undefined) => {
    setError(null);
    setPending(null);
    if (!file) return;
    // Cleared so that choosing the same file again, after a Cancel, still
    // fires `change`.
    if (fileRef.current) fileRef.current.value = '';

    const result = parseBackup(await file.text());
    if (!result.ok) {
      setError(t(result.reason === 'newer' ? 'popup.backupTooNew' : 'popup.backupInvalid'));
      return;
    }

    // Nothing is written yet. The file replaces settings that sync to every
    // machine the user is signed in on, so it says how much it would change
    // and waits for Apply.
    setPending({
      settings: result.settings,
      changed: countChangedSettings(settings, result.settings),
    });
  };

  const apply = async (incoming: Partial<HubSettings>) => {
    setPending(null);
    // A refused write is reported and the popup left as it is: reloading would
    // show the old values with no word of why the import did not take.
    try {
      await onImport(incoming);
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : String(importError);
      setError(t('popup.saveFailed', { message }));
      return;
    }

    // The form copies each setting into local state when it mounts, so the
    // fields would still show the old values with the new ones already saved —
    // the one state where the popup contradicts the dashboard behind it.
    // Remounting is the cheapest way to make every field agree again.
    window.location.reload();
  };

  return (
    <Field label={t('popup.backup')} hint={error ?? t('popup.backupHint')}>
      <div className='flex gap-2'>
        <button type='button' onClick={handleExport} className={buttonCls}>
          {t('popup.backupExport')}
        </button>
        <button type='button' onClick={() => fileRef.current?.click()} className={buttonCls}>
          {t('popup.backupImport')}
        </button>
      </div>
      {pending && (
        <div className='mt-2 flex flex-col gap-2'>
          <p className='text-xs text-white/70'>
            {pending.changed > 0
              ? t('popup.backupChanges', { count: pending.changed })
              : t('popup.backupNoChanges')}
          </p>
          <div className='flex gap-2'>
            {/* Applying a file that changes nothing would only reload the popup. */}
            {pending.changed > 0 && (
              <button type='button' onClick={() => void apply(pending.settings)} className={buttonCls}>
                {t('popup.backupApply')}
              </button>
            )}
            <button type='button' onClick={() => setPending(null)} className={buttonCls}>
              {t('popup.cancel')}
            </button>
          </div>
        </div>
      )}
      {/*
        Hidden because a bare file input cannot be styled to match the button
        beside it, and the pair reads as one control only if they look alike.
      */}
      <input
        ref={fileRef}
        type='file'
        accept='application/json,.json'
        className='hidden'
        aria-label={t('popup.backupImport')}
        onChange={(e) => void handleImport(e.target.files?.[0])}
      />
    </Field>
  );
}
