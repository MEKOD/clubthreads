ALTER TABLE posts
ADD COLUMN IF NOT EXISTS link_preview_url text,
ADD COLUMN IF NOT EXISTS link_preview_title text,
ADD COLUMN IF NOT EXISTS link_preview_description text,
ADD COLUMN IF NOT EXISTS link_preview_image_url text,
ADD COLUMN IF NOT EXISTS link_preview_site_name varchar(128);
