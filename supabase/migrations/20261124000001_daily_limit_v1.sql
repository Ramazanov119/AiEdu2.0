-- Add daily_limit_v1 column to profiles for AiEdu 1.0 limit
ALTER TABLE IF EXISTS profiles
  ADD COLUMN IF NOT EXISTS daily_limit_v1 integer DEFAULT 20 CHECK(daily_limit_v1 IS NULL OR daily_limit_v1 >= 0);
