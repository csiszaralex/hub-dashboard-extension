import { format } from 'date-fns';
import { MapPin, RefreshCw, Sunrise, Sunset, Umbrella, Wind } from 'lucide-react';
import { useWeather } from '../hooks/useWeather';
import { getWeatherDescription, getWeatherIcon } from '../utils/weatherMapping';

export const WeatherWidget = () => {
  const { data, loading, refresh } = useWeather();

  if (loading && !data) {
    return (
      <div className='absolute top-8 right-8 w-72 bg-gray-900/40 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden animate-pulse'>
        <div className='p-5 pb-4'>
          <div className='flex items-center gap-1.5 mb-3'>
            <div className='w-3.5 h-3.5 bg-white/10 rounded-full' />
            <div className='h-3 w-24 bg-white/10 rounded' />
          </div>
          <div className='flex justify-between items-center'>
            <div className='flex flex-col gap-2'>
              <div className='h-12 w-20 bg-white/10 rounded-lg' />
              <div className='h-4 w-24 bg-white/10 rounded' />
            </div>
            <div className='w-16 h-16 bg-white/10 rounded-full' />
          </div>
        </div>

        <div className='bg-black/20 px-5 py-4 grid grid-cols-2 gap-y-4 gap-x-4 border-t border-white/5'>
          {[...Array(2)].map((_, i) => (
            <div key={i} className='flex items-center gap-2.5'>
              <div className='w-7 h-7 rounded-full bg-white/10' />
              <div className='flex flex-col gap-1.5'>
                <div className='h-2 w-8 bg-white/5 rounded' />
                <div className='h-3 w-12 bg-white/10 rounded' />
              </div>
            </div>
          ))}
          <div className='flex items-center gap-2.5 col-span-2 mt-1 pt-3 border-t border-white/5'>
            <div className='w-7 h-7 rounded-full bg-white/10' />
            <div className='flex flex-col gap-1.5 w-full'>
              <div className='h-2 w-16 bg-white/5 rounded' />
              <div className='h-3 w-3/4 bg-white/10 rounded' />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const now = new Date();
  const sunrise = new Date(data.sunrise);
  const sunset = new Date(data.sunset);
  const isDaytime = now >= sunrise && now < sunset;

  const nextSolarEvent = isDaytime
    ? { icon: Sunset, label: 'Nyug', time: sunset, color: 'text-orange-400' }
    : { icon: Sunrise, label: 'Kelt', time: sunrise, color: 'text-orange-300' };

  const SolarIcon = nextSolarEvent.icon;
  const hasRain = data.rain.amount > 0 || data.rain.probability > 0;

  // Ha az eső az aktuális (vagy elmúlt) órához tartozik, ne írjuk ki hogy "22:00", hanem "Most"
  const getRainTimeLabel = (isoTime: string | null) => {
    if (!isoTime) return null;
    const rainDate = new Date(isoTime);
    if (rainDate.getTime() <= now.getTime()) return 'Most';
    return format(rainDate, 'HH:mm');
  };

  return (
    <div className='group absolute top-8 right-8 w-72 bg-gray-900/40 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden font-sans text-white'>
      <button
        onClick={refresh}
        className={`absolute top-3 right-3 p-2 text-white/20 hover:text-white/80 hover:bg-white/10 rounded-full transition-all z-10 ${loading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        title='Időjárás frissítése'
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
      </button>

      <div className='p-5 pb-4'>
        <div className='flex items-center gap-1.5 text-white/60 text-xs font-medium tracking-wider uppercase mb-3'>
          <MapPin className='w-3.5 h-3.5' />
          <span className='truncate'>{data.city}</span>
        </div>

        <div
          className={`flex items-center w-full ${isDaytime ? 'justify-between' : 'flex-row-reverse justify-between'}`}
        >
          <div className={`flex flex-col ${!isDaytime ? 'items-end text-right' : ''}`}>
            <span className='text-5xl font-bold tracking-tighter leading-none'>{data.temp}°</span>
            <span className='text-sm font-medium text-white/80 mt-1'>
              {getWeatherDescription(data.code)}
            </span>
          </div>
          <div className='text-white/90 scale-[2] transform-gpu origin-center p-2'>
            {getWeatherIcon(data.code)}
          </div>
        </div>
      </div>

      <div className='bg-black/20 px-5 py-4 grid grid-cols-2 gap-y-4 gap-x-4 border-t border-white/5'>
        {/* Szél */}
        <div className='flex items-center gap-2.5'>
          <div className='p-1.5 rounded-full bg-white/5 text-blue-300'>
            <Wind className='w-3.5 h-3.5' />
          </div>
          <div className='flex flex-col'>
            <span className='text-[10px] text-white/40 uppercase font-bold tracking-wider'>
              Szél
            </span>
            <span className='text-sm font-medium'>{data.windSpeed} km/h</span>
          </div>
        </div>

        {/* Napkelte/Nyugta */}
        <div className='flex items-center gap-2.5'>
          <div className={`p-1.5 rounded-full bg-white/5 ${nextSolarEvent.color}`}>
            <SolarIcon className='w-3.5 h-3.5' />
          </div>
          <div className='flex flex-col'>
            <span className='text-[10px] text-white/40 uppercase font-bold tracking-wider'>
              {nextSolarEvent.label}
            </span>
            <span className='text-sm font-medium'>{format(nextSolarEvent.time, 'HH:mm')}</span>
          </div>
        </div>

        {/* Csapadék sáv - Integrálva a gridbe */}
        <div className='flex items-center gap-2.5 col-span-2 mt-1 pt-3 border-t border-white/5'>
          <div className='p-1.5 rounded-full bg-white/5 text-indigo-300'>
            <Umbrella className='w-3.5 h-3.5' />
          </div>
          <div className='flex flex-col'>
            <span className='text-[10px] text-white/40 uppercase font-bold tracking-wider'>
              Csapadék (köv. 12 óra)
            </span>
            <span className='text-sm font-medium'>
              {!hasRain ? (
                'Nincs várható csapadék'
              ) : (
                <span className='flex items-center gap-1.5'>
                  {data.rain.probability}%
                  {data.rain.amount > 0 && <span className='text-white/40'>|</span>}
                  {data.rain.amount > 0 && `${data.rain.amount} mm`}
                  {data.rain.nextTime && <span className='text-white/40'>|</span>}
                  {data.rain.nextTime && (
                    <span className='text-indigo-200'>{getRainTimeLabel(data.rain.nextTime)}</span>
                  )}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
