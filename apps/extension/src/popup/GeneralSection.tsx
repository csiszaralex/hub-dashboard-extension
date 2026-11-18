import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { AVAILABLE_LANGUAGES } from '../i18n/i18n';
import type { HubSettings } from '../hooks/useSettings';
import { Field, inputCls } from './Field';
import { QuoteSourceSection } from './QuoteSourceSection';
import { useSave } from './saveStatus';
import { SettingsBackup } from './SettingsBackup';

const getLanguageLabel = (lang: string): string => {
  const name = new Intl.DisplayNames([lang], { type: 'language' }).of(lang) ?? lang;
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** Module scope: `i18next/no-literal-string` flags literals inside JSX. */
const FALLBACK_LANGUAGE = 'en';

/** The General tab: language, the quote source, and the settings backup. */
export function GeneralSection({
  settings,
  onImport,
}: {
  settings: HubSettings;
  onImport: (settings: Partial<HubSettings>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { save } = useSave();
  const [language, setLanguage] = useState(settings.language);

  return (
    <div className='flex flex-col gap-3'>
      <Field id='language' label={t('popup.language')}>
        <select
          id='language'
          value={language}
          onChange={(e) => {
            setLanguage(e.target.value);
            void save({ language: e.target.value });
          }}
          className={inputCls}
        >
          <option value=''>{t('popup.languageAuto')}</option>
          {AVAILABLE_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {getLanguageLabel(lang)}
            </option>
          ))}
        </select>
      </Field>
      {/*
        The interface language drives which sources are offered, so this reads
        the selection above rather than waiting for the stored setting to come
        back through `useSettings`.
      */}
      <QuoteSourceSection
        source={settings.quoteSource}
        query={settings.quoteQuery}
        customQuotes={settings.customQuotes}
        language={language || i18n.language?.split('-')[0] || FALLBACK_LANGUAGE}
      />
      {/*
        Exports what is stored. Every control writes as it changes, so that
        differs from the screen only during the pause before typed text is
        written.
      */}
      <SettingsBackup settings={settings} onImport={onImport} />
    </div>
  );
}
