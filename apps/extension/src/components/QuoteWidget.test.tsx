import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QuoteData } from '@hub/shared';

const CITATUM: QuoteData = {
  text: 'Üres fejjel lehet megélni, üres gyomorral nem.',
  author: 'Móra Ferenc',
  sourceUrl: 'https://www.citatum.hu/idezet/5073',
};

const noop = () => {};

const load = async () => {
  await import('../i18n/i18n');
  return (await import('./QuoteWidget')).QuoteWidget;
};

describe('QuoteWidget', () => {
  it('offers a way to ask for a different quote', async () => {
    const QuoteWidget = await load();
    const onRefresh = vi.fn();

    render(<QuoteWidget quote={CITATUM} loading={false} onRefresh={onRefresh} />);
    screen.getByRole('button', { name: 'New quote' }).click();

    expect(onRefresh).toHaveBeenCalled();
  });

  it('disables the refresh while one is in flight', async () => {
    // Clicking through a slow request would skip entries of the pool without
    // showing them, which reads as the button doing nothing.
    const QuoteWidget = await load();

    render(<QuoteWidget quote={CITATUM} loading={true} onRefresh={noop} />);

    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('no longer prints the source under the quote', async () => {
    // It moved to the credits cluster in the corner, next to the photo credit.
    // Two attributions in two unrelated places was the complaint; `App.test`
    // covers the link itself now.
    const QuoteWidget = await load();

    render(<QuoteWidget quote={CITATUM} loading={false} onRefresh={noop} />);

    expect(screen.queryByText('Source')).toBeNull();
    expect(screen.getByText(/Móra Ferenc/)).not.toBeNull();
  });
});
