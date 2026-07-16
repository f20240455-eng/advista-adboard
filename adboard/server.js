const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { db, hashPassword, listingToApi } = require("./db");
const X = require("./integrations");
const { track } = require("./analytics");

const app = express();
const PORT = process.env.PORT || 3000;
const ROLES = ["client", "owner", "vendor"];

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

// Default 100kb is too small for proof-of-play photo uploads (base64 JPEGs).
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Tells the front-end which optional integrations are switched on, so it can
// hide the Google button / payment step when they are not configured.
app.get("/api/config", (req, res) => {
  res.json({
    googleEnabled: X.googleEnabled(),
    razorpayEnabled: X.razorpayEnabled(),
    razorpayKeyId: X.razorpayEnabled() ? X.RAZORPAY_KEY_ID : null,
    commissionPct: X.COMMISSION_PCT,
  });
});

// ---------- auth ----------

app.post("/api/register", (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role)
    return res.status(400).json({ error: "All fields are required." });
  if (!ROLES.includes(role))
    return res.status(400).json({ error: "Please choose whether you're advertising, listing a space, or offering services." });
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

// ---------- password reset ----------

app.post("/api/forgot-password", async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  // Always answer the same way: revealing which emails exist would leak accounts.
  const generic = {
    ok: true,
    message: "If an account exists for that email, we've sent a reset link.",
  };
  if (!email) return res.status(400).json({ error: "Please enter your email." });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) return res.json(generic);

  const token = crypto.randomBytes(32).toString("hex");
  db.prepare(
    `INSERT INTO password_resets (token, user_id, expires_at, used, created_at)
     VALUES (?, ?, ?, 0, ?)`
  ).run(
    token,
    user.id,
    new Date(Date.now() + 60 * 60 * 1000).toISOString(), // valid 1 hour
    new Date().toISOString()
  );

  const link = `${X.appUrl(req)}/reset.html?token=${token}`;
  try {
    await X.sendEmail({
      to: user.email,
      subject: "Reset your BookMyBoard password",
      text:
        `Hi ${user.name},\n\n` +
        `Use the link below to set a new password. It expires in one hour.\n\n${link}\n\n` +
        `If you didn't ask for this, you can ignore this email.`,
    });
  } catch (e) {
    console.error("Password reset email error:", e.message);
  }
  res.json(generic);
});

app.post("/api/reset-password", (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password)
    return res.status(400).json({ error: "Missing token or password." });
  if (String(password).length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters." });

  const row = db.prepare("SELECT * FROM password_resets WHERE token = ?").get(String(token));
  if (!row || row.used || row.expires_at < new Date().toISOString())
    return res.status(400).json({ error: "This reset link is invalid or has expired." });

  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare("UPDATE users SET salt = ?, password_hash = ? WHERE id = ?").run(
    salt,
    hashPassword(password, salt),
    row.user_id
  );
  db.prepare("UPDATE password_resets SET used = 1 WHERE token = ?").run(String(token));
  // Signing out other sessions limits the damage if a link was intercepted.
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);
  res.json({ ok: true });
});

// ---------- Google sign-in ----------

