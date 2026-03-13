ALTER TABLE direct_messages
    ALTER COLUMN content DROP NOT NULL;

ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS media_url text,
    ADD COLUMN IF NOT EXISTS media_mime_type varchar(64);

ALTER TABLE direct_messages
    DROP CONSTRAINT IF EXISTS direct_messages_content_or_media_chk;

ALTER TABLE direct_messages
    ADD CONSTRAINT direct_messages_content_or_media_chk
    CHECK (
        NULLIF(btrim(COALESCE(content, '')), '') IS NOT NULL
        OR media_url IS NOT NULL
    );
