# Memos Widget Design

**Goal:** Surface the user's self-hosted [Memos](https://usememos.com) instance on the
new tab page — a compact list of the current tag's memos that expands into a full
panel, where a memo can be composed and an existing one marked done by archiving it.

**Status:** Design approved. Implementation plan not yet written.

## Why this is not an `apps/api` endpoint

A Memos instance is the user's own server, typically on a LAN or behind Tailscale,
which the Cloudflare Worker cannot reach. Even where it could, routing private notes
through a public, unauthenticated proxy — with the user's access token sitting in it
as a Worker secret — is the wrong trust boundary.

The extension calls the instance directly. This adds an entry to the **External APIs
consumed by the extension** list in `CLAUDE.md`, not a route to `apps/api`.

## Decisions

| Question | Decision |
|---|---|
| What "mark done" means | **Archive** (`state: ARCHIVED`) — one `PATCH`, reversible, leaves the content untouched |
| What the list shows on open | A single **base tag** configured in the popup (e.g. `#todo`); tag chips re-filter within the session, a new tab returns to the base. An empty base tag means unfiltered — the newest memos, whatever their tags |
| Placement | **Compact rows that expand** — three borderless lines plus a "+N more" affordance; clicking a row's text opens the full panel with chips and the composer |
| Tag on compose | The **active filter's tag** is appended, shown as a removable chip in the composer. Unfiltered view composes untagged |
| Infrastructure | **Cache-first page, no background retry queue.** Failed writes keep their text and persist as a single draft; the user re-sends |
| Supported server | **Memos v0.30.0 or newer, required.** Connect refuses an older instance and tells the user to upgrade |

The service worker is not touched.

## Permission model

`manifest.json` gains no new `host_permissions`. Instead:

```json
"optional_host_permissions": ["https://*/*"]
```

That is only the permitted set. At runtime the popup requests exactly one origin:

```ts
chrome.permissions.request({ origins: ['https://memo.example.com/*'] })
```

A user who never configures the widget grants nothing. HTTPS only — the new tab page
is a secure context, and a plain-HTTP instance would be subject to mixed-content
blocking; `normalizeBaseUrl` rejects `http://` rather than failing opaquely later.

### The user-gesture constraint

`chrome.permissions.request` requires a user gesture, and the gesture chain does not
survive an `await`. `PopupForm.handleSubmit` awaits (geocoding, custom-image checks)
before it does anything, so routing the request through the shared **Save** button
would make it fail silently.

The Memos tab therefore carries its own **Connect** button, which in a single click:

1. requests the origin permission,
2. reads `GET /api/v1/instance/profile` and checks `version` against the floor,
3. issues `GET /api/v1/memos?pageSize=1&state=NORMAL` with the entered token,
4. persists the setting **only if all three succeed.**

A wrong URL, a mistyped token or an unsupported server surfaces there, in the popup,
rather than as an empty card on the new tab page.

### Revocation

Chrome lets a user revoke an optional permission at any time. Every fetch path is
gated on `chrome.permissions.contains`; a missing permission renders the "reconnect"
state instead of producing a network error.

## Secret storage

- **Base URL** → `chrome.storage.sync`, as a `HubSettings` field (`memosUrl`).
- **Access token** → `chrome.storage.local`, under its own key, **outside the settings
  store.**

This is structural, not cautionary. `settingsBackup.RULES` is a
`{ [K in keyof HubSettings]: … }` mapped type, so a token living in `HubSettings`
would be *required* to have an export rule, and `buildBackup` serialises the whole
object to a file the user may share. Keeping the token out of `HubSettings` makes
exporting it **impossible at the type level** — nothing to remember.

Accepted consequence: on a second machine the URL syncs and the token does not, so
Connect must be pressed once per device. That is correct behaviour for a secret.

`memosUrl` still needs its `RULES` entry — validated as an HTTPS origin, not merely
as a string.

## Module layout

Pure logic in `utils/`, I/O separated, React last — the existing house pattern.

| Module | Responsibility |
|---|---|
| `utils/memos.ts` | URL normalisation, version comparison, response validation, compose-content tagging. No `fetch`, no `chrome` |
| `utils/memosClient.ts` | `list` / `create` / `archive` / `probe`. Returns `{ok:true,…} \| {ok:false, reason:'auth'\|'permission'\|'version'\|'network'\|'server'}` rather than throwing |
| `utils/memosStorage.ts` | All `chrome.storage.local` access: cached list, active tag, unsent draft, token |
| `hooks/useMemos.ts` | Cache-first render, background refresh, actions. **One instance**, owned by `MemosWidget` — see the `useQuote` docstring for why multiple consumers hurt |
| `components/MemosWidget.tsx` | Compact rows and the expand toggle. Each compact row carries its own archive control — ticking the top item off is the whole point of the widget and must not cost two clicks. Positioned by `App.tsx`, like the other widgets |
| `components/MemosPanel.tsx` | Full list, tag chips, composer |
| `popup/MemosSection.tsx` | URL, token, Connect, base tag |

Plus `'memos'` in `WIDGET_IDS`, an eighth `TabNav` tab (the four-column grid becomes
4+4), `App.tsx` mounting behind `showWidget('memos')`, and keys in both
`i18n/locales/en.json` and `hu.json` — `i18n/validate.ts` fails typecheck if their key
structures diverge.

## Target version: Memos v0.30

