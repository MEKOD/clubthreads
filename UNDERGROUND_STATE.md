# Club Threads State

This is the document a new reader should open if they want to understand why this repository exists and why it is worth taking seriously.

Most repositories in this category are one of three things:

- a frontend shell with no real usage
- a backend scaffold with no product pressure
- a clone with commodity timelines and no meaningful systems thinking

Club Threads is different.

It is an actively used social product codebase with enough real behavior to make feed quality, messaging architecture, moderation rules, media handling, and operational tradeoffs visible in the code.

## The One-Sentence Version

Club Threads is an open-source social platform with custom ranking, realtime direct messages, communities, media processing, and behavioral analytics, and it has been running for real users on a cheap home machine rather than on a polished cloud stack.

Live app:

- [club.misya.me](https://club.misya.me/)

## Why This Repo Is Interesting

The most important fact about this project is not the framework list.

It is this:

the backend is running on a low-cost Lenovo Ubuntu machine at home, literally under a couch, and it still powers a live network with real posting, reading, ranking, messaging, notifications, and moderation behavior.

That constraint matters.

This repo was not designed from the comfort of infinite cloud budget, managed queues everywhere, and a marketing-first product surface. It was shaped by hard limits:

- modest hardware
- real users
- real uptime pressure
- real media handling
- real ranking inputs
- real moderation and access control

That is why many of the engineering decisions in this codebase are pragmatic instead of ornamental.

## What The Product Already Has

Club Threads already includes:

- a personalized `for_you` feed with explicit scoring logic
- latest, popular, and trash feed surfaces
- public profiles, follows, mentions, and discovery
- public and private communities with moderation and access rules
- one-to-one direct messaging with realtime delivery
- image and video uploads with server-side processing
- web push notifications
- behavioral analytics ingestion for product telemetry and ranking
- generated share cards
- admin and moderation surfaces

This is not a concept repo. It is a full product surface with working interactions across backend, frontend, database, caching, and media layers.

## Operating Under Real Constraints

The current deployment shape is intentionally simple:

- backend runs on a cheap Lenovo Ubuntu box at home
- data and services are managed with a pragmatic self-hosted setup
- the system has to work within limited CPU, memory, and operational margin

That has downstream consequences:

- feed logic has to be understandable and tunable
- realtime transport has to be simple enough to operate
- media processing needs guardrails
- analytics must be useful without becoming infrastructure theater
- security hardening matters because the system is exposed to the real internet, not just localhost

In other words, this project is closer to "a live indie system under pressure" than to "a polished venture-backed platform template".

## Current Snapshot

Metrics below reflect the internal snapshot captured on March 13, 2026.

### Network Size

- 42 registered users
- 132 follow relationships
- 6 communities

Role distribution:

- 23 standard users
- 10 pink accounts
- 7 elite accounts
- 2 admin accounts

### Content And Interaction Volume

- 1,885 total posts
- 554 favorites
- 105 reposts
- 27 quotes
- 108 trash interactions
- 285 reply starts
- 109 reply submissions

### Behavior And Traffic

- 54,000+ behavioral analytics events
- 1,307 recorded sessions
- 19,841 `post_dwell` events
- 17,916 `post_impression` events
- 6,354 `screen_view` events
- 3,622 `feed_refresh` events
- 1,793 `composer_open` events
- average dwell time per post of roughly 8.46 seconds

## Why These Numbers Matter

This is not large-scale social data.

It is enough, however, to cross the threshold where product choices become real:

- there is enough content for ranking to matter
- there is enough reading behavior for dwell and impression signals to mean something
- there is enough interaction diversity for favorites alone to be insufficient
- there is enough messaging activity for realtime delivery paths to matter
- there is enough social structure for community and relationship models to influence visibility

That is the key distinction.

The value of this snapshot is not that it is massive. The value is that it is dense enough to create genuine system pressure.

## What The Data Suggests

The current network appears to be small but behaviorally rich.

The strongest signals are:

- people are not only opening the app, they are writing into it
- people are not only scrolling, they are spending measurable time on posts
- replies, reposts, quotes, and trash actions are active enough to shape feed outcomes
- the social graph and communities are populated enough to create differentiated viewer experiences

An average dwell time above eight seconds is especially important. For a small network, that strongly suggests the feed is not just producing accidental impressions. People are actually stopping to read.

## What The System Already Proves

Even at this scale, the repository already proves several non-trivial things:

- the personalized feed is driven by actual behavior rather than placeholder logic
- the direct-message system supports realtime delivery and receipt state in production-like conditions
- communities, membership rules, moderation permissions, and role checks work as part of the live product
- the media pipeline is integrated into normal use, not bolted on as an afterthought
- the analytics layer is rich enough to feed ranking, telemetry, and product iteration
- the security model has already been hardened beyond default hobby-project shortcuts

That matters because many early open-source social projects never reach the point where these tradeoffs become visible.

## Architectural Shape

At a high level:

- backend: Fastify + TypeScript + PostgreSQL + Redis
- frontend: React + Vite + TypeScript + Zustand + PWA support

Important system properties:

- JWT auth with runtime role and account-state checks
- SSE-based realtime updates for direct messages and notifications
- Drizzle ORM over PostgreSQL
- Redis for counters, fan-out, caching, and fast analytics support
- Sharp and FFmpeg for media processing
- behavioral analytics ingestion tied directly to feed logic

This stack is not interesting because it is fashionable. It is interesting because it is coherent for the problem and the operating budget.

## Engineering Philosophy

The codebase reflects a specific philosophy:

- prefer systems that can be understood end-to-end
- prefer ranking logic that can be inspected and tuned
- prefer infrastructure that can be run cheaply
- prefer product decisions shaped by behavior, not by generic platform templates
- prefer practical hardening over fake enterprise ceremony

That philosophy is visible across the repo:

- feed formulas are documented
- direct-message architecture is documented
- deployment and configuration are documented
- security tradeoffs are explicit

## What This Repo Is Not

To frame it correctly:

- it is not internet-scale
- it is not a toy
- it is not only a UI demo
- it is not a generic "AI wrapper"
- it is not a cloud-credits vanity architecture

It is an early but real social system.

## Best Reading Order

If you want the fastest route through the repository:

1. Read [README.md](/Users/k/Desktop/social/README.md) for setup, structure, and runtime expectations.
2. Read [docs/for-you-feed-math.md](/Users/k/Desktop/social/docs/for-you-feed-math.md) for the ranking model.
3. Read [docs/direct-messaging-README.md](/Users/k/Desktop/social/docs/direct-messaging-README.md) for the messaging architecture.
4. Read [docs/configuration.md](/Users/k/Desktop/social/docs/configuration.md) and [docs/deployment.md](/Users/k/Desktop/social/docs/deployment.md) for operating details.

## Final Framing

Club Threads should be read as a product-shaped codebase built under real constraints.

It already has:

- real users
- real content
- real telemetry
- real ranking pressure
- real operational limits

That combination is what gives this repository its value.
