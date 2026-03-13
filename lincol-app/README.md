# Club Threads Frontend

This directory contains the React frontend for Club Threads. It is a Vite-based SPA with PWA support and is designed to work against the Fastify backend in the repository root.

## Stack

- React 19
- TypeScript
- Vite
- Zustand
- React Router
- PWA support through `vite-plugin-pwa`

## What the frontend does

- authentication and session persistence
- timeline browsing across latest, trash, trending, and personalized surfaces
- post creation, replies, reposts, quotes, mentions, and media attachments
- profile and community views
- realtime notifications and direct-message updates
- push subscription bootstrapping
- analytics event collection for the ranking pipeline

## Environment Variables

The frontend uses Vite environment variables.

### Required in split-origin deployments

- `VITE_API_URL`
  - full backend origin, for example `https://api.example.com`
  - if omitted, the app falls back to `http://localhost:3000`

### Optional

- `VITE_TURNSTILE_SITE_KEY`
  - Cloudflare Turnstile site key for the registration screen
- `VITE_KLIPY_API_KEY`
  - GIF-provider API key
  - if omitted, GIF search is disabled in that build

Use [`lincol-app/.env.example`](/Users/k/Desktop/social/lincol-app/.env.example) as a starting point.

## Local Development

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Build the app:

```bash
npm run build
```

Preview the production bundle:

```bash
npm run preview
```

## Backend Expectations

The frontend expects:

- a reachable backend API
- CORS permission when the backend is on a different origin
- HTTPS for production use
- SSE endpoints for notifications and direct messages
- bearer-token auth, not query-string auth

## Cloudflare Pages Checklist

If you deploy this frontend to Cloudflare Pages:

1. Set `VITE_API_URL` for both preview and production environments.
2. Make sure the backend is reachable over HTTPS.
3. Add the Pages origin to backend `CORS_ALLOWED_ORIGINS`.
4. Redeploy the frontend after changing environment variables.
5. Clear stale service-worker cache if a previous build pointed to the wrong backend.

## Troubleshooting

### The app loads but no data appears

Usually one of these is wrong:

- `VITE_API_URL` still points to `http://localhost:3000`
- the backend does not allow the frontend origin in CORS
- the backend is only exposed over HTTP while the frontend runs over HTTPS

### Login works locally but not on Pages

Check:

- the exact backend origin configured in `VITE_API_URL`
- CORS allowlists on the backend
- browser console for blocked requests or mixed-content errors

### Realtime updates do not arrive

Check:

- `/notifications/stream` and `/dm/stream` are reachable from the deployed origin
- bearer `Authorization` headers are not stripped by a proxy
- the backend origin is the same one used for normal API requests

## Related Docs

- [Repository README](/Users/k/Desktop/social/README.md)
- [Configuration Reference](/Users/k/Desktop/social/docs/configuration.md)
- [Deployment Guide](/Users/k/Desktop/social/docs/deployment.md)
