CREATE TABLE IF NOT EXISTS blocks (
    blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS blocks_blocker_id_idx
ON blocks (blocker_id);

CREATE INDEX IF NOT EXISTS blocks_blocked_id_idx
ON blocks (blocked_id);
