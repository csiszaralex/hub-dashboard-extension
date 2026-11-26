import { useTranslation } from 'react-i18next';
import { useSettings } from '../hooks/useSettings';
import { toLanguage } from '../i18n/language';
import { feedbackUrl } from '../utils/feedback';
import { PopupForm } from './PopupForm';

export function Popup() {
  const { settings, isLoaded, saveSettings } = useSettings();
  const { t, i18n } = useTranslation();

  if (!isLoaded)
    return (
      <div className='flex items-center justify-center h-40 text-white/50 text-sm'>
        {t('popup.loading')}
      </div>
    );

  return (
    <div className='p-4 flex flex-col gap-3'>
      <div className='flex items-baseline justify-between gap-3 border-b border-white/10 pb-2.5'>
        <h2 className='text-base font-semibold text-white/90'>{t('popup.title')}</h2>
        {/* A new tab, since a Chrome popup closes the moment it loses focus. */}
        <a
          href={feedbackUrl('popup', toLanguage(i18n.language), __APP_VERSION__)}
          target='_blank'
          rel='noopener noreferrer'
          className='text-xs text-white/60 hover:text-white/90 underline underline-offset-2'
        >
          {t('popup.feedback')}
        </a>
      </div>
      <PopupForm settings={settings} onSave={saveSettings} />
    </div>
  );
}
