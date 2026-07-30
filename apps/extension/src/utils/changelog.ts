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
 * Strips the markdown the modal cannot render: the trailing
 * `([abc1234](…))` commit reference, link syntax, and the bold markers
 * `nx release` wraps the commit scope in (`**extension:** …`).
 */
export const stripMarkdown = (text: string): string =>
  text
    .replace(/\s*\(\[?[a-f0-9]{7,}\]?(?:\([^)]+\))?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '')
    .trim();
