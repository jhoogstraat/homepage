# Joshua Hoogstraat’s homepage

A portfolio built with Astro 7 and Tailwind CSS 4. Pages are generated as static HTML; the weather, Spotify and Beszel endpoints run on the server with the standalone Node adapter.

## Development

Requires Bun 1.4.3. Install dependencies with `bun install --frozen-lockfile`.

```sh
bun run dev         # http://localhost:4321
bun run check-sync  # translation keys, types and array structure
bun run check       # Astro and TypeScript diagnostics
bun run test        # API regression checks with mocked upstream services
bun run build       # translation check and production build
bun run preview     # preview the build
```

## Structure

- `src/pages/[...path].astro` generates the five pages in DE, EN and ES.
- `src/components/pages/` contains page content. The layout owns navigation, metadata and the footer.
- `src/lib/i18n.ts` defines supported locales, page names and localized paths.
- `i18n/*.json` contains the copy. Keep keys, value types and array structure in sync.
- `src/pages/api/` contains server endpoints. Credentials are read from runtime environment variables.

German uses `/`, `/about`, `/homelab`, `/imprint` and `/privacy`. English and Spanish use `/en` and `/es` prefixes. Language links retain the current page and work without JavaScript. The former empty `/blog` route redirects to `/about`.

Browser scripts handle the animated terminal, keyboard shortcuts, theme toggle and live widgets. The terminal respects reduced motion and animates once per session. Press `?` or use the header button to view or disable shortcuts. Theme and shortcut preferences are saved in local storage. Without JavaScript, page content and navigation remain available; monitoring widgets show an unavailable state.

## Server configuration

Set these variables at runtime, never in public browser code.

### Beszel

| Variable | Purpose |
| --- | --- |
| `BESZEL_BASE_URL` | Beszel server URL; monitoring is unavailable if omitted |
| `BESZEL_SYSTEM_NAME` | System to display, default `pi1` |
| `BESZEL_PB_EMAIL`, `BESZEL_PB_PASSWORD` | PocketBase credentials, when authentication is required |
| `BESZEL_PB_AUTH_PATH` | Authentication path, default `api/collections/users/auth-with-password` |

The endpoint reads the matching system and up to 200 of its containers. It displays CPU, memory and disk percentages, disk temperature, and container CPU and memory (MiB). Successful responses are cached for 30 seconds and concurrent requests share one fetch. Container health codes are respected, and offline systems do not publish stale metrics or green container statuses. Missing data is shown as unavailable; no simulated metrics are used. Only the selected system name, update time, usage and container names/images/status are published. Use an account with read access restricted to the intended system. Internal addresses and credentials are not returned.

### Weather

The weather widget shows Berlin conditions from [Open-Meteo](https://open-meteo.com/en/docs), fetched through `/api/weather` without browser geolocation. Responses are cached for 15 minutes; failures show an unavailable state. No API key is required.

### Spotify

| Variable | Purpose |
| --- | --- |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Application credentials |
| `SPOTIFY_REFRESH_TOKEN` | Initial refresh token |
| `SPOTIFY_TOKEN_STORE_PATH` | Writable token file, default `.spotify/refresh-token.json` |
| `SPOTIFY_RESPONSE_CACHE_TTL_MS` | Playback cache duration, default `30000` |
| `SPOTIFY_RESPONSE_ERROR_CACHE_TTL_MS` | Error cache duration, default `5000` |
| `SPOTIFY_UNCONFIGURED_CACHE_TTL_MS` | Unconfigured cache duration, default `60000` |

Authorize the application with `user-read-currently-playing` and `user-read-recently-played` scopes using [Spotify’s authorization code flow](https://developer.spotify.com/documentation/web-api/tutorials/code-flow). The endpoint shows the current track or most recently played track. Rotated refresh tokens are written atomically with owner-only file permissions. Mount the token directory on persistent writable storage in a container; keep `.env` and token files out of version control.

## Deployment

`Containerfile` builds the site and runs `dist/server/entry.mjs` on port 4321. A server runtime is required for the live endpoints; static-only hosts cannot run them. Run the same checks before deployment:

```sh
bun run check-sync && bun run check && bun run test && bun run build
```

Hosting, retention and legal disclosures must match the actual deployment. The owner’s postal address is omitted by request; the repository cannot establish the completeness of legal notices.

MIT license.
