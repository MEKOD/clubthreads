# For You Feed: Data Requirements for Tuning

This document describes the datasets needed to re-tune the current `for_you` ranking model.

## Goal

Use this when you want to:

- adjust ranking weights
- calibrate chaos-slot behavior
- compare quality versus latency trade-offs
- run offline evaluation against delivered impressions

## What matters most

The most useful inputs are not raw event dumps. The best starting point is:

1. viewer-author aggregates
2. post aggregates
3. impression outcome data

Raw events are a fallback only when aggregate exports are unavailable.

## Required Datasets

### 1. Viewer-author aggregate

Each row should represent a `viewer_id + author_id` pair.

Required columns:

- `viewer_id`
- `author_id`
- `window_start`
- `window_end`
- `author_dwell_seconds`
- `author_reply_count`
- `is_following`

Helpful optional columns:

- `author_profile_view_count`
- `author_like_count`
- `author_trash_count`

Why it matters:

- `author_dwell_seconds` is the core affinity signal
- `author_reply_count` is one of the strongest "familiarity" signals
- `is_following` is a high-value binary feature

### 2. Post aggregate

Each row should represent a single `post_id`.

Required columns:

- `post_id`
- `author_id`
- `created_at`
- `fav_count`
- `trash_count`
- `reply_count`
- `rt_count`
- `impression_count`
- `dwell_total_seconds`

Helpful optional columns:

- `open_count`
- `community_id`
- `is_private_community`

Why it matters:

- it captures the post-level viral and quality signals used by the ranker

### 3. Delivery or outcome dataset

This is the most important dataset for serious weight tuning. Each row should represent one delivered impression.

Required columns:

- `viewer_id`
- `post_id`
- `author_id`
- `served_at`
- `position`
- `surface`
- `feed_mode`
- `clicked_open`
- `dwell_ms_after_impression`
- `liked`
- `trashed`
- `replied`
- `followed_author_after_view`

Without this dataset, tuning is mostly heuristic.

## Preferred File Formats

Order of preference:

1. Parquet
2. `CSV.gz`
3. `NDJSON.gz`

For larger exports, keep datasets separate:

- `viewer_author_agg.parquet`
- `post_agg.parquet`
- `delivery_outcomes.parquet`

## Recommended Time Windows

Use:

- minimum: last 14 days
- better: last 30 days
- best: last 60 to 90 days

Avoid mixing very old product behavior with very new behavior if the ranking surface changed significantly during the export window.

## Data Quality Rules

Before sharing or consuming an export, validate:

- `impression_count >= 0`
- `dwell_total_seconds >= 0`
- `created_at` is not null
- no duplicate `post_id` rows in post aggregates
- no duplicate `viewer_id + author_id` rows in viewer-author aggregates
- all timestamps use a single timezone, ideally UTC

## Anonymization

You can hash these identifiers if needed:

- `viewer_id`
- `author_id`
- `post_id`
- `community_id`

Important:

- hashing must be stable across all files
- otherwise cross-dataset joins will break

## What can be tuned with these datasets

Examples:

- affinity versus viral weight balance
- recency decay strength
- trash penalty strength
- chaos threshold and slot count
- dwell-based quality contribution
- reply and follow bonus scaling

## Raw Event Fallback

If aggregates are not available, request raw analytics events for at least:

- `post_impression`
- `post_dwell`
- `post_open`
- `profile_view`
- `follow`

And join them with relevant post metadata such as:

- `id`
- `user_id`
- `parent_id`
- `created_at`
- `fav_count`
- `trash_count`
- `reply_count`

Raw exports are more expensive and harder to work with, so they should not be the default ask.

## Copy-paste Request Template

You can send the following to a data or infra owner:

`We need a 30-60 day export for For You feed tuning: viewer-author aggregates, post aggregates, and impression outcome data. Parquet is preferred. The required columns are documented in docs/for-you-feed-data-README.md.`
