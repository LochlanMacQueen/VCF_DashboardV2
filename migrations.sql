-- VCF Dashboard V2.0 Database Migrations
-- Run these in your Supabase SQL Editor

-- ============================================
-- PHASE 1: ALTER EXISTING TABLES
-- ============================================

-- Add role and profile picture to accounts
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'investor',
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- Add purchase date to holdings
ALTER TABLE holdings
ADD COLUMN IF NOT EXISTS purchase_date DATE;

-- ============================================
-- PHASE 2: CREATE NEW TABLES
-- ============================================

-- Meetings table
CREATE TABLE IF NOT EXISTS meetings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    date DATE NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    presentation_links TEXT[], -- Array of URLs
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pitches table
CREATE TABLE IF NOT EXISTS pitches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ticker TEXT NOT NULL,
    pitched_by TEXT NOT NULL,
    pitch_date DATE NOT NULL,
    summary TEXT,
    slideshow_url TEXT,
    thesis TEXT,
    sector TEXT,
    status TEXT DEFAULT 'pending', -- pending, approved, rejected
    voting_open BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Votes table
CREATE TABLE IF NOT EXISTS votes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    pitch_id UUID REFERENCES pitches(id) ON DELETE CASCADE,
    voter_user_id UUID REFERENCES auth.users(id),
    voter_name TEXT NOT NULL,
    vote_type TEXT NOT NULL CHECK (vote_type IN ('yes', 'no', 'abstain')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(pitch_id, voter_user_id) -- One vote per user per pitch
);

-- Resources table
CREATE TABLE IF NOT EXISTS resources (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    category TEXT NOT NULL, -- e.g., 'Valuation', 'Technical Analysis', 'Fundamentals'
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Benchmark data table
CREATE TABLE IF NOT EXISTS benchmark_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    sp500_close DECIMAL(10, 2),
    fund_nav DECIMAL(10, 4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- PHASE 3: ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitches ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmark_data ENABLE ROW LEVEL SECURITY;

-- Accounts policies
CREATE POLICY "Users can view all accounts" ON accounts
    FOR SELECT USING (true);

CREATE POLICY "Admins can update accounts" ON accounts
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM accounts
            WHERE owner_user_id = auth.uid()
            AND role = 'admin'
        )
    );

CREATE POLICY "Admins can insert accounts" ON accounts
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM accounts
            WHERE owner_user_id = auth.uid()
            AND role = 'admin'
        )
    );

-- Users can update their own profile picture
CREATE POLICY "Users can update own profile picture" ON accounts
    FOR UPDATE USING (owner_user_id = auth.uid())
    WITH CHECK (owner_user_id = auth.uid());

-- Holdings policies
CREATE POLICY "Authenticated users can view holdings" ON holdings
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage holdings" ON holdings
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM accounts
            WHERE owner_user_id = auth.uid()
            AND role = 'admin'
        )
    );

-- Meetings policies
CREATE POLICY "Members and admins can view meetings" ON meetings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM accounts
            WHERE owner_user_id = auth.uid()
            AND role IN ('member', 'admin')
        )
    );

CREATE POLICY "Admins can manage meetings" ON meetings
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM accounts
            WHERE owner_user_id = auth.uid()
            AND role = 'admin'
        )
    );

-- Pitches policies
CREATE POLICY "Members and admins can view pitches" ON pitches
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM accounts
            WHERE owner_user_id = auth.uid()
            AND role IN ('member', 'admin')
        )
    );

CREATE POLICY "Admins can manage pitches" ON pitches
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM accounts
            WHERE owner_user_id = auth.uid()
            AND role = 'admin'
        )
    );

-- Votes policies
CREATE POLICY "Members and admins can view votes" ON votes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM accounts
            WHERE owner_user_id = auth.uid()
            AND role IN ('member', 'admin')
        )
    );

CREATE POLICY "Eligible users can cast votes" ON votes
    FOR INSERT WITH CHECK (
        voter_user_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM accounts
            WHERE owner_user_id = auth.uid()
            AND role IN ('member', 'admin')
        )
    );

CREATE POLICY "Users can view own votes" ON votes
    FOR SELECT USING (voter_user_id = auth.uid());

-- Resources policies
CREATE POLICY "Members and admins can view resources" ON resources
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM accounts
            WHERE owner_user_id = auth.uid()
            AND role IN ('member', 'admin')
        )
    );

CREATE POLICY "Admins can manage resources" ON resources
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM accounts
            WHERE owner_user_id = auth.uid()
            AND role = 'admin'
        )
    );

-- Benchmark data policies
CREATE POLICY "All authenticated users can view benchmark data" ON benchmark_data
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage benchmark data" ON benchmark_data
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM accounts
            WHERE owner_user_id = auth.uid()
            AND role = 'admin'
        )
    );

-- ============================================
-- PHASE 4: STORAGE BUCKET (Run in Supabase Dashboard)
-- ============================================
--
-- Create bucket manually in Supabase Dashboard > Storage:
-- 1. Click "New bucket"
-- 2. Name: profile-pictures
-- 3. Public bucket: YES
-- 4. File size limit: 2MB (2097152 bytes)
-- 5. Allowed MIME types: image/jpeg, image/png
--
-- Then add these storage policies via SQL:

-- Storage policies for profile-pictures bucket
-- (Uncomment and run after creating the bucket)

 INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
 VALUES (
     'profile-pictures',
     'profile-pictures',
     true,
     2097152,
     ARRAY['image/jpeg', 'image/png']
 );

 CREATE POLICY "Users can upload own profile picture"
 ON storage.objects FOR INSERT
 WITH CHECK (
     bucket_id = 'profile-pictures' AND
     auth.uid()::text = (storage.foldername(name))[1]
 );

 CREATE POLICY "Users can update own profile picture"
 ON storage.objects FOR UPDATE
 USING (
     bucket_id = 'profile-pictures' AND
     auth.uid()::text = (storage.foldername(name))[1]
 );

 CREATE POLICY "Anyone can view profile pictures"
 ON storage.objects FOR SELECT
 USING (bucket_id = 'profile-pictures');

-- ============================================
-- OPTIONAL: SEED DATA FOR TESTING
-- ============================================

-- Update existing accounts to have roles (run once)
-- UPDATE accounts SET role = 'admin' WHERE name = 'Your Admin Name';
-- UPDATE accounts SET role = 'member' WHERE role IS NULL OR role = 'investor';

-- Sample meeting
-- INSERT INTO meetings (date, title, notes, presentation_links) VALUES
-- ('2024-01-15', 'Q1 Strategy Meeting', 'Discussed portfolio rebalancing and new sector allocations.', ARRAY['https://example.com/slides']);

-- Sample resource
-- INSERT INTO resources (title, url, category, description) VALUES
-- ('DCF Modeling Guide', 'https://example.com/dcf', 'Valuation', 'Comprehensive guide to discounted cash flow analysis');

-- Sample pitch
-- INSERT INTO pitches (ticker, pitched_by, pitch_date, summary, sector, status, voting_open) VALUES
-- ('AAPL', 'John Doe', '2024-01-20', 'Strong services growth and margin expansion', 'Technology', 'pending', true);
