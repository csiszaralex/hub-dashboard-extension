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

## Single purpose

Hub replaces the new tab page with a dashboard: clock, weather, Google Calendar
events, a daily quote, a countdown, a focus timer and a quick note, over a daily
background image.

## Permission justifications

Each is written to fit the dashboard's ~100 character field.

| Permission      | Justification                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `alarms`        | Schedules the daily background prefetch and the focus timer's phase changes, both on device only.        |
| `notifications` | Shows one local notification when a focus or break interval ends. No session data leaves the device.     |
| `storage`       | Saves your settings, notes and cached weather, quote and background data on the device.                  |
| `geolocation`   | Resolves your approximate location for the weather widget, only when no city is set in the settings.     |
| `identity`      | Signs you in to Google with read-only calendar scope so your upcoming events can be shown.               |

Host permissions are justified by the same features: Open-Meteo and BigDataCloud
for weather and place names, GeoJS as the IP-based location fallback,
`images.unsplash.com` for background image bytes, the Hub API for background
metadata and daily quotes, and `www.googleapis.com` for Google Calendar.

## Remote code

None. Everything executed is bundled in the package; the extension fetches data
(JSON and images) but never code.

## Notes for the 2.3.0 submission

`alarms` and `notifications` are **new in 2.3.0**. Chrome prompts existing users
to accept them on update, and an unexplained permission prompt is a common reason
people disable an extension — so the release notes should say what they are for
before the prompt does.
