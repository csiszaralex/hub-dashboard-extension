import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Hoisted out of the JSX: `i18next/no-literal-string` flags string literals in
// attribute expressions too. This is the shape `nx release` writes, version
// headings, commit links and all.
const CHANGELOG = [
  '## 2.3.0 (2026-08-12)',
  '',
  '### 🚀 Features',
  '',
  "- **extension:** prefetch tomorrow's background in the service worker ([441074f](https://github.com/x/y/commit/441074f))",
  '- **extension:** show a four-day forecast ([fa98b6e](https://github.com/x/y/commit/fa98b6e))',
  '',
  '### 🩹 Fixes',
  '',
  '- **extension:** stop emitting unusable module preloads ([b0ef568](https://github.com/x/y/commit/b0ef568))',
  '',
  '## 2.2.0 (2026-04-06)',
  '',
  '### 🚀 Features',
  '',
  '- **extension:** add tabs in popup ([e7271f0](https://github.com/x/y/commit/e7271f0))',
].join('\n');

const VERSION = '2.3.0';
/** Older than every release in the fixture, so both of them are unseen. */
const OLDER = '2.1.0';
const noop = () => {};

describe('WhatsNewModal', () => {
  it('renders an entry without the scope that prefixes every line', async () => {
    const { WhatsNewModal } = await import('./WhatsNewModal');

    render(<WhatsNewModal version={VERSION} lastSeenVersion={null} onClose={noop} changelog={CHANGELOG} />);

    // The text a user reads, with no `extension:` in front of it and no commit
    // hash behind it.
    expect(screen.getByText("prefetch tomorrow's background in the service worker")).not.toBeNull();
    expect(screen.queryByText(/extension:/)).toBeNull();
    expect(screen.queryByText(/441074f/)).toBeNull();
  });

  it('catches a user up on every release they skipped, labelled by version', async () => {
    // The case this exists for. 2.2.0 is the last build the public has, and the
    // next one will be 2.3.1 — so an upgrade lands two releases at once, and
    // showing only the newest would bury everything in between forever.
    const { WhatsNewModal } = await import('./WhatsNewModal');

    render(
      <WhatsNewModal
        version={VERSION}
        lastSeenVersion={OLDER}
        onClose={noop}
        changelog={CHANGELOG}
      />,
    );

    expect(screen.getByText('add tabs in popup')).not.toBeNull();
    expect(screen.getByText('show a four-day forecast')).not.toBeNull();

    // Labelled, or two "Features" lists run together with nothing to separate
    // what arrived when. Scoped to the scrolling list because the panel header
    // names the current version too, and an unscoped query matches both.
    const list = screen.getAllByRole('listitem')[0].closest('div[class*="overflow-y-auto"]');
    expect(within(list as HTMLElement).getByText('v2.3.0')).not.toBeNull();
    expect(within(list as HTMLElement).getByText('v2.2.0')).not.toBeNull();
  });

  it('shows no version labels when there is only one release to report', async () => {
    // The header already names it; repeating it inside would be noise.
    const { WhatsNewModal } = await import('./WhatsNewModal');

    render(
      <WhatsNewModal
        version={VERSION}
        lastSeenVersion={null}
        onClose={noop}
        changelog={CHANGELOG}
      />,
    );

    expect(screen.queryByText('v2.2.0')).toBeNull();
    expect(screen.queryByText('add tabs in popup')).toBeNull();
  });

  it('keeps both change-type sections', async () => {
    const { WhatsNewModal } = await import('./WhatsNewModal');

    render(<WhatsNewModal version={VERSION} lastSeenVersion={null} onClose={noop} changelog={CHANGELOG} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('translates the section headings and keeps their emoji', async () => {
    // Importing i18n installs the react-i18next binding; without it `t()`
    // returns the key and this would pass on a string nobody wants to read.
    const i18n = (await import('../i18n/i18n')).default;
    await i18n.changeLanguage('hu');
    const { WhatsNewModal } = await import('./WhatsNewModal');

    render(<WhatsNewModal version={VERSION} lastSeenVersion={null} onClose={noop} changelog={CHANGELOG} />);

    expect(screen.getByText('Újdonságok')).not.toBeNull();
    expect(screen.getByText('Javítások')).not.toBeNull();
    // The emoji is not translated and must survive being separated from them.
    expect(screen.getByText('🚀')).not.toBeNull();
    // The entries stay in English: they are commit subjects, generated into the
    // changelog long before a language is chosen.
    expect(screen.getByText('show a four-day forecast')).not.toBeNull();

    await i18n.changeLanguage('en');
  });

  it('scrolls a long release inside the modal instead of past the viewport', async () => {
    // happy-dom has no layout engine, so this asserts the two classes the
    // behaviour rests on rather than a height it cannot measure. Both are easy
    // to drop in a restyle, and without them a 26-entry release — which 2.3.0
    // was — runs off the bottom of the screen with no way to reach the rest.
    const { WhatsNewModal } = await import('./WhatsNewModal');

    const { container } = render(
      <WhatsNewModal version={VERSION} lastSeenVersion={null} onClose={noop} changelog={CHANGELOG} />,
    );

    const modal = container.firstElementChild;
    expect(modal?.className).toContain('max-h-[calc(100vh-5rem)]');

    const list = screen.getAllByRole('listitem')[0].closest('div[class*="overflow-y-auto"]');
    expect(list).not.toBeNull();
    // Without `min-h-0` the flex child refuses to shrink below its content and
    // `overflow-y-auto` never engages — the modal grows instead of scrolling.
    expect(list?.className).toContain('min-h-0');
  });
});
