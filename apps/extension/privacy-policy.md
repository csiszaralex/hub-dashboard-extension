# Privacy Policy for Hub Extension

**Effective Date:** July 29, 2026

This Privacy Policy describes how the Hub Chrome Extension ("Hub", "we", "us", or "our") handles your data. Hub is designed to be a privacy-first, local dashboard. We do not collect, store, or process your personal data.

Hub operates one backend service of its own: the Hub API, a Cloudflare Worker that supplies background images. It is described under "Hub API" below. No personal data, calendar data, location, or note content is ever sent to it.

## Data We Access and How We Use It

Hub requests specific browser permissions to provide its core functionality. All data accessed through these permissions remains on your local device.

### 1. Google Calendar Data (`identity` permission)

Hub uses Chrome's native `identity` API to authenticate with your Google account and requests read-only access to your Google Calendar (`https://www.googleapis.com/auth/calendar.readonly`). This scope is read-only and covers both your calendar list (needed so you can choose which calendars to display, and to show their colours) and the events on them.

- **Usage:** We fetch your upcoming events strictly to display them on your local dashboard.
- **Storage & Sharing:** Calendar data is processed temporarily in your browser's memory. We do not store, log, transmit, or share your calendar events with any third parties. Hub's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

### 2. Location and Weather (`geolocation` permission)

To display local weather conditions, Hub needs an approximate location. It is resolved in this order, stopping at the first that succeeds:

1. The city you entered in the settings, if any.
2. Your device location via the browser's geolocation API.
3. An approximate location derived from your IP address by GeoJS (`get.geojs.io`).
4. A default location (Budapest).

- **Usage:** The resulting coordinates are sent to Open-Meteo (weather) and, unless you set a city manually, to BigDataCloud (to turn the coordinates into a place name). If step 3 is reached, your IP address is exposed to GeoJS as part of that request.
- **Storage:** The most recent coordinates and weather result are cached on your device for 30 minutes to avoid repeat requests. We do not track your location history and no location data leaves your device except in the API requests described above.

### 3. Local Storage (`storage` permission)

Hub uses your browser's storage to save:

- Your preferences — background search tags, weather location, selected calendars, countdown target and language — via `chrome.storage.sync`, which Chrome synchronises across devices where you are signed in.
- Your quick notes, in `localStorage` on the device only.
- Cached content in `localStorage` (the daily quote, weather, and background image metadata) and the background image itself in the browser's Cache storage, to avoid re-downloading it.

Hub does not store any API keys on your device. This data is stored solely on your device (plus Chrome Sync, for preferences) and can be cleared at any time by uninstalling the extension or clearing your browser data.

## Hub API

Background images are requested from the Hub API, a Cloudflare Worker we operate at `hub-api.csiszaralex.workers.dev`. It exists so that the Unsplash API key stays on the server instead of being shipped inside the extension.

- **What is sent:** only the background search tags you configured (for example `landscape,forest`). No account identifier, location, calendar data, or note content is included. As with any web request, your IP address and standard browser headers are visible to Cloudflare.
- **What is stored:** the Worker caches pools of Unsplash image metadata, keyed by search tags. Nothing user-identifying is written to that cache, and we keep no request logs beyond Cloudflare's standard, short-lived operational logging.

## Third-Party Services

Hub interacts with the following third-party APIs to fetch content. When Hub makes requests to these services, your IP address and standard browser headers are exposed to them as part of normal web traffic:

- **Unsplash:** Background images. The extension downloads the image files from `images.unsplash.com`; the search itself goes through the Hub API described above.
- **Google Calendar API:** Used to fetch your schedule.
- **Open-Meteo:** Weather forecasts, and city lookup when you type a city name in the settings.
- **BigDataCloud:** Turns coordinates into a place name for the weather widget.
- **GeoJS:** Approximate location from your IP address, used only as a fallback when the settings and browser geolocation do not provide one.
- **Stoic Quote API:** Used to fetch daily quotes.

These third-party services have their own privacy policies governing the data they process during API requests.

## Data Protection

Hub takes the following measures to protect sensitive data, particularly Google user data accessed via OAuth:

- **OAuth 2.0:** Authentication with Google is performed exclusively through Chrome's built-in `chrome.identity` API using the OAuth 2.0 protocol. Hub never handles or stores your Google account credentials.
- **HTTPS only:** All API requests to Google services and third-party services are made exclusively over HTTPS, ensuring data is encrypted in transit.
- **No server-side storage of user data:** Google user data (e.g., calendar events) is fetched directly in your browser and never transmitted to, stored on, or processed by any server we control. The only server we operate is the Hub API described above, which never receives Google user data.
- **Read-only access:** Hub requests only a read-only scope (`calendar.readonly`), limiting the extent of access to your Google account to the minimum required for the feature.
- **Token scope limitation:** OAuth tokens are requested with the minimum necessary scopes and are managed entirely by the Chrome browser runtime.

## Data Retention and Deletion

Hub does not retain Google user data beyond the immediate session:

- **Google Calendar data:** Calendar events are fetched on-demand and held only in your browser's runtime memory for the duration of the current session. This data is never written to disk, local storage, or any external system, and is automatically cleared when you close or reload the extension.
- **OAuth tokens:** Google OAuth access tokens are managed by Chrome's `identity` API. You can revoke Hub's access to your Google account at any time via your [Google Account permissions page](https://myaccount.google.com/permissions). Revoking access immediately removes Hub's ability to fetch any Google user data.
- **Local preferences:** Settings stored in `chrome.storage` and cached content in `localStorage` and Cache storage stay on your device (preferences additionally travel through Chrome Sync) and can be deleted at any time by clearing the extension's storage via Chrome settings or by uninstalling the extension.
- **No long-term retention:** We do not collect or archive any Google user data — there is no data held by Hub beyond your local device that would need to be deleted.

## Data Sharing and Selling

We do not sell, trade, rent, or otherwise share your personal information or browsing data with any third party. The extension operates entirely on your local machine.

## Changes to This Privacy Policy

We may update this Privacy Policy from time to time. Any changes will be reflected by updating the "Effective Date" at the top of this document.

## Contact Us

If you have any questions or suggestions about our Privacy Policy, please contact us at:
[hub@csalex.dev](mailto:hub@csalex.dev)
