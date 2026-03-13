CREATE TABLE IF NOT EXISTS community_join_requests (
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS community_join_requests_user_id_idx
    ON community_join_requests (user_id);

CREATE TABLE IF NOT EXISTS community_invites (
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    invited_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    inviter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, invited_user_id)
);

CREATE INDEX IF NOT EXISTS community_invites_invited_user_id_idx
    ON community_invites (invited_user_id);
