CREATE INDEX IF NOT EXISTS posts_user_created_at_idx
ON posts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS follows_follower_id_idx
ON follows (follower_id);

CREATE INDEX IF NOT EXISTS notifications_user_is_read_created_at_idx
ON notifications (user_id, is_read, created_at DESC);
