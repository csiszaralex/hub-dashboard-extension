import { useEffect, useRef } from 'react';

/**
 * Mirrors `title` onto `document.title` while it is non-null, restoring
 * whatever the tab's title was before this hook first touched it — either
 * when `title` goes back to `null`, or on unmount, whichever comes first.
 *
 * The `owns` ref is what keeps a restore from firing twice. Without it, a
 * hook that restored via `null` and then unmounted would restore a second
 * time on cleanup — stomping on any title something else set in between
 * (another tab's render, a different part of the page). `owns` tracks
 * whether this hook is the one currently holding `document.title`, so the
 * second restore becomes a no-op instead of clobbering that unrelated
 * change. `original` is captured lazily, the first time `title` becomes
 * non-null, rather than unconditionally at mount — a hook that is always
 * passed `null` never reads or writes `document.title` at all.
 */
export const useDocumentTitle = (title: string | null): void => {
  const original = useRef<string | null>(null);
  const owns = useRef(false);

  useEffect(() => {
    if (title === null) {
      if (owns.current) {
        document.title = original.current ?? document.title;
        owns.current = false;
      }
      return;
    }

    if (!owns.current) {
      original.current = document.title;
      owns.current = true;
    }
    document.title = title;
  }, [title]);

  // Separate, mount-only effect: its cleanup must run exactly once, on
  // unmount, regardless of how many times the effect above has run.
  useEffect(
    () => () => {
      if (owns.current) {
        document.title = original.current ?? document.title;
        owns.current = false;
      }
    },
    [],
  );
};
