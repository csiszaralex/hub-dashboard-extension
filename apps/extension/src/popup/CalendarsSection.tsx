import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HubSettings } from '../hooks/useSettings';
import {
  fetchCalendarList,
  type CalendarListEntry,
  type CalendarListResult,
} from '../utils/googleCalendar';
import { labelCls, sectionCls } from './Field';
import { useSave } from './saveStatus';

/**
 * `signed-out` covers both a user who never connected and one whose token
 * Google no longer accepts: either way the way forward is the sign-in button,
 * and neither is an error the user caused by opening the popup.
 */
type ListState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; calendars: CalendarListEntry[] }
  | { kind: 'error'; message: string };

/**
 * The Calendars tab: which of the user's Google calendars the widget shows.
 *
 * The list is asked for without a prompt when the tab opens, and a user who is
 * not signed in sees the sign-in button and a hint, not an error: they have not
 * done anything yet. An error appears only for a request that failed (offline,
 * an API error), or after the sign-in button was pressed and did not work.
 */
export function CalendarsSection({ settings }: { settings: HubSettings }) {
  const { t } = useTranslation();
  const { save } = useSave();
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [selected, setSelected] = useState<string[]>(settings.selectedCalendars);
  /** Only the latest request commits: the mount load and a sign-in can overlap. */
  const request = useRef(0);

  const show = useCallback(
    (result: CalendarListResult, interactive: boolean) => {
      if (result.kind === 'ok') setList({ kind: 'ready', calendars: result.calendars });
      else if (result.kind === 'failed')
        setList({
          kind: 'error',
          message: result.status ? t('popup.apiError', { status: result.status }) : t('popup.networkError'),
        });
      else if (interactive) setList({ kind: 'error', message: t('popup.signInFailed') });
      else setList({ kind: 'signed-out' });
    },
    [t],
  );

  useEffect(() => {
    const requests = request;
    const id = ++requests.current;
    void fetchCalendarList(false).then((result) => {
      if (id === requests.current) show(result, false);
    });
    return () => {
      // An answer arriving after the tab closed must not land.
      requests.current++;
    };
  }, [show]);

  /** From a click: the interactive sign-in needs that gesture. */
  const signIn = async () => {
    const id = ++request.current;
    const result = await fetchCalendarList(true);
    if (id === request.current) show(result, true);
  };

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id];
    setSelected(next);
    void save({ selectedCalendars: next });
  };

  return (
    <div className={`${sectionCls} gap-3`}>
      <div className='flex justify-between items-center'>
        <span className={labelCls}>{t('popup.calendars')}</span>
        <button
          type='button'
          onClick={() => void signIn()}
          className='text-[10px] font-medium bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded transition-colors shrink-0'
        >
          {t('popup.googleLogin')}
        </button>
      </div>
      {list.kind === 'error' && (
        <p className='text-[10px] text-red-400 bg-red-500/10 p-2 rounded'>{list.message}</p>
      )}
      {list.kind === 'loading' && (
        <p className='text-[10px] text-white/40 italic'>{t('popup.loadingCalendars')}</p>
      )}
      {list.kind === 'signed-out' && (
        <p className='text-[10px] text-white/40'>{t('popup.calendarsSignedOut')}</p>
      )}
      {list.kind === 'ready' && (
        <div className='flex flex-col gap-0.5 min-w-0'>
          {list.calendars.map((cal) => (
            <label
              key={cal.id}
              className='flex items-center gap-2.5 cursor-pointer hover:bg-white/5 px-2 py-1.5 rounded-md transition-colors min-w-0'
            >
              <input
                type='checkbox'
                checked={selected.includes(cal.id)}
                onChange={() => toggle(cal.id)}
                className='accent-white/70 w-3.5 h-3.5 rounded border-white/20 bg-zinc-900 cursor-pointer shrink-0'
              />
              <div
                className='w-2.5 h-2.5 rounded-full shrink-0'
                style={{ backgroundColor: cal.backgroundColor || '#ccc' }}
              />
              <span className='text-sm text-white/90 truncate select-none min-w-0 flex-1'>
                {cal.summary}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
