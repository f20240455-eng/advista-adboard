// SQLite storage layer. The database file lives in DATA_DIR when set (point this
// at a mounted Railway volume so data survives redeploys); otherwise it sits next
// to the app for local development.

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "advista.db");

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

// ---------- one-time seed ----------
// Seeds a verified house account and starter inventory so the marketplace isn't
// empty on first launch. Runs only when the users table is empty.
function seedIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) return;

  const now = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const houseId = "u-advista-media";
  db.prepare(
    `INSERT INTO users (id, name, email, role, salt, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    houseId,
    "AdVista Media (Verified)",
    "media@advista.in",
    "owner",
    salt,
    hashPassword(crypto.randomBytes(12).toString("hex"), salt),
    now
  );

  const listings = [
    ["NH-48 Fuel Station Unipole", "Gurugram", "NH-48, Km 42, beside IOCL fuel station", "Unipole", "40 x 20 ft", "North-bound traffic", 145000, 220000, 1, "Premium unipole at a busy IOCL pump on the Delhi–Jaipur highway. Long dwell time while vehicles refuel; visible from 300m on the carriageway.", "highway"],
    ["Cyber Hub Digital LED Wall", "Gurugram", "DLF Cyber Hub, main entrance plaza", "Digital LED", "24 x 12 ft", "Pedestrian plaza", 60000, 480000, 1, "4K LED wall at the entrance of Cyber Hub. 10-second slots in a 60-second loop, evening footfall of office crowd and diners.", "digital"],
    ["Mumbai–Pune Expressway Gantry", "Mumbai", "Expressway Km 18, before Khalapur toll", "Gantry", "60 x 15 ft", "Pune-bound traffic", 180000, 350000, 1, "Overhead gantry with unmissable placement before the toll plaza where traffic slows to a crawl. Highest read-time on the corridor.", "highway"],
    ["Andheri Metro Pillar Series", "Mumbai", "Andheri West, Metro pillars 214–222", "Metro Pillar", "8 pillars, 10 x 5 ft each", "Both carriageways", 95000, 160000, 0, "A run of 8 consecutive metro pillars for sequential storytelling creatives on a dense office corridor.", "urban"],
    ["Koramangala Mall Facade Wrap", "Bengaluru", "Forum Mall, 80 Feet Road facade", "Wall Wrap", "50 x 30 ft", "80 Feet Road junction", 110000, 300000, 1, "Full building wrap over the mall entrance at one of Bengaluru's busiest junctions. Weekend footfall skews young and high-spend.", "urban"],
    ["ORR Fuel Station Hoarding", "Bengaluru", "Outer Ring Road, HP petrol pump, Marathahalli", "Billboard", "30 x 15 ft", "Airport-bound traffic", 130000, 190000, 1, "Backlit hoarding inside a high-volume HP pump on ORR. Captive audience during refuelling plus full visibility from the service road.", "fuel"],
    ["Anna Salai Digital Billboard", "Chennai", "Anna Salai, opposite LIC building", "Digital LED", "20 x 10 ft", "Signal-stop traffic", 90000, 260000, 1, "Digital screen at a 90-second signal — guaranteed dwell time every cycle in Chennai's CBD.", "digital"],
    ["Balangir Sambalpur Road Hoarding", "Balangir", "NH-26, Madhiapali, near auto showroom cluster", "Billboard", "30 x 12 ft", "Sambalpur-bound traffic", 48000, 55000, 1, "High-visibility roadside hoarding on Balangir's main commercial artery, beside the car and two-wheeler showroom cluster. Strong for auto, jewellery and coaching brands.", "highway"],
  ];

  const insert = db.prepare(
    `INSERT INTO listings
       (id, owner_id, title, city, location, type, size, facing,
        traffic_per_day, price_per_month, lit, description, theme, created_at)
     VALUES (@id, @owner_id, @title, @city, @location, @type, @size, @facing,
        @traffic_per_day, @price_per_month, @lit, @description, @theme, @created_at)`
  );
  listings.forEach((l, i) => {
    insert.run({
      id: "l" + (i + 1),
      owner_id: houseId,
      title: l[0], city: l[1], location: l[2], type: l[3], size: l[4], facing: l[5],
      traffic_per_day: l[6], price_per_month: l[7], lit: l[8], description: l[9],
      theme: l[10], created_at: now,
    });
  });
}

seedIfEmpty();

module.exports = { db, hashPassword, listingToApi };
