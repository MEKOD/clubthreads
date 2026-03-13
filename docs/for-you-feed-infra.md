# For You Feed: Rollout and Operations

This document covers rollout, migration, and operational expectations for the personalized `for_you` feed.

## Overview

- the home experience can use `for_you` as the default feed
- backend endpoint: `GET /feed?mode=for_you&limit=30&offset=0`
- authentication is required
- ranking is computed in PostgreSQL and finalized in application code
- the backend injects a small amount of controlled "chaos" content into fixed slots

## Relevant Code

- route: `/Users/k/Desktop/social/src/routes/feed.ts`
- ranking service: `/Users/k/Desktop/social/src/services/forYouFeed.ts`
- analytics schema: `/Users/k/Desktop/social/src/db/schema.ts`
- supporting migration: `/Users/k/Desktop/social/migrations/add_for_you_feed_indexes.sql`

## Live Inputs Used by Ranking

Tables and signals:

- `posts`
- `follows`
- `blocks`
- `post_communities`
- `community_members`
- `behavioral_analytics_events`
- `interactions`

Important analytics events:

- `post_impression`
- `post_dwell`
- `post_open`
- `profile_view`
- `follow`

Important application signals:

- viewer-to-author dwell time
- viewer-to-author reply count
- follow state
- post-level favorites, trash, reply, repost, and age signals

## Rollout Checklist

1. Deploy the backend code that includes the `for_you` route and ranking service.
2. Apply the required indexes in `/Users/k/Desktop/social/migrations/add_for_you_feed_indexes.sql`.
3. Run `ANALYZE behavioral_analytics_events;` after the migration.
4. Restart backend instances so new query plans and config are active.
5. Smoke-test with an authenticated user:
   - `GET /feed?mode=for_you&limit=10`
6. Verify the frontend tab order and default home behavior match product expectations.

## Migration Notes

The feed relies on analytics indexes for acceptable performance. The migration adds indexes that support:

- user + event + entity lookups
- entity + event + time lookups

Without these indexes, ranking quality may still be correct but latency will degrade quickly as analytics volume grows.

## Expected Runtime Behavior

- unauthenticated users receive `401` for `mode=for_you`
- latest and trash feeds continue to behave independently
- the old "popular home tab" behavior is not the primary default anymore
- right-rail discovery is still driven by separate trending endpoints

## Query Characteristics

At a high level the feed:

- considers recent root posts as the candidate pool
- computes viewer-author affinity from recent engagement
- computes post-level viral performance from aggregate signals
- applies recency decay and fatigue penalties
- reranks a larger pool than the final page size
- injects a limited number of non-obvious "chaos" posts into fixed slots

Pool sizing is dynamic:

- lower bound: `80`
- upper bound: `250`

This gives the reranker enough headroom even when paginating.

## Operational Checks

Watch these during rollout:

- p95 and p99 latency for `GET /feed?mode=for_you`
- `behavioral_analytics_events` table size and vacuum health
- event volume for `post_impression` and `post_dwell`
- database execution plans after schema changes
- percentage of `401` responses on `for_you` requests

Recommended checks:

- `EXPLAIN (ANALYZE, BUFFERS)` on the live ranking query
- table bloat and autovacuum lag
- daily analytics ingestion volume
- impression-to-dwell ratios by release

## Failure Modes

### The feed is empty

Check:

- the caller is authenticated
- there are recent eligible root posts
- block filters are not excluding most candidates
- private-community visibility rules are not narrowing the pool too far

### The feed is slow

Check:

- whether the analytics indexes were applied
- whether `ANALYZE behavioral_analytics_events` was run
- whether autovacuum is behind
- whether the analytics table has grown beyond previous expectations

### The feed quality is weak

Check:

- whether `post_impression` is actually being recorded
- whether `post_dwell` is flushed reliably
- whether there is enough recent engagement per user
- whether the candidate pool is too small for the current content volume

## Scale Notes

The current version does not use precomputed aggregate tables. If traffic grows materially, likely next steps are:

- viewer-author affinity aggregate tables
- post-behavior aggregate tables
- scheduled refresh or streaming aggregation
- tighter cache strategy around candidate generation
