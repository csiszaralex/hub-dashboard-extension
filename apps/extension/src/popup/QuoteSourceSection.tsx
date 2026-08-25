import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_QUOTE_SOURCE, QUOTE_SOURCES_ENDPOINT } from '../utils/api';
import { Field, inputCls } from './Field';

interface ApiSource {
  id: string;
  languages: string[];
  acceptsQuery: boolean;
}

interface Props {
  source: string;
  query: string;
  language: string;
  onSourceChange: (source: string) => void;
  onQueryChange: (query: string) => void;
}

/**
 * Picks where the daily quote comes from.
 *
 * The list is fetched rather than hard-coded, because the worker is the only
 * thing that knows what it can actually serve: a source whose credentials are
 * missing from a deployment is absent from the response, so this offers one
 * fewer option instead of one that fails on every request.
 */
export function QuoteSourceSection({
  source,
  query,
  language,
  onSourceChange,
  onQueryChange,
}: Props) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<ApiSource[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch(QUOTE_SOURCES_ENDPOINT)
      .then((res) => (res.ok ? (res.json() as Promise<ApiSource[]>) : Promise.reject(res.status)))
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

  return (
    <>
      <Field id='quoteSource' label={t('popup.quoteSource')} hint={t('popup.quoteSourceHint')}>
        <select
          id='quoteSource'
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
          className={inputCls}
          disabled={sources === null}
        >
          {/*
            The saved value is always an option, even before the list arrives or
            when it no longer contains it. Without this the select would show
            whatever happens to be first and silently save that on the next
            submit — changing a preference the user never touched.
          */}
          {!selected && <option value={source}>{source || DEFAULT_QUOTE_SOURCE}</option>}
          {usable.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id}
            </option>
          ))}
        </select>
      </Field>

      {selected?.acceptsQuery && (
        <Field id='quoteQuery' label={t('popup.quoteQuery')} hint={t('popup.quoteQueryHint')}>
          <input
            id='quoteQuery'
            type='text'
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t('popup.quoteQueryPlaceholder')}
            className={inputCls}
          />
        </Field>
      )}
    </>
  );
}
