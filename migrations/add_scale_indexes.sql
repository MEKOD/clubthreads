CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS post_communities_community_id_post_id_idx
ON post_communities (community_id, post_id);

CREATE INDEX IF NOT EXISTS posts_created_at_id_idx
ON posts (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS posts_parent_created_at_idx
ON posts (parent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS posts_trash_created_at_idx
ON posts (trash_count DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_created_at_idx
ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS users_username_prefix_idx
ON users (username varchar_pattern_ops);

CREATE INDEX IF NOT EXISTS posts_content_trgm_idx
ON posts
USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS communities_name_trgm_idx
ON communities
USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS communities_slug_trgm_idx
ON communities
USING gin (slug gin_trgm_ops);

CREATE INDEX IF NOT EXISTS communities_description_trgm_idx
ON communities
USING gin (description gin_trgm_ops);
