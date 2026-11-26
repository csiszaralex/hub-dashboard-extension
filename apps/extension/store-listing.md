# Chrome Web Store listing

The copy submitted to the Chrome Web Store, kept here so the listing and the
manifest cannot drift apart. When `manifest.json` gains a permission or a host,
this file and [`privacy-policy.md`](privacy-policy.md) are what the review reads
— update all three together or the submission is rejected.

## Assets

| Asset      | File                                          | Requirement            |
| ---------- | --------------------------------------------- | ---------------------- |
| Screenshot | [`../../assets/preview.png`](../../assets/preview.png) | 1280x800, PNG |
| Icon       | [`icons/icon128.png`](icons/icon128.png)      | 128x128, PNG           |

The screenshot lives at the repository root rather than in the extension's
`public/` directory. It used to sit in `public/`, which meant Chrome packaged
1.1 MB of store artwork into every install and every update — over half the
download, for an image that never renders in the product. From the root it is
still served by GitHub Pages for the project page, and still the file to upload
to the dashboard, without riding along in the package.

## Listing copy

English, for the store's default listing. The **summary** is not repeated here:
it is `description` in [`manifest.json`](manifest.json), which the store shows
under the name and Chrome shows in `chrome://extensions`, capped at 132
characters. The **detailed description** below is pasted into the dashboard as
plain text (the store renders no Markdown, so bullets are `•`).

The contact address everywhere (store, privacy policy, feedback) is
`hub@csalex.dev`.

```text
Hub turns every new tab into a quiet dashboard over a fresh photograph: the time, the weather, your next meetings, a quote for the day, and the few tools you reach for between tasks.

No account. No tracking. Your notes and settings stay in your browser, and the one widget that syncs notes talks only to a Memos server you run yourself.

WHAT IT SHOWS
• Clock and date, in 12- or 24-hour time as your language prefers
• Weather now and for the next four days, for your city or your location
• Upcoming events from the Google Calendars you pick (read-only access)
• A daily quote: Stoic, Hungarian (Citatum), a built-in list, or your own
• A countdown to a date you set
• A focus timer: one focus and one break per start, with a single notification however many tabs are open
• A quick note that stays on this device
• Memos: your notes from your own self-hosted Memos server (v0.30 or newer)
• A new background photo from Unsplash every day, picked by the topics you choose, or your own image

MADE TO STAY OUT OF THE WAY
• Hide any widget, dim the photo, or press "." or double-click to see only the photograph
• Settings save as you change them; export them to a file and import them on another machine
• Works in English and Hungarian
• Tomorrow's photo is fetched in the background, so a new tab does not wait for it

PRIVACY
Hub has no account and no analytics. Calendar events are read with Google's read-only scope and never leave your browser. The Hub API receives only the photo topics and quote settings you chose, nothing that identifies you, and per-request logging is switched off. The full policy: https://csalex.in/hub-dashboard-extension/apps/extension/privacy-policy.html

Open source: https://github.com/csiszaralex/hub-dashboard-extension
Questions or ideas: hub@csalex.dev
```

### Screenshots

1280×800 PNG, five of them, taken from a profile with **invented calendar
entries and notes only**: the screenshots are public and stay up for years.

1. The whole page at 1920 wide, daytime photo, every widget on: the first look.
2. The calendar and weather side by side, with a few made-up meetings.
3. The focus timer running, and the notification it raises.
4. The Memos panel open with three or four sample notes.
5. The settings page on the Appearance tab, showing the topics and the dim slider.

## Single purpose

Hub replaces the new tab page with a dashboard: clock, weather, Google Calendar
events, a daily quote, a countdown, a focus timer, a quick note and a Memos
widget (requires a self-hosted Memos 0.30.0 or newer instance), over a daily
background image.

## Permission justifications

Each is written to fit the dashboard's ~100 character field.

| Permission      | Justification                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `alarms`        | Schedules the daily background prefetch and the focus timer's phase changes, both on device only.        |
| `notifications` | Shows one local notification when a focus or break interval ends. No session data leaves the device.     |
| `storage`       | Saves your settings, notes, cached widget data and, if you connect Memos, its token and your memos.      |
| `geolocation`   | Resolves your location for the weather widget, only when no city is set in the settings.                 |
| `identity`      | Signs you in to Google with read-only calendar scope so your upcoming events can be shown.               |

Host permissions are justified by the same features: Open-Meteo and BigDataCloud
for weather and place names, GeoJS as the IP-based location fallback,
`images.unsplash.com` for background image bytes, the Hub API for background
metadata and daily quotes, and `www.googleapis.com` for Google Calendar.

`optional_host_permissions` (`https://*/*`) is requested at runtime, for the
single origin the user enters in the extension's settings, so the Memos widget
can read and write notes on that user's own self-hosted Memos server. Not
requested unless the user configures the widget.

## Remote code

None. Everything executed is bundled in the package; the extension fetches data
(JSON and images) but never code.
