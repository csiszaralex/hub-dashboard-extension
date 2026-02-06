import { Camera, MapPin } from 'lucide-react';
import type { BackgroundData } from '../hooks/useBackground';

interface Props {
  data: BackgroundData;
}

export const BackgroundInfo = ({ data }: Props) => {
  return (
    <div className='flex flex-col items-start text-white/60 text-xs gap-1 transition-opacity duration-500 delay-100'>
      {data.location && (
        <div className='flex items-center gap-1.5'>
          <span>{data.location}</span>
          <MapPin className='w-3 h-3' />
        </div>
      )}

      <a
        href={data.photographerUrl}
        target='_blank'
        rel='noopener noreferrer'
        className='flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer'
      >
        <span>{data.photographer} / Unsplash</span>
        <Camera className='w-3 h-3' />
      </a>
    </div>
  );
};
