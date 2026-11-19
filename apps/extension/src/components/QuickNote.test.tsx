import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const load = async () => {
  // Installs the react-i18next binding, or every name below is a raw key.
  await import('../i18n/i18n');
  return (await import('./QuickNote')).QuickNote;
};

describe('QuickNote — accessibility', () => {
  it('names its icon-only toggle and says whether the note is open', async () => {
    const QuickNote = await load();

    render(<QuickNote />);

    const open = screen.getByRole('button', { name: 'Open notes' });
    expect(open.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(open);

    const close = screen.getByRole('button', { name: 'Close notes' });
    expect(close.getAttribute('aria-expanded')).toBe('true');
  });

  // The closed panel is only faded out, so without `inert` its textarea and
  // delete button stayed in the Tab order of a panel nobody could see.
  it('keeps the closed panel out of reach and names the textarea', async () => {
    const QuickNote = await load();

    render(<QuickNote />);

    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    expect(textarea.closest('[inert]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open notes' }));

    expect(textarea.closest('[inert]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeNull();
  });
});
