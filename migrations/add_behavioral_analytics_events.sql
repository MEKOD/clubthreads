CREATE TABLE IF NOT EXISTS behavioral_analytics_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    event_type varchar(32) NOT NULL,
    surface varchar(80) NOT NULL,
    entity_type varchar(32),
    entity_id varchar(160),
    session_id varchar(80),
    dwell_ms integer,
    search_query varchar(160),
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS behavioral_analytics_events_user_occurred_at_idx
    ON behavioral_analytics_events (user_id, occurred_at);

CREATE INDEX IF NOT EXISTS behavioral_analytics_events_event_occurred_at_idx
    ON behavioral_analytics_events (event_type, occurred_at);

CREATE INDEX IF NOT EXISTS behavioral_analytics_events_entity_occurred_at_idx
    ON behavioral_analytics_events (entity_type, entity_id, occurred_at);

CREATE INDEX IF NOT EXISTS behavioral_analytics_events_session_occurred_at_idx
    ON behavioral_analytics_events (session_id, occurred_at);

CREATE INDEX IF NOT EXISTS behavioral_analytics_events_search_occurred_at_idx
    ON behavioral_analytics_events (search_query, occurred_at);
