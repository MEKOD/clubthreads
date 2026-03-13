CREATE TABLE IF NOT EXISTS community_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    title varchar(120) NOT NULL,
    description text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_rules_community_sort_idx
    ON community_rules (community_id, sort_order);