The adapter targets **one** API version rather than tolerating a range. Memos has
moved this surface repeatedly — `rowStatus` became `state`, the CEL filter syntax was
reworked, and in 0.30 `workspace_service` was renamed to `instance_service` outright.
A dual-shape parser would be guesswork against versions nobody here runs.

The floor is **0.30.0**. Below it, Connect refuses with an upgrade message; above it,
the widget proceeds — refusing a future release would break on the next upstream
version, and if the shape does change, the probe's list call fails with a clear error
anyway. Verified against the `v0.30.0` protos:

| Operation | Call |
|---|---|
| Version | `GET /api/v1/instance/profile` → `{ version, commit, … }` |
| List | `GET /api/v1/memos?pageSize=200&state=NORMAL` → `{ memos: […], nextPageToken }` |
| Create | `POST /api/v1/memos` with `{ content, visibility }` |
| Archive | `PATCH` on the memo's resource name with `updateMask=state` and `{ state: "ARCHIVED" }` |

REST field names are lowerCamelCase (grpc-gateway), and a memo's `name` is its
resource name, `memos/{uid}`.

Three things the server gives us that the earlier draft planned to compute:

- **`tags`** is a first-class field on `Memo` — no `#tag` parsing out of content.
- **`snippet`** is a first-class field — no client-side truncation for compact rows.
- **`state`** is a dedicated list parameter — archived memos are excluded by the
  request, not filtered out afterwards.

`utils/memos.ts` shrinks accordingly: it keeps URL normalisation, the version
comparison, response validation, and appending the active tag on compose.

## Data flow

On page load `useMemos` starts from cache, not the network:

1. **Read cache** from `storage.local`. Unlike `localStorage` this is async, so the
   cached rows land a tick later — no network, but not the first frame either. The
   compact view holds its final height from the start so the layout does not jump.
2. **Gate** on origin permission and token presence. If either is missing, render the
   "connect in settings" state and issue **no** fetch.
3. **Refresh** the newest N (200) memos. Success writes the cache and re-renders;
   failure leaves the cached rows on screen.

**Tag filtering is client-side.** Chips come from each memo's `tags` field and are
applied in memory, so switching chips costs zero requests — on a page that opens
constantly, that is the point. The server *can* filter (`filter=`), and there is an
open upstream report about tag filters that I have not verified; neither changes the
answer, because the zero-request argument stands on its own.

Archived memos never arrive in the first place: the list request carries
`state=NORMAL`.

Stated limitation: with a large archive, a `#todo` older than the newest 200 will not
appear. The fetch has one call site in `memosClient`, where a server-side filter
attempt with client-side fallback can be added if this ever bites.

## Actions

**Archive is optimistic.** The row disappears immediately and the `PATCH` follows; a
failure restores the row with an indication. Safe to do optimistically precisely
because archiving is reversible — the worst outcome is recoverable.

**Compose is not optimistic.** The composer stays disabled until the server confirms:
the id and timestamps come from the server, and a phantom row that vanishes or
duplicates half a second later is worse than a brief wait. On failure the text stays
in the field **and** persists to `storage.local` as a draft, so closing the tab does
not lose it. One draft, not a queue — re-sending is a deliberate click.

## Error handling

| `reason` | What the user sees | Retries? |
|---|---|---|
| `auth` (401/403) | "token invalid or expired", pointing at settings | No — retrying is pointless |
| `permission` (revoked) | "reconnect" state | No |
| `version` (below 0.30.0, or `instance/profile` 404s) | "upgrade the instance to 0.30.0 or newer" | No |
| `network` | Cached rows stay, faint "stale" marker | On the next new tab |
| `server` (5xx) | Same | Same |

`network` is the common case — every day spent away from the server. It must not
produce a red error: the hub would push it in the user's face on every new tab. It
shows the cache, quietly.

## Testing

`utils/memos.test.ts` carries the weight: URL normalisation (HTTP rejected, trailing
slash, junk input), version comparison at the boundaries (`0.29.9` refused, `0.30.0`
accepted, `0.31.0` accepted, and a malformed version string refused rather than
coerced), response validation against a malformed payload, and `composeContent` not
duplicating a tag the user already typed.

`utils/memosClient.test.ts` covers all five failure reasons and the success path with
a stubbed `fetch` — including a `404` on `/api/v1/instance/profile`, which is how a
pre-0.30 server presents itself and must map to the upgrade message rather than to a
generic network error.

The new `chrome.permissions` stub in `src/test/chromeStub.ts` must model what the real
API **enforces**, not just its happy path: `request()` can be denied and returns
`false`. A stub that always resolves `true` never executes the denial branch — the
exact class of gap that has shipped two real-browser bugs past a green suite here.

Rendering and Chrome integration are verified by hand, by loading
`apps/extension/dist/`.

## Documents to update in the same commit as `manifest.json`

- `privacy-policy.md` — a user-supplied server; the memo content and the token go only
  there; the token is stored locally and transmitted nowhere else. Bump the effective
  date.
- `apps/extension/store-listing.md` — justification for the optional host permission, and
  the stated requirement of a Memos 0.30.0+ instance.
- `CLAUDE.md` — the External APIs list, including *why* this does not go through the
  Worker.

## Out of scope

No editing, no deletion, no pagination, no attachment handling, and no service worker
changes. Deletion is deliberately absent: archiving is reversible and covers "done";
anything permanent belongs in Memos' own UI. The hub is a surface for the newest few
items, not a Memos client.
