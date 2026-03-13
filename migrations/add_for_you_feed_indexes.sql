CREATE INDEX IF NOT EXISTS behavioral_analytics_events_user_event_entity_occurred_at_idx
    ON behavioral_analytics_events (user_id, event_type, entity_type, entity_id, occurred_at);

CREATE INDEX IF NOT EXISTS behavioral_analytics_events_entity_event_occurred_at_idx
    ON behavioral_analytics_events (entity_type, event_type, entity_id, occurred_at);
