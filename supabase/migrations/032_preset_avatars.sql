-- Migration 032: Preset avatars for Commoners
-- Admin-defined avatars; Commoners choose from this list (no custom upload).
-- Nobles and Royals can upload custom photos.

-- ============================================================
-- 1. Create preset_avatars table
-- ============================================================
CREATE TABLE IF NOT EXISTS preset_avatars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sort_order INT NOT NULL DEFAULT 0,
    label TEXT,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE preset_avatars ENABLE ROW LEVEL SECURITY;

-- Anyone can read (for avatar picker)
CREATE POLICY "preset_avatars_select" ON preset_avatars
    FOR SELECT USING (true);

-- Only service_role can modify (admin page uses service_role)
CREATE POLICY "preset_avatars_service_role" ON preset_avatars
    FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_preset_avatars_sort ON preset_avatars(sort_order);

-- ============================================================
-- 2. Seed default preset avatars (placeholder URLs - admin can replace)
-- ============================================================
INSERT INTO preset_avatars (sort_order, label, image_url) VALUES
    (1, 'Meeple Blue', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Ccircle cx="32" cy="32" r="30" fill="%236366f1"/%3E%3Ccircle cx="28" cy="26" r="4" fill="white"/%3E%3Ccircle cx="36" cy="26" r="4" fill="white"/%3E%3Cpath d="M22 42 Q32 52 42 42" stroke="white" stroke-width="2" fill="none"/%3E%3C/svg%3E'),
    (2, 'Meeple Gold', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Ccircle cx="32" cy="32" r="30" fill="%23ffd700"/%3E%3Ccircle cx="28" cy="26" r="4" fill="%23333"/%3E%3Ccircle cx="36" cy="26" r="4" fill="%23333"/%3E%3Cpath d="M22 42 Q32 52 42 42" stroke="%23333" stroke-width="2" fill="none"/%3E%3C/svg%3E'),
    (3, 'Meeple Green', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Ccircle cx="32" cy="32" r="30" fill="%2310b981"/%3E%3Ccircle cx="28" cy="26" r="4" fill="white"/%3E%3Ccircle cx="36" cy="26" r="4" fill="white"/%3E%3Cpath d="M22 42 Q32 52 42 42" stroke="white" stroke-width="2" fill="none"/%3E%3C/svg%3E'),
    (4, 'Meeple Red', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Ccircle cx="32" cy="32" r="30" fill="%23ef4444"/%3E%3Ccircle cx="28" cy="26" r="4" fill="white"/%3E%3Ccircle cx="36" cy="26" r="4" fill="white"/%3E%3Cpath d="M22 42 Q32 52 42 42" stroke="white" stroke-width="2" fill="none"/%3E%3C/svg%3E'),
    (5, 'Meeple Purple', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Ccircle cx="32" cy="32" r="30" fill="%238b5cf6"/%3E%3Ccircle cx="28" cy="26" r="4" fill="white"/%3E%3Ccircle cx="36" cy="26" r="4" fill="white"/%3E%3Cpath d="M22 42 Q32 52 42 42" stroke="white" stroke-width="2" fill="none"/%3E%3C/svg%3E');
