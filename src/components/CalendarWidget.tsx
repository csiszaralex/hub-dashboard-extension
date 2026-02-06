import { differenceInMinutes, format, isSameDay, isToday, isTomorrow, parseISO } from 'date-fns';
import { hu } from 'date-fns/locale';
import { Briefcase, Calendar, Clock, MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { useCalendar } from '../hooks/useCalendar';

// --- Típusok ---
interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
}

interface EventRowProps {
  event: CalendarEvent;
  type: 'next' | 'future';
}

// --- Segédfüggvény ---
const formatEventTime = (date: Date) => {
  if (isToday(date)) return format(date, 'HH:mm');
  if (isTomorrow(date)) return `Holnap ${format(date, 'HH:mm')}`;
  return format(date, 'MMM d. HH:mm', { locale: hu });
};

// --- Kiszervezett sor komponens ---
const EventRow = ({ event, type }: EventRowProps) => {
  const start = parseISO(event.start.dateTime!);
  const end = parseISO(event.end.dateTime!);
  const isNext = type === 'next';

  const diff = differenceInMinutes(start, new Date());

  let timeLabel = '';
  if (isNext) {
    if (isToday(start) && diff < 60 && diff > 0) timeLabel = `${diff} perc múlva`;
    else timeLabel = formatEventTime(start);
  } else {
    timeLabel = formatEventTime(start);
  }

  if (diff <= 0 && type === 'next') timeLabel = 'Most';

  return (
    <div
      className={`relative group ${isNext ? 'mb-2' : 'py-1.5 border-t border-white/5 opacity-70'}`}
    >
      <div className='flex justify-between items-start'>
        <div className='flex-1 min-w-0'>
          <div
            className={`flex items-center gap-1.5 ${isNext ? 'text-blue-300 mb-0.5' : 'text-white/50'} text-xs font-bold uppercase tracking-wider`}
          >
            {isNext && <Clock className='w-3 h-3' />}
            <span>{timeLabel}</span>
            {isNext && isToday(end) && (
              <span className='text-white/30 font-normal'>| {format(end, 'HH:mm')}</span>
            )}
          </div>

          <h4
            className={`${isNext ? 'text-base text-white font-bold' : 'text-sm text-white/90'} truncate leading-tight`}
          >
            {event.summary}
          </h4>

          {isNext && event.location && (
            <div className='flex items-center gap-1 mt-1 text-xs text-white/50 truncate'>
              <MapPin className='w-3 h-3 shrink-0' />
              <span>{event.location}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Fő Komponens ---
export const CalendarWidget = () => {
  const { events, signedIn, login, loading } = useCalendar();

  // --- Adatfeldolgozás ---
  const { currentEvent, nextEvent, allDayEvents, futureEvents } = useMemo(() => {
    const now = new Date();
    const _allDay: CalendarEvent[] = [];
    const _timed: CalendarEvent[] = [];

    events.forEach((e) => {
      if (e.start.date) {
        if (isSameDay(parseISO(e.start.date), now)) _allDay.push(e);
      } else if (e.start.dateTime) {
        _timed.push(e);
      }
    });

    let current: CalendarEvent | null = null;
    let next: CalendarEvent | null = null;
    const future: CalendarEvent[] = [];

    for (const e of _timed) {
      const start = parseISO(e.start.dateTime!);
      const end = parseISO(e.end.dateTime!);

      if (start <= now && end > now) {
        if (!current) current = e;
      } else if (start > now) {
        if (!next) next = e;
        else future.push(e);
      }
    }

    return {
      currentEvent: current,
      nextEvent: next,
      allDayEvents: _allDay,
      futureEvents: future.slice(0, 2),
    };
  }, [events]);

  if (loading) return null;

  if (!signedIn) {
    return (
      <div className='absolute top-8 left-8'>
        <button
          onClick={login}
          className='flex items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full text-white/70 hover:bg-white/10 hover:text-white transition-all text-sm font-medium shadow-lg'
        >
          <Calendar className='w-4 h-4' />
          <span>Csatolás</span>
        </button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className='absolute top-8 left-8 flex items-center gap-3 px-5 py-3 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl'>
        <div className='p-2 bg-white/5 rounded-full text-emerald-400'>
          <Calendar className='w-5 h-5' />
        </div>
        <div>
          <p className='text-sm font-bold text-white/90'>Üres naptár</p>
          <p className='text-xs text-white/50'>Flow state ON</p>
        </div>
      </div>
    );
  }

  return (
    <div className='absolute top-8 left-8 w-60 flex flex-col gap-2'>
      {/* 1. SZEKCIÓ: MOST ZAJLIK (Finomított Glassmorphism) */}
      {currentEvent && (
        <div className='bg-linear-to-r from-indigo-500/30 to-purple-500/30 backdrop-blur-xl border border-indigo-500/20 p-4 rounded-2xl relative overflow-hidden animate-in fade-in slide-in-from-top-4 duration-500'>
          <div className='absolute top-3 right-3 flex items-center gap-1.5'>
            <span className='relative flex h-2 w-2'>
              <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75'></span>
              <span className='relative inline-flex rounded-full h-2 w-2 bg-indigo-400'></span>
            </span>
            <span className='text-[10px] font-bold text-indigo-200 uppercase tracking-widest'>
              Most
            </span>
          </div>

          <h2 className='text-xl font-bold text-white leading-tight pr-8 mb-1 line-clamp-2'>
            {currentEvent.summary}
          </h2>
          <div className='text-indigo-200/80 text-sm flex items-center gap-2 font-medium'>
            <Clock className='w-3.5 h-3.5' />
            {format(parseISO(currentEvent.end.dateTime!), 'HH:mm')}-ig
          </div>
        </div>
      )}

      {/* 2. SZEKCIÓ: NAPLÓ */}
      <div className='grid grid-cols-1 gap-2'>
        <div className='bg-black/40 backdrop-blur-xl border border-white/10 p-4 rounded-2xl shadow-xl'>
          {/* HEADER: Egész naposak (Csak MA) */}
          {allDayEvents.length > 0 && (
            <div className='flex flex-wrap gap-2 mb-3 border-b border-white/5 pb-3'>
              {allDayEvents.map((e) => (
                <div
                  key={e.id}
                  className='bg-white/10 border border-white/5 px-2 py-1 rounded-md flex items-center gap-2 max-w-full'
                >
                  <Briefcase className='w-3 h-3 text-amber-200 shrink-0' />
                  <span
                    className='text-xs font-semibold text-white/90 truncate max-w-35'
                    title={e.summary}
                  >
                    {e.summary}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* KÖVETKEZŐ */}
          {nextEvent ? (
            <div className='flex flex-col gap-3'>
              <EventRow event={nextEvent} type='next' />
              {futureEvents.length > 0 && (
                <div className='flex flex-col gap-2 mt-1 pl-1'>
                  {futureEvents.map((e) => (
                    <EventRow key={e.id} event={e} type='future' />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className='text-center py-2'>
              <p className='text-sm text-white/40'>Nincs további program.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
