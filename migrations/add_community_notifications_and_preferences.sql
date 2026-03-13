ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'community_invite';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'community_join_request';
DO $$ BEGIN
    CREATE TYPE notification_action_status AS ENUM ('accepted', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS reject_community_invites boolean NOT NULL DEFAULT false;

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS community_id uuid REFERENCES communities(id) ON DELETE CASCADE;
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS action_status notification_action_status;
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
