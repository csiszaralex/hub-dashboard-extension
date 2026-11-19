import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import { warmUp } from '../test/warmUp';

warmUp(() => Promise.all([import('../i18n/i18n'), import('./Clock')]));

/** 15:05 local time, so the hour differs between a 12- and a 24-hour clock. */
const AFTERNOON = new Date(2026, 2, 4, 15, 5);

/** Renders the clock with `language` saved, the way a page load would read it. */
const renderIn = async (language: string) => {
  // Only `Date`: i18n's init and the storage stub resolve on real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AFTERNOON);
  installChromeStub().seedSync({ language });
  const i18n = (await import('../i18n/i18n')).default;
  const { Clock } = await import('./Clock');
  await vi.waitFor(() => expect(i18n.language).toBe(language));
  render(<Clock />);
};

afterEach(() => {
  vi.useRealTimers();
});

describe('Clock', () => {
  it('reads 3:05 PM in English', async () => {
    await renderIn('en');

    expect(screen.getByText('3')).not.toBeNull();
    expect(screen.getByText('05')).not.toBeNull();
    expect(screen.getByText('PM')).not.toBeNull();
    expect(screen.getByText('March 4, Wednesday')).not.toBeNull();
  });

  it('reads 15:05 in Hungarian, with no day period', async () => {
    await renderIn('hu');

    expect(screen.getByText('15')).not.toBeNull();
    expect(screen.getByText('05')).not.toBeNull();
    expect(screen.queryByText(/^(AM|PM|de\.|du\.)$/)).toBeNull();
    expect(screen.getByText('március 4., szerda')).not.toBeNull();
  });
});
