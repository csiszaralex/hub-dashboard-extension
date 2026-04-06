import { useTranslation } from 'react-i18next';
import { useSettings } from '../hooks/useSettings';
import { PopupForm } from './PopupForm';

export function Popup() {
  const { settings, isLoaded, saveSettings } = useSettings();
  const { t } = useTranslation();

  if (!isLoaded)
    return (
      <div className='flex items-center justify-center h-40 text-white/50 text-sm'>
        {t('popup.loading')}
      </div>
    );

  return (
    <div className='p-4 flex flex-col gap-3'>
      <h2 className='text-base font-semibold text-white/90 border-b border-white/10 pb-2.5'>
        {t('popup.title')}
      </h2>
      <PopupForm initialSettings={settings} onSave={saveSettings} />
    </div>
  );
}
