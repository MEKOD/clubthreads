ALTER TABLE users
    ADD COLUMN IF NOT EXISTS dm_crypto jsonb;

ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS encrypted_payload jsonb;
