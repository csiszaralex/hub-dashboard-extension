import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HubSettings } from '../hooks/useSettings';
import { toLanguage } from '../i18n/language';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { hintId } from './ariaIds';
import { Field, inputCls } from './Field';
import { useSave } from './saveStatus';

interface GeocodingAnswer {
  results?: { name: string; latitude: number; longitude: number }[];
}

/**
 * The Weather tab's city.
 *
 * Unlike every other text field this is not written as it is typed: the
 * weather needs coordinates, and only a lookup turns the text into them. So it
 * is resolved on blur or Enter, and written together with its coordinates, or
 * not at all — a half-typed city never reaches storage, and a not-found one
 * leaves the last working location in place.
 */
export function WeatherSection({ settings }: { settings: HubSettings }) {
  // The city name comes back in this language too, and is what gets saved.
  const { t, i18n } = useTranslation();
  const { save, report } = useSave();
  const [city, setCity] = useState(settings.locationCity);
  const [cityError, setCityError] = useState<string | null>(null);
  /**
   * The text last resolved or attempted. Enter and the blur that follows it
   * would otherwise look the same city up twice, and an unchanged field would
   * be looked up on every blur.
   */
  const attempted = useRef<string | null>(settings.locationCity.trim());
  /** Bumped by every lookup and every keystroke, so a late answer for older text is dropped. */
  const lookup = useRef(0);
  const inFlight = useRef(false);

  const edit = (value: string) => {
    setCity(value);
    lookup.current++;
    // A lookup the keystroke abandoned never answered for its text, so that
    // text must not count as attempted if the user types their way back to it.
    if (inFlight.current) {
      inFlight.current = false;
      attempted.current = null;
    }
  };

  const fail = (message: string) => {
    setCityError(message);
    report(message);
  };

  const resolve = async () => {
    const wanted = city.trim();
    if (wanted === attempted.current) return;
    attempted.current = wanted;
    setCityError(null);

    // An empty field means "automatic (IP based)", which is no location.
    if (!wanted) {
      void save({ locationCity: '', locationLat: null, locationLon: null });
      return;
    }

    const id = ++lookup.current;
    inFlight.current = true;
    let data: GeocodingAnswer;
    try {
      data = await fetchWithTimeout(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(wanted)}&count=1&language=${toLanguage(i18n.language)}&format=json`,
        (res) => res.json() as Promise<GeocodingAnswer>,
      );
    } catch {
      if (id !== lookup.current) return;
      inFlight.current = false;
      fail(t('popup.cityError'));
      return;
    }
    if (id !== lookup.current) return;
    inFlight.current = false;

    const found = data.results?.[0];
    if (!found) {
      fail(t('popup.cityNotFound'));
      return;
    }
    attempted.current = found.name;
    setCity(found.name);
    void save({ locationCity: found.name, locationLat: found.latitude, locationLon: found.longitude });
  };

  return (
    <Field id='city' label={t('popup.weatherLocation')} hint={cityError ?? t('popup.weatherLocationHint')}>
      <input
        id='city'
        aria-describedby={hintId('city')}
        type='text'
        value={city}
        onChange={(e) => edit(e.target.value)}
        onBlur={() => void resolve()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void resolve();
        }}
        aria-invalid={cityError !== null}
        className={`${inputCls} ${cityError ? 'border-red-500/50 focus:ring-red-500/50' : ''}`}
        placeholder={t('popup.weatherLocationPlaceholder')}
      />
    </Field>
  );
}
