import { differenceInMinutes, format, isToday, isTomorrow, parseISO } from 'date-fns';
import { hu } from 'date-fns/locale';
import { Calendar, MapPin, Video } from 'lucide-react';
import { useMemo } from 'react';
import { useCalendar, type CalendarEvent } from '../hooks/useCalendar';
import { useSettings } from '../hooks/useSettings';

interface EventRowProps {
  event: CalendarEvent;
  state: 'current' | 'next' | 'future';
}

const formatEventTime = (date: Date) => {
  if (isToday(date)) return format(date, 'HH:mm');
  if (isTomorrow(date)) return `Holnap ${format(date, 'HH:mm')}`;
  return format(date, 'MMM. d. HH:mm', { locale: hu });
};

const EventRow = ({ event, state }: EventRowProps) => {
  const start = parseISO(event.start.dateTime!);
  const end = parseISO(event.end.dateTime!);

  const isCurrent = state === 'current';
  const isNext = state === 'next';
  const diff = differenceInMinutes(start, new Date());

  // Időpont formázási logika egységesítése
  let timeDisplay = '';
  if (isCurrent) {
    timeDisplay = `${format(start, 'HH:mm')} - ${format(end, 'HH:mm')}`;
  } else if (isNext && isToday(start) && diff < 60 && diff > 0) {
    timeDisplay = `${diff} perc múlva | ${format(end, 'HH:mm')}`;
  } else {
    timeDisplay = `${formatEventTime(start)} | ${format(end, 'HH:mm')}`;
  }

  const opacityClass = isCurrent
    ? 'opacity-100'
    : isNext
      ? 'opacity-90'
      : 'opacity-60 hover:opacity-100 transition-opacity';
  const bgClass = isCurrent ? 'bg-white/5' : 'bg-transparent hover:bg-white/[0.02]';

  const cleanDescription = event.description?.replace(/(<([^>]+)>)/gi, '');

  return (
    <div
      className={`relative flex items-center gap-3 p-2.5 rounded-lg transition-colors group ${bgClass} ${opacityClass}`}
      title={cleanDescription}
    >
      {/* Naptárszín indikátor */}
      <div
        className='w-0.5 h-8 rounded-full shrink-0'
        style={{ backgroundColor: event.calendarColor }}
      ></div>

      {/* Bal oldal: Cím, Idő és Helyszín */}
      <div className='flex-1 min-w-0 flex flex-col gap-0.5 justify-center'>
        {/* FELSŐ SOR: Cím és Aktív indikátor */}
        <div className='flex items-center gap-2'>
          {isCurrent && (
            <span className='relative flex h-2 w-2 shrink-0'>
              <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75'></span>
              <span className='relative inline-flex rounded-full h-2 w-2 bg-indigo-400'></span>
            </span>
          )}
          <h4
            className={`truncate ${isCurrent ? 'text-sm font-bold text-white' : 'text-sm font-medium text-white/90'}`}
          >
            {event.summary}
          </h4>
        </div>

        {/* ALSÓ SOR: Idő és Helyszín */}
        <div
          className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider ${isCurrent ? 'text-indigo-300' : isNext ? 'text-blue-300' : 'text-white/50'} truncate`}
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

      {/* Jobb oldal: Kiemelt Call to Action (Meet gomb) */}
      {event.hangoutLink && (
        <a
          href={event.hangoutLink}
          className='flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400/80 hover:text-emerald-400 transition-colors shrink-0'
          title='Csatlakozás a híváshoz'
        >
          <Video className='w-4 h-4' />
        </a>
      )}
    </div>
  );
};

export const CalendarWidget = () => {
  const { settings, isLoaded: settingsLoaded } = useSettings();
  const { events, signedIn, login, loading } = useCalendar(
    settings.selectedCalendars,
    settingsLoaded,
  );

  const { currentEvents, nextEvent, allDayEvents, futureEvents } = useMemo(() => {
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');

    const _allDay: CalendarEvent[] = [];
    const _timed: CalendarEvent[] = [];

    events.forEach((e) => {
      if (e.start.date && e.end.date) {
        if (e.start.date <= todayStr && e.end.date > todayStr) _allDay.push(e);
      } else if (e.start.dateTime) {
        _timed.push(e);
      }
    });

    const current: CalendarEvent[] = [];
    let next: CalendarEvent | null = null;
    const future: CalendarEvent[] = [];

    for (const e of _timed) {
      const start = parseISO(e.start.dateTime!);
      const end = parseISO(e.end.dateTime!);

      if (start <= now && end > now) current.push(e);
      else if (start > now) {
        if (!next) next = e;
        else future.push(e);
      }
    }

    current.sort(
      (a, b) => parseISO(a.end.dateTime!).getTime() - parseISO(b.end.dateTime!).getTime(),
    );

    return {
      currentEvents: current,
      nextEvent: next,
      allDayEvents: _allDay,
      futureEvents: future.slice(0, 3),
    };
  }, [events]);

  if (!settingsLoaded || loading) return null;

  if (!signedIn) {
    return (
      <div className='absolute top-8 left-8'>
        <button
          onClick={login}
          className='flex items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full text-white/70 hover:bg-white/10 hover:text-white transition-all text-sm font-medium shadow-lg'
        >
          <Calendar className='w-4 h-4' />
          <span>Naptár csatolása</span>
        </button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className='absolute top-8 left-8 flex items-center gap-3 px-4 py-2.5 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl'>
        <div className='p-1.5 bg-white/5 rounded-full text-emerald-400'>
          <Calendar className='w-4 h-4' />
        </div>
        <div>
          <p className='text-sm font-bold text-white/90'>Üres naptár</p>
          <p className='text-[10px] text-white/50 uppercase tracking-wider'>Flow state ON</p>
        </div>
      </div>
    );
  }

  return (
    <div className='absolute top-8 left-8 w-72 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-3 flex flex-col gap-2'>
      {/* 1. EGÉSZ NAPOS ESEMÉNYEK */}
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
              <span className='text-[11px] font-medium text-white/80 truncate' title={e.summary}>
                {e.summary}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 2. ESEMÉNYEK LISTÁJA */}
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
            <p className='text-xs text-white/40'>Nincs további program a láthatáron.</p>
          </div>
        )}
      </div>
    </div>
  );
};
