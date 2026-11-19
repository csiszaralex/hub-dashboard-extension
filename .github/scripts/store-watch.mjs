/**
 * Decides whether the Chrome Web Store has fallen behind the extension's
 * releases, for `.github/workflows/store-watch.yml`.
 *
 * deploy.yml uploads every `extension@*` tag as a draft that the owner submits
 * for review by hand, and versions once sat unsubmitted for months with nobody
 * noticing. The workflow fetches the store's status and the tags; everything
 * that decides what to say lives here, so it can be tested without either.
 *
 * Usage: node store-watch.mjs <status.json> <tags.txt> <message.md>
 * Writes the message to <message.md> and prints `action=report|resolve`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The owner deliberately uses a release for some days before submitting it, so
 * a draft younger than this is the normal state, not a lapse.
 */
export const THRESHOLD_DAYS = 21;

export const TAG_PREFIX = 'extension@';

export const ISSUE_TITLE = 'Chrome Web Store is behind the latest extension release';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A Chrome extension version: one to four dot-separated integers. */
export const parseVersion = (text) =>
  typeof text === 'string' && /^\d+(\.\d+){0,3}$/.test(text) ? text.split('.').map(Number) : null;

/** Missing trailing parts count as zero, as Chrome compares them. */
export const compareVersions = (a, b) => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`Not a version: ${left ? b : a}`);
  for (let i = 0; i < 4; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
};

const highest = (versions) =>
  versions.reduce((best, v) => (best === null || compareVersions(v, best) > 0 ? v : best), null);

/**
 * The live version from a v2 `fetchStatus` response: the highest `crxVersion`
 * across `publishedItemRevisionStatus.distributionChannels`, or null when that
 * field is unset, which the API documents as "the item is not published".
 * A partial rollout counts as live: the owner has acted on it.
 */
export const publishedVersion = (status) =>
  highest(
    (status?.publishedItemRevisionStatus?.distributionChannels ?? [])
      .map((channel) => channel?.crxVersion)
      .filter((v) => parseVersion(v)),
  );

/** The revision submitted for review, if any: `{ state, version }`. */
export const submittedRevision = (status) => {
  const revision = status?.submittedItemRevisionStatus;
  if (!revision) return null;
  return {
    state: revision.state ?? 'unknown',
    version: highest(
      (revision.distributionChannels ?? []).map((c) => c?.crxVersion).filter((v) => parseVersion(v)),
    ),
  };
};

/**
 * Lines of `<tag> <ISO date>`, as `git for-each-ref` prints them. Tags that are
 * not `extension@<version>` are skipped.
 */
export const parseTags = (text) =>
  text
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([name, date]) => name?.startsWith(TAG_PREFIX) && date)
    .map(([name, date]) => ({ version: name.slice(TAG_PREFIX.length), date: new Date(date) }))
    .filter(({ version, date }) => parseVersion(version) && !Number.isNaN(date.getTime()));

const isoDay = (date) => date.toISOString().slice(0, 10);

/**
 * `report` when a release has waited longer than the threshold, with the issue
 * body; `resolve` otherwise, with the comment to close an open issue with.
 *
 * The wait is measured from the oldest release the store does not have, not
 * the newest: with a release every week the newest tag is never three weeks
 * old, and the store could still lag for months.
 */
export const decide = ({ status, tags, now, thresholdDays = THRESHOLD_DAYS }) => {
  if (tags.length === 0) throw new Error(`No ${TAG_PREFIX}* tags found`);

  const live = publishedVersion(status);
  const unpublished = tags
    .filter((tag) => live === null || compareVersions(tag.version, live) > 0)
    .sort((a, b) => compareVersions(a.version, b.version));

  const liveText = live ?? 'none (the item is not published)';

  if (unpublished.length === 0) {
    return { action: 'resolve', message: `The store is live on ${liveText}, the latest release.` };
  }

  const oldest = unpublished.reduce((a, b) => (b.date < a.date ? b : a));
  const days = Math.floor((now.getTime() - oldest.date.getTime()) / DAY_MS);

  if (now.getTime() - oldest.date.getTime() <= thresholdDays * DAY_MS) {
    return {
      action: 'resolve',
      message: `The store is live on ${liveText}; no release has waited more than ${thresholdDays} days.`,
    };
  }

  const newest = unpublished[unpublished.length - 1];
  const submitted = submittedRevision(status);
  const lines = [
    `- **Live:** ${liveText}`,
    `- **Waiting:** ${newest.version} (the draft deploy.yml uploads is always the newest release)`,
    `- **Unpublished since:** ${isoDay(oldest.date)}, when ${oldest.version} was released (${days} days ago)`,
    `- **Releases not live:** ${unpublished.map((t) => t.version).join(', ')}`,
    `- **Submitted for review:** ${
      submitted ? `${submitted.version ?? 'unknown version'} (${submitted.state})` : 'nothing'
    }`,
    '',
    'Submit the draft in the Chrome Web Store developer dashboard. This issue is updated daily by',
    '`.github/workflows/store-watch.yml` and closed once the live version catches up.',
  ];
  return { action: 'report', message: lines.join('\n') };
};

const main = ([statusPath, tagsPath, messagePath]) => {
  const result = decide({
    status: JSON.parse(readFileSync(statusPath, 'utf8')),
    tags: parseTags(readFileSync(tagsPath, 'utf8')),
    now: new Date(),
  });
  writeFileSync(messagePath, `${result.message}\n`);
  console.log(`action=${result.action}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
