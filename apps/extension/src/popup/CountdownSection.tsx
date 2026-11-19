import { useTranslation } from 'react-i18next';
import type { HubSettings } from '../hooks/useSettings';
import { hintId } from './ariaIds';
import { Field, inputCls } from './Field';
import { useDraftSetting } from './useDraftSetting';

/**
 * The Countdown tab. Debounced like text: a `datetime-local` field fires a
 * change for every segment typed, and an empty one clears the countdown.
 */
export function CountdownSection({ settings }: { settings: HubSettings }) {
  const { t } = useTranslation();
  const target = useDraftSetting(settings.countdownTarget ?? '', (value) => ({
    countdownTarget: value || null,
  }));

  return (
    <Field id='countdownTarget' label={t('popup.countdown')} hint={t('popup.countdownHint')}>
      <input
        id='countdownTarget'
        aria-describedby={hintId('countdownTarget')}
        type='datetime-local'
        value={target.draft}
        onChange={(e) => target.change(e.target.value)}
        onBlur={target.flush}
        className={`${inputCls} text-white scheme-dark`}
      />
    </Field>
  );
}
