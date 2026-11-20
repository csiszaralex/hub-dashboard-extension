import { differenceInMinutes, format, isToday, isTomorrow, parseISO } from 'date-fns';
import { Calendar, MapPin, Video } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCalendar } from '../hooks/useCalendar';
import { useSettings } from '../hooks/useSettings';
import { toLanguage } from '../i18n/language';
import { DATE_LOCALES, formatTime } from '../utils/localeFormat';
import type { CalendarEvent } from '../types/calendar';
import { categorizeEvents, meetingLink } from '../utils/calendarEvents';

interface EventRowProps {
  event: CalendarEvent;
  state: 'current' | 'next' | 'future';
}

const EventRow = ({ event, state }: EventRowProps) => {
  const { t, i18n } = useTranslation();
  const language = toLanguage(i18n.language);
  const time = (date: Date) => formatTime(date, language);

  const formatEventTime = (date: Date) => {
    if (isToday(date)) return time(date);
    if (isTomorrow(date)) return `${t('calendar.tomorrow')} ${time(date)}`;
    return `${format(date, t('calendar.dateFormat'), { locale: DATE_LOCALES[language] })} ${time(date)}`;
  };

  const start = parseISO(event.start.dateTime!);
  const end = parseISO(event.end.dateTime!);

  const isCurrent = state === 'current';
  const isNext = state === 'next';
  const diff = differenceInMinutes(start, new Date());

  let timeDisplay: string;
  if (isCurrent) {
    timeDisplay = `${time(start)} - ${time(end)}`;
  } else if (isNext && isToday(start) && diff < 60 && diff > 0) {
    timeDisplay = `${t('calendar.minutesUntil', { count: diff })} | ${time(end)}`;
  } else {
    timeDisplay = `${formatEventTime(start)} | ${time(end)}`;
  }

  const opacityClass = isCurrent
    ? 'opacity-100'
    : isNext
      ? 'opacity-90'
      : 'opacity-60 hover:opacity-100 transition-opacity';
  const bgClass = isCurrent ? 'bg-white/5' : 'bg-transparent hover:bg-white/[0.02]';

  const cleanDescription = event.description?.replace(/(<([^>]+)>)/gi, '');
  const joinUrl = meetingLink(event);

  return (
    <div
      className={`relative flex items-center gap-3 p-2.5 rounded-lg transition-colors group ${bgClass} ${opacityClass}`}
      title={cleanDescription}
    >
      {/* Calendar color indicator */}
      <div
        className='w-0.5 h-8 rounded-full shrink-0'
        style={{ backgroundColor: event.calendarColor }}
      ></div>

      {/* Left: Title, Time & Location */}
      <div className='flex-1 min-w-0 flex flex-col gap-0.5 justify-center'>
        {/* Top row: Title & Active indicator */}
        <div className='flex items-center gap-2'>
          {/*
            The ping is pure motion over the solid dot, so reduced motion
            drops it rather than leaving it frozen on top of the dot.
          */}
          {isCurrent && (
            <span className='relative flex h-2 w-2 shrink-0'>
              <span className='animate-ping motion-reduce:hidden absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75'></span>
              <span className='relative inline-flex rounded-full h-2 w-2 bg-indigo-400'></span>
            </span>
          )}
          <h4
            className={`truncate ${isCurrent ? 'text-sm font-bold text-white' : 'text-sm font-medium text-white/90'}`}
          >
            {event.summary}
          </h4>
        </div>

        {/* Bottom row: Time & Location */}
        <div
          className={`flex items-center gap-2 text-2xs font-bold uppercase tracking-wider ${isCurrent ? 'text-indigo-300' : isNext ? 'text-blue-300' : 'text-white/50'} truncate`}
        >
          <span className='shrink-0'>{timeDisplay}</span>

          {event.location && (
            <>
              <span className='text-white/20 shrink-0'>•</span>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(event.location)}`}
                className='flex items-center gap-1 hover:text-white/90 transition-colors truncate'
                title={event.location}
              >
                <MapPin className='w-3 h-3 shrink-0' />
                <span className='truncate'>{event.location.split(',')[0]}</span>
              </a>
            </>
          )}
        </div>
      </div>

      {/*
        Right: join the call. Resolved through `meetingLink` rather than read
        off `hangoutLink`, which Google sets for Meet and nothing else — a Zoom
        or Teams meeting puts its URL under `conferenceData` and used to render
        no button at all on a widget that shows every calendar.
      */}
      {joinUrl && (
        <a
          href={joinUrl}
          className='flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400/80 hover:text-emerald-400 transition-colors shrink-0'
          title={t('calendar.joinCall')}
          aria-label={t('calendar.joinCall')}
        >
          <Video className='w-4 h-4' />
        </a>
      )}
    </div>
  );
};

export const CalendarWidget = () => {
  const { settings, isLoaded: settingsLoaded } = useSettings();
  const { status, events, refreshFailed, login, retry } = useCalendar(
    settings.selectedCalendars,
    settingsLoaded,
  );
  const { t } = useTranslation();

  const { currentEvents, nextEvent, allDayEvents, futureEvents } = useMemo(
    () => categorizeEvents(events, new Date()),
    [events],
  );

  if (!settingsLoaded || status === 'loading') return null;

  // Neither state may fall through to the empty-day copy below: that tells the
  // user they are free. For `needs-sign-in` the click on this button is the
  // gesture the interactive sign-in needs, so the way back is here rather than
  // in the popup.
  if (status === 'needs-sign-in' || status === 'failed') {
    const needsSignIn = status === 'needs-sign-in';
    return (
      <div className='absolute top-edge left-edge flex items-center gap-3 px-4 py-2.5 glass shadow-xl'>
        <div className='p-1.5 bg-white/5 rounded-full text-amber-300'>
          <Calendar className='w-4 h-4' />
        </div>
        <p role='alert' className='text-sm text-white/80'>
          {needsSignIn ? t('calendar.signInAgainHint') : t('calendar.loadFailed')}
        </p>
        <button
          onClick={needsSignIn ? login : retry}
          className='px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-xs text-white/80 transition-colors shrink-0'
        >
          {needsSignIn ? t('calendar.signInAgain') : t('calendar.retry')}
        </button>
      </div>
    );
  }

  // A refresh that failed after a success: the events below are the last ones
  // Google sent, which is better than nothing but should not pass for current.
  // A `status`, not an `alert`: the events are still on screen, so this
  // qualifies them rather than reporting that something is missing.
  const staleNote = refreshFailed && (
    <p role='status' className='text-2xs text-white/40'>
      {t('calendar.refreshFailed')}
    </p>
  );

  if (status === 'signed-out') {
    return (
      <div className='absolute top-edge left-edge'>
        <button
          onClick={login}
          className='flex items-center gap-2 px-4 py-2 glass rounded-full text-white/70 hover:bg-white/10 hover:text-white transition-all text-sm font-medium shadow-lg'
        >
          <Calendar className='w-4 h-4' />
          <span>{t('calendar.attach')}</span>
        </button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className='absolute top-edge left-edge flex items-center gap-3 px-4 py-2.5 glass shadow-xl'>
        <div className='p-1.5 bg-white/5 rounded-full text-emerald-400'>
          <Calendar className='w-4 h-4' />
        </div>
        <div>
          <p className='text-sm font-bold text-white/90'>{t('calendar.empty')}</p>
          <p className='text-2xs text-white/50 uppercase tracking-wider'>{t('calendar.flowState')}</p>
          {staleNote}
        </div>
      </div>
    );
  }

  return (
    <div className='absolute top-edge left-edge w-72 glass shadow-2xl p-3 flex flex-col gap-2'>
      {/* 1. ALL-DAY EVENTS */}
      {allDayEvents.length > 0 && (
        <div className='flex flex-wrap gap-1.5 pb-2 border-b border-white/5'>
          {allDayEvents.map((e) => (
            <div
              key={e.id}
              className='flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 border border-white/5 max-w-full'
              title={e.description?.replace(/(<([^>]+)>)/gi, '')}
            >
              <div
                className='w-1.5 h-1.5 rounded-full shrink-0'
                style={{ backgroundColor: e.calendarColor }}
              ></div>
              <span className='text-2xs font-medium text-white/80 truncate' title={e.summary}>
                {e.summary}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 2. EVENT LIST */}
      <div className='flex flex-col gap-1'>
        {currentEvents.map((e) => (
          <EventRow key={e.id} event={e} state='current' />
        ))}

        {nextEvent && <EventRow event={nextEvent} state='next' />}

        {futureEvents.map((e) => (
          <EventRow key={e.id} event={e} state='future' />
        ))}

        {!nextEvent && currentEvents.length === 0 && (
          <div className='text-center py-4'>
            <p className='text-xs text-white/40'>{t('calendar.noEvents')}</p>
          </div>
        )}
      </div>

      {staleNote && <div className='px-2.5'>{staleNote}</div>}
    </div>
  );
};