app.get("/auth/google", (req, res) => {
  if (!X.googleEnabled()) return res.status(404).send("Google sign-in is not configured.");
  const role = ROLES.includes(req.query.role) ? req.query.role : "client";
  const next = typeof req.query.next === "string" && req.query.next.startsWith("/")
    ? req.query.next
    : "/dashboard.html";
  // Random state carries role/next across the round trip and blocks CSRF.
  const state = crypto.randomBytes(16).toString("hex");
  db.prepare(
    `INSERT INTO oauth_states (state, role, next_url, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(
    state,
    role,
    next,
    new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    new Date().toISOString()
  );
  res.redirect(X.googleAuthUrl(req, state));
});

app.get("/auth/google/callback", async (req, res) => {
  if (!X.googleEnabled()) return res.status(404).send("Google sign-in is not configured.");
  const { code, state } = req.query;
  const stateRow = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(String(state || ""));
  if (!code || !stateRow || stateRow.used || stateRow.expires_at < new Date().toISOString())
    return res.redirect("/login.html?error=" + encodeURIComponent("Google sign-in expired. Please try again."));
  db.prepare("UPDATE oauth_states SET used = 1 WHERE state = ?").run(String(state));

  const intent = { role: stateRow.role, next: stateRow.next_url };

  try {
    const profile = await X.googleExchange(req, String(code));
    let user = db.prepare("SELECT * FROM users WHERE google_id = ?").get(profile.googleId);
    if (!user) user = db.prepare("SELECT * FROM users WHERE email = ?").get(profile.email);

    if (user) {
      // Link the Google account to the existing local account on first use.
      if (!user.google_id)
        db.prepare("UPDATE users SET google_id = ? WHERE id = ?").run(profile.googleId, user.id);
    } else {
      const salt = crypto.randomBytes(16).toString("hex");
      user = {
        id: "u-" + crypto.randomBytes(6).toString("hex"),
        name: profile.name,
        email: profile.email,
        role: ROLES.includes(intent.role) ? intent.role : "client",
        salt,
        // Unusable random password: Google users sign in via OAuth, and can set
        // a real password later through the forgot-password flow.
        password_hash: hashPassword(crypto.randomBytes(32).toString("hex"), salt),
        google_id: profile.googleId,
        created_at: new Date().toISOString(),
      };
      db.prepare(
        `INSERT INTO users (id, name, email, role, salt, password_hash, google_id, created_at)
         VALUES (@id, @name, @email, @role, @salt, @password_hash, @google_id, @created_at)`
      ).run(user);
    }
    startSession(res, user.id);
    const next = String(intent.next || "/dashboard.html");
    res.redirect(next.startsWith("/") ? next : "/dashboard.html");
  } catch (e) {
    res.redirect("/login.html?error=" + encodeURIComponent(e.message || "Google sign-in failed."));
  }
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

  // Searches that return nothing are the most valuable rows in this table:
  // they map demand we cannot currently supply, and tell us which owners to go
  // recruit in which city. Only log searches with actual intent (a filter or a
  // query), not the bare "browse everything" page load.
  const hasIntent = Boolean(
    (city && city !== "all") || (type && type !== "all") || maxPrice || q
  );
  if (hasIntent) {
    track("search", {
      req,
      res,
      user: currentUser(req),
      props: {
        city: city || null,
        type: type || null,
        maxPrice: maxPrice ? Number(maxPrice) : null,
        hasQuery: Boolean(q),
        resultCount: rows.length,
        zeroResults: rows.length === 0,
      },
    });
  }

  res.json({ listings: rows.map(listingToApi), cities: all, types });
});

app.get("/api/listings/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM listings WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Listing not found." });
  const owner = db.prepare("SELECT name FROM users WHERE id = ?").get(row.owner_id);
  const bookedRanges = db
    .prepare("SELECT start_date AS startDate, end_date AS endDate FROM bookings WHERE listing_id = ? AND status = 'approved'")
    .all(row.id);
  const blockedDates = db
    .prepare("SELECT date FROM blocked_dates WHERE listing_id = ? ORDER BY date")
    .all(row.id)
    .map((r) => r.date);

  // The denominator for conversion: how many people saw this listing at this
  // price versus how many went on to request it.
  track("listing_view", {
    req,
    res,
    user: currentUser(req),
    listingId: row.id,
    price: row.price_per_month,
    props: {
      city: row.city,
      type: row.type,
      trafficPerDay: row.traffic_per_day,
      lit: Boolean(row.lit),
      isBooked: bookedRanges.length > 0,
    },
  });

  res.json({
    listing: listingToApi(row),
    ownerName: owner ? owner.name : "Unknown",
    bookedRanges,
    blockedDates,
  });
});

// ---------- owner availability calendar ----------

app.post("/api/listings/:id/blocks", requireAuth("owner"), (req, res) => {
  const listing = db.prepare("SELECT owner_id FROM listings WHERE id = ?").get(req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found." });
  if (listing.owner_id !== req.user.id)
    return res.status(403).json({ error: "This isn't your listing." });

  const date = String((req.body || {}).date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: "A valid date is required." });

  const clash = db
    .prepare("SELECT 1 FROM bookings WHERE listing_id = ? AND status = 'approved' AND ? BETWEEN start_date AND end_date")
    .get(req.params.id, date);
  if (clash) return res.status(409).json({ error: "That date already has a confirmed booking." });

  db.prepare(
    `INSERT OR IGNORE INTO blocked_dates (id, listing_id, date, created_at) VALUES (?, ?, ?, ?)`
  ).run("bd-" + crypto.randomBytes(6).toString("hex"), req.params.id, date, new Date().toISOString());
  res.status(201).json({ ok: true });
});

app.delete("/api/listings/:id/blocks/:date", requireAuth("owner"), (req, res) => {
  const listing = db.prepare("SELECT owner_id FROM listings WHERE id = ?").get(req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found." });
  if (listing.owner_id !== req.user.id)
    return res.status(403).json({ error: "This isn't your listing." });
  db.prepare("DELETE FROM blocked_dates WHERE listing_id = ? AND date = ?").run(req.params.id, req.params.date);
  res.json({ ok: true });
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

  // What owners believe their space is worth, at the moment they list it and
  // before any market feedback. This is the baseline the pricing guide will be
  // measured against.
  track("listing_created", {
    req, res, user: req.user,
    listingId: listing.id,
    price: listing.price_per_month,
    props: {
      city: listing.city,
      type: listing.type,
      trafficPerDay: listing.traffic_per_day,
      lit: Boolean(listing.lit),
      size: listing.size,
    },
  });
  res.status(201).json({ listing: listingToApi(listing) });
});

// ---------- bookings ----------

// Days are inclusive of both the start and end date.
function daysBetween(startDate, endDate) {
  return Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
}

app.post("/api/bookings", requireAuth("client"), (req, res) => {
  const { listingId, startDate, endDate, message } = req.body || {};
  const listing = db.prepare("SELECT * FROM listings WHERE id = ?").get(listingId);
  if (!listing) return res.status(404).json({ error: "Listing not found." });
  if (!startDate || !endDate)
    return res.status(400).json({ error: "Start and end dates are required." });
  if (endDate < startDate)
    return res.status(400).json({ error: "End date must be after the start date." });

  const approved = db
    .prepare("SELECT start_date, end_date FROM bookings WHERE listing_id = ? AND status = 'approved'")
    .all(listingId);
  if (approved.some((b) => overlaps(startDate, endDate, b.start_date, b.end_date))) {
    // Demand we turned away. Repeated collisions on one listing are a strong
    // signal it is underpriced for that window.
    track("booking_blocked", {
      req, res, user: req.user, listingId,
      price: listing.price_per_month,
      props: { reason: "already_booked", startDate, endDate },
    });
    return res.status(409).json({ error: "That space is already booked for part of those dates." });
  }

  const blockedInRange = db
    .prepare("SELECT 1 FROM blocked_dates WHERE listing_id = ? AND date BETWEEN ? AND ? LIMIT 1")
    .get(listingId, startDate, endDate);
  if (blockedInRange) {
    track("booking_blocked", {
      req, res, user: req.user, listingId,
      price: listing.price_per_month,
      props: { reason: "owner_blocked", startDate, endDate },
    });
    return res.status(409).json({ error: "The owner has marked part of those dates unavailable." });
  }

  // Lock the quote at request time from the price the advertiser actually saw,
  // so it cannot move between request and approval.
  const days = daysBetween(startDate, endDate);
  const rupees = Math.round((listing.price_per_month * days) / 30);
  const { amountTotal, platformFee, ownerPayout } = X.splitAmount(rupees * 100);

  const booking = {
    id: "b-" + crypto.randomBytes(6).toString("hex"),
    listing_id: listingId,
    client_id: req.user.id,
    start_date: startDate,
    end_date: endDate,
    message: String(message || "").trim(),
    status: "pending",
    amount_total: amountTotal,
    platform_fee: platformFee,
    owner_payout: ownerPayout,
    payment_status: "unpaid",
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO bookings (id, listing_id, client_id, start_date, end_date, message, status,
                           amount_total, platform_fee, owner_payout, payment_status, created_at)
     VALUES (@id, @listing_id, @client_id, @start_date, @end_date, @message, @status,
             @amount_total, @platform_fee, @owner_payout, @payment_status, @created_at)`
  ).run(booking);

  track("booking_requested", {
    req, res, user: req.user,
    listingId,
    bookingId: booking.id,
    price: listing.price_per_month,
    props: {
      days,
      quotedTotal: rupees,
      city: listing.city,
      type: listing.type,
      trafficPerDay: listing.traffic_per_day,
      // Lead time is a core seasonality feature: how far ahead people book.
      leadTimeDays: daysBetween(new Date().toISOString().slice(0, 10), startDate) - 1,
      startDate,
      hasMessage: Boolean(booking.message),
    },
  });
  res.status(201).json({ booking });
});

