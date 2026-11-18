import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HubSettings } from '../hooks/useSettings';
import { clampDim, MAX_DIM } from '../utils/dim';
import { Field, inputCls } from './Field';
import { useSave } from './saveStatus';
import { useDraftSetting } from './useDraftSetting';

// Module scope, like TabNav's TABS: i18next/no-literal-string flags literals inside
// JSX, and this array is only ever mapped over from within JSX.
const BACKGROUND_SOURCES = ['unsplash', 'custom'] as const;

type BackgroundSource = HubSettings['backgroundSource'];

/** The Background tab: where the photo comes from, the Unsplash tags, and the dim. */
export function AppearanceSection({ settings }: { settings: HubSettings }) {
  const { t } = useTranslation();
  const { save, report } = useSave();
  // What the radios show. It can say `custom` while storage still says
  // `unsplash`: choosing the option with no image stored yet shows the upload
  // field, and only an image actually in the cache makes it the setting.
  const [source, setSource] = useState<BackgroundSource>(settings.backgroundSource);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const tags = useDraftSetting(settings.unsplashQuery, (value) => ({
    unsplashQuery: value.trim(),
  }));
  const dim = useDraftSetting(clampDim(settings.backgroundDim), (value) => ({
    backgroundDim: clampDim(value),
  }));

  const fail = (message: string) => {
    setUploadError(message);
    report(message);
  };

  const chooseSource = async (next: BackgroundSource) => {
    setSource(next);
    setUploadError(null);
    if (next === 'unsplash') {
      void save({ backgroundSource: next });
      return;
    }
    // Without an image in the cache the background hook has nothing to
    // resolve and the dashboard silently goes blank, so the setting waits for
    // the upload below.
    const { hasCustomImage } = await import('../utils/imageCache');
    if (await hasCustomImage()) void save({ backgroundSource: next });
    else setUploadError(t('popup.uploadMissing'));
  };

  const handleUpload = async (file: File | undefined) => {
    setUploadError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      fail(t('popup.uploadNotImage'));
      return;
    }
    const { putCustomImage } = await import('../utils/imageCache');
    if (await putCustomImage(file)) {
      void save({ backgroundSource: 'custom' });
    } else {
      fail(t('popup.uploadFailed'));
    }
  };

  return (
    <div className='flex flex-col gap-3'>
      <Field label={t('popup.backgroundSource')}>
        <div className='flex flex-col gap-1'>
          {BACKGROUND_SOURCES.map((option) => (
            <label key={option} className='flex items-center gap-2.5 cursor-pointer text-sm'>
              <input
                type='radio'
                name='backgroundSource'
                value={option}
                checked={source === option}
                onChange={() => void chooseSource(option)}
                className='accent-white/70 shrink-0'
              />
              <span className='select-none'>{t(`popup.source_${option}`)}</span>
            </label>
          ))}
        </div>
      </Field>

      {source === 'custom' && (
        <Field id='upload' label={t('popup.upload')} hint={uploadError ?? t('popup.uploadHint')}>
          <input
            id='upload'
            type='file'
            accept='image/*'
            onChange={(e) => void handleUpload(e.target.files?.[0])}
            className='w-full text-xs'
          />
        </Field>
      )}

      {source === 'unsplash' && (
        <Field id='query' label={t('popup.appearance')} hint={t('popup.appearanceHint')}>
          <input
            id='query'
            type='text'
            value={tags.draft}
            onChange={(e) => tags.change(e.target.value)}
            onBlur={tags.flush}
            className={inputCls}
            placeholder={t('popup.appearancePlaceholder')}
          />
        </Field>
      )}

      <Field id='dim' label={t('popup.dim')} hint={t('popup.dimHint', { value: dim.draft })}>
        {/*
          Debounced like text, and written on release: dragging fires a change
          per step, and each one written would spend sync's write budget on
          positions the user only passed through.
        */}
        <input
          id='dim'
          type='range'
          min={0}
          max={MAX_DIM}
          step={5}
          value={dim.draft}
          onChange={(e) => dim.change(Number(e.target.value))}
          onPointerUp={dim.flush}
          onBlur={dim.flush}
          className='w-full accent-white'
        />
      </Field>
    </div>
  );
}
