import { Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { parseHeading, releasesSince, stripMarkdown } from '../utils/changelog';

const GithubIcon = () => (
  <svg viewBox='0 0 24 24' fill='currentColor' className='w-4 h-4'>
    <path d='M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z' />
  </svg>
);

interface Props {
  version: string;
  /**
   * The version this user last saw the modal for, or null on a first install.
   * Everything released between it and `version` is shown, because a user does
   * not necessarily arrive one release at a time.
   */
  lastSeenVersion: string | null;
  onClose: () => void;
  /**
   * The release notes to draw from. Defaults to the recent slice of
   * `CHANGELOG.md` that `vite.config.ts` injects at build time, which is what
   * the app always wants; the parameter exists so a test can supply its own.
   * `__CHANGELOG__` is a compile-time substitution rather than a global, so it
   * cannot be stubbed — under Vitest it is replaced with the empty string, and
   * without this the modal has no reachable state in which it renders an entry.
   */
  changelog?: string;
}

export const WhatsNewModal = ({
  version,
  lastSeenVersion,
  onClose,
  changelog = __CHANGELOG__,
}: Props) => {
  const { t } = useTranslation();
  const releases = releasesSince(changelog, lastSeenVersion, version);
  const hasSections = releases.some((release) => release.sections.length > 0);
  // One release needs no version headings — the panel header already names it.
  // Several do, or the reader gets two "Features" lists with nothing to say
  // which release each belongs to.
  const showVersions = releases.length > 1;

  return (
    // The same glass as every other widget. An opaque panel was tried first,
    // because the clock's white digits read straight through a translucent one
    // — but that put a solid slab in the middle of an interface where nothing
    // else is solid, which is a worse trade than it sounds. `App.tsx` hides the
    // clock and the quote while this is open instead, so there is nothing left
    // behind the glass to show through and the house style survives.
    //
    // Capped to the viewport: the slot starts at `top-10`, so anything taller
    // ran off the bottom of the screen with no way to reach the rest.
    // No horizontal padding on the panel itself. It used to carry `px-8`, which
    // pushed the scroll container — and with it the scrollbar — that far in
    // from the edge, on top of the container's own padding. Each child pads
    // itself instead, so the scrollbar can sit against the panel edge while the
    // text still lines up with the header.
    <div className='flex flex-col bg-black/20 backdrop-blur-md py-4 rounded-3xl border border-white/10 shadow-2xl max-w-lg w-full max-h-[calc(100vh-5rem)]'>
      {/* Header */}
      <div className='flex items-center justify-between gap-6 px-5'>
        <div className='flex items-center gap-2.5'>
          <Sparkles className='w-4 h-4 text-white/60 shrink-0' />
          <span className='text-xs text-white/50 uppercase tracking-widest'>{t('whatsNew.updated')}</span>
          <span className='text-sm font-bold text-white/90'>{`v${version}`}</span>
          <a
            href='https://github.com/csiszaralex/hub-dashboard-extension'
            target='_blank'
            rel='noreferrer'
            className='text-white/40 hover:text-white transition-colors'
          >
            <GithubIcon />
          </a>
        </div>
        <button
          onClick={onClose}
          className='cursor-pointer text-white/40 hover:text-white transition-colors shrink-0'
        >
          <X className='w-4 h-4' />
        </button>
      </div>

      {/* Changelog */}
      {hasSections && (
        // `min-h-0` is what makes the scrolling work, not decoration: a flex
        // child's default `min-height: auto` refuses to shrink below its
        // content, so `overflow-y-auto` would never engage and the list would
        // push the modal past its own `max-h` instead of scrolling inside it.
        // The same rule that clipped the settings tab strip, one axis over.
        //
        // The scrollbar is styled through the standard `scrollbar-width` and
        // `scrollbar-color` properties rather than `::-webkit-scrollbar`:
        // Chrome has supported them since 121 and they need no vendor-prefixed
        // pseudo-element rules in the stylesheet. Left at the platform default
        // it renders as an opaque light-grey bar with a solid track — the one
        // piece of unstyled OS chrome in a translucent, dark interface.
        //
        // `pl-5` matches the header; `pr-1.5` is all that separates the
        // scrollbar from the panel edge, which is the point of moving the
        // padding off the panel.
        <>
          {/*
            The divider is its own element rather than a `border-t` on the
            scroller: the scroller now runs the full width of the panel, so its
            border would run into the rounded corners instead of lining up
            with the header. `mx-5` keeps it on the header's grid.
          */}
          <div className='mt-3 mx-5 border-t border-white/10' />
          <div className='pt-3 space-y-4 min-h-0 overflow-y-auto pl-5 pr-1.5 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.2)_transparent]'>
            {releases.map((release) => (
              <div key={release.version} className='space-y-3'>
                {showVersions && (
                  <p className='text-[11px] font-bold text-white/70 tracking-wide'>
                    {`v${release.version}`}
                  </p>
                )}
                {release.sections.map((section, i) => {
                  const { emoji, key, text } = parseHeading(section.heading);

                  return (
                    <div key={i}>
                      {section.heading && (
                        <p className='text-xs font-bold text-white/40 uppercase tracking-widest mb-1.5'>
                          {/*
                            Only the words are translated. The entries below
                            them are commit subjects — written in English at
                            commit time and baked into the file long before a
                            language is picked — so a translated heading over
                            English bullets is as far as this goes. An
                            unrecognised heading keeps what the tool wrote.
                          */}
                          {emoji && <span className='mr-1.5'>{emoji}</span>}
                          {key ? t(`whatsNew.sections.${key}`) : text}
                        </p>
                      )}
                      <ul className='space-y-1'>
                        {section.items.map((item, j) => (
                          <li key={j} className='flex items-start gap-2 text-sm text-white/70'>
                            {section.heading && (
                              <span className='mt-1.5 w-1 h-1 rounded-full bg-white/30 shrink-0' />
                            )}
                            <span>{stripMarkdown(item)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
