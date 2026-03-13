# For You Feed: Scoring Formulas

This document explains the scoring model used by `/Users/k/Desktop/social/src/services/forYouFeed.ts`.

The formulas below are an approximation of the current ranking logic. They are meant to help product, data, and engineering reason about the system, not to act as a strict source-of-truth implementation spec.

## 1. Affinity Score

Affinity measures how interested the viewer is in an author or related community. Most counters grow logarithmically so the score saturates instead of exploding.

```text
AffinityScore =
  8  * ln(author_dwell_seconds + 1)
  + 12 * ln(author_post_open_count + 1)
  + 10 * ln(author_profile_view_count + 1)
  + 6  * ln(community_view_count + 1)
  + 42 * author_reply_count
  + 18 * recently_followed_author
  + 10 * is_following_author
  + 8  * is_member_of_community
```

Interpretation:

- dwell time is the baseline interest signal
- replies are treated as especially strong intent
- follow state and recent follows add explicit preference
- community familiarity matters, but less than direct author intent

## 2. Viral Score

Viral score measures how well the post performs globally.

```text
ViralScore =
  2  * fav_count
  + 10 * reply_count
  - 2  * trash_count
  + 5  * (dwell_total_seconds / (impression_count + 1))
  + RelativePerformanceFactor
```

Where:

```text
RelativePerformanceFactor =
  ln(impression_count + 2) * (
    18 * open_count   / (impression_count + 5)
    + 20 * reply_count / (impression_count + 5)
    + 8  * share_count / (impression_count + 5)
    + 6  * repost_count / (impression_count + 5)
    - 14 * trash_count / (impression_count + 5)
  )
```

Why the `+5` denominator smoothing exists:

- it reduces instability for posts with very few impressions
- otherwise small early samples would overreact too strongly

## 3. Fatigue Penalty

Fatigue penalizes content the viewer keeps seeing without engaging with.

```text
FatiguePenalty =
  18 * ln(post_impression_count + 1)
  + 6  * ln(max(0, author_impressions - author_opens) + 1)
  + 10 * ln(max(0, thread_impressions - thread_opens) + 1)
  + ThreadPenalty
  + AuthorPenalty
```

Hard penalties:

- `ThreadPenalty = 18`
  - applied when the viewer repeatedly skips the same thread and spends less than ~3 seconds on it overall
- `AuthorPenalty = 14`
  - applied when the viewer sees an author multiple times, never opens, and spends very little time on that author's posts

## 4. Chaos Score

Chaos is a deliberate exploration mechanism. It makes room for high-signal unfamiliar content from outside the user's usual bubble.

```text
ChaosScore =
  if (
    author_not_followed
    and no_prior_affinity
    and no_prior_replies
    and post_is_root
  )
  then 15 * trash_count * (dwell_total_seconds / (impression_count + 1))
  else 0
```

This is intentionally not the dominant path for most posts. It is a side-channel for discovery.

## 5. Base Selection Score

Before the application layer does final reordering, the database-stage score combines affinity, virality, recency decay, and fatigue.

```text
BaseScore =
  (
    1.0 * AffinityScore
    + 0.8 * ViralScore
    - 2.0 * AgeHours
  ) * ReplyMultiplier
  - FatiguePenalty
```

Where:

- `AgeHours` is the post age in hours
- `ReplyMultiplier` slightly reduces the score of replies compared with root posts

## 6. Final Candidate Selection Score

The system then compares the normal path with the chaos path:

```text
SelectionScore = max(
  BaseScore,
  (1.5 * ChaosScore) - (0.55 * FatiguePenalty)
)
```

Interpretation:

- most posts win through `BaseScore`
- unfamiliar discovery content can still enter through `ChaosScore`
- fatigue still suppresses repeated low-interest content

## 7. Application-Layer Author Diversification

After database scoring, the Node.js layer applies an author diversity penalty to avoid streaks from the same person.

```text
AdjustedScore =
  SelectionScore / ((1 + author_count_in_current_page * 0.9) ^ 1.35)
```

This does not redefine relevance. It only smooths the final ordering so the page feels less repetitive.

## 8. Tuning Levers

The main knobs product and data teams usually adjust are:

- affinity weight versus viral weight
- recency decay rate
- trash penalty strength
- reply bonuses
- chaos multiplier and slot count
- fatigue severity

## 9. Practical Reading Guide

When tuning:

- if the feed feels too familiar, raise exploration pressure carefully
- if the feed feels too random, reduce chaos and increase affinity weight
- if stale content survives too long, increase age decay
- if low-quality viral bait dominates, raise trash and fatigue penalties

The formulas are only part of the story. Data quality, candidate pool size, and analytics coverage matter just as much as coefficient choices.
