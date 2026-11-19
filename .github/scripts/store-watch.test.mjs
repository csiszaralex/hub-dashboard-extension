import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareVersions,
  decide,
  parseTags,
  publishedVersion,
  THRESHOLD_DAYS,
} from './store-watch.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-19T12:00:00Z');
const daysAgo = (days) => new Date(now.getTime() - days * DAY_MS);
const tag = (version, age) => ({ version, date: daysAgo(age) });

/** A `fetchStatus` body with the given live versions, one channel each. */
const status = (...versions) => ({
  publishedItemRevisionStatus: {
    state: 'PUBLISHED',
    distributionChannels: versions.map((crxVersion) => ({ crxVersion, deployPercentage: 100 })),
  },
});

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
    assert.equal(compareVersions('2.9.9', '2.10.0'), -1);
  });

  it('treats missing parts as zero', () => {
    assert.equal(compareVersions('2.1', '2.1.0'), 0);
  });

  it('rejects what is not a version', () => {
    assert.throws(() => compareVersions('2.1.0-beta', '2.1.0'));
  });
});

describe('publishedVersion', () => {
  it('takes the highest version across channels, so a partial rollout counts', () => {
    assert.equal(publishedVersion(status('2.11.0', '2.12.0')), '2.12.0');
  });

  it('is null when the item has no published revision', () => {
    assert.equal(publishedVersion({ itemId: 'x' }), null);
  });
});

describe('parseTags', () => {
  it('reads for-each-ref lines and skips other tags', () => {
    const tags = parseTags(
      'extension@2.12.2 2026-11-19T21:24:09Z\napi@1.4.3 2026-11-19T21:24:09Z\n\nextension@bad 2026-11-01T00:00:00Z\n',
    );
    assert.deepEqual(tags, [{ version: '2.12.2', date: new Date('2026-11-19T21:24:09Z') }]);
  });
});

describe('decide', () => {
  it('resolves when the live version is the newest release', () => {
    const result = decide({ status: status('2.12.0'), tags: [tag('2.11.0', 60), tag('2.12.0', 40)], now });
    assert.equal(result.action, 'resolve');
  });

  it('resolves while the waiting release is younger than the threshold', () => {
    const result = decide({ status: status('2.11.0'), tags: [tag('2.11.0', 60), tag('2.12.0', 20)], now });
    assert.equal(result.action, 'resolve');
  });

  it('resolves at exactly the threshold, since the rule is "older than"', () => {
    const result = decide({
      status: status('2.11.0'),
      tags: [tag('2.12.0', THRESHOLD_DAYS)],
      now,
    });
    assert.equal(result.action, 'resolve');
  });

  it('reports a release that has waited past the threshold', () => {
    const result = decide({ status: status('2.11.0'), tags: [tag('2.11.0', 60), tag('2.12.0', 22)], now });
    assert.equal(result.action, 'report');
    assert.match(result.message, /\*\*Live:\*\* 2\.11\.0/);
    assert.match(result.message, /\*\*Waiting:\*\* 2\.12\.0/);
    assert.match(result.message, /Unpublished since:\*\* 2026-10-28, when 2\.12\.0 was released \(22 days ago\)/);
  });

  it('measures from the oldest unpublished release, so frequent releases cannot hide a lag', () => {
    const result = decide({
      status: status('2.10.0'),
      tags: [tag('2.10.0', 90), tag('2.11.0', 60), tag('2.12.0', 3)],
      now,
    });
    assert.equal(result.action, 'report');
    assert.match(result.message, /Waiting:\*\* 2\.12\.0/);
    assert.match(result.message, /when 2\.11\.0 was released \(60 days ago\)/);
    assert.match(result.message, /Releases not live:\*\* 2\.11\.0, 2\.12\.0/);
  });

  it('resolves once a partial catch-up leaves only a young release waiting', () => {
    const result = decide({
      status: status('2.11.0'),
      tags: [tag('2.10.0', 90), tag('2.11.0', 60), tag('2.12.0', 3)],
      now,
    });
    assert.equal(result.action, 'resolve');
  });

  it('reports every release when nothing is published', () => {
    const result = decide({ status: {}, tags: [tag('1.0.0', 30)], now });
    assert.equal(result.action, 'report');
    assert.match(result.message, /Live:\*\* none/);
  });

  it('names a revision already submitted for review', () => {
    const result = decide({
      status: {
        ...status('2.11.0'),
        submittedItemRevisionStatus: {
          state: 'PENDING_REVIEW',
          distributionChannels: [{ crxVersion: '2.12.0', deployPercentage: 100 }],
        },
      },
      tags: [tag('2.12.0', 30)],
      now,
    });
    assert.match(result.message, /Submitted for review:\*\* 2\.12\.0 \(PENDING_REVIEW\)/);
  });

  it('fails instead of resolving when there are no tags to compare with', () => {
    assert.throws(() => decide({ status: status('2.11.0'), tags: [], now }));
  });
});
