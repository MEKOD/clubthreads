ALTER TABLE direct_threads
    ADD COLUMN IF NOT EXISTS user_a_last_delivered_sequence integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS user_b_last_delivered_sequence integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS user_a_last_seen_sequence integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS user_b_last_seen_sequence integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_sequence integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS last_message_sequence integer NOT NULL DEFAULT 0;

ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS sequence integer;

WITH sequenced_messages AS (
    SELECT
        dm.id,
        ROW_NUMBER() OVER (
            PARTITION BY dm.thread_id
            ORDER BY dm.created_at ASC, dm.id ASC
        )::int AS sequence
    FROM direct_messages dm
)
UPDATE direct_messages dm
SET sequence = sequenced_messages.sequence
FROM sequenced_messages
WHERE sequenced_messages.id = dm.id
  AND dm.sequence IS NULL;

ALTER TABLE direct_messages
    ALTER COLUMN sequence SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS direct_messages_thread_sequence_unique_idx
ON direct_messages (thread_id, sequence);

WITH thread_receipts AS (
    SELECT
        dt.id,
        COALESCE(MAX(dm.sequence), 0) AS last_message_sequence,
        COALESCE(MAX(dm.sequence), 0) + 1 AS next_sequence,
        COALESCE((
            SELECT MAX(dm_a.sequence)
            FROM direct_messages dm_a
            WHERE dm_a.thread_id = dt.id
              AND dm_a.created_at <= dt.user_a_last_read_at
        ), 0) AS user_a_last_seen_sequence,
        COALESCE((
            SELECT MAX(dm_b.sequence)
            FROM direct_messages dm_b
            WHERE dm_b.thread_id = dt.id
              AND dm_b.created_at <= dt.user_b_last_read_at
        ), 0) AS user_b_last_seen_sequence
    FROM direct_threads dt
    LEFT JOIN direct_messages dm ON dm.thread_id = dt.id
    GROUP BY dt.id, dt.user_a_last_read_at, dt.user_b_last_read_at
)
UPDATE direct_threads dt
SET
    next_sequence = thread_receipts.next_sequence,
    last_message_sequence = thread_receipts.last_message_sequence,
    user_a_last_seen_sequence = thread_receipts.user_a_last_seen_sequence,
    user_b_last_seen_sequence = thread_receipts.user_b_last_seen_sequence,
    user_a_last_delivered_sequence = GREATEST(dt.user_a_last_delivered_sequence, thread_receipts.user_a_last_seen_sequence),
    user_b_last_delivered_sequence = GREATEST(dt.user_b_last_delivered_sequence, thread_receipts.user_b_last_seen_sequence)
FROM thread_receipts
WHERE thread_receipts.id = dt.id;
