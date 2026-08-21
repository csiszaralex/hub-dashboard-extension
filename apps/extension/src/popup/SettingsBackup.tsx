import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HubSettings } from '../hooks/useSettings';
import { buildBackup, parseBackup } from '../utils/settingsBackup';
import { Field } from './Field';

const buttonCls =
  'flex-1 px-3 py-1.5 rounded text-xs font-semibold transition-colors bg-white/10 hover:bg-white/20';

interface Props {
  settings: HubSettings;
  onImport: (settings: Partial<HubSettings>) => void;
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
    if (!file) return;

    const restored = parseBackup(await file.text());
    if (!restored) {
      setError(t('popup.backupInvalid'));
      return;
    }

    onImport(restored);

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
