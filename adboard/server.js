const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");

// ---------- storage ----------

function defaultData() {
  const demoSalt = crypto.randomBytes(16).toString("hex");
  const hash = (pw, salt) =>
    crypto.scryptSync(pw, salt, 64).toString("hex");
  const users = [
    {
      id: "u-owner",
      name: "Highway Fuels Pvt Ltd",
      email: "owner@demo.com",
      role: "owner",
      salt: demoSalt,
      passwordHash: hash("demo123", demoSalt),
    },
    {
      id: "u-client",
      name: "Brightwave Beverages",
      email: "client@demo.com",
      role: "client",
      salt: demoSalt,
      passwordHash: hash("demo123", demoSalt),
    },
  ];
  const listings = [
    {
      id: "l1", ownerId: "u-owner", title: "NH-48 Fuel Station Unipole",
      city: "Gurugram", location: "NH-48, Km 42, beside IOCL fuel station",
      type: "Unipole", size: "40 x 20 ft", facing: "North-bound traffic",
      trafficPerDay: 145000, pricePerMonth: 220000, lit: true,
      description: "Premium unipole at a busy IOCL pump on the Delhi–Jaipur highway. Long dwell time while vehicles refuel; visible from 300m on the carriageway.",
      theme: "highway",
    },
    {
      id: "l2", ownerId: "u-owner", title: "Cyber Hub Digital LED Wall",
      city: "Gurugram", location: "DLF Cyber Hub, main entrance plaza",
      type: "Digital LED", size: "24 x 12 ft", facing: "Pedestrian plaza",
      trafficPerDay: 60000, pricePerMonth: 480000, lit: true,
      description: "4K LED wall at the entrance of Cyber Hub. 10-second slots in a 60-second loop, evening footfall of office crowd and diners.",
      theme: "digital",
    },
    {
      id: "l3", ownerId: "u-owner", title: "Mumbai–Pune Expressway Gantry",
      city: "Mumbai", location: "Expressway Km 18, before Khalapur toll",
      type: "Gantry", size: "60 x 15 ft", facing: "Pune-bound traffic",
      trafficPerDay: 180000, pricePerMonth: 350000, lit: true,
      description: "Overhead gantry with unmissable placement before the toll plaza where traffic slows to a crawl. Highest read-time on the corridor.",
      theme: "highway",
    },
    {
      id: "l4", ownerId: "u-owner", title: "Andheri Metro Pillar Series",
      city: "Mumbai", location: "Andheri West, Metro pillars 214–222",
      type: "Metro Pillar", size: "8 pillars, 10 x 5 ft each", facing: "Both carriageways",
      trafficPerDay: 95000, pricePerMonth: 160000, lit: false,
      description: "A run of 8 consecutive metro pillars for sequential storytelling creatives on a dense office corridor.",
      theme: "urban",
    },
    {
      id: "l5", ownerId: "u-owner", title: "Koramangala Mall Facade Wrap",
      city: "Bengaluru", location: "Forum Mall, 80 Feet Road facade",
      type: "Wall Wrap", size: "50 x 30 ft", facing: "80 Feet Road junction",
      trafficPerDay: 110000, pricePerMonth: 300000, lit: true,
      description: "Full building wrap over the mall entrance at one of Bengaluru's busiest junctions. Weekend footfall skews young and high-spend.",
      theme: "urban",
    },
    {
      id: "l6", ownerId: "u-owner", title: "ORR Fuel Station Hoarding",
      city: "Bengaluru", location: "Outer Ring Road, HP petrol pump, Marathahalli",
      type: "Billboard", size: "30 x 15 ft", facing: "Airport-bound traffic",
      trafficPerDay: 130000, pricePerMonth: 190000, lit: true,
      description: "Backlit hoarding inside a high-volume HP pump on ORR. Captive audience during refuelling plus full visibility from the service road.",
      theme: "fuel",
    },
    {
      id: "l7", ownerId: "u-owner", title: "Anna Salai Digital Billboard",
      city: "Chennai", location: "Anna Salai, opposite LIC building",
      type: "Digital LED", size: "20 x 10 ft", facing: "Signal-stop traffic",
      trafficPerDay: 90000, pricePerMonth: 260000, lit: true,
      description: "Digital screen at a 90-second signal — guaranteed dwell time every cycle in Chennai's CBD.",
      theme: "digital",
    },
    {
      id: "l8", ownerId: "u-owner", title: "Jaipur Highway Welcome Arch",
      city: "Jaipur", location: "NH-48 city entry, Ajmer Road",
      type: "Gantry", size: "45 x 12 ft", facing: "City-bound traffic",
      trafficPerDay: 75000, pricePerMonth: 120000, lit: false,
      description: "The first large-format site tourists and commuters see entering Jaipur from Delhi. Strong for hospitality and retail brands.",
      theme: "highway",
    },
  ];
  return { users, listings, bookings: [], sessions: {} };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const d = defaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
    return d;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

const db = loadData();

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ---------- helpers ----------

function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString("hex");
}

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
  const userId = db.sessions[token];
  if (!userId) return null;
  return db.users.find((u) => u.id === userId) || null;
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
    return res.status(400).json({ error: "Role must be client or owner." });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  const emailNorm = String(email).trim().toLowerCase();
  if (db.users.some((u) => u.email === emailNorm))
    return res.status(409).json({ error: "An account with that email already exists." });
  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    id: "u-" + crypto.randomBytes(6).toString("hex"),
    name: String(name).trim(),
    email: emailNorm,
    role,
    salt,
    passwordHash: hashPassword(password, salt),
  };
  db.users.push(user);
  const token = crypto.randomBytes(24).toString("hex");
  db.sessions[token] = user.id;
  save();
  res.cookie
    ? res.cookie("session", token, { httpOnly: true })
    : res.setHeader("Set-Cookie", `session=${token}; HttpOnly; Path=/`);
  res.json({ user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.users.find(
    (u) => u.email === String(email || "").trim().toLowerCase()
  );
  if (!user || hashPassword(password || "", user.salt) !== user.passwordHash)
    return res.status(401).json({ error: "Invalid email or password." });
  const token = crypto.randomBytes(24).toString("hex");
  db.sessions[token] = user.id;
  save();
  res.setHeader("Set-Cookie", `session=${token}; HttpOnly; Path=/`);
  res.json({ user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  const token = parseCookies(req).session;
  if (token) {
    delete db.sessions[token];
    save();
  }
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
  let items = db.listings.slice();
  if (city && city !== "all") items = items.filter((l) => l.city === city);
  if (type && type !== "all") items = items.filter((l) => l.type === type);
  if (maxPrice) items = items.filter((l) => l.pricePerMonth <= Number(maxPrice));
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((l) =>
      [l.title, l.location, l.city, l.type, l.description]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }
  const cities = [...new Set(db.listings.map((l) => l.city))].sort();
  const types = [...new Set(db.listings.map((l) => l.type))].sort();
  res.json({ listings: items, cities, types });
});

app.get("/api/listings/:id", (req, res) => {
  const listing = db.listings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found." });
  const owner = db.users.find((u) => u.id === listing.ownerId);
  const bookedRanges = db.bookings
    .filter((b) => b.listingId === listing.id && b.status === "approved")
    .map((b) => ({ startDate: b.startDate, endDate: b.endDate }));
  res.json({
    listing,
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
    ownerId: req.user.id,
    title: String(title).trim(),
    city: String(city).trim(),
    location: String(location).trim(),
    type: String(type).trim(),
    size: String(size).trim(),
    facing: String(facing || "").trim(),
    trafficPerDay: Number(trafficPerDay) || 0,
    pricePerMonth: Number(pricePerMonth),
    lit: Boolean(lit),
    description: String(description || "").trim(),
    theme: themeByType[type] || "urban",
  };
  db.listings.push(listing);
  save();
  res.status(201).json({ listing });
});

// ---------- bookings ----------

app.post("/api/bookings", requireAuth("client"), (req, res) => {
  const { listingId, startDate, endDate, message } = req.body || {};
  const listing = db.listings.find((l) => l.id === listingId);
  if (!listing) return res.status(404).json({ error: "Listing not found." });
  if (!startDate || !endDate)
    return res.status(400).json({ error: "Start and end dates are required." });
  if (endDate < startDate)
    return res.status(400).json({ error: "End date must be after the start date." });
  const clash = db.bookings.some(
    (b) =>
      b.listingId === listingId &&
      b.status === "approved" &&
      overlaps(startDate, endDate, b.startDate, b.endDate)
  );
  if (clash)
    return res.status(409).json({ error: "That space is already booked for part of those dates." });
  const booking = {
    id: "b-" + crypto.randomBytes(6).toString("hex"),
    listingId,
    clientId: req.user.id,
    startDate,
    endDate,
    message: String(message || "").trim(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  db.bookings.push(booking);
  save();
  res.status(201).json({ booking });
});

app.get("/api/bookings", requireAuth(), (req, res) => {
  const withDetails = (b) => {
    const listing = db.listings.find((l) => l.id === b.listingId);
    const client = db.users.find((u) => u.id === b.clientId);
    return {
      ...b,
      listingTitle: listing ? listing.title : "Deleted listing",
      listingCity: listing ? listing.city : "",
      pricePerMonth: listing ? listing.pricePerMonth : 0,
      clientName: client ? client.name : "Unknown",
    };
  };
  let items;
  if (req.user.role === "client") {
    items = db.bookings.filter((b) => b.clientId === req.user.id);
  } else {
    const myListingIds = new Set(
      db.listings.filter((l) => l.ownerId === req.user.id).map((l) => l.id)
    );
    items = db.bookings.filter((b) => myListingIds.has(b.listingId));
  }
  res.json({ bookings: items.map(withDetails).reverse() });
});

app.get("/api/my-listings", requireAuth("owner"), (req, res) => {
  res.json({
    listings: db.listings.filter((l) => l.ownerId === req.user.id),
  });
});

app.post("/api/bookings/:id/decision", requireAuth("owner"), (req, res) => {
  const booking = db.bookings.find((b) => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  const listing = db.listings.find((l) => l.id === booking.listingId);
  if (!listing || listing.ownerId !== req.user.id)
    return res.status(403).json({ error: "This booking is not on your listing." });
  const { status } = req.body || {};
  if (!["approved", "rejected"].includes(status))
    return res.status(400).json({ error: "Status must be approved or rejected." });
  if (status === "approved") {
    const clash = db.bookings.some(
      (b) =>
        b.id !== booking.id &&
        b.listingId === booking.listingId &&
        b.status === "approved" &&
        overlaps(booking.startDate, booking.endDate, b.startDate, b.endDate)
    );
    if (clash)
      return res.status(409).json({ error: "Dates clash with an already-approved booking." });
  }
  booking.status = status;
  save();
  res.json({ booking });
});

app.listen(PORT, () => {
  console.log(`AdVista running at http://localhost:${PORT}`);
});
