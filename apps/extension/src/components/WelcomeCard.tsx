import { Hand, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const POINTS = ['welcome.settings', 'welcome.toggle', 'welcome.connect'] as const;

interface Props {
  onClose: () => void;
}

/**
 * The first install's greeting, shown in place of the release notes, which
 * would only be a list of commit subjects to someone who has never used Hub.
 *
 * A labelled region rather than a dialog: it sits beside the dashboard instead
 * of over it, so it neither moves focus nor traps it, and `aria-modal` would
 * tell a screen reader the rest of the page is out of reach when it is not.
 */
export const WelcomeCard = ({ onClose }: Props) => {
  const { t } = useTranslation();
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);

  // On `window`, not on the card: nothing moves focus into a non-modal card,
  // so a key handler on it would hear Escape only after the user tabbed in.
  // Skipped while the UI is hidden (`App` makes the layer `inert`): that press
  // belongs to `useUiVisibility`, which brings the UI back with it, and the
  // card should still be there when it does — it is what told the user to try.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (cardRef.current?.closest('[inert]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <section
      ref={cardRef}
      aria-labelledby={titleId}
      className='flex flex-col gap-3 glass-subtle px-5 py-4 shadow-2xl max-w-md w-full'
    >
      <div className='flex items-center justify-between gap-6'>
        <div className='flex items-center gap-2.5'>
          <Hand className='w-4 h-4 text-white/60 shrink-0' aria-hidden />
          <h2 id={titleId} className='text-xs text-white/50 uppercase tracking-widest'>
            {t('welcome.title')}
          </h2>
        </div>
        <button
          type='button'
          onClick={onClose}
          className='cursor-pointer text-white/40 hover:text-white transition-colors shrink-0'
          title={t('welcome.close')}
          aria-label={t('welcome.close')}
        >
          <X className='w-4 h-4' />
        </button>
      </div>
      <ul className='space-y-1.5'>
        {POINTS.map((key) => (
          <li key={key} className='flex items-start gap-2 text-sm text-white/70'>
            <span className='mt-2 w-1 h-1 rounded-full bg-white/30 shrink-0' aria-hidden />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      <button
        type='button'
        onClick={() => void chrome.runtime.openOptionsPage()}
        className='self-start cursor-pointer text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors'
      >
        {t('welcome.openSettings')}
      </button>
    </section>
  );
};
