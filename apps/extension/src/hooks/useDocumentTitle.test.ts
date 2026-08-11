import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

const load = async () => (await import('./useDocumentTitle')).useDocumentTitle;

beforeEach(() => {
  document.title = 'Original Title';
});

describe('useDocumentTitle', () => {
  it('sets document.title to the given value', async () => {
    const useDocumentTitle = await load();
    renderHook(({ title }) => useDocumentTitle(title), { initialProps: { title: 'Hub — Focus 24:59' } });

    expect(document.title).toBe('Hub — Focus 24:59');
  });

  it('restores the original title on unmount', async () => {
    const useDocumentTitle = await load();
    const { unmount } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: 'Hub — Focus 24:59' },
    });
    expect(document.title).toBe('Hub — Focus 24:59');

    unmount();

    expect(document.title).toBe('Original Title');
  });

  it('restores the original title when passed null', async () => {
    const useDocumentTitle = await load();
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: 'Hub — Focus 24:59' as string | null },
    });
    expect(document.title).toBe('Hub — Focus 24:59');

    rerender({ title: null });

    expect(document.title).toBe('Original Title');
  });

  it('keeps updating the title while it stays non-null, without re-capturing the original', async () => {
    const useDocumentTitle = await load();
    const { rerender, unmount } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: 'Hub — Focus 24:59' },
    });

    rerender({ title: 'Hub — Focus 24:58' });
    expect(document.title).toBe('Hub — Focus 24:58');

    unmount();
    expect(document.title).toBe('Original Title');
  });

  it('does not clobber a title set by something else after it already restored via null', async () => {
    const useDocumentTitle = await load();
    const { rerender, unmount } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: 'Hub — Focus 24:59' as string | null },
    });

    rerender({ title: null });
    expect(document.title).toBe('Original Title');

    // Something unrelated changes the tab title after this hook restored it —
    // a different widget, a browser action, whatever.
    document.title = 'Something Else';

    unmount();

    expect(document.title).toBe('Something Else');
  });

  it('never touches document.title when always passed null', async () => {
    const useDocumentTitle = await load();
    const { unmount } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: null as string | null },
    });
    expect(document.title).toBe('Original Title');

    unmount();

    expect(document.title).toBe('Original Title');
  });
});
