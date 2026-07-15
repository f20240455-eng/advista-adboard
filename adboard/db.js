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
// Money is stored in paise (integer) to avoid floating-point drift.
ensureColumn("bookings", "amount_total", "INTEGER");
ensureColumn("bookings", "platform_fee", "INTEGER");
ensureColumn("bookings", "owner_payout", "INTEGER");
ensureColumn("bookings", "payment_status", "TEXT NOT NULL DEFAULT 'unpaid'");
ensureColumn("bookings", "payment_order_id", "TEXT");
ensureColumn("bookings", "payment_id", "TEXT");

function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString("hex");
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

module.exports = { db, hashPassword, listingToApi };
