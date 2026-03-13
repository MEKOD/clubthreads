ALTER TABLE direct_messages
    DROP CONSTRAINT IF EXISTS direct_messages_content_or_media_chk;

ALTER TABLE direct_messages
    ADD CONSTRAINT direct_messages_content_or_media_chk
    CHECK (
        NULLIF(btrim(COALESCE(content, '')), '') IS NOT NULL
        OR media_url IS NOT NULL
        OR encrypted_payload IS NOT NULL
    );
