# Club Threads

Club Threads is a split-stack social platform built around fast timelines, private and public communities, 1:1 direct messaging, media sharing, push notifications, and a personalized "For You" feed.

This repository contains:

- a Fastify + TypeScript backend in `/src`
- a React + Vite frontend in `/lincol-app`
- migrations, infra notes, and system documentation in `/migrations`, `/infra`, and `/docs`

## Status

The codebase is actively evolving and is now being prepared for open-source distribution. The platform is usable, but some operational defaults in local Docker files are intentionally developer-friendly and should be hardened before public production deployment.

## Project Snapshot

Club Threads is not just a code dump. It has already been exercised by a small live network and has enough product surface area to expose real ranking, messaging, moderation, and media-processing behavior.

It is also being operated under real hardware constraints rather than a polished cloud stack: the current backend runs on a low-cost Lenovo Ubuntu machine at home. That constraint shaped a lot of the engineering decisions in this repository.

Live app:

- [club.misya.me](https://club.misya.me/)

As of March 13, 2026, the current instance had roughly:

- 42 registered users
- 1,885 posts
- 132 follow edges
- 6 communities
- 54,000+ behavioral analytics events
- 1,307 recorded sessions

The most important signal is not raw volume, but density:

- average post dwell time is about 8.46 seconds
- replies, reposts, quotes, favorites, and trash interactions are all active enough to shape ranking behavior
- the app has enough usage to expose tradeoffs in feed quality, conversation depth, realtime delivery, and moderation tools

For the detailed product and system brief, see [UNDERGROUND_STATE.md](./UNDERGROUND_STATE.md).

## Core Features

- JWT-based authentication with runtime role and account-status validation
- public profiles, follow graph, search, trending topics, and mentions
- latest, trash, popular, and personalized `for_you` feed modes
- community system with membership, moderation, rules, requests, and invites
- image and video uploads with server-side processing
- generated share cards
- 1:1 direct messaging with SSE realtime delivery and push notifications
- web push notifications for in-app activity and direct messages
- behavioral analytics ingestion for ranking and product telemetry
- optional Turnstile verification for sign-up hardening
- optional AI bot integration for mention-driven replies

## Stack

### Backend

- Fastify
- TypeScript
- PostgreSQL
- Drizzle ORM
- Redis
- Sharp
- FFmpeg

### Frontend

- React 19
- Vite
- TypeScript
- Zustand
- React Router
- PWA support via `vite-plugin-pwa`

## Repository Layout

```text
.
├── src/                  # Backend source
├── lincol-app/           # Frontend application
├── docs/                 # Product and subsystem documentation
├── migrations/           # SQL migrations applied outside Drizzle-generated output
├── infra/                # Infra support files such as postgres.conf and tunnel config
├── tools/                # Small local tools (for example the log viewer)
├── Dockerfile            # Backend image
└── docker-compose.yml    # Local multi-service stack
```

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- FFmpeg available in the backend runtime
- libvips support for Sharp

### 1. Install dependencies

```bash
npm install
cd lincol-app && npm install
```

### 2. Configure environment variables

Copy the example files and fill in real values:

```bash
cp .env.example .env
cp lincol-app/.env.example lincol-app/.env
```

See [docs/configuration.md](/Users/k/Desktop/social/docs/configuration.md) for a full variable reference and deployment-specific notes.

### 3. Start infrastructure

You can run PostgreSQL and Redis yourself, or use Docker Compose locally:

```bash
docker compose up -d postgres redis
```

Important:

- the checked-in Compose defaults are local-development defaults
- do not ship the default database password or public port mappings to production

### 4. Run database migrations

Use your preferred migration flow for this repository:

```bash
npm run db:migrate
```

The repo also contains hand-authored SQL migrations in `/migrations` that document important schema changes and subsystem rollouts.

### 5. Start the backend

```bash
npm run dev
```

Default backend URLs:

- API: `http://localhost:3000`
- health: `http://localhost:3000/health`
- monitoring: `http://127.0.0.1:3100` when `ENABLE_LOCAL_MONITORING` is not disabled

### 6. Start the frontend

```bash
cd lincol-app
npm run dev
```

By default the frontend expects the backend at `http://localhost:3000`. Override this with `VITE_API_URL` when the frontend and backend run on different origins.

## Scripts

### Backend

- `npm run dev` - start the backend in watch mode
- `npm run build` - compile TypeScript into `dist/`
- `npm run start` - run the compiled backend
- `npm run logs:view` - open the local log viewer utility
- `npm run db:generate` - generate Drizzle artifacts
- `npm run db:migrate` - run database migrations
- `npm run db:push` - push schema changes directly
- `npm run db:studio` - open Drizzle Studio

### Frontend

- `npm run dev` - start the Vite dev server
- `npm run build` - run TypeScript build plus production bundle
- `npm run preview` - preview the production bundle locally
- `npm run lint` - run ESLint

## Runtime Architecture

At a high level:

- React talks to the Fastify API over HTTP
- authentication uses bearer JWTs
- SSE powers realtime notifications and direct message updates
- PostgreSQL stores the primary relational model
- Redis handles fast counters, pub/sub, caching, and some fan-out behavior
- Sharp and FFmpeg process user-uploaded media
- optional web push bridges app events to installed clients

## API Surface

Main route groups registered by the backend:

- `/auth` - register, login, current user, avatar/cover upload, DM crypto bundle storage
- `/feed` - latest, trash, popular, and `for_you` timelines
- `/posts` - create, fetch, delete, and post-thread operations
- `/interactions` - favorites and trash interactions
- `/users` - profile lookup, search, suggestions, relationship views
- `/follows` - follow and unfollow actions
- `/communities` - community CRUD, membership, moderation, requests, and invites
- `/notifications` - activity list, read state, realtime stream, push subscription management
- `/dm` - conversations, unread counts, realtime stream, send/read/delivered/typing flows
- `/media` - upload and serve processed media
- `/share` - render share-card images
- `/analytics` - ingest behavioral analytics batches
- `/admin` - admin-only user role and notification operations

## Security Highlights

Recent hardening relevant to open-source publication:

- production requires an explicit `JWT_SECRET`
- JWTs are accepted from the `Authorization` header, not query strings
- authenticated requests re-check current role and `isActive` state in the database
- CORS now uses an explicit allowlist via `CORS_ALLOWED_ORIGINS`, `APP_ORIGIN`, or `FRONTEND_ORIGIN`
- the backend emits baseline hardening headers such as `X-Content-Type-Options` and `Referrer-Policy`
- the legacy hard-coded startup admin account has been removed in favor of explicit opt-in seeding
- image processing strips metadata and caps input pixel counts
- link-preview fetching performs hostname and private-IP safety checks

For deployment guidance, see [docs/deployment.md](/Users/k/Desktop/social/docs/deployment.md).

## Configuration

Two files are intended to be your starting point:

- [`.env.example`](/Users/k/Desktop/social/.env.example) for the backend
- [`lincol-app/.env.example`](/Users/k/Desktop/social/lincol-app/.env.example) for the frontend

Detailed reference:

- [docs/configuration.md](/Users/k/Desktop/social/docs/configuration.md)

## Documentation Index

- [docs/configuration.md](/Users/k/Desktop/social/docs/configuration.md) - backend and frontend environment reference
- [docs/deployment.md](/Users/k/Desktop/social/docs/deployment.md) - local, Docker, and split-origin deployment guidance
- [docs/direct-messaging-README.md](/Users/k/Desktop/social/docs/direct-messaging-README.md) - direct messaging architecture and behavior
- [docs/for-you-feed-infra.md](/Users/k/Desktop/social/docs/for-you-feed-infra.md) - rollout and operational notes for the personalized feed
- [docs/for-you-feed-data-README.md](/Users/k/Desktop/social/docs/for-you-feed-data-README.md) - data export requirements for ranking tuning
- [docs/for-you-feed-math.md](/Users/k/Desktop/social/docs/for-you-feed-math.md) - scoring formulas behind the personalized feed

## Frontend Deployment Note

If the frontend is hosted on Cloudflare Pages and the backend is hosted elsewhere:

- set `VITE_API_URL` in the Pages project
- expose the backend over HTTPS
- add the Pages origin to backend CORS allowlists

If you skip any of those, the frontend will load but fail to fetch data.

## Open-Source Readiness Notes

Before publishing publicly, review:

- all example credentials and local Compose defaults
- third-party API keys and provider quotas
- any branding or content that should not be redistributed
- production logging and moderation expectations
- migration ordering and setup instructions for first-time contributors

## Community Docs

- [CONTRIBUTING.md](/Users/k/Desktop/social/CONTRIBUTING.md) - contribution and pull request expectations
- [SECURITY.md](/Users/k/Desktop/social/SECURITY.md) - how to report vulnerabilities privately
- [CODE_OF_CONDUCT.md](/Users/k/Desktop/social/CODE_OF_CONDUCT.md) - collaboration rules for public participation

## Contact

- Email: `mert38338@gmail.com`
- X: [@popybuthole](https://x.com/popybuthole)

## License

Club Threads is licensed under the GNU Affero General Public License v3.0.

See [LICENSE](/Users/k/Desktop/social/LICENSE).
