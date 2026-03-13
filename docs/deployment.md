# Deployment Guide

This guide documents practical deployment patterns for the current repository.

## Recommended Production Shape

The cleanest production setup is a split deployment:

- frontend on Cloudflare Pages or another static host
- backend on a Node-capable host
- PostgreSQL and Redis as managed or self-hosted services
- HTTPS on both frontend and backend origins

## Deployment Models

### Model A: Same-origin

Use one domain and proxy the frontend and backend together.

Pros:

- fewer CORS concerns
- simpler auth and asset URL handling

Cons:

- more reverse-proxy setup

### Model B: Split-origin

Host the SPA and API on different origins, for example:

- frontend: `https://app.example.com`
- backend: `https://api.example.com`

Pros:

- easy static hosting for the frontend
- clean separation of concerns

Cons:

- requires explicit CORS configuration
- environment-variable mistakes are more common

## Backend Deployment Checklist

Before shipping the backend:

1. Set `NODE_ENV=production`.
2. Set a strong `JWT_SECRET`.
3. Set a valid `DATABASE_URL`.
4. Set `REDIS_URL`.
5. Configure `CORS_ALLOWED_ORIGINS` for all browser-facing frontend origins.
6. Expose the API over HTTPS.
7. Mount a persistent upload directory if local storage is still used for media.
8. Make sure FFmpeg and libvips are installed in the runtime image.
9. Apply database migrations before switching traffic.
10. Confirm `/health` responds successfully.

Recommended smoke tests:

```bash
curl -i https://api.example.com/health
curl -i -H "Origin: https://app.example.com" https://api.example.com/feed
```

In the second response, `Access-Control-Allow-Origin` should match the calling frontend origin.

## Frontend Deployment Checklist

Before shipping the frontend:

1. Set `VITE_API_URL` to the real backend origin.
2. Set `VITE_TURNSTILE_SITE_KEY` if sign-up captcha is enabled.
3. Build and deploy a fresh bundle.
4. Verify that service-worker cache is not pinning an old backend URL.
5. Open the app in a clean session and confirm that data loads from the intended API.

## Cloudflare Pages Checklist

When using Cloudflare Pages:

### Required

- set `VITE_API_URL` in project settings
- set it for both preview and production environments if you use both
- ensure the backend origin is HTTPS
- allow the Pages domain in backend `CORS_ALLOWED_ORIGINS`

### After changing env vars

- trigger a new deployment
- hard-refresh the browser
- if necessary, unregister the old service worker in devtools

## Docker Notes

The repository includes:

- `/Users/k/Desktop/social/Dockerfile` for the backend image
- `/Users/k/Desktop/social/docker-compose.yml` for local multi-service bring-up

Important:

- the Compose file is convenient for local development
- it is not a secure production template as-is
- replace default credentials and remove unnecessary public port mappings before public deployment

## Media and Asset Considerations

Current media behavior:

- uploads are written to the backend filesystem by default
- share-card rendering may need `APP_ORIGIN` or `SHARE_CARD_ASSET_ORIGIN` for correct asset URLs

If you later move media to object storage or a CDN, update:

- upload handling
- asset URL generation
- share-card asset resolution

## Push Notification Deployment

To enable web push in production:

1. generate VAPID keys
2. set `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY`
3. make sure the frontend service worker is served from the correct origin
4. confirm the browser can register subscriptions successfully

## Common Split-Origin Failure Modes

### Frontend works but API calls fail

Usually one of:

- `VITE_API_URL` points to the wrong host
- backend CORS allowlist is incomplete
- backend is HTTP-only while the frontend is HTTPS

### Login works but realtime features do not

Check:

- `/notifications/stream`
- `/dm/stream`
- reverse proxies preserving `Authorization` headers

### Media URLs render incorrectly

Check:

- `APP_ORIGIN`
- `SHARE_CARD_ASSET_ORIGIN`
- frontend `VITE_API_URL`
- whether stored media URLs are relative or absolute

## Post-Deploy Validation

Minimum checks after deployment:

- register or log in
- load home feed
- create a post
- upload media
- open notifications
- open direct messages
- confirm share-card generation
- verify `/health`

If the frontend is on a separate origin, also confirm:

- preflight requests succeed
- SSE endpoints connect
- no mixed-content warnings appear in browser devtools
