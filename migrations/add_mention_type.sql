-- Migration: Add 'mention' to notification_type enum
-- Run this against the production database before deploying

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'mention';
