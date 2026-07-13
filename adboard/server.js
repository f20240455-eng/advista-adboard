const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { db, hashPassword, listingToApi } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- helpers ----------

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const session = db.prepare("SELECT user_id FROM sessions WHERE token = ?").get(token);
  if (!session) return null;
  return db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) || null;
}

function startSession(res, userId) {
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(
    token,
    userId,
    new Date().toISOString()
  );
  res.setHeader("Set-Cookie", `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
}

function requireAuth(role) {
  return (req, res, next) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: "Please log in first." });
    if (role && user.role !== role)
      return res.status(403).json({ error: `Only ${role}s can do that.` });
    req.user = user;
    next();
  };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- auth ----------

app.post("/api/register", (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role)
    return res.status(400).json({ error: "All fields are required." });
  if (!["client", "owner"].includes(role))
    return res.status(400).json({ error: "Please choose whether you're advertising or listing a space." });
  if (String(password).length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  const emailNorm = String(email).trim().toLowerCase();
  const exists = db.prepare("SELECT 1 FROM users WHERE email = ?").get(emailNorm);
  if (exists)
    return res.status(409).json({ error: "An account with that email already exists." });

  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    id: "u-" + crypto.randomBytes(6).toString("hex"),
    name: String(name).trim(),
    email: emailNorm,
    role,
    salt,
    password_hash: hashPassword(password, salt),
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO users (id, name, email, role, salt, password_hash, created_at)
     VALUES (@id, @name, @email, @role, @salt, @password_hash, @created_at)`
  ).run(user);
  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(String(email || "").trim().toLowerCase());
  if (!user || hashPassword(password || "", user.salt) !== user.password_hash)
    return res.status(401).json({ error: "Invalid email or password." });
  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  const token = parseCookies(req).session;
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.setHeader("Set-Cookie", "session=; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

// ---------- listings ----------

app.get("/api/listings", (req, res) => {
  const { city, type, maxPrice, q } = req.query;
  const clauses = [];
  const params = {};
  if (city && city !== "all") { clauses.push("city = @city"); params.city = city; }
  if (type && type !== "all") { clauses.push("type = @type"); params.type = type; }
  if (maxPrice) { clauses.push("price_per_month <= @maxPrice"); params.maxPrice = Number(maxPrice); }
  if (q) {
    clauses.push("(LOWER(title || ' ' || location || ' ' || city || ' ' || type || ' ' || IFNULL(description,'')) LIKE @q)");
    params.q = "%" + String(q).toLowerCase() + "%";
  }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const rows = db.prepare(`SELECT * FROM listings ${where} ORDER BY created_at`).all(params);

  const all = db.prepare("SELECT DISTINCT city FROM listings ORDER BY city").all().map((r) => r.city);
  const types = db.prepare("SELECT DISTINCT type FROM listings ORDER BY type").all().map((r) => r.type);
  res.json({ listings: rows.map(listingToApi), cities: all, types });
});

app.get("/api/listings/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM listings WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Listing not found." });
  const owner = db.prepare("SELECT name FROM users WHERE id = ?").get(row.owner_id);
  const bookedRanges = db
    .prepare("SELECT start_date AS startDate, end_date AS endDate FROM bookings WHERE listing_id = ? AND status = 'approved'")
    .all(row.id);
  res.json({
    listing: listingToApi(row),
    ownerName: owner ? owner.name : "Unknown",
    bookedRanges,
  });
});

