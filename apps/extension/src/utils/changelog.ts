export interface ChangelogSection {
  heading: string;
  items: string[];
}

/**
 * Turns the changelog slice injected at build time into headings and bullets.
 *
 * Bullets that appear before any heading (the shape `nx release` produces for a
 * release with a single change type) go into one unnamed leading section.
 */
export const parseSections = (text: string): ChangelogSection[] => {
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^#{2,4}\s+/.test(trimmed)) {
      current = { heading: trimmed.replace(/^#+\s+/, ''), items: [] };
      sections.push(current);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!current) {
        current = { heading: '', items: [] };
        sections.push(current);
      }
      current.items.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }

    if (sections.length === 0) {
      current = { heading: '', items: [trimmed] };
      sections.push(current);
    }
  }

  return sections;
};

export interface ChangelogRelease {
  version: string;
  sections: ChangelogSection[];
}

/** A version heading — `## 2.3.0 (2026-08-12)`, or `# 2.0.0` for the major. */
const VERSION_HEADING = /^#{1,2}\s+\[?(\d+\.\d+\.\d+)/;

/**
 * Splits the whole changelog into one entry per released version.
 *
 * Version headings are level one or two and start with a number; section
 * headings are level three. `nx release` writes `# 2.0.0` for a major and
 * `## x.y.z` for everything else, so both levels have to count as a version or
 * the major's sections would be attributed to the release above it.
 */
export const parseReleases = (text: string): ChangelogRelease[] => {
  const releases: ChangelogRelease[] = [];
  let current: { version: string; lines: string[] } | null = null;

  const flush = () => {
    if (current)
      releases.push({
        version: current.version,
        sections: parseSections(current.lines.join('\n')),
      });
  };

  for (const line of text.split('\n')) {
    const match = VERSION_HEADING.exec(line.trim());
    if (match) {
      flush();
      current = { version: match[1], lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  flush();

  return releases;
};

/** Numeric, so 2.10.0 sorts above 2.9.0 the way a string compare would not. */
const compareVersions = (a: string, b: string): number => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/**
 * Every release between the one the user last saw and the one now running.
 *
 * The modal used to be handed a single version's notes, baked in at build time,
 * which quietly assumed users upgrade one release at a time. They do not: the
 * Chrome Web Store ships whatever is current, so someone on 2.2.0 who updates
 * to 2.3.1 would have been shown 2.3.1's handful of fixes and never told about
 * the twenty-six changes in 2.3.0.
 *
 * A first install has nothing to catch up on, so it gets the current release
 * only rather than the entire history of the extension.
 */
export const releasesSince = (
  text: string,
  lastSeen: string | null,
  current: string,
): ChangelogRelease[] => {
  const releases = parseReleases(text);
  const running = releases.filter(
    (release) => compareVersions(release.version, current) <= 0,
  );

  const unseen = lastSeen
    ? running.filter(
        (release) => compareVersions(release.version, lastSeen) > 0,
      )
    : running.filter((release) => release.version === current);

  // A downgrade leaves nothing strictly newer than what was last seen. Showing
  // the running version again beats opening an empty panel.
  if (unseen.length > 0) return unseen;
  return running.filter((release) => release.version === current);
};

/**
 * Entry count past which a release is long enough to hide the clock and quote
 * behind it.
 *
 * A count and not a measurement, deliberately: it cannot drift with viewport
 * height, font size or zoom, so the modal behaves identically everywhere and a
 * test can pin it. It is still only a proxy for how tall the modal ends up —
 * a narrow window wraps entries onto two lines — but being wrong here costs a
 * clock hidden slightly early or slightly late, not an unreachable list.
 */
export const LONG_RELEASE_ENTRIES = 7;

/**
 * Total bullets across the releases being shown, which is what the threshold
 * counts.
 *
 * Takes the releases rather than the raw changelog on purpose: the build now
 * injects the last ten of them, so counting the whole string would clear the
 * threshold every time and blank the dashboard for even a one-line patch.
 */
export const countEntries = (releases: ChangelogRelease[]): number =>
  releases.reduce(
    (total, release) =>
      total + release.sections.reduce((sum, section) => sum + section.items.length, 0),
    0,
  );

/**
 * A literal union rather than `string`, and load-bearing: `react-i18next` types
 * `t()` against the keys generated from `en.json`, so `whatsNew.sections.${key}`
 * only compiles while every member here has a translation. Adding a section
 * without one is a build error, not a key rendered raw on screen.
 */
export type SectionKey =
  | 'features'
  | 'fixes'
  | 'performance'
  | 'breakingChanges'
  | 'updatedDependencies';

/**
 * The changelog tool's section headings, mapped onto those keys.
 *
 * Only the headings are translatable. The entries under them are commit
 * subjects, written in English at commit time and generated into the file long
 * before any locale is chosen, so there is nothing to translate them from.
 * Headings are a closed set of half a dozen words that repeat every release,
 * which makes them worth doing and the entries not.
 *
 * Keyed on the lowercased words with the emoji removed, because the same
 * section has arrived under more than one spelling: `nx release` writes
 * `🩹 Fixes` today and the older entries in this changelog say `Bug Fixes`.
 */
const SECTION_KEYS: Record<string, SectionKey> = {
  features: 'features',
  fixes: 'fixes',
  'bug fixes': 'fixes',
  performance: 'performance',
  'breaking changes': 'breakingChanges',
  'updated dependencies': 'updatedDependencies',
};

export interface ParsedHeading {
  /** The leading emoji, kept as-is — it needs no translation and survives one. */
  emoji: string;
  /** Translation key under `whatsNew.sections`, or null when unrecognised. */
  key: SectionKey | null;
  /** The original words, which is what an unrecognised heading falls back to. */
  text: string;
}

/**
 * Splits a section heading into its emoji and its words, and looks the words up.
 *
 * A null `key` is not a failure: the changelog tool can emit sections this map
 * has never seen, and rendering the English heading it wrote beats rendering a
 * missing translation key or nothing at all.
 */
export const parseHeading = (heading: string): ParsedHeading => {
  // Everything before the first letter or digit is the emoji, which keeps
  // variation selectors and zero-width joiners attached to it rather than
  // stranding them at the front of the text.
  const [, symbols = '', words = ''] =
    /^([^\p{L}\p{N}]*)(.*)$/u.exec(heading.trim()) ?? [];
  const text = words.trim();

  return {
    emoji: symbols.trim(),
    key: SECTION_KEYS[text.toLowerCase()] ?? null,
    text,
  };
};

/**
 * Strips what the modal cannot render or does not want: the trailing
 * `([abc1234](…))` commit reference, link syntax, the bold markers `nx release`
 * wraps the commit scope in, and then the scope itself.
 *
 * The scope goes because this changelog is generated from one project's own
 * commits, so it is the same word on every single line — `extension:` printed
 * twenty-six times down a modal, indenting the part that actually differs. It
 * says nothing to a user who is already looking at the extension.
 *
 * Only a leading lowercase token immediately followed by a colon is treated as
 * a scope. A conventional-commit subject is a lowercase imperative phrase with
 * no colon of its own, so that pattern does not occur naturally; requiring the
 * colon to touch the first word keeps `handle two cases: empty and missing`
 * intact, and requiring lowercase keeps prose like `Note: …` intact.
 */
export const stripMarkdown = (text: string): string =>
  text
    .replace(/\s*\(\[?[a-f0-9]{7,}\]?(?:\([^)]+\))?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/^[a-z][a-z0-9-]*:\s+/, '')
    .trim();
