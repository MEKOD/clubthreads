# Contributing to Club Threads

Thanks for taking the time to contribute.

This repository contains:

- a Fastify + TypeScript backend in `/src`
- a React + Vite frontend in `/lincol-app`
- product and rollout docs in `/docs`

## Before you start

- open an issue first for large changes, architectural rewrites, or new subsystems
- keep pull requests focused; small, reviewable changes move faster
- do not include secrets, local `.env` files, or generated build output
- preserve existing behavior unless the change explicitly intends to alter it

## Local setup

1. Install backend dependencies:

```bash
npm install
```

2. Install frontend dependencies:

```bash
cd lincol-app
npm install
```

3. Create local env files from the examples:

```bash
cp .env.example .env
cp lincol-app/.env.example lincol-app/.env
```

4. Start PostgreSQL and Redis, then run the backend and frontend dev servers.

See [README.md](/Users/k/Desktop/social/README.md), [docs/configuration.md](/Users/k/Desktop/social/docs/configuration.md), and [docs/deployment.md](/Users/k/Desktop/social/docs/deployment.md) for the current setup flow.

## What to include in a pull request

- a clear description of the problem and the change
- notes on any schema, config, or deployment impact
- screenshots or screen recordings for visible UI changes
- test notes, or a short explanation if no automated coverage was added

## Scope guidelines

Good first contributions:

- bug fixes
- documentation improvements
- small UX polish
- missing validation and error handling
- targeted performance or safety fixes

Changes that should usually be discussed first:

- auth changes
- feed ranking changes
- moderation model changes
- direct-message protocol changes
- storage or deployment architecture changes

## Database and migrations

- keep schema updates explicit
- include migration notes when behavior depends on new columns or indexes
- avoid mixing unrelated schema and feature work in the same PR

## Security expectations

- never commit credentials, API keys, or real user data
- avoid adding query-string auth, permissive CORS shortcuts, or unsafe file handling
- if you find a security issue, do not open a public issue; use [SECURITY.md](/Users/k/Desktop/social/SECURITY.md)

## Review standard

Pull requests are reviewed for:

- correctness
- production risk
- maintainability
- operational clarity
- security impact

If a change cannot be explained clearly, it is not ready to merge.
