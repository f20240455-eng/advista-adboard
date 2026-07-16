// Marketplace event logging.
//
// This exists for one reason: a pricing/demand model needs a history of what
// was shown, at what price, and what happened next. None of that is
// recoverable retroactively — if we don't capture it as it happens, it's gone.
//
// Two rules this module never breaks:
//
//  1. It never throws. Analytics is not worth a 500 on a real user's booking.
//     Every entry point is wrapped; failures are logged and swallowed.
//  2. It never stores personal or cross-site identifiers. No IP addresses, no
//     third-party ids. visitor_id is a first-party random id, rotated every 90
//     days, used only to stitch one person's own session together.

const crypto = require("crypto");
const { db } = require("./db");

const VISITOR_COOKIE = "bmb_vid";
const VISITOR_MAX_AGE_DAYS = 90;

const insertEvent = db.prepare(
  `INSERT INTO events (id, name, created_at, visitor_id, user_id, user_role,
                       listing_id, booking_id, price_snapshot, props)
   VALUES (@id, @name, @created_at, @visitor_id, @user_id, @user_role,
           @listing_id, @booking_id, @price_snapshot, @props)`
);

function readCookie(req, key) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === key) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

// Issues a first-party visitor id if the browser doesn't have one yet. This
// only ever groups activity within this site; it is not linked to any identity
// and carries no personal data.
function ensureVisitorId(req, res) {
  try {
    const existing = readCookie(req, VISITOR_COOKIE);
    if (existing && /^[a-f0-9]{16,32}$/.test(existing)) return existing;

    const id = crypto.randomBytes(12).toString("hex");
    const maxAge = VISITOR_MAX_AGE_DAYS * 24 * 60 * 60;
    // Append rather than overwrite: the session cookie may already be queued.
    const prior = res.getHeader("Set-Cookie");
    const cookie = `${VISITOR_COOKIE}=${id}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
    res.setHeader(
      "Set-Cookie",
      prior ? (Array.isArray(prior) ? [...prior, cookie] : [prior, cookie]) : cookie
    );
    return id;
  } catch {
    return null;
  }
}

// The only way events are written. `req` is optional so server-side flows can
// log without a request in hand.
function track(name, { req, res, user, listingId, bookingId, price, props } = {}) {
  try {
    let visitorId = null;
    if (req) {
      visitorId = res ? ensureVisitorId(req, res) : readCookie(req, VISITOR_COOKIE);
    }
    insertEvent.run({
      id: "e-" + crypto.randomBytes(8).toString("hex"),
      name: String(name),
      created_at: new Date().toISOString(),
      visitor_id: visitorId,
      user_id: user ? user.id : null,
      user_role: user ? user.role : null,
      listing_id: listingId || null,
      booking_id: bookingId || null,
      // Frozen at event time. Never re-derived by joining to listings later.
      price_snapshot: Number.isFinite(price) ? Math.round(price) : null,
      props: props ? JSON.stringify(props) : null,
    });
  } catch (e) {
    // Deliberately swallowed — see rule 1 at the top of this file.
    console.error("[analytics] dropped event", name, e.message);
  }
}

module.exports = { track, ensureVisitorId };
