## 2.3.1 (2026-08-14)

### 🩹 Fixes

- **extension:** show every release a user skipped, not just the newest ([ce1090e](https://github.com/csiszaralex/hub-dashboard-extension/commit/ce1090e))
- **extension:** make the release notes readable at any length ([6c87339](https://github.com/csiszaralex/hub-dashboard-extension/commit/6c87339))

### 🔥 Performance

- **extension:** stop shipping store artwork in the package ([7883e03](https://github.com/csiszaralex/hub-dashboard-extension/commit/7883e03))

## 2.3.0 (2026-08-12)

### 🚀 Features

- **extension:** reach the focus session from the popup ([3906bd2](https://github.com/csiszaralex/hub-dashboard-extension/commit/3906bd2))
- **extension:** announce the focus phase in the tab title ([4873eb8](https://github.com/csiszaralex/hub-dashboard-extension/commit/4873eb8))
- **extension:** move the focus timer into the service worker ([d35f962](https://github.com/csiszaralex/hub-dashboard-extension/commit/d35f962))
- **extension:** put the focus timer beside the countdown ([b696cdb](https://github.com/csiszaralex/hub-dashboard-extension/commit/b696cdb))
- **extension:** add a Pomodoro focus timer ([3b7b8e3](https://github.com/csiszaralex/hub-dashboard-extension/commit/3b7b8e3))
- **extension:** add a keyboard shortcut for the UI toggle ([f60c560](https://github.com/csiszaralex/hub-dashboard-extension/commit/f60c560))
- **extension:** read quotes through the Hub API with a bundled fallback ([20e6d25](https://github.com/csiszaralex/hub-dashboard-extension/commit/20e6d25))
- **extension:** prefetch tomorrow's background in the service worker ([441074f](https://github.com/csiszaralex/hub-dashboard-extension/commit/441074f))
- **extension:** allow a custom background image ([5706c98](https://github.com/csiszaralex/hub-dashboard-extension/commit/5706c98))
- **extension:** show a four-day forecast ([fa98b6e](https://github.com/csiszaralex/hub-dashboard-extension/commit/fa98b6e))
- **extension:** let each widget be hidden from the popup ([2ef0ce0](https://github.com/csiszaralex/hub-dashboard-extension/commit/2ef0ce0))
- **extension:** add a background dimming slider ([c0af588](https://github.com/csiszaralex/hub-dashboard-extension/commit/c0af588))
- **extension:** clean up obsolete image caches on update ([609b368](https://github.com/csiszaralex/hub-dashboard-extension/commit/609b368))

### 🩹 Fixes

- **extension:** keep error diagnostics in production builds ([5edb780](https://github.com/csiszaralex/hub-dashboard-extension/commit/5edb780))
- **extension:** keep the custom background across a cache version bump ([b20c6d4](https://github.com/csiszaralex/hub-dashboard-extension/commit/b20c6d4))
- **extension:** stop a long tab label from clipping the strip again ([8df725a](https://github.com/csiszaralex/hub-dashboard-extension/commit/8df725a))
- **extension:** show every settings tab ([4c5bf87](https://github.com/csiszaralex/hub-dashboard-extension/commit/4c5bf87))
- **extension:** stop emitting unusable module preloads ([9cabe85](https://github.com/csiszaralex/hub-dashboard-extension/commit/9cabe85))
- **extension:** let the focus length fields be typed into ([88a7b86](https://github.com/csiszaralex/hub-dashboard-extension/commit/88a7b86))
- **extension:** declare the geocoding and IP-location hosts ([1d01531](https://github.com/csiszaralex/hub-dashboard-extension/commit/1d01531))
- **api:** follow the Unsplash attribution guidelines ([07a9e89](https://github.com/csiszaralex/hub-dashboard-extension/commit/07a9e89))
- **extension:** store background images in the Cache API ([8f8238d](https://github.com/csiszaralex/hub-dashboard-extension/commit/8f8238d))
- **extension:** stop refetching the background on every new tab ([9a72fde](https://github.com/csiszaralex/hub-dashboard-extension/commit/9a72fde))
- **extension:** update background handling and improve photographer credit display ([58734a5](https://github.com/csiszaralex/hub-dashboard-extension/commit/58734a5))

### 🔥 Performance

- **extension:** self-host the Inter font ([60774a6](https://github.com/csiszaralex/hub-dashboard-extension/commit/60774a6))

### 🧱 Updated Dependencies

- Updated @hub/shared to 0.1.4

## 2.2.0 (2026-04-06)

### 🚀 Features

- **extension:** add tabs in popup ([#4](https://github.com/csiszaralex/hub-dashboard-extension/pull/4))
- **extension:** implement internationalization support with i18next and localization files ([#3](https://github.com/csiszaralex/hub-dashboard-extension/pull/3))

### 🧱 Updated Dependencies

- Updated @hub/shared to 0.1.3

## 2.1.2 (2026-04-04)

### 🩹 Fixes

- **extension:** improve background fetching logic and query handling ([#2](https://github.com/csiszaralex/hub-dashboard-extension/pull/2))

## 2.1.1 (2026-03-30)

### 🩹 Fixes

- **repo:** remove author acknowledgment from CHANGELOGs ([b0a727e](https://github.com/csiszaralex/hub-dashboard-extension/commit/b0a727e))

### 🧱 Updated Dependencies

- Updated @hub/shared to 0.1.2

## 2.1.0 (2026-03-30)

### 🚀 Features

- **extension:** implement Whats New modal and changelog integration ([054a7bf](https://github.com/csiszaralex/hub-dashboard-extension/commit/054a7bf))

### 🩹 Fixes

- **repo:** make package.json files consistent ([4a937f5](https://github.com/csiszaralex/hub-dashboard-extension/commit/4a937f5))

# 2.0.0 (2026-03-23)

Edit background module to use proxy hub api instead of direct call to unsplash.

## 1.3.2 (2026-03-22)

### 🧱 Updated Dependencies

- Updated @hub/shared to 0.1.1

## 1.3.1 (2026-03-21)

### 🚀 Features

- **shared:** create shared package with BackgroundData interface and configuration ([a91cb42](https://github.com/csiszaralex/hub-dashboard-extension/commit/a91cb42))

### 🧱 Updated Dependencies

- Updated @hub/shared to 0.1.0

## 1.3.0 (2026-03-21)

### 🚀 Features

- add ESLint configuration and update .gitignore for new files ([ff75ecf](https://github.com/csiszaralex/hub-dashboard-extension/commit/ff75ecf))
- move structure to app/extension folder ([995196d](https://github.com/csiszaralex/hub-dashboard-extension/commit/995196d))

### 🩹 Fixes

- update tsconfig to include correct source directory ([5b298d5](https://github.com/csiszaralex/hub-dashboard-extension/commit/5b298d5))

## [1.1.2](https://github.com/csiszaralex/hub-dashboard-extension/compare/v1.1.1...v1.1.2) (2026-03-18)

### Bug Fixes

- correct command for building and packing the extension ([6248541](https://github.com/csiszaralex/hub-dashboard-extension/commit/62485415aac3ac5d19e3ef260314ccbdc211c658))

## [1.1.1](https://github.com/csiszaralex/hub-dashboard-extension/compare/v1.1.0...v1.1.1) (2026-03-18)

### Bug Fixes

- edit github action location ([2e729b3](https://github.com/csiszaralex/hub-dashboard-extension/commit/2e729b377ebb09e5ae04a796f9f97a9cf60b1c89))

## 1.1.0 (2026-03-18)

### Bug Fixes

- improve wording in Privacy Policy section of README ([dac964e](https://github.com/csiszaralex/hub-dashboard-extension/commit/dac964e69ec72fcb5bae9efddd9118c093ab2860))
- update header formatting in README for consistency ([9b2dd89](https://github.com/csiszaralex/hub-dashboard-extension/commit/9b2dd89530cc33d17b3e10662cd9b0aac86e85ff))

### Features

- add background refresh functionality with loading state in useBackground hook ([1f00f89](https://github.com/csiszaralex/hub-dashboard-extension/commit/1f00f89af5c0746773c41dcb75e02b962e36528e))
- add BackgroundInfo component and useBackground hook for dynamic background data ([8a1e21f](https://github.com/csiszaralex/hub-dashboard-extension/commit/8a1e21f079db18cc73791b5dcce8e65b7f214e52))
- add colors to calendars and multiple current event display ([364fcb7](https://github.com/csiszaralex/hub-dashboard-extension/commit/364fcb7955eaa1e7b3ee74bed69787dfd0e9a78a))
- add configuration to exclude index.html from build ([85efcbe](https://github.com/csiszaralex/hub-dashboard-extension/commit/85efcbeb39ebcc4bda5d86a332a701a713619965))
- add CountdownWidget and integrate countdown target settings in PopupForm ([5bae3c3](https://github.com/csiszaralex/hub-dashboard-extension/commit/5bae3c3ee5f9547e25d2687c1711d83cbdf8601d))
- add GitHub Actions workflow for deploying Chrome extension ([30e020a](https://github.com/csiszaralex/hub-dashboard-extension/commit/30e020aae05a22500689baeb9d6963f263b6d8d3))
- add local image caching for background and update App component to use local image when offline ([b7af132](https://github.com/csiszaralex/hub-dashboard-extension/commit/b7af1326f3192e0ea31823f4e554fa8b9b14b3fd))
- add periodic refresh for weather data every 30 minutes ([440c04c](https://github.com/csiszaralex/hub-dashboard-extension/commit/440c04c8bb8cd6b6858b3dd2e8b63d6c5b8be3f8))
- add popup for Hub settings with Unsplash API configuration ([ee7d456](https://github.com/csiszaralex/hub-dashboard-extension/commit/ee7d456e76ae709d88560de7c97a58ff3ef32523))
- add Privacy Policy document outlining data usage and permissions ([31bcfc8](https://github.com/csiszaralex/hub-dashboard-extension/commit/31bcfc854ab8feb65ab8c1ae64ec10e67bcebfed))
- add Privacy Policy section to README ([27baf13](https://github.com/csiszaralex/hub-dashboard-extension/commit/27baf13d76eaef0a9c674ba1dc2811b3e1de4766))
- add QuickNote component and useNote hook for note management ([2022307](https://github.com/csiszaralex/hub-dashboard-extension/commit/2022307db2b266b0bdafaf82eec2feff16585982))
- add README with project overview, features, getting started guide, and tech stack ([fd50b52](https://github.com/csiszaralex/hub-dashboard-extension/commit/fd50b520a4e88790dfb5cfb76d3147517bbbeba8))
- add refresh functionality to WeatherWidget and refactor useWeather hook ([69e5f9e](https://github.com/csiszaralex/hub-dashboard-extension/commit/69e5f9ea4b5699efb109369350edefd9afad5dee))
- add release-it with config ([4ea178d](https://github.com/csiszaralex/hub-dashboard-extension/commit/4ea178d9c223e6c0df288184cdd5621e5d14f687))
- add TopSitesWidget component and useTopSites hook for displaying top sites ([4bee689](https://github.com/csiszaralex/hub-dashboard-extension/commit/4bee689b14fc523f9eb1a4df67a87ca9081140f0))
- add UnsplashKeyPrompt component and integrate Unsplash key handling in App ([ea2490b](https://github.com/csiszaralex/hub-dashboard-extension/commit/ea2490b17a7b28de7695d40d9a1cd77060198b23))
- add useQuote hook for fetching and caching daily quotes ([854460e](https://github.com/csiszaralex/hub-dashboard-extension/commit/854460e67a4162a72b30c08cc944d67bd2b16fbf))
- enhance loading state in WeatherWidget with improved skeleton UI ([151026a](https://github.com/csiszaralex/hub-dashboard-extension/commit/151026abbac0ca1ec7cb75ad8408c1f3d84b708d))
- enhance useCalendar hook to include settings loaded state and add periodic refresh for calendar events ([e6da314](https://github.com/csiszaralex/hub-dashboard-extension/commit/e6da31451087e4b834fd0622d932eecec910e032))
- enhance useSettings and PopupForm to manage locationCity, locationLat, and locationLon ([0bccab7](https://github.com/csiszaralex/hub-dashboard-extension/commit/0bccab70b5e8c707c50767cee0f3fc98cb45153e))
- enhance WeatherWidget and weatherMapping for improved UI and weather icon handling ([e1ddde8](https://github.com/csiszaralex/hub-dashboard-extension/commit/e1ddde8958f17f357bd23f56b3ca251f20f0226d))
- enhance WeatherWidget loading state and improve rain data handling in useWeather hook ([0b9220d](https://github.com/csiszaralex/hub-dashboard-extension/commit/0b9220d2da7441e3e48636e45f87544aa6f63cc1))
- implement CalendarWidget and useCalendar hook for event management ([fefeeca](https://github.com/csiszaralex/hub-dashboard-extension/commit/fefeeca85c54ed37c27d55a0d5a1e0e3082748d1))
- implement main application structure with widgets for clock, weather, quotes, calendar, and background info ([baea97c](https://github.com/csiszaralex/hub-dashboard-extension/commit/baea97cd85eb65e7996765ecc6f17fc4f065151c))
- implement useSettings hook for managing Unsplash API settings ([15defed](https://github.com/csiszaralex/hub-dashboard-extension/commit/15defedb5dfb7e286edef9c9498f5654be87ba0b))
- improve calendar widget UI ([bea8a0b](https://github.com/csiszaralex/hub-dashboard-extension/commit/bea8a0b25c72374310df058e0f322562c337fa9d))
- improve weather data caching in useWeather hook ([d6901a0](https://github.com/csiszaralex/hub-dashboard-extension/commit/d6901a0b179f8f5ca4b79d2b3621efccc64dd25b))
- initialize project with TypeScript and Vite configuration ([6d2770b](https://github.com/csiszaralex/hub-dashboard-extension/commit/6d2770be8593751d18e5e32ff1ebedd7c692a044))
- integrate calendar selection in PopupForm and update useCalendar to support multiple calendars ([81e3827](https://github.com/csiszaralex/hub-dashboard-extension/commit/81e38277e4dbc8d41a527a701a12f30650f0fcb5))
- refactor useWeather to improve location resolution and caching logic ([83cb5c5](https://github.com/csiszaralex/hub-dashboard-extension/commit/83cb5c521e21f66c32bcbfd1cd961e1b944f5c29))
- remove TopSitesWidget component and adjust QuoteWidget position ([a6fdaff](https://github.com/csiszaralex/hub-dashboard-extension/commit/a6fdaff0b5e60d4a58c3403b9e242bafa2643736))
- update getDailyData and setDailyData to include query parameter ([cffdd4f](https://github.com/csiszaralex/hub-dashboard-extension/commit/cffdd4fb69b9640c0eeec184200fa3ee6798fea1))
- update manifest.json permissions and client_id; add comment for TopSitesWidget in App component ([8a88023](https://github.com/csiszaralex/hub-dashboard-extension/commit/8a88023195ed4752db4eb885176b77c738f4ec0a))
- update package name from 'my-dashboard' to 'hub' ([d318cb9](https://github.com/csiszaralex/hub-dashboard-extension/commit/d318cb909fce6ef8278aebb91616f744fe36a938))
- update version to 1.0.1 and enhance Vite configuration with dynamic manifest ([08f718d](https://github.com/csiszaralex/hub-dashboard-extension/commit/08f718d89e1b665255e91a69d8fbda5faef081a1))
