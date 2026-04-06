import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { AVAILABLE_LANGUAGES } from '../i18n/i18n';
import { type HubSettings } from '../hooks/useSettings';
import { Field, inputCls } from './Field';
import { CalendarsSection, type CalendarListEntry } from './CalendarsSection';
import { TabNav, type TabId } from './TabNav';

declare const chrome: {
  identity: {
    getAuthToken: (options: { interactive: boolean }, callback: (token: string) => void) => void;
  };
  runtime: {
    lastError?: { message: string };
  };
};

const getLanguageLabel = (lang: string): string => {
  const name = new Intl.DisplayNames([lang], { type: 'language' }).of(lang) ?? lang;
  return name.charAt(0).toUpperCase() + name.slice(1);
};

export function PopupForm({
  initialSettings,
  onSave,
}: {
  initialSettings: HubSettings;
  onSave: (settings: Partial<HubSettings>) => void;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>(
    () => (localStorage.getItem('popup_tab') as TabId | null) ?? 'general',
  );
  const [query, setQuery] = useState(initialSettings.unsplashQuery);
  const [city, setCity] = useState(initialSettings.locationCity);
  const [selectedCals, setSelectedCals] = useState<string[]>(initialSettings.selectedCalendars);
  const [countdownTarget, setCountdownTarget] = useState(initialSettings.countdownTarget || '');
  const [language, setLanguage] = useState(initialSettings.language);
  const [availableCals, setAvailableCals] = useState<CalendarListEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [cityError, setCityError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);

  useEffect(() => {
    const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
    const autoDetect =
      preferred.map((l) => l.split('-')[0]).find((c) => AVAILABLE_LANGUAGES.includes(c)) ??
      AVAILABLE_LANGUAGES[0] ??
      'en';
    void i18n.changeLanguage(language || autoDetect);
  }, [language]);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    localStorage.setItem('popup_tab', tab);
  };

  const loadCalendars = useCallback(
    (interactive = false) => {
      chrome.identity.getAuthToken({ interactive }, async (token: string) => {
        setCalError(null);
        if (chrome.runtime.lastError || !token) {
          const errorMsg = chrome.runtime.lastError?.message || t('popup.noToken');
          setCalError(t('popup.authError', { message: errorMsg }));
          return;
        }
        try {
          const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            setAvailableCals(
              (data.items || []).map((cal: CalendarListEntry & { primary: boolean }) =>
                cal.primary ? { ...cal, id: 'primary' } : cal,
              ),
            );
          } else {
            setCalError(t('popup.apiError', { status: res.status }));
          }
        } catch {
          setCalError(t('popup.networkError'));
        }
      });
    },
    [t],
  );

  useEffect(() => {
    loadCalendars(false);
  }, [loadCalendars]);

  const toggleCalendar = (id: string) =>
    setSelectedCals((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCityError(null);
    setLoading(true);

    let lat = initialSettings.locationLat;
    let lon = initialSettings.locationLon;
    let validCity = city.trim();

    if (validCity && validCity !== initialSettings.locationCity) {
      try {
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(validCity)}&count=1&language=en&format=json`,
        );
        const data = await res.json();
        if (data.results?.length > 0) {
          lat = data.results[0].latitude;
          lon = data.results[0].longitude;
          validCity = data.results[0].name;
          setCity(validCity);
        } else {
          setCityError(t('popup.cityNotFound'));
          setLoading(false);
          return;
        }
      } catch {
        setCityError(t('popup.cityError'));
        setLoading(false);
        return;
      }
    } else if (!validCity) {
      lat = null;
      lon = null;
    }

    onSave({
      unsplashQuery: query.trim(),
      locationCity: validCity,
      locationLat: lat,
      locationLon: lon,
      selectedCalendars: selectedCals,
      countdownTarget: countdownTarget || null,
      language,
    });
    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <form onSubmit={handleSubmit} className='flex flex-col gap-3 min-w-0'>
      <TabNav active={activeTab} onChange={handleTabChange} />

      <div className='min-h-28'>
        {activeTab === 'general' && (
          <Field id='language' label={t('popup.language')}>
            <select
              id='language'
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
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
        )}

        {activeTab === 'appearance' && (
          <Field id='query' label={t('popup.appearance')} hint={t('popup.appearanceHint')}>
            <input
              id='query'
              type='text'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={inputCls}
              placeholder={t('popup.appearancePlaceholder')}
            />
          </Field>
        )}

        {activeTab === 'weather' && (
          <Field
            id='city'
            label={t('popup.weatherLocation')}
            hint={cityError ?? t('popup.weatherLocationHint')}
          >
            <input
              id='city'
              type='text'
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={`${inputCls} ${cityError ? 'border-red-500/50 focus:ring-red-500/50' : ''}`}
              placeholder={t('popup.weatherLocationPlaceholder')}
            />
          </Field>
        )}

        {activeTab === 'countdown' && (
          <Field id='countdownTarget' label={t('popup.countdown')} hint={t('popup.countdownHint')}>
            <input
              id='countdownTarget'
              type='datetime-local'
              value={countdownTarget}
              onChange={(e) => setCountdownTarget(e.target.value)}
              className={`${inputCls} text-white scheme-dark`}
            />
          </Field>
        )}

        {activeTab === 'calendars' && (
          <CalendarsSection
            availableCals={availableCals}
            selectedCals={selectedCals}
            calError={calError}
            onToggle={toggleCalendar}
            onLogin={() => loadCalendars(true)}
          />
        )}
      </div>

      <button
        type='submit'
        disabled={loading}
        className='w-full bg-white text-black hover:bg-white/90 transition-colors py-2.5 rounded-md text-sm font-semibold disabled:opacity-50'
      >
        {loading ? t('popup.saving') : saved ? t('popup.saved') : t('popup.save')}
      </button>
    </form>
  );
}
