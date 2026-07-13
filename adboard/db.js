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
`);

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
