import { format } from 'date-fns';
import { MapPin, RefreshCw, Sunrise, Sunset, Umbrella, Wind } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWeather } from '../hooks/useWeather';
import { getWeatherDescription, getWeatherIcon } from '../utils/weatherMapping';

export const WeatherWidget = () => {
  const { data, loading, refresh } = useWeather();
  const { t } = useTranslation();

  if (loading && !data) {
    return (
      <div className='absolute top-8 right-8 w-72 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-3 flex flex-col gap-3 animate-pulse'>
        {/* Header skeleton */}
        <div className='flex items-center gap-1.5 px-1'>
          <div className='w-3 h-3 bg-white/10 rounded-full' />
          <div className='h-2.5 w-24 bg-white/10 rounded' />
        </div>

        {/* Main section skeleton */}
        <div className='flex justify-between items-center px-2 py-1'>
          <div className='flex flex-col gap-2'>
            <div className='h-10 w-16 bg-white/10 rounded-lg' />
            <div className='h-3 w-20 bg-white/10 rounded' />
          </div>
          <div className='w-12 h-12 bg-white/10 rounded-full' />
        </div>

        {/* Bottom section skeleton */}
        <div className='flex flex-col gap-1.5 mt-1 border-t border-white/5 pt-2'>
          <div className='grid grid-cols-2 gap-1.5'>
            <div className='h-10 bg-white/5 rounded-lg' />
            <div className='h-10 bg-white/5 rounded-lg' />
          </div>
          <div className='h-10 bg-white/5 rounded-lg' />
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
    ? { icon: Sunset, label: t('weather.sunset'), time: sunset, color: 'text-orange-400' }
    : { icon: Sunrise, label: t('weather.sunrise'), time: sunrise, color: 'text-orange-300' };

  const SolarIcon = nextSolarEvent.icon;
  const hasRain = data.rain.amount > 0 || data.rain.probability > 0;

  const getRainTimeLabel = (isoTime: string | null) => {
    if (!isoTime) return null;
    const rainDate = new Date(isoTime);
    if (rainDate.getTime() <= now.getTime()) return t('weather.now');
    return format(rainDate, 'HH:mm');
  };

  return (
    <div className='group absolute top-8 right-8 w-72 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-3 flex flex-col gap-2 font-sans text-white'>
      {/* 1. SECTION: Header (Location & Refresh) */}
      <div className='flex justify-between items-center px-1'>
        <div className='flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/50'>
          <MapPin className='w-3 h-3' />
          <span className='truncate max-w-40' title={data.city}>
            {data.city}
          </span>
        </div>
        <button
          onClick={refresh}
          className={`p-1 text-white/30 hover:text-white transition-colors rounded-full ${loading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          title={t('weather.refresh')}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 2. SECTION: Main Temperature & Icon */}
      <div className='flex items-center justify-between px-2 py-1'>
        <div className='flex flex-col'>
          <span className='text-5xl font-bold tracking-tighter leading-none'>{data.temp}°</span>
          <span className='text-xs font-medium text-white/80 mt-1 capitalize'>
            {getWeatherDescription(data.code)}
          </span>
        </div>
        <div className='text-white/90 scale-[1.7] transform-gpu origin-right pr-2'>
          {getWeatherIcon(data.code, isDaytime)}
        </div>
      </div>

      {/* 3. SECTION: Details (Wind, Sun, Rain) */}
      <div className='flex flex-col gap-1.5 mt-1 border-t border-white/5 pt-2.5'>
        {/* Wind & Sunrise/Sunset in one row */}
        <div className='grid grid-cols-2 gap-1.5'>
          {/* Wind */}
          <div className='flex items-center gap-2 p-2 rounded-lg bg-white/5 hover:bg-white/[0.07] transition-colors'>
            <Wind className='w-3.5 h-3.5 text-blue-300 shrink-0' />
            <div className='flex flex-col'>
              <span className='text-[9px] uppercase font-bold text-white/40 tracking-wider'>
                {t('weather.wind')}
              </span>
              <span className='text-[11px] font-medium text-white/90'>{data.windSpeed} km/h</span>
            </div>
          </div>

          {/* Sunrise/Sunset */}
          <div className='flex items-center gap-2 p-2 rounded-lg bg-white/5 hover:bg-white/[0.07] transition-colors'>
            <SolarIcon className={`w-3.5 h-3.5 shrink-0 ${nextSolarEvent.color}`} />
            <div className='flex flex-col'>
              <span className='text-[9px] uppercase font-bold text-white/40 tracking-wider'>
                {nextSolarEvent.label}
              </span>
              <span className='text-[11px] font-medium text-white/90'>
                {format(nextSolarEvent.time, 'HH:mm')}
              </span>
            </div>
          </div>
        </div>

        {/* Precipitation (full-width row) */}
        <div className='flex items-center gap-2.5 p-2 rounded-lg bg-white/5 hover:bg-white/[0.07] transition-colors'>
          <Umbrella className='w-3.5 h-3.5 text-indigo-300 shrink-0' />
          <div className='flex flex-col min-w-0'>
            <span className='text-[9px] uppercase font-bold text-white/40 tracking-wider'>
              {t('weather.precipitation')}
            </span>
            <span className='text-[11px] font-medium text-white/90 truncate'>
              {!hasRain ? (
                t('weather.noPrecipitation')
              ) : (
                <span className='flex items-center gap-1.5'>
                  {data.rain.probability}%
                  {data.rain.amount > 0 && <span className='text-white/30'>•</span>}
                  {data.rain.amount > 0 && `${data.rain.amount} mm`}
                  {data.rain.nextTime && <span className='text-white/30'>•</span>}
                  {data.rain.nextTime && (
                    <span className='text-indigo-300'>{getRainTimeLabel(data.rain.nextTime)}</span>
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
