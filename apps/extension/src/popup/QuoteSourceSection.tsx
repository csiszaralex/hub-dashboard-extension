import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_QUOTE_SOURCE_ID, type QuoteData } from '@hub/shared';
import { QUOTE_SOURCES_ENDPOINT } from '../utils/api';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import {
  CUSTOM_QUOTE_SOURCE,
  fitCustomQuotes,
  MAX_CUSTOM_QUOTES,
  parseCustomQuotes,
  serializeCustomQuotes,
} from '../utils/customQuotes';
import { hintId } from './ariaIds';
import { Field, inputCls } from './Field';
import { useSave } from './saveStatus';
import { useDraftSetting } from './useDraftSetting';

interface ApiSource {
  id: string;
  languages: string[];
  acceptsQuery: boolean;
}

interface Props {
  /** The stored settings, read once when the section mounts. */
  source: string;
  query: string;
  customQuotes: QuoteData[];
  language: string;
}

/** What the textarea's text keeps: the quotes that fit, and how many did not. */
const fitText = (text: string) => fitCustomQuotes(parseCustomQuotes(text));

/**
 * Picks where the daily quote comes from.
 *
 * The list is fetched rather than hard-coded, because the worker is the only
 * thing that knows what it can actually serve: a source whose credentials are
 * missing from a deployment is absent from the response, so this offers one
 * fewer option instead of one that fails on every request.
 */
export function QuoteSourceSection({
  source: storedSource,
  query: storedQuery,
  customQuotes,
  language,
}: Props) {
  const { t } = useTranslation();
  const { save } = useSave();
  /**
   * The ids come from the API, so one this build has no label for (a source
   * added to the worker later) shows as its id rather than as a missing key.
   */
  const labels: Partial<Record<string, string>> = t('quote.sources', { returnObjects: true });
  const label = (id: string) => labels[id] ?? id;
  const [sources, setSources] = useState<ApiSource[] | null>(null);
  const [source, setSource] = useState(storedSource);
  const query = useDraftSetting(storedQuery, (value) => ({ quoteQuery: value }));
  /**
   * The textarea holds raw text while it is being edited, so a half-typed line
   * is not reformatted under the cursor. It is serialised from the stored
   * quotes only when the editor mounts, and parsed when it is written.
   */
  const quotesText = useDraftSetting(serializeCustomQuotes(customQuotes), (text) => ({
    customQuotes: fitText(text).kept,
  }));
  /**
   * How many typed quotes fit and how many the list cannot hold, said under
   * the textarea as the user types: the draft keeps every line, so without
   * this the ones past the budget would vanish only on the next open.
   */
  const fitted = fitText(quotesText.draft);

  useEffect(() => {
    let live = true;
    fetchWithTimeout(QUOTE_SOURCES_ENDPOINT, (res) =>
      res.ok ? (res.json() as Promise<ApiSource[]>) : Promise.reject(res.status),
    )
      .then((list) => live && setSources(list))
      // The saved source keeps working regardless; only the picker needs the
      // list, so a failure here leaves the current setting alone rather than
      // resetting it to a default the user did not choose.
      .catch((error) => console.error('Quote sources fetch failed:', error));
    return () => {
      live = false;
    };
  }, []);

  // Only sources that can answer in the interface language. A source is not
  // wrong for lacking a language, but offering it would mean picking Hungarian
  // and reading English.
  const usable = (sources ?? []).filter((entry) => entry.languages.includes(language));
  const selected = usable.find((entry) => entry.id === source);
  const isCustom = source === CUSTOM_QUOTE_SOURCE;

  return (
    <>
      <Field id='quoteSource' label={t('popup.quoteSource')} hint={t('popup.quoteSourceHint')}>
        <select
          id='quoteSource'
          aria-describedby={hintId('quoteSource')}
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            void save({ quoteSource: e.target.value });
          }}
          className={inputCls}
          disabled={sources === null}
        >
          {/*
            The saved value is always an option, even before the list arrives or
            when it no longer contains it. Without this the select would show
            whatever happens to be first, claiming a preference the user never
            chose.
          */}
          {!selected && <option value={source}>{label(source || DEFAULT_QUOTE_SOURCE_ID)}</option>}
          {usable.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {label(entry.id)}
            </option>
          ))}
          {/*
            Always offered, and never fetched: this source is answered inside
            the extension, so it does not depend on the worker being reachable
            or on any language having content.
          */}
          <option value={CUSTOM_QUOTE_SOURCE}>{label(CUSTOM_QUOTE_SOURCE)}</option>
        </select>
      </Field>

      {isCustom && (
        <Field
          id='customQuotes'
          label={t('popup.customQuotes')}
          hint={t('popup.customQuotesHint', { max: MAX_CUSTOM_QUOTES })}
        >
          <textarea
            id='customQuotes'
            aria-describedby={hintId('customQuotes')}
            value={quotesText.draft}
            rows={5}
            placeholder={t('popup.customQuotesPlaceholder')}
            onChange={(e) => quotesText.change(e.target.value)}
            onBlur={quotesText.flush}
            className={inputCls}
          />
          <p className='text-[10px] text-white/40'>
            {t('popup.customQuotesCount', { count: fitted.kept.length })}
            {fitted.dropped > 0 && (
              <span className='ml-1 text-amber-300/80'>
                {t('popup.customQuotesDropped', { count: fitted.dropped })}
              </span>
            )}
          </p>
        </Field>
      )}

      {selected?.acceptsQuery && (
        <Field id='quoteQuery' label={t('popup.quoteQuery')} hint={t('popup.quoteQueryHint')}>
          <input
            id='quoteQuery'
            aria-describedby={hintId('quoteQuery')}
            type='text'
            value={query.draft}
            onChange={(e) => query.change(e.target.value)}
            onBlur={query.flush}
            placeholder={t('popup.quoteQueryPlaceholder')}
            className={inputCls}
          />
        </Field>
      )}
    </>
  );
}
