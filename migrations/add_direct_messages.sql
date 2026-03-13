CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS direct_threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_a_last_read_at timestamptz NOT NULL DEFAULT now(),
    user_b_last_read_at timestamptz NOT NULL DEFAULT now(),
    last_message_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT direct_threads_distinct_users_chk CHECK (user_a_id <> user_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS direct_threads_pair_unique_idx
ON direct_threads (user_a_id, user_b_id);

CREATE INDEX IF NOT EXISTS direct_threads_user_a_last_message_idx
ON direct_threads (user_a_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS direct_threads_user_b_last_message_idx
ON direct_threads (user_b_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS direct_threads_last_message_idx
ON direct_threads (last_message_at DESC);

CREATE TABLE IF NOT EXISTS direct_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES direct_threads(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS direct_messages_thread_created_at_idx
ON direct_messages (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS direct_messages_sender_created_at_idx
ON direct_messages (sender_id, created_at DESC);
