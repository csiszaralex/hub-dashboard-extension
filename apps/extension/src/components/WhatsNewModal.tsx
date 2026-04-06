import { Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const GithubIcon = () => (
  <svg viewBox='0 0 24 24' fill='currentColor' className='w-4 h-4'>
    <path d='M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z' />
  </svg>
);

interface Props {
  version: string;
  onClose: () => void;
}

interface ChangelogSection {
  heading: string;
  items: string[];
}

const parseSections = (text: string): ChangelogSection[] => {
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^#{2,4}\s+/.test(trimmed)) {
      current = { heading: trimmed.replace(/^#+\s+/, ''), items: [] };
      sections.push(current);
    } else if (/^[-*]\s+/.test(trimmed)) {
      const item = trimmed.replace(/^[-*]\s+/, '');
      if (current) {
        current.items.push(item);
      } else {
        if (sections.length === 0 || sections[sections.length - 1].heading !== '') {
          current = { heading: '', items: [] };
          sections.push(current);
        }
        sections[sections.length - 1].items.push(item);
      }
    } else if (trimmed && sections.length === 0) {
      sections.push({ heading: '', items: [trimmed] });
    }
  }

  return sections;
};

const stripMarkdown = (text: string): string =>
  text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s*\(\[?[a-f0-9]{7,}\]?(?:\([^)]+\))?\)/g, '')
    .trim();

export const WhatsNewModal = ({ version, onClose }: Props) => {
  const { t } = useTranslation();
  const sections = parseSections(__CHANGELOG__);
  const hasSections = sections.length > 0;

  return (
    <div className='flex flex-col bg-black/20 backdrop-blur-md px-8 py-5 rounded-3xl border border-white/10 shadow-2xl max-w-sm w-full'>
      {/* Header */}
      <div className='flex items-center justify-between gap-6'>
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
        <div className='mt-3 pt-3 border-t border-white/10 space-y-3'>
          {sections.map((section, i) => (
            <div key={i}>
              {section.heading && (
                <p className='text-xs font-bold text-white/40 uppercase tracking-widest mb-1.5'>
                  {section.heading}
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
          ))}
        </div>
      )}
    </div>
  );
};
