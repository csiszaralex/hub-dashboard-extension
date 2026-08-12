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

/** Total bullets across every section, which is what the threshold counts. */
export const countEntries = (text: string): number =>
  parseSections(text).reduce((total, section) => total + section.items.length, 0);

/**
 * The changelog tool's section headings, mapped onto translation keys.
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
/**
 * A literal union rather than `string`, and load-bearing: `react-i18next` types
 * `t()` against the keys generated from `en.json`, so `whatsNew.sections.${key}`
 * only compiles while every member here has a translation. Adding a section to
 * the map without adding it to the locale files is a build error, not a key
 * rendered raw on screen.
 */
export type SectionKey =
  | 'features'
  | 'fixes'
  | 'performance'
  | 'breakingChanges'
  | 'updatedDependencies';

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
  const [, symbols = '', words = ''] = /^([^\p{L}\p{N}]*)(.*)$/u.exec(heading.trim()) ?? [];
  const text = words.trim();

  return { emoji: symbols.trim(), key: SECTION_KEYS[text.toLowerCase()] ?? null, text };
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
