-- ─────────────────────────────────────────────
--  Breach App – PostgreSQL Schema
-- ─────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(120) NOT NULL,
  email       VARCHAR(255) UNIQUE NOT NULL,
  password    TEXT,                          -- NULL for OAuth-only accounts
  google_id   VARCHAR(255) UNIQUE,
  avatar_url  TEXT,
  upi_id      VARCHAR(120),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Groups table
CREATE TABLE IF NOT EXISTS groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(120) NOT NULL,
  description TEXT,
  currency    VARCHAR(10) DEFAULT 'INR',
  cover_url   TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Group members (many-to-many)
CREATE TABLE IF NOT EXISTS group_members (
  group_id    UUID REFERENCES groups(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(20) DEFAULT 'member',  -- 'admin' | 'member'
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

-- Expenses table
CREATE TABLE IF NOT EXISTS expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID REFERENCES groups(id) ON DELETE CASCADE,
  title       VARCHAR(255) NOT NULL,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category    VARCHAR(60) DEFAULT 'General',
  paid_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  split_method VARCHAR(20) DEFAULT 'equal',   -- 'equal' | 'percentage' | 'custom'
  date        DATE DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Expense splits – one row per participant per expense
-- Stores the exact amount each person owes for this expense
CREATE TABLE IF NOT EXISTS expense_splits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  UUID REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  share       NUMERIC(12,2) NOT NULL,   -- amount this user owes for the expense
  percentage  NUMERIC(6,2),            -- only set when split_method = 'percentage'
  UNIQUE (expense_id, user_id)
);

-- Settlements table
CREATE TABLE IF NOT EXISTS settlements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID REFERENCES groups(id) ON DELETE CASCADE,
  from_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  to_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method        VARCHAR(30) DEFAULT 'cash',  -- 'upi' | 'cash' | 'card' | 'qr'
  status        VARCHAR(20) DEFAULT 'pending', -- 'pending' | 'completed'
  settled_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
