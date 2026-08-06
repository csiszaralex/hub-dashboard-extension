import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { AVAILABLE_LANGUAGES } from '../i18n/i18n';
import { type HubSettings } from '../hooks/useSettings';
import { clampDim, MAX_DIM } from '../utils/dim';
import {
  clampPomodoroMinutes,
  DEFAULT_BREAK_MINUTES,
  DEFAULT_WORK_MINUTES,
} from '../utils/pomodoro';
import { type WidgetId } from '../widgets';
import { Field, inputCls } from './Field';
import { CalendarsSection, type CalendarListEntry } from './CalendarsSection';
import { TabNav, type TabId } from './TabNav';
import { WidgetsSection } from './WidgetsSection';

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

// Module scope, like TabNav's TABS: i18next/no-literal-string flags literals inside
// JSX, and this array is only ever mapped over from within JSX.
const BACKGROUND_SOURCES = ['unsplash', 'custom'] as const;

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
  const [backgroundSource, setBackgroundSource] = useState(initialSettings.backgroundSource);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dim, setDim] = useState(clampDim(initialSettings.backgroundDim));
  const [city, setCity] = useState(initialSettings.locationCity);
  const [selectedCals, setSelectedCals] = useState<string[]>(initialSettings.selectedCalendars);
  const [countdownTarget, setCountdownTarget] = useState(initialSettings.countdownTarget || '');
  const [language, setLanguage] = useState(initialSettings.language);
  const [hiddenWidgets, setHiddenWidgets] = useState<WidgetId[]>(initialSettings.hiddenWidgets);
  // Held as the raw typed string, not a number: `Number('')` is `0`, so a
  // number-typed state would redisplay `0` the instant the field is cleared
  // and turn a fresh `3` into `03`. Parsed and clamped once, at submit time.
  const [workMinutes, setWorkMinutes] = useState(String(initialSettings.pomodoroWorkMinutes));
  const [breakMinutes, setBreakMinutes] = useState(String(initialSettings.pomodoroBreakMinutes));
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

  const toggleWidget = (id: WidgetId) =>
    setHiddenWidgets((prev) => (prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]));

  const handleUpload = async (file: File | undefined) => {
    setUploadError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError(t('popup.uploadNotImage'));
      return;
    }
    const { putCustomImage } = await import('../utils/imageCache');
    if (await putCustomImage(file)) {
      setBackgroundSource('custom');
    } else {
      setUploadError(t('popup.uploadFailed'));
    }
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCityError(null);
    setUploadError(null);
    setLoading(true);

    if (backgroundSource === 'custom') {
      // The radio can be set to 'custom' without ever going through handleUpload
      // (a fresh selection has no file yet), so verify the image actually exists
      // in the cache before letting the setting be saved — otherwise the hook has
      // nothing to resolve and the background silently goes blank.
      const { hasCustomImage } = await import('../utils/imageCache');
      if (!(await hasCustomImage())) {
        setUploadError(t('popup.uploadMissing'));
        setLoading(false);
        return;
      }
    }

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
      backgroundSource,
      backgroundDim: clampDim(dim),
      locationCity: validCity,
      locationLat: lat,
      locationLon: lon,
      selectedCalendars: selectedCals,
      countdownTarget: countdownTarget || null,
      language,
      hiddenWidgets,
      // Clamped here too, not just where settings are read back
      // (`useSettings.merge`/`applyChanges`): the numeric inputs unmount
      // when another tab is selected, so a value left cleared or corrupt
      // would otherwise reach `chrome.storage.sync.set` verbatim and only
      // get caught on the next read. Passed as the raw string (not
      // `Number(...)`-converted first) so `clampPomodoroMinutes` can tell an
      // emptied field apart from a deliberate `0` and fall back accordingly.
      pomodoroWorkMinutes: clampPomodoroMinutes(workMinutes, DEFAULT_WORK_MINUTES),
      pomodoroBreakMinutes: clampPomodoroMinutes(breakMinutes, DEFAULT_BREAK_MINUTES),
    });
    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <form onSubmit={handleSubmit} className='flex flex-col gap-3 min-w-0'>
      <TabNav active={activeTab} onChange={handleTabChange} />

      <div>
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
          <div className='flex flex-col gap-3'>
            <Field label={t('popup.backgroundSource')}>
              <div className='flex flex-col gap-1'>
                {BACKGROUND_SOURCES.map((source) => (
                  <label key={source} className='flex items-center gap-2.5 cursor-pointer text-sm'>
                    <input
                      type='radio'
                      name='backgroundSource'
                      value={source}
                      checked={backgroundSource === source}
                      onChange={() => setBackgroundSource(source)}
                      className='accent-white/70 shrink-0'
                    />
                    <span className='select-none'>{t(`popup.source_${source}`)}</span>
                  </label>
                ))}
              </div>
            </Field>

            {backgroundSource === 'custom' && (
              <Field id='upload' label={t('popup.upload')} hint={uploadError ?? t('popup.uploadHint')}>
                <input
                  id='upload'
                  type='file'
                  accept='image/*'
                  onChange={(e) => void handleUpload(e.target.files?.[0])}
                  className='w-full text-xs'
                />
              </Field>
            )}

            {backgroundSource === 'unsplash' && (
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

            <Field id='dim' label={t('popup.dim')} hint={t('popup.dimHint', { value: dim })}>
              <input
                id='dim'
                type='range'
                min={0}
                max={MAX_DIM}
                step={5}
                value={dim}
                onChange={(e) => setDim(Number(e.target.value))}
                className='w-full accent-white'
              />
            </Field>
          </div>
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

        {activeTab === 'pomodoro' && (
          <div className='flex flex-col gap-3'>
            <Field id='work' label={t('popup.pomodoroWork')}>
              <input
                id='work'
                type='number'
                min={1}
                max={180}
                value={workMinutes}
                onChange={(e) => setWorkMinutes(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field id='break' label={t('popup.pomodoroBreak')}>
              <input
                id='break'
                type='number'
                min={1}
                max={180}
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
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

        {activeTab === 'widgets' && (
          <WidgetsSection hidden={hiddenWidgets} onToggle={toggleWidget} />
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
