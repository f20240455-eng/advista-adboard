// External integrations. Every one of these is optional: the app boots and works
// without any credentials, and each feature switches itself on only when its
// environment variables are present. Secrets are read from the environment and
// are never written to the repo.

const crypto = require("crypto");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "BookMyBoard <onboarding@resend.dev>";

// Platform commission taken on each confirmed booking.
const COMMISSION_PCT = Number(process.env.PLATFORM_COMMISSION_PCT || 10);

// Public base URL, used for OAuth redirects and password-reset links.
function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  return `${proto}://${req.headers.host}`;
}

const googleEnabled = () => Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const razorpayEnabled = () => Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
const emailEnabled = () => Boolean(RESEND_API_KEY);

// ---------- email ----------
// Falls back to logging the message when no provider is configured, so the
// password-reset flow stays testable in development.
async function sendEmail({ to, subject, text }) {
  if (!emailEnabled()) {
    console.log(`\n[email not configured] would send to ${to}\nSubject: ${subject}\n${text}\n`);
    return { delivered: false };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Email send failed:", res.status, body);
    return { delivered: false };
  }
  return { delivered: true };
}

// ---------- Google OAuth ----------
function googleAuthUrl(req, state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${appUrl(req)}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// Exchanges the one-time code for tokens, then reads the verified profile.
async function googleExchange(req, code) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${appUrl(req)}/auth/google/callback`,
    }),
  });
  if (!tokenRes.ok) throw new Error("Google sign-in failed.");
  const { access_token } = await tokenRes.json();

  const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) throw new Error("Could not read your Google profile.");
  const profile = await profileRes.json();
  if (!profile.email || !profile.email_verified)
    throw new Error("Your Google account has no verified email.");
  return { googleId: profile.sub, email: String(profile.email).toLowerCase(), name: profile.name || profile.email };
}

// ---------- Razorpay ----------
// Amounts are in paise throughout.
function splitAmount(amountPaise) {
  const platformFee = Math.round((amountPaise * COMMISSION_PCT) / 100);
  return { amountTotal: amountPaise, platformFee, ownerPayout: amountPaise - platformFee };
}

async function razorpayCreateOrder({ amountPaise, receipt, notes }) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt, notes }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Razorpay order failed:", res.status, body);
    throw new Error("Could not start the payment. Please try again.");
  }
  return res.json();
}

// Razorpay signs `order_id|payment_id` with the key secret.
function razorpayVerify({ orderId, paymentId, signature }) {
  const expected = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  COMMISSION_PCT,
  RAZORPAY_KEY_ID,
  appUrl,
  googleEnabled,
  razorpayEnabled,
  emailEnabled,
  sendEmail,
  googleAuthUrl,
  googleExchange,
  splitAmount,
  razorpayCreateOrder,
  razorpayVerify,
};