app.post("/api/listings", requireAuth("owner"), (req, res) => {
  const {
    title, city, location, type, size, facing,
    trafficPerDay, pricePerMonth, lit, description,
  } = req.body || {};
  if (!title || !city || !location || !type || !size || !pricePerMonth)
    return res.status(400).json({ error: "Title, city, location, type, size and price are required." });
  const themeByType = {
    "Digital LED": "digital", Unipole: "highway", Gantry: "highway",
    Billboard: "fuel", "Metro Pillar": "urban", "Wall Wrap": "urban",
  };
  const listing = {
    id: "l-" + crypto.randomBytes(6).toString("hex"),
    owner_id: req.user.id,
    title: String(title).trim(),
    city: String(city).trim(),
    location: String(location).trim(),
    type: String(type).trim(),
    size: String(size).trim(),
    facing: String(facing || "").trim(),
    traffic_per_day: Number(trafficPerDay) || 0,
    price_per_month: Number(pricePerMonth),
    lit: lit ? 1 : 0,
    description: String(description || "").trim(),
    theme: themeByType[type] || "urban",
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO listings
       (id, owner_id, title, city, location, type, size, facing,
        traffic_per_day, price_per_month, lit, description, theme, created_at)
     VALUES (@id, @owner_id, @title, @city, @location, @type, @size, @facing,
        @traffic_per_day, @price_per_month, @lit, @description, @theme, @created_at)`
  ).run(listing);
  res.status(201).json({ listing: listingToApi(listing) });
});

// ---------- bookings ----------

app.post("/api/bookings", requireAuth("client"), (req, res) => {
  const { listingId, startDate, endDate, message } = req.body || {};
  const listing = db.prepare("SELECT id FROM listings WHERE id = ?").get(listingId);
  if (!listing) return res.status(404).json({ error: "Listing not found." });
  if (!startDate || !endDate)
    return res.status(400).json({ error: "Start and end dates are required." });
  if (endDate < startDate)
    return res.status(400).json({ error: "End date must be after the start date." });

  const approved = db
    .prepare("SELECT start_date, end_date FROM bookings WHERE listing_id = ? AND status = 'approved'")
    .all(listingId);
  if (approved.some((b) => overlaps(startDate, endDate, b.start_date, b.end_date)))
    return res.status(409).json({ error: "That space is already booked for part of those dates." });

  const booking = {
    id: "b-" + crypto.randomBytes(6).toString("hex"),
    listing_id: listingId,
    client_id: req.user.id,
    start_date: startDate,
    end_date: endDate,
    message: String(message || "").trim(),
    status: "pending",
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO bookings (id, listing_id, client_id, start_date, end_date, message, status, created_at)
     VALUES (@id, @listing_id, @client_id, @start_date, @end_date, @message, @status, @created_at)`
  ).run(booking);
  res.status(201).json({ booking });
});

app.get("/api/bookings", requireAuth(), (req, res) => {
  let rows;
  if (req.user.role === "client") {
    rows = db
      .prepare(
        `SELECT b.*, l.title AS listingTitle, l.city AS listingCity, l.price_per_month AS pricePerMonth,
                u.name AS clientName
           FROM bookings b
           JOIN listings l ON l.id = b.listing_id
           JOIN users u ON u.id = b.client_id
          WHERE b.client_id = ?
          ORDER BY b.created_at DESC`
      )
      .all(req.user.id);
  } else {
    rows = db
      .prepare(
        `SELECT b.*, l.title AS listingTitle, l.city AS listingCity, l.price_per_month AS pricePerMonth,
                u.name AS clientName
           FROM bookings b
           JOIN listings l ON l.id = b.listing_id
           JOIN users u ON u.id = b.client_id
          WHERE l.owner_id = ?
          ORDER BY b.created_at DESC`
      )
      .all(req.user.id);
  }
  const bookings = rows.map((b) => ({
    id: b.id,
    listingId: b.listing_id,
    clientId: b.client_id,
    startDate: b.start_date,
    endDate: b.end_date,
    message: b.message,
    status: b.status,
    listingTitle: b.listingTitle,
    listingCity: b.listingCity,
    pricePerMonth: b.pricePerMonth,
    clientName: b.clientName,
  }));
  res.json({ bookings });
});

app.get("/api/my-listings", requireAuth("owner"), (req, res) => {
  const rows = db
    .prepare("SELECT * FROM listings WHERE owner_id = ? ORDER BY created_at DESC")
    .all(req.user.id);
  res.json({ listings: rows.map(listingToApi) });
});

app.post("/api/bookings/:id/decision", requireAuth("owner"), (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  const listing = db.prepare("SELECT owner_id FROM listings WHERE id = ?").get(booking.listing_id);
  if (!listing || listing.owner_id !== req.user.id)
    return res.status(403).json({ error: "This booking is not on your listing." });
  const { status } = req.body || {};
  if (!["approved", "rejected"].includes(status))
    return res.status(400).json({ error: "Status must be approved or rejected." });

  if (status === "approved") {
    const others = db
      .prepare("SELECT start_date, end_date FROM bookings WHERE listing_id = ? AND status = 'approved' AND id != ?")
      .all(booking.listing_id, booking.id);
    if (others.some((b) => overlaps(booking.start_date, booking.end_date, b.start_date, b.end_date)))
      return res.status(409).json({ error: "Dates clash with an already-approved booking." });
  }
  db.prepare("UPDATE bookings SET status = ? WHERE id = ?").run(status, booking.id);
  res.json({ booking: { ...booking, status } });
});

app.listen(PORT, () => {
  console.log(`AdVista running at http://localhost:${PORT}`);
});
