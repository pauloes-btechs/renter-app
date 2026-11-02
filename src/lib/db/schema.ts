/**
 * SQLite schema (portable to PostgreSQL — see README "Moving to Postgres/Supabase").
 * Money: integer cents. Fractions: integer basis points. Weights: integer thousandths.
 */
export const MIGRATIONS: string[] = [
  /* 1 — initial */ `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

-- Personal sign-in links (one per device hand-off). Hash only; raw token shown once.
CREATE TABLE access_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  source_kind TEXT NOT NULL DEFAULT 'manual' CHECK (source_kind IN ('manual','listing_url','import')),
  listing_url TEXT,
  shared_amenities_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE property_cost_items (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'base' CHECK (kind IN ('base','cleaning','tax','service','other')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  bed_config TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL CHECK (capacity >= 1),
  bed_count INTEGER NOT NULL CHECK (bed_count >= 1),
  has_bunk INTEGER NOT NULL DEFAULT 0,
  accessible INTEGER NOT NULL DEFAULT 0,
  weight_milli INTEGER NOT NULL CHECK (weight_milli >= 0),
  quality_rating INTEGER NOT NULL DEFAULT 3 CHECK (quality_rating BETWEEN 1 AND 5),
  attributes_json TEXT NOT NULL,
  image_key TEXT NOT NULL DEFAULT 'generic',
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE room_amenities (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'dot',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE stays (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  check_in TEXT,
  check_out TEXT
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  stay_id TEXT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  organizer_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','collecting','ready','proposed','voting','approved','finalized')),
  max_parties INTEGER NOT NULL CHECK (max_parties >= 1),
  max_party_size INTEGER NOT NULL CHECK (max_party_size >= 1),
  approval_policy TEXT NOT NULL DEFAULT 'unanimous' CHECK (approval_policy IN ('unanimous','majority')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE pricing_configurations (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
  shared_bps INTEGER NOT NULL CHECK (shared_bps BETWEEN 0 AND 10000),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE parties (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  slot_label TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  representative_user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','active','left')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX parties_group ON parties(group_id);

CREATE TABLE party_memberships (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('representative','member')),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  left_at TEXT
);
-- A person can be in only one active party per group.
CREATE UNIQUE INDEX membership_one_party_per_group ON party_memberships(group_id, user_id) WHERE left_at IS NULL;

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  party_id TEXT REFERENCES parties(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  token_enc TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE questionnaires (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  shared_at TEXT,
  UNIQUE (party_id, user_id)
);

CREATE TABLE party_preferences (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL UNIQUE REFERENCES parties(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL,
  finalized_by TEXT NOT NULL REFERENCES users(id),
  finalized_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE proposal_versions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  inputs_hash TEXT NOT NULL,
  inputs_snapshot_json TEXT NOT NULL,
  engine TEXT NOT NULL,
  feasible_count INTEGER NOT NULL,
  diagnosis_json TEXT,
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','stale','superseded')),
  stale_reason TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (group_id, version_no)
);

CREATE TABLE allocation_proposals (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES proposal_versions(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  label TEXT NOT NULL,
  strategies_json TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  explanation_json TEXT NOT NULL,
  is_selected INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE room_assignments (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES allocation_proposals(id) ON DELETE CASCADE,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  UNIQUE (proposal_id, party_id),
  UNIQUE (proposal_id, room_id)
);

CREATE TABLE cost_breakdowns (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES allocation_proposals(id) ON DELETE CASCADE,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  party_size INTEGER NOT NULL,
  shared_cents INTEGER NOT NULL,
  room_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  per_person_json TEXT NOT NULL,
  share_bps INTEGER NOT NULL,
  rank_position INTEGER NOT NULL,
  satisfaction REAL NOT NULL,
  fit REAL NOT NULL,
  afford REAL NOT NULL,
  UNIQUE (proposal_id, party_id)
);

CREATE TABLE votes (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES allocation_proposals(id) ON DELETE CASCADE,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve','request_changes')),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  invalidated_at TEXT,
  invalidated_reason TEXT
);
-- One live vote per party per proposal (concurrency-safe upsert target).
CREATE UNIQUE INDEX votes_one_active ON votes(proposal_id, party_id) WHERE invalidated_at IS NULL;

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  party_id TEXT REFERENCES parties(id) ON DELETE SET NULL,
  proposal_id TEXT REFERENCES allocation_proposals(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE agreements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  proposal_id TEXT NOT NULL REFERENCES allocation_proposals(id),
  snapshot_json TEXT NOT NULL,
  finalized_by TEXT NOT NULL REFERENCES users(id),
  finalized_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT
);

-- Payment-ready ledger: one obligation per party on finalization. No payments processed in v1.
CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  party_id TEXT NOT NULL REFERENCES parties(id),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'owed' CHECK (status IN ('owed','paid','void')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX activity_group ON activity_events(group_id, created_at);
`,
  /* 2 — auction / price discovery */ `
ALTER TABLE pricing_configurations ADD COLUMN method TEXT NOT NULL DEFAULT 'weighted' CHECK (method IN ('weighted','hybrid','auction'));
ALTER TABLE proposal_versions ADD COLUMN auction_json TEXT;
`,
  /* 3 — listing import: per-room photo */ `
ALTER TABLE rooms ADD COLUMN photo_data TEXT;
`,
];
