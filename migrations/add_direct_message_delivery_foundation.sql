ALTER TABLE direct_threads
    ADD COLUMN IF NOT EXISTS user_a_unread_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS user_b_unread_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_message_id uuid;

ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS client_message_id varchar(64);

CREATE INDEX IF NOT EXISTS direct_threads_last_message_id_idx
ON direct_threads (last_message_id);

CREATE UNIQUE INDEX IF NOT EXISTS direct_messages_idempotency_idx
ON direct_messages (thread_id, sender_id, client_message_id);

WITH thread_stats AS (
    SELECT
        dt.id,
        (
            SELECT dm.id
            FROM direct_messages dm
            WHERE dm.thread_id = dt.id
            ORDER BY dm.created_at DESC, dm.id DESC
            LIMIT 1
        ) AS last_message_id,
        (
            SELECT COUNT(*)::int
            FROM direct_messages dm
            WHERE dm.thread_id = dt.id
              AND dm.sender_id <> dt.user_a_id
              AND dm.created_at > dt.user_a_last_read_at
        ) AS user_a_unread_count,
        (
            SELECT COUNT(*)::int
            FROM direct_messages dm
            WHERE dm.thread_id = dt.id
              AND dm.sender_id <> dt.user_b_id
              AND dm.created_at > dt.user_b_last_read_at
        ) AS user_b_unread_count
    FROM direct_threads dt
)
UPDATE direct_threads dt
SET
    last_message_id = thread_stats.last_message_id,
    user_a_unread_count = thread_stats.user_a_unread_count,
    user_b_unread_count = thread_stats.user_b_unread_count
FROM thread_stats
WHERE thread_stats.id = dt.id;