// ---------- payments ----------
// Flow: owner approves -> advertiser pays -> booking is confirmed. The platform
// commission is recorded on every paid booking.

app.post("/api/bookings/:id/pay", requireAuth("client"), async (req, res) => {
  if (!X.razorpayEnabled())
    return res.status(503).json({ error: "Online payment isn't switched on yet." });
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking || booking.client_id !== req.user.id)
    return res.status(404).json({ error: "Booking not found." });
  if (booking.status !== "approved")
    return res.status(400).json({ error: "This booking isn't approved yet." });
  if (booking.payment_status === "paid")
    return res.status(400).json({ error: "This booking is already paid." });

  try {
    const order = await X.razorpayCreateOrder({
      amountPaise: booking.amount_total,
      receipt: booking.id,
      notes: { bookingId: booking.id, listingId: booking.listing_id },
    });
    db.prepare("UPDATE bookings SET payment_order_id = ? WHERE id = ?").run(order.id, booking.id);
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post("/api/bookings/:id/pay/verify", requireAuth("client"), (req, res) => {
  if (!X.razorpayEnabled())
    return res.status(503).json({ error: "Online payment isn't switched on yet." });
  const { paymentId, signature } = req.body || {};
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking || booking.client_id !== req.user.id)
    return res.status(404).json({ error: "Booking not found." });
  if (!booking.payment_order_id)
    return res.status(400).json({ error: "No payment was started for this booking." });

  const ok = X.razorpayVerify({
    orderId: booking.payment_order_id,
    paymentId,
    signature,
  });
  if (!ok) return res.status(400).json({ error: "Payment could not be verified." });

  db.prepare("UPDATE bookings SET payment_status = 'paid', payment_id = ? WHERE id = ?").run(
    String(paymentId),
    booking.id
  );

  // Ground truth: money actually changed hands at this price.
  track("booking_paid", {
    req, res, user: req.user,
    listingId: booking.listing_id,
    bookingId: booking.id,
    price: (booking.amount_total || 0) / 100,
    props: {
      amountTotal: (booking.amount_total || 0) / 100,
      platformFee: (booking.platform_fee || 0) / 100,
      startDate: booking.start_date,
      endDate: booking.end_date,
    },
  });
  res.json({ ok: true });
});

// ---------- proof-of-play photos ----------
// Owners upload a mounting/monitoring photo against an approved booking so
// the advertiser can see the creative actually went up — the single biggest
// trust gap in static (non-digital) outdoor advertising.

function photoToApi(p) {
  return { id: p.id, kind: p.kind, imageDataUrl: p.image_data, caption: p.caption || "", createdAt: p.created_at };
}

function photosForBooking(bookingId) {
  return db
    .prepare("SELECT * FROM booking_photos WHERE booking_id = ? ORDER BY created_at")
    .all(bookingId)
    .map(photoToApi);
}

app.post("/api/bookings/:id/photos", requireAuth("owner"), (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  const listing = db.prepare("SELECT owner_id FROM listings WHERE id = ?").get(booking.listing_id);
  if (!listing || listing.owner_id !== req.user.id)
    return res.status(403).json({ error: "This booking is not on your listing." });
  if (booking.status !== "approved")
    return res.status(400).json({ error: "Only approved bookings can have proof photos." });

  const { kind, imageDataUrl, caption } = req.body || {};
  if (!imageDataUrl || !/^data:image\/(jpeg|png|webp);base64,/.test(imageDataUrl))
    return res.status(400).json({ error: "A valid image is required." });
  if (imageDataUrl.length > 3_500_000)
    return res.status(413).json({ error: "That image is too large. Try a smaller photo." });

  const photo = {
    id: "ph-" + crypto.randomBytes(6).toString("hex"),
    booking_id: req.params.id,
    kind: kind === "monitoring" ? "monitoring" : "mount",
    image_data: imageDataUrl,
    caption: String(caption || "").trim(),
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO booking_photos (id, booking_id, kind, image_data, caption, created_at)
     VALUES (@id, @booking_id, @kind, @image_data, @caption, @created_at)`
  ).run(photo);
  res.status(201).json({ photo: photoToApi(photo) });
});

app.delete("/api/bookings/:id/photos/:photoId", requireAuth("owner"), (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  const listing = db.prepare("SELECT owner_id FROM listings WHERE id = ?").get(booking.listing_id);
  if (!listing || listing.owner_id !== req.user.id)
    return res.status(403).json({ error: "This booking is not on your listing." });
  db.prepare("DELETE FROM booking_photos WHERE id = ? AND booking_id = ?").run(req.params.photoId, req.params.id);
  res.json({ ok: true });
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
    // Money is stored in paise; expose rupees to the UI.
    amountTotal: (b.amount_total || 0) / 100,
    platformFee: (b.platform_fee || 0) / 100,
    ownerPayout: (b.owner_payout || 0) / 100,
    paymentStatus: b.payment_status || "unpaid",
    photos: photosForBooking(b.id),
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

  // The supply-side label: did the owner accept this price for these dates?
  const listingRow = db.prepare("SELECT * FROM listings WHERE id = ?").get(booking.listing_id);
  track("booking_decided", {
    req, res, user: req.user,
    listingId: booking.listing_id,
    bookingId: booking.id,
    price: listingRow ? listingRow.price_per_month : null,
    props: {
      decision: status,
      quotedTotal: (booking.amount_total || 0) / 100,
      // How long the advertiser waited — our own service-quality metric.
      ownerResponseHours:
        Math.round(((Date.now() - new Date(booking.created_at)) / 3600000) * 10) / 10,
      startDate: booking.start_date,
      endDate: booking.end_date,
    },
  });
  res.json({ booking: { ...booking, status } });
});

// ---------- vendors (printing, fabrication, digital screens, installation) ----------

const VENDOR_CATEGORIES = [
  "Banner & Flex Printing",
  "Billboard Fabrication",
  "Digital LED Screen Supply",
  "Installation & Mounting",
  "Creative & Design",
];

app.get("/api/vendor-categories", (req, res) => res.json({ categories: VENDOR_CATEGORIES }));

function vendorToApi(v) {
  return {
    id: v.id,
    name: v.name,
    category: v.category,
    city: v.city,
    description: v.description || "",
    phone: v.phone || "",
    minPrice: v.min_price || 0,
  };
}

app.get("/api/vendors", (req, res) => {
  const { category, city, q } = req.query;
  const clauses = [];
  const params = {};
  if (category && category !== "all") { clauses.push("category = @category"); params.category = category; }
  if (city && city !== "all") { clauses.push("city = @city"); params.city = city; }
  if (q) {
    clauses.push("(LOWER(name || ' ' || city || ' ' || category || ' ' || IFNULL(description,'')) LIKE @q)");
    params.q = "%" + String(q).toLowerCase() + "%";
  }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const rows = db.prepare(`SELECT * FROM vendors ${where} ORDER BY created_at DESC`).all(params);
  const cities = db.prepare("SELECT DISTINCT city FROM vendors ORDER BY city").all().map((r) => r.city);
  res.json({ vendors: rows.map(vendorToApi), cities, categories: VENDOR_CATEGORIES });
});

app.get("/api/vendors/:id", (req, res) => {
  const v = db.prepare("SELECT * FROM vendors WHERE id = ?").get(req.params.id);
  if (!v) return res.status(404).json({ error: "Supplier not found." });
  res.json({ vendor: vendorToApi(v) });
});

// A vendor account owns exactly one profile.
app.get("/api/my-vendor", requireAuth("vendor"), (req, res) => {
  const v = db.prepare("SELECT * FROM vendors WHERE user_id = ?").get(req.user.id);
  res.json({ vendor: v ? vendorToApi(v) : null });
});

app.post("/api/vendors", requireAuth("vendor"), (req, res) => {
  const { name, category, city, description, phone, minPrice } = req.body || {};
  if (!name || !category || !city)
    return res.status(400).json({ error: "Name, category and city are required." });
  if (!VENDOR_CATEGORIES.includes(category))
    return res.status(400).json({ error: "Please choose a valid category." });

  const existing = db.prepare("SELECT id FROM vendors WHERE user_id = ?").get(req.user.id);
  const fields = {
    name: String(name).trim(),
    category,
    city: String(city).trim(),
    description: String(description || "").trim(),
    phone: String(phone || "").trim(),
    min_price: Number(minPrice) || 0,
  };

  if (existing) {
    db.prepare(
      `UPDATE vendors SET name=@name, category=@category, city=@city,
              description=@description, phone=@phone, min_price=@min_price
       WHERE id=@id`
    ).run({ ...fields, id: existing.id });
    return res.json({ vendor: vendorToApi({ ...fields, id: existing.id }) });
  }

  const vendor = {
    id: "v-" + crypto.randomBytes(6).toString("hex"),
    user_id: req.user.id,
    ...fields,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO vendors (id, user_id, name, category, city, description, phone, min_price, created_at)
     VALUES (@id, @user_id, @name, @category, @city, @description, @phone, @min_price, @created_at)`
  ).run(vendor);
  res.status(201).json({ vendor: vendorToApi(vendor) });
});

app.post("/api/service-requests", requireAuth(), (req, res) => {
  const { vendorId, message } = req.body || {};
  const vendor = db.prepare("SELECT * FROM vendors WHERE id = ?").get(vendorId);
  if (!vendor) return res.status(404).json({ error: "Supplier not found." });
  if (vendor.user_id === req.user.id)
    return res.status(400).json({ error: "You can't send a request to yourself." });

  const request = {
    id: "sr-" + crypto.randomBytes(6).toString("hex"),
    vendor_id: vendorId,
    requester_id: req.user.id,
    message: String(message || "").trim(),
    status: "open",
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO service_requests (id, vendor_id, requester_id, message, status, created_at)
     VALUES (@id, @vendor_id, @requester_id, @message, @status, @created_at)`
  ).run(request);
  res.status(201).json({ request });
});

app.get("/api/service-requests", requireAuth(), (req, res) => {
  const rows =
    req.user.role === "vendor"
      ? db
          .prepare(
            `SELECT s.*, u.name AS requesterName, u.email AS requesterEmail, v.name AS vendorName
               FROM service_requests s
               JOIN vendors v ON v.id = s.vendor_id
               JOIN users u ON u.id = s.requester_id
              WHERE v.user_id = ?
              ORDER BY s.created_at DESC`
          )
          .all(req.user.id)
      : db
          .prepare(
            `SELECT s.*, u.name AS requesterName, u.email AS requesterEmail, v.name AS vendorName
               FROM service_requests s
               JOIN vendors v ON v.id = s.vendor_id
               JOIN users u ON u.id = s.requester_id
              WHERE s.requester_id = ?
              ORDER BY s.created_at DESC`
          )
          .all(req.user.id);
  res.json({
    requests: rows.map((r) => ({
      id: r.id,
      vendorName: r.vendorName,
      requesterName: r.requesterName,
      // The vendor needs a way to reply; the requester already knows their own address.
      requesterEmail: req.user.role === "vendor" ? r.requesterEmail : null,
      message: r.message,
      status: r.status,
      createdAt: r.created_at,
    })),
  });
});

// ---------- insights (private) ----------
// Aggregates over the event log. Gated by ADMIN_TOKEN: this is commercial
// intelligence, not public data. With no token configured the route does not
// exist at all, so an unconfigured deploy can't leak it.

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(404).json({ error: "Not found." });
  const given = req.get("x-admin-token") || req.query.token || "";
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(401).json({ error: "Unauthorized." });
  next();
}

app.get("/api/admin/insights", requireAdmin, (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const q = (sql, ...p) => db.prepare(sql).all(...p);

  const eventCounts = q(
    `SELECT name, COUNT(*) AS n FROM events WHERE created_at >= ? GROUP BY name ORDER BY n DESC`,
    since
  );

  // The supply-gap map: what people looked for and we had nothing for.
  const zeroResultSearches = q(
    `SELECT json_extract(props,'$.city') AS city,
            json_extract(props,'$.type') AS type,
            COUNT(*) AS n
       FROM events
      WHERE name = 'search' AND created_at >= ?
        AND json_extract(props,'$.zeroResults') = 1
      GROUP BY city, type
      ORDER BY n DESC
      LIMIT 20`,
    since
  );

  const funnel = {};
  for (const name of ["listing_view", "booking_requested", "booking_decided", "booking_paid"]) {
    funnel[name] = (eventCounts.find((e) => e.name === name) || { n: 0 }).n;
  }

  // Every completed observation the future model would train on.
  const priceObservations = q(
    `SELECT COUNT(*) AS n FROM events WHERE name IN ('booking_requested','booking_paid')`
  )[0].n;

  const topListings = q(
    `SELECT listing_id,
            SUM(name = 'listing_view') AS views,
            SUM(name = 'booking_requested') AS requests
       FROM events
      WHERE listing_id IS NOT NULL AND created_at >= ?
      GROUP BY listing_id
      ORDER BY views DESC
      LIMIT 10`,
    since
  );

  const decisions = q(
    `SELECT json_extract(props,'$.decision') AS decision,
            COUNT(*) AS n,
            ROUND(AVG(json_extract(props,'$.ownerResponseHours')), 1) AS avgResponseHours
       FROM events
      WHERE name = 'booking_decided' AND created_at >= ?
      GROUP BY decision`,
    since
  );

  res.json({
    windowDays: days,
    generatedAt: new Date().toISOString(),
    eventCounts,
    funnel,
    priceObservations,
    modelReadiness: {
      observations: priceObservations,
      // Not a real threshold yet — a deliberate reminder that a heuristic
      // beats a model until there is genuine volume behind it.
      roughTargetForModelling: 300,
      ready: priceObservations >= 300,
    },
    zeroResultSearches,
    decisions,
    topListings,
  });
});

app.listen(PORT, () => {
  console.log(`BookMyBoard running at http://localhost:${PORT}`);
});
