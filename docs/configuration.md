# Configuration Reference

This document lists the main environment variables used by the backend and frontend.

Use these example files as the quickest starting point:

- [`.env.example`](/Users/k/Desktop/social/.env.example)
- [`lincol-app/.env.example`](/Users/k/Desktop/social/lincol-app/.env.example)

## Backend Variables

### Core runtime

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | Runtime mode. Production mode enables stricter behavior such as mandatory JWT secret handling and DB SSL. |
| `PORT` | No | `3000` | API listen port. |
| `HOST` | No | `0.0.0.0` | API listen host. |
| `DATABASE_URL` | Yes | None | PostgreSQL connection string. |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection string. |
| `JWT_SECRET` | Yes in production | Ephemeral in development | JWT signing secret. Must be at least 32 characters in production. |

### Cross-origin and asset origins

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `CORS_ALLOWED_ORIGINS` | Required for split-origin deployments | None | Comma-separated browser origins allowed to call the API. |
| `APP_ORIGIN` | Optional | None | Canonical application origin. Also used by some asset-generation paths. |
| `FRONTEND_ORIGIN` | Optional | None | Alternate way to allow a browser origin for CORS. |
| `SHARE_CARD_ASSET_ORIGIN` | Optional | Derived | Origin used when rendering share-card assets. |
| `CF_TUNNEL_HOSTNAME` | Optional | None | Tunnel hostname fallback for some asset URL generation. |

### Monitoring and limits

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ENABLE_LOCAL_MONITORING` | No | `true` | Enables the separate monitoring HTTP server. |
| `MONITORING_HOST` | No | `127.0.0.1` | Monitoring server bind host. |
| `MONITORING_PORT` | No | `3100` | Monitoring server port. |
| `RATE_LIMIT_MAX` | No | `300` | Global API rate limit per minute. |
| `AUTH_LOGIN_RATE_LIMIT_MAX` | No | `15` | Login route limit. |
| `AUTH_LOGIN_RATE_LIMIT_WINDOW` | No | `1 minute` | Login route time window. |
| `AUTH_REGISTER_RATE_LIMIT_MAX` | No | `5` | Registration route limit. |
| `AUTH_REGISTER_RATE_LIMIT_WINDOW` | No | `5 minutes` | Registration route time window. |
| `MAX_FILE_SIZE_MB` | No | `20` | Multipart file-size cap used by upload routes. |
| `UPLOAD_DIR` | No | `./uploads` under project root | Directory for processed media files. |

### Optional security services

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `TURNSTILE_SECRET_KEY` | Optional | Disabled | Enables Cloudflare Turnstile verification for sign-up. |
| `LINK_PREVIEW_DOMAIN_BLACKLIST` | Optional | Built-in local/private blocklist | Additional comma-separated hostnames blocked from preview fetching. |

### Web push

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `VAPID_SUBJECT` | Optional | None | Web Push VAPID subject, usually a mailto or URL. |
| `VAPID_PUBLIC_KEY` | Optional | None | Public key returned to browsers. |
| `VAPID_PRIVATE_KEY` | Optional | None | Private key used to sign push sends. |
| `WEB_PUSH_TTL_SECONDS` | No | `900` | Push TTL, clamped to a safe range. |
| `WEB_PUSH_URGENCY` | No | `high` | Web Push urgency header. |

### Media pipeline

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `VIDEO_TRANSCODE_CONCURRENCY` | No | `1` | Maximum parallel FFmpeg video jobs. |
| `VIDEO_TRANSCODE_QUEUE_LIMIT` | No | `4` | Maximum queued video jobs before uploads are rejected as overloaded. |

### Optional startup seeding

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SEED_ADMIN_ON_STARTUP` | No | `false` | Enables explicit admin creation on boot. |
| `SEED_ADMIN_USERNAME` | Required if seeding is enabled | None | Username for the seeded admin account. |
| `SEED_ADMIN_PASSWORD` | Required if seeding is enabled | None | Password for the seeded admin account. Must be at least 12 characters. |

### Optional AI bot

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AI_BOT_ENABLED` | No | `false` | Enables the mention-triggered bot flow. |
| `AI_BOT_USERNAME` | No | `gregor` | Bot username. |
| `AI_BOT_MODEL` | No | `gemini-2.5-flash-lite` | Model name used for generation. |
| `AI_BOT_TIMEOUT_MS` | No | `10000` | Generation timeout. |
| `AI_BOT_USER_DAILY_LIMIT` | No | `3` | Per-user quota. |
| `AI_BOT_GLOBAL_DAILY_LIMIT` | No | `300` | Global daily quota. |
| `AI_BOT_GLOBAL_MINUTE_LIMIT` | No | `10` | Global minute quota. |
| `AI_BOT_ROOT_POSTS_ONLY` | No | `true` | Restricts bot activation to root posts when enabled. |
| `AI_BOT_QUOTA_TIMEZONE` | No | `Europe/Istanbul` | Timezone used for quota windows. |
| `AI_BOT_CONTEXT_LIMIT` | No | `4` | Number of thread items included in the prompt context. |
| `AI_BOT_BIO` | No | Built-in Turkish bio | Bot profile bio. |
| `GEMINI_API_KEY` | Required if AI bot is enabled | None | Provider API key. |
| `GEMINI_API_URL` | No | Google Gemini API v1beta URL | Override for model endpoint base URL. |

## Frontend Variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `VITE_API_URL` | Required outside local same-machine development | `http://localhost:3000` | Full backend origin used by the SPA. |
| `VITE_TURNSTILE_SITE_KEY` | Optional | Disabled | Enables the registration-page Turnstile widget. |
| `VITE_KLIPY_API_KEY` | Optional | Disabled when unset | GIF picker API key. Required if you want GIF search enabled in the frontend. |

## Split-Origin Example

If the frontend runs on Cloudflare Pages and the backend runs on `api.example.com`:

### Frontend

```env
VITE_API_URL=https://api.example.com
VITE_TURNSTILE_SITE_KEY=...
```

### Backend

```env
JWT_SECRET=replace-with-a-long-random-secret
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
CORS_ALLOWED_ORIGINS=https://app.example.com,https://your-project.pages.dev
APP_ORIGIN=https://app.example.com
```

## Secrets Guidance

- never commit real `.env` files
- treat `JWT_SECRET`, DB credentials, Redis credentials, `VAPID_PRIVATE_KEY`, and `GEMINI_API_KEY` as secrets
- do not rely on the local Docker Compose defaults in production
- rotate credentials before publishing the repo publicly if any old values were ever used in a shared environment

## Common Mistakes

### Frontend loads but no data arrives

Usually one of these:

- `VITE_API_URL` still points to localhost
- backend CORS allowlist does not include the frontend origin
- backend is only exposed over HTTP while the frontend uses HTTPS

### Push notifications do not work

Check:

- all three VAPID values are set
- the browser successfully fetched `/notifications/vapid-public-key`
- the service worker is active

### The server fails to boot in production

Most common causes:

- missing `JWT_SECRET`
- invalid `DATABASE_URL`
- no database connectivity

### Sign-up captcha never appears

Check both sides:

- frontend has `VITE_TURNSTILE_SITE_KEY`
- backend has `TURNSTILE_SECRET_KEY`
