import { format } from 'date-fns';
import { MapPin, Sunrise, Sunset, Umbrella, Wind } from 'lucide-react';
import { useWeather } from '../hooks/useWeather';
import { getWeatherDescription, getWeatherIcon } from '../utils/weatherMapping';

export const WeatherWidget = () => {
  const { data, loading } = useWeather();

  if (loading)
    return (
      <div className='absolute top-8 right-8 text-white/40 text-sm animate-pulse'>Időjárás...</div>
    );
  if (!data) return null;

  return (
    // Fix szélesség (w-72) a konzisztencia miatt, 'backdrop-blur-md' az üveghatásért
    <div className='absolute top-8 right-8 w-72 bg-gray-900/40 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden font-sans text-white'>
      {/* FELSŐ RÉSZ: Fő adatok */}
      <div className='p-5 pb-4'>
        {/* Városfejléc */}
        <div className='flex items-center gap-1.5 text-white/60 text-xs font-medium tracking-wider uppercase mb-3'>
          <MapPin className='w-3.5 h-3.5' />
          <span className='truncate'>{data.city}</span>
        </div>

        {/* Hőfok és Ikon egy sorban - Kitölti a teret */}
        <div className='flex justify-between items-center'>
          <div className='flex flex-col'>
            <span className='text-5xl font-bold tracking-tighter leading-none'>{data.temp}°</span>
            <span className='text-sm font-medium text-white/80 mt-1'>
              {getWeatherDescription(data.code)}
            </span>
          </div>

          {/* Nagy ikon a jobb oldalon */}
          <div className='text-white/90 scale-150 p-2'>{getWeatherIcon(data.code)}</div>
        </div>
      </div>

      {/* ALSÓ RÉSZ: Részletek (Sötétebb háttérrel elválasztva) */}
      <div className='bg-black/20 px-5 py-4 grid grid-cols-2 gap-y-3 gap-x-4 border-t border-white/5'>
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

        {/* Eső */}
        <div className='flex items-center gap-2.5'>
          <div className='p-1.5 rounded-full bg-white/5 text-indigo-300'>
            <Umbrella className='w-3.5 h-3.5' />
          </div>
          <div className='flex flex-col'>
            <span className='text-[10px] text-white/40 uppercase font-bold tracking-wider'>
              Eső
            </span>
            <span className='text-sm font-medium'>
              {data.nextRain ? format(new Date(data.nextRain), 'HH:mm') : '-'}
            </span>
          </div>
        </div>

        {/* Napkelte */}
        <div className='flex items-center gap-2.5'>
          <div className='p-1.5 rounded-full bg-white/5 text-orange-300'>
            <Sunrise className='w-3.5 h-3.5' />
          </div>
          <div className='flex flex-col'>
            <span className='text-[10px] text-white/40 uppercase font-bold tracking-wider'>
              Kelt
            </span>
            <span className='text-sm font-medium'>{format(new Date(data.sunrise), 'HH:mm')}</span>
          </div>
        </div>

        {/* Naplemente */}
        <div className='flex items-center gap-2.5'>
          <div className='p-1.5 rounded-full bg-white/5 text-orange-400'>
            <Sunset className='w-3.5 h-3.5' />
          </div>
          <div className='flex flex-col'>
            <span className='text-[10px] text-white/40 uppercase font-bold tracking-wider'>
              Nyug
            </span>
            <span className='text-sm font-medium'>{format(new Date(data.sunset), 'HH:mm')}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
