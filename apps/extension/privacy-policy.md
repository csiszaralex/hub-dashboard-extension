# Privacy Policy for Hub Extension

**Effective Date:** March 4, 2026

This Privacy Policy describes how the Hub Chrome Extension ("Hub", "we", "us", or "our") handles your data. Hub is designed to be a privacy-first, local dashboard. We do not collect, store, or process your personal data on any external servers owned by us.

## Data We Access and How We Use It

Hub requests specific browser permissions to provide its core functionality. All data accessed through these permissions remains on your local device and is never transmitted to our servers.

### 1. Google Calendar Data (`identity` permission)

Hub uses Chrome's native `identity` API to authenticate with your Google account and requests read-only access to your Google Calendar (`https://www.googleapis.com/auth/calendar.events.readonly`).

- **Usage:** We fetch your upcoming events strictly to display them on your local dashboard.
- **Storage & Sharing:** Calendar data is processed temporarily in your browser's memory. We do not store, log, transmit, or share your calendar events with any third parties. Hub's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

### 2. Top Sites (`topSites` permission)

Hub accesses your most frequently visited websites to display a quick-access list on your dashboard.

- **Usage & Storage:** This data is read locally by the browser and rendered directly on the screen. It is never collected, tracked, or sent over the network.

### 3. Location and Weather (`geolocation` permission)

To display local weather conditions, Hub requests your geographic location.

- **Usage:** Your location coordinates are sent directly to third-party weather and location APIs (Open-Meteo and BigDataCloud) to retrieve weather data.
- **Storage:** We do not track your location history. The location data is only used at the moment of the request.

### 4. Local Storage (`storage` permission)

Hub uses your browser's local storage (`chrome.storage` and `localStorage`) to save:

- Your user preferences (e.g., Unsplash API key, search queries).
- Your daily quick notes.
- Cached data (like background images) to optimize network usage.
  This data is stored solely on your device and can be cleared at any time by uninstalling the extension or clearing your browser data.

## Third-Party Services

Hub interacts with the following third-party APIs to fetch content. When Hub makes requests to these services, your IP address and standard browser headers are exposed to them as part of normal web traffic:

- **Unsplash API:** Used to fetch background images based on your provided API key.
- **Google Calendar API:** Used to fetch your schedule.
- **Open-Meteo / BigDataCloud:** Used to provide weather information based on your location.
- **Stoic Quote API:** Used to fetch daily quotes.

These third-party services have their own privacy policies governing the data they process during API requests.

## Data Protection

Hub takes the following measures to protect sensitive data, particularly Google user data accessed via OAuth:

- **OAuth 2.0:** Authentication with Google is performed exclusively through Chrome's built-in `chrome.identity` API using the OAuth 2.0 protocol. Hub never handles or stores your Google account credentials.
- **HTTPS only:** All API requests to Google services and third-party services are made exclusively over HTTPS, ensuring data is encrypted in transit.
- **No server-side storage:** We operate no backend servers. Google user data (e.g., calendar events) is fetched directly in your browser and never transmitted to, stored on, or processed by any server we control.
- **Read-only access:** Hub requests only read-only scopes (`calendar.events.readonly`), limiting the extent of access to your Google account to the minimum required for the feature.
- **Token scope limitation:** OAuth tokens are requested with the minimum necessary scopes and are managed entirely by the Chrome browser runtime.

## Data Retention and Deletion

Hub does not retain Google user data beyond the immediate session:

- **Google Calendar data:** Calendar events are fetched on-demand and held only in your browser's runtime memory for the duration of the current session. This data is never written to disk, local storage, or any external system, and is automatically cleared when you close or reload the extension.
- **OAuth tokens:** Google OAuth access tokens are managed by Chrome's `identity` API. You can revoke Hub's access to your Google account at any time via your [Google Account permissions page](https://myaccount.google.com/permissions). Revoking access immediately removes Hub's ability to fetch any Google user data.
- **Local preferences:** Settings stored in `chrome.storage` (such as API keys or cached data) are stored solely on your device and can be deleted at any time by clearing the extension's storage via Chrome settings or by uninstalling the extension.
- **No long-term retention:** We do not collect or archive any Google user data — there is no data held by Hub beyond your local device that would need to be deleted.

## Data Sharing and Selling

We do not sell, trade, rent, or otherwise share your personal information or browsing data with any third party. The extension operates entirely on your local machine.

## Changes to This Privacy Policy

We may update this Privacy Policy from time to time. Any changes will be reflected by updating the "Effective Date" at the top of this document.

## Contact Us

If you have any questions or suggestions about our Privacy Policy, please contact us at:
[hub@csalex.dev](mailto:hub@csalex.dev)
