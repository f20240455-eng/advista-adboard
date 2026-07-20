// SQLite storage layer. The database file lives in DATA_DIR when set (point this
// at a mounted Railway volume so data survives redeploys); otherwise it sits next
// to the app for local development.

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "bookmyboard.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    role          TEXT NOT NULL,
    salt          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS listings (
    id             TEXT PRIMARY KEY,
    owner_id       TEXT NOT NULL REFERENCES users(id),
    title          TEXT NOT NULL,
    city           TEXT NOT NULL,
    location       TEXT NOT NULL,
    type           TEXT NOT NULL,
    size           TEXT NOT NULL,
    facing         TEXT,
    traffic_per_day INTEGER DEFAULT 0,
    price_per_month INTEGER NOT NULL,
    lit            INTEGER DEFAULT 0,
    description    TEXT,
    theme          TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id          TEXT PRIMARY KEY,
    listing_id  TEXT NOT NULL REFERENCES listings(id),
    client_id   TEXT NOT NULL REFERENCES users(id),
    start_date  TEXT NOT NULL,
    end_date    TEXT NOT NULL,
    message     TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  -- Short-lived CSRF state for the Google OAuth round trip.
  CREATE TABLE IF NOT EXISTS oauth_states (
    state      TEXT PRIMARY KEY,
    role       TEXT NOT NULL,
    next_url   TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  -- Supply-side partners: billboard fabricators, banner printers,
  -- digital-screen suppliers and installers.
  CREATE TABLE IF NOT EXISTS vendors (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    city        TEXT NOT NULL,
    description TEXT,
    phone       TEXT,
    min_price   INTEGER,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS service_requests (
    id           TEXT PRIMARY KEY,
    vendor_id    TEXT NOT NULL REFERENCES vendors(id),
    requester_id TEXT NOT NULL REFERENCES users(id),
    message      TEXT,
    status       TEXT NOT NULL DEFAULT 'open',
    created_at   TEXT NOT NULL
  );

  -- One row per single day an owner has manually taken off the calendar
  -- (maintenance, an offline deal, etc.) — separate from real bookings so
  -- owners can toggle it with one click without going through the booking flow.
  CREATE TABLE IF NOT EXISTS blocked_dates (
    id         TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    date       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(listing_id, date)
  );

  -- One row each time a user accepts a specific version of the legal policies.
  -- Keeps an auditable trail (who accepted which version, when) and lets a
  -- policy bump force re-acceptance. No IP is stored — invariant 7. The unique
  -- pair makes re-recording the same acceptance a harmless no-op.
  CREATE TABLE IF NOT EXISTS user_consents (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id),
    policy_version TEXT NOT NULL,
    accepted_at    TEXT NOT NULL,
    UNIQUE(user_id, policy_version)
  );

  -- Photos of the physical site an owner attaches when listing a space, so
  -- advertisers can see the actual location before booking. Same base64-in-
  -- SQLite approach as booking_photos (fine at MVP scale; object storage later).
  -- The sort column gives the owner control over which one is the cover image.
  CREATE TABLE IF NOT EXISTS listing_photos (
    id         TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    image_data TEXT NOT NULL,
    caption    TEXT,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_listing_photos_listing ON listing_photos(listing_id);

  -- Proof-of-play: mounting / monitoring photos an owner uploads against an
  -- approved booking so the advertiser can see the creative actually went up.
  CREATE TABLE IF NOT EXISTS booking_photos (
    id         TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL REFERENCES bookings(id),
    kind       TEXT NOT NULL DEFAULT 'mount',
    image_data TEXT NOT NULL,
    caption    TEXT,
    created_at TEXT NOT NULL
  );

  -- Demand we could not supply, stated in the visitor's own words. The search
  -- event log already records zero-result searches, but that only captures the
  -- filters someone happened to try. This is the explicit version: which city,
  -- which format, what budget, and — crucially — a way to reach them once we
  -- recruit an owner there. It is the recruiting list.
  CREATE TABLE IF NOT EXISTS space_requests (
    id         TEXT PRIMARY KEY,
    user_id    TEXT,
    city       TEXT NOT NULL,
    area       TEXT,
    type       TEXT,
    -- paise, integer, like all money in this schema
    max_budget INTEGER,
    contact    TEXT,
    notes      TEXT,
    status     TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_space_requests_time ON space_requests(created_at);

  -- Marketplace event log. This is the training set for future pricing and
  -- demand models, so the rules are deliberate:
  --
  --  * price_snapshot is the price AT THE MOMENT OF THE EVENT, copied in, not
  --    joined. An owner editing their price later must never silently rewrite
  --    history — that would corrupt every past observation.
  --  * No IP addresses and no cross-site identifiers. visitor_id is a rotating
  --    first-party id used only to group one person's session on this site.
  --  * NO foreign keys on purpose: analytics must never block or fail a
  --    product write, and events outlive the rows they reference (a deleted
  --    listing's history is still valid training data).
  CREATE TABLE IF NOT EXISTS events (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    visitor_id     TEXT,
    user_id        TEXT,
    user_role      TEXT,
    listing_id     TEXT,
    booking_id     TEXT,
    -- rupees, integer, frozen at event time
    price_snapshot INTEGER,
    -- JSON blob for event-specific fields (filters used, days, outcome, …)
    props          TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_events_name_time ON events(name, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_listing ON events(listing_id);
  CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(visitor_id);
`);

// ---------- migrations ----------
// Adds columns to existing databases without destroying data.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("users", "google_id", "TEXT");
// Marks an operator account that can reach the private admin console. Set from
// ADMIN_EMAILS on login — there is deliberately no public way to become admin.
ensureColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
// Money is stored in paise (integer) to avoid floating-point drift.
ensureColumn("bookings", "amount_total", "INTEGER");
ensureColumn("bookings", "platform_fee", "INTEGER");
ensureColumn("bookings", "owner_payout", "INTEGER");
ensureColumn("bookings", "payment_status", "TEXT NOT NULL DEFAULT 'unpaid'");
ensureColumn("bookings", "payment_order_id", "TEXT");
ensureColumn("bookings", "payment_id", "TEXT");
// When we've manually transferred the owner's share (total minus commission) to
// their bank. Owner payouts are off-platform for now; this is the ledger flag.
ensureColumn("bookings", "paid_out_at", "TEXT");
// Set when a paid booking is refunded via Razorpay. payment_status then becomes
// 'refunded' and status 'cancelled', so it drops out of the revenue/payout math.
ensureColumn("bookings", "refund_id", "TEXT");
ensureColumn("bookings", "refunded_at", "TEXT");

function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString("hex");
}

// ---------- legal policy versioning ----------
// Bumping this string is how we "push" updated Terms/Privacy to everyone: every
// existing user then has no consent row at the new version, so the re-consent
// gate (shared.js) blocks the app for them until they accept. Use a date so the
// version is self-describing in the audit trail. Keep it in sync with the
// "Last updated" line shown on the policy pages.
const POLICY_VERSION = "2026-07-17";

// A user must accept the current policy version before using the app. A brand
// new Google user (auto-created at OAuth callback) and every pre-existing user
// both land here with no matching row, so both get prompted — no separate path.
function userNeedsConsent(userId) {
  return !db
    .prepare("SELECT 1 FROM user_consents WHERE user_id = ? AND policy_version = ?")
    .get(userId, POLICY_VERSION);
}

// Idempotent: the UNIQUE(user_id, policy_version) pair means recording the same
// acceptance twice (e.g. register + a later gate) quietly does nothing.
function recordConsent(userId) {
  db.prepare(
    `INSERT OR IGNORE INTO user_consents (id, user_id, policy_version, accepted_at)
     VALUES (?, ?, ?, ?)`
  ).run(
    "c-" + crypto.randomBytes(8).toString("hex"),
    userId,
    POLICY_VERSION,
    new Date().toISOString()
  );
}

// Convert a listings row (snake_case, integer booleans) to the API shape.
function listingToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    city: row.city,
    location: row.location,
    type: row.type,
    size: row.size,
    facing: row.facing || "",
    trafficPerDay: row.traffic_per_day,
    pricePerMonth: row.price_per_month,
    lit: !!row.lit,
    description: row.description || "",
    theme: row.theme,
  };
}

module.exports = {
  db,
  hashPassword,
  listingToApi,
  POLICY_VERSION,
  userNeedsConsent,
  recordConsent,
};
