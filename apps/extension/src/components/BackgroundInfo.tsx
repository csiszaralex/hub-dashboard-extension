import type { BackgroundData } from '@hub/shared';
import { Camera, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const UNSPLASH_URL = 'https://unsplash.com/?utm_source=hub&utm_medium=referral';

interface Props {
  data: BackgroundData;
}

export const BackgroundInfo = ({ data }: Props) => {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col items-start text-white/60 text-xs gap-1 transition-opacity duration-500 delay-100'>
      {data.location && (
        <div className='flex items-center gap-1.5'>
          <span>{data.location}</span>
          <MapPin className='w-3 h-3' />
        </div>
      )}

      {data.photographer && (
        // Unsplash API guidelines require crediting both the photographer and
        // Unsplash, each hyperlinked, with referral parameters on the links.
        <div className='flex items-center gap-1.5'>
          <a
            href={data.photographerUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='hover:text-white transition-colors cursor-pointer'
            aria-label={t('background.photographerLabel', { name: data.photographer })}
          >
            {data.photographer}
          </a>
          <span aria-hidden='true'>/</span>
          <a
            href={UNSPLASH_URL}
            target='_blank'
            rel='noopener noreferrer'
            className='hover:text-white transition-colors cursor-pointer'
          >
            Unsplash
          </a>
          <Camera className='w-3 h-3' />
        </div>
      )}
    </div>
  );
};
