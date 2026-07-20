# BookMyBoard — project context

Read this before touching anything. It exists so a fresh session can continue
without re-deriving decisions or re-litigating settled ones.

## What this is

A two-sided marketplace for Indian outdoor advertising (OOH): billboard/hoarding
owners list space, advertisers book it directly. **No brokers, no inventory
ownership.** We aggregate and take a commission.

The goal in one line: **make booking a billboard as easy as booking a movie
ticket.** A small business owner with no marketing team logs in → picks
locations + dates → pays → campaign runs.

We own nothing: not the boards, not the land, not the printers. Pure
aggregation + convenience + trust layer.

## Live

- **Prod:** https://advista-adboard-production.up.railway.app
  (URL still says "advista" — the old name. Rebranded to BookMyBoard; the
  Railway URL was never renamed. A real domain is a pending task.)
- **Repo:** https://github.com/f20240455-eng/advista-adboard
- **Deploy:** push to `main` → Railway auto-deploys (~20-30s). Root dir `adboard`.
  Local branch is `chore/add-readme-and-gitignore`; ship with
  `git push origin HEAD:main`.
- Railway has a **volume mounted at `/data`** with `DATA_DIR=/data`, so SQLite
  survives redeploys. This was a real bug source before it was set up.

## Stack + architecture

Node + Express + SQLite (`better-sqlite3`), vanilla HTML/CSS/JS front end.
**No build step, no framework, no bundler** — `npm start` runs everything.
Keep it that way unless there's a strong reason; it's a deliberate choice that
keeps the whole thing legible and deployable anywhere.

```
adboard/
  server.js         all HTTP routes (single file, sectioned by comments)
  db.js             SQLite schema + migrations (ensureColumn) + listingToApi
  analytics.js      event logging  — see "The two AI-adjacent features"
  pricing.js        transparent price guide — see same
  integrations.js   Google OAuth / Razorpay / Resend, all env-gated + optional
  public/           static front end, one file per page
    shared.js       nav, footer, calendar, esc(), formatters, PWA install
    styles.css      whole design system
    sw.js           service worker (network-first — read the comment in it)
```

Tables: `users, listings, bookings, sessions, password_resets, oauth_states,
vendors, service_requests, blocked_dates, booking_photos, listing_photos,
user_consents, space_requests, events`.

Roles: `client` (advertiser), `owner` (has space), `vendor` (printer/fabricator/
installer). An `is_admin` flag on `users` (set from `ADMIN_EMAILS`, never via any
public path) gates the private operator console at `/console.html`.

## Non-negotiable invariants

Each of these was a real bug or a deliberate defense. Don't regress them.

1. **Dates: never `toISOString()` for date-only values.** Constructing a date
   from `"YYYY-MM-DD"` in local time then reading it back as UTC shifts it a day
   backwards for any UTC+ timezone — i.e. all of India, our entire market. A
   Sep 1–10 booking rendered as booked Aug 31–Sep 9. Use `expandDateRange()` /
   `localISODate()` in `shared.js`.
2. **`events.price_snapshot` is copied in at event time, never joined.** If an
   owner edits their price, history must not silently rewrite itself, or the
   future training set is corrupt. Verified by changing a listing 40k→90k and
   confirming prior events stayed at 40k.
3. **`analytics.track()` must never throw.** Verified by dropping the `events`
   table while running — the event dropped, the product kept working. Analytics
   must never 500 a real booking.
4. **Escape user input before `innerHTML`.** Use `esc()` from `shared.js`. A
   stored-XSS hole was found and closed here once already.
5. **Money is stored in paise (integers).** Never floats. `amount_total`,
   `platform_fee`, `owner_payout`.
6. **`sw.js` is network-first, not stale-while-revalidate.** Filenames aren't
   content-hashed, so a cached `styles.css` next to fresh HTML visibly breaks
   the page after deploy.
7. **No personal/cross-site data in analytics.** No IPs, no user agents, no
   third-party ids. `visitor_id` is a first-party random cookie only.
8. **A booking is confirmed through `markBookingPaid()`, never by an ad-hoc
   UPDATE.** The browser return and the Razorpay webhook both report the same
   payment and *both normally fire* — they race. The guarded write
   (`WHERE payment_status != 'paid'`) is what makes the second one a no-op. Bypass
   it and `booking_paid` gets logged twice, which double-counts real revenue in
   the only dataset a future pricing model can learn from (see invariant 2).
   Verified by redelivering a webhook and confirming one event, not two.
9. **The webhook authenticates by HMAC over the raw body — keep `rawBody`
   intact.** `express.json({ verify })` in `server.js` stashes the original bytes
   because re-serialising the parsed object does not reproduce them and every
   signature would fail. The route has no session by design; the signature *is*
   the auth. Also: only `payment.captured` confirms (`authorized` is a hold, not
   money), the charged amount is checked against our locked quote, and unknown
   orders still return 2xx — a non-2xx makes Razorpay retry for hours over
   something retries can't fix.
10. **The admin surface 404s for everyone who isn't an operator — never 403.**
    `requireAdmin` returns the same "Not found" whether the caller is anonymous
    or a logged-in non-admin, so the console API can't be probed. There is no
    admin link anywhere public and no public way to become admin; `is_admin` is
    synced from `ADMIN_EMAILS` on login only.
11. **Consent is enforced server-side, and re-consent is a single gate.** Register
    rejects without `acceptedTerms`; `/api/me` returns `needsConsent`, and one
    blocking modal in `shared.js` (`mountConsentGate`) covers new Google users
    and every existing user after a `POLICY_VERSION` bump. Bumping that constant
    (in `db.js`) is how a new policy is "pushed" — no per-user migration.
12. **A refunded booking must leave the revenue/payout math.** `applyRefund`
    sets `payment_status='refunded'` + `status='cancelled'`; every admin
    overview/ledger figure filters on `payment_status='paid'`, so refunds fall
    out automatically. Refund is blocked once the owner payout is marked sent.

## Design system — and why it looks like this

Real user feedback earlier: the site *"looks like any other vibe-coded website"*
and *"some misunderstood this website as spam ads."* The current look is the fix,
so don't drift back toward generic SaaS.

- **Fonts:** Fraunces (serif, headings) + Work Sans (body). Deliberately not
  Inter-everywhere, which reads as AI-generated default.
- **Palette:** cream `#faf6ee` bg, deep teal `#0b6e5c` brand, terracotta
  `#c1502a` action, forest/goldenrod/brick for status. Deliberately **not**
  blue+orange SaaS default.
- **No emoji anywhere.** Arrows (→ ←) are fine.
- **Real photography** (Unsplash, free licence) — no illustrated cartoons, and
  avoid any image with visible third-party trademarks. **Never use an image
  with a stock watermark on it**; covering the watermark is circumventing the
  licence, not clearing it. This rule has already caught a live violation: the
  homepage *Billboards* card shipped for a while carrying a real Kaplan
  Business School ad.
- **Homepage format cards** (`public/images/formats/*.jpg`) are Unsplash bases
  with a BookMyBoard creative perspective-composited onto the board face, so
  the marketplace advertises itself instead of someone else's brand. The
  build script lives in the scratchpad, not the repo — if these need
  regenerating, the recipe is: warp the creative onto the board quad, then
  blend back a **heavily blurred** copy of the original for scene lighting.
  Blending back an unblurred copy leaves the previous ad's text legible
  through the new artwork.
- **Contact address is literal text in 5 files** (`contact/terms/privacy/
  refunds.html` + the footer in `shared.js`, 10 occurrences). No build step, so
  changing it is one `sed` across `public/`. Currently a Gmail placeholder —
  **switch to a domain address once the domain is registered.**
- **Mobile-first**, verified at 375px. Nav overflow at 375px has bitten twice —
  check it after nav changes.
- No fake testimonials, fake brand logos, or inflated stats. All were removed
  once already for exactly this reason.

## Features, and why each exists

- **Listings + search/filter/sort** — the browse surface.
- **Availability calendars** — advertisers pick dates on a real month calendar
  (not raw date inputs); owners block/unblock days from *My listings → Manage
  calendar*. Blocked days reject overlapping bookings server-side. This is the
  "movie ticket" seat-map equivalent.
- **Proof-of-play photos** — owner attaches a mounting photo to an approved
  booking; advertiser sees it as proof the creative actually went up. This
  targets **the single biggest trust gap for static OOH**: "is my banner
  actually up, 400km away?" Compressed client-side via canvas before upload.
  (Currently base64 in SQLite — fine at MVP scale, should move to object
  storage later.)
- **Listing site photos** — owner attaches photos of the physical location on
  the *Add a space* form (reuses `fileToCompressedDataUrl`). Served as real image
  responses from `/api/listing-photos/:id` (not base64 in the listing JSON), so
  the browse list stays light; shown as a cover thumbnail on cards and a swappable
  gallery on the listing page. Same base64-in-SQLite storage caveat as above.
- **Legal + consent** — Terms, Privacy (DPDP-aware), Refund/Cancellation and
  Contact pages, footer-linked. Consent captured at signup and re-forced on a
  `POLICY_VERSION` bump (see invariant 11). Entity name/address are marked-up
  placeholders until the business is registered — **fill before go-live.**
- **Operator console** (`/console.html`, unlinked) — insights, a bookings view,
  the manual owner-payout ledger, refunds, and policy-adoption. Admin-gated
  (invariant 10). Owner payouts are **off-platform**: the ledger tracks who is
  owed what; you transfer and mark it paid. Refunds are admin-initiated full
  Razorpay refunds (see invariant 12).
- **Payments + commission** — quote is **locked at request time** so it can't
  move between request and approval. Owner sees net payout after fee.
  `PLATFORM_COMMISSION_PCT` default 10. Confirmation arrives by **two
  independent routes** — the browser returning from checkout, and Razorpay's
  webhook (`POST /api/webhooks/razorpay`). Either alone confirms the booking,
  so a payer who closes the tab mid-checkout no longer loses their booking.
  Both funnel through `markBookingPaid()` — see invariant 8.
- **Suppliers marketplace** — printers/fabricators/LED suppliers/installers.
  This is the "execution" layer where the bad experience actually lives (late
  mounting, no proof), and a second margin source.
- **Auth** — scrypt + HttpOnly session cookies (30d), role-gated APIs, Google
  sign-in, password reset (single-use, 1h, invalidates sessions).
- **PWA** — installable, `/install.html` is a shareable install link. Android/
  desktop get a real install prompt; iOS Safari has no such API, so it shows
  Share → Add to Home Screen instructions. That asymmetry is a platform limit,
  not a bug.

## The two AI-adjacent features (read this before "adding AI")

The MSME hackathon pitch promises AI dynamic pricing + CV site verification.
Both are **genuinely on the roadmap**, but here's the honest state and why the
current implementation is what it is.

### Why it isn't ML today

1. **Zero data.** Production has ~0 listings, 0 bookings. ML pricing learns from
   transaction outcomes. There are none.
2. **The industry has no shared unit of measure.** Published India OOH CPMs
   range ₹0.15–0.40, ₹50–200 (premium), ₹400–4,000 (DOOH) — *four orders of
   magnitude for the same nominal unit*. Mordor Intelligence names the absence
   of standardised audience measurement as the key structural barrier. You
   cannot model a price when there is no agreed denominator. **This is why no
   Indian competitor has one either — it was never a modelling problem.**

### 1. `analytics.js` — the event log (the actual groundwork)

Logs: `search` (incl. zero-result), `listing_view`, `listing_created`,
`booking_requested`, `booking_blocked` (turned-away demand), `booking_decided`
(with owner response time), `booking_paid`, `price_suggested`.

None of this is recoverable retroactively — if it isn't captured as it happens,
it's gone. This is the only reason a model could exist in 12–18 months.

Read it: `GET /api/admin/insights?days=30&token=$ADMIN_TOKEN` (gated by
`ADMIN_TOKEN`, timing-safe compare, 404s entirely if unset). **`ADMIN_TOKEN` is
already set in Railway.**

**`zeroResultSearches` is the field that pays off immediately** — it maps demand
we can't supply, i.e. exactly which owners to go recruit in which city. Useful
at 10 visitors, not 10,000.

Its explicit counterpart is the **`space_requests` table**: the "Can't find the
right space?" form on browse, promoted automatically whenever a search returns
nothing. Where a zero-result search only records the filters someone happened to
try, this captures the city in their own words *plus a contact* — so demand
becomes a list of people to call once supply exists. **Open to logged-out
visitors on purpose**: the most valuable signal comes from people who would have
bounced rather than sign up. Operators read it in the console under *Wanted
spaces*, grouped by city.

`modelReadiness` tracks observations vs a rough 300 threshold. It is honest on
purpose; don't dress it up.

### 2. `pricing.js` — the transparent price guide

A **plain rules engine, not ML, on purpose**: city-tier baseline → traffic
positioning → format multiplier → backlit bonus. Every step is returned to the
client and rendered as a visible "see the math" list.

**The strategic point:** the product's whole thesis is fixing opaque OOH
pricing. A black-box "AI price" would contradict the exact promise being made.
**Explainability isn't a compromise here — it is the product.** Do not relabel
this "AI" in the UI. It says "Suggested range" and shows its work.

Two surfaces: live suggestion on the owner's *Add a space* form (informs, never
overwrites the price field), and an audit of the asking price on the public
listing page (it will tell an owner their own listing is 64% over — verified).

Calibration: band constants come from published rate cards, then corrected
against one real anchor — a Balangir hoarding (48K traffic/day) genuinely listed
at ₹55,000. The initial "other city" band (₹15k–1.5L, matching tier-2 capitals
like Jaipur/Lucknow) overshot that by ~50%, because traffic positioning alone
can't tell a small district town from a tier-2 capital. Ceiling pulled to ₹90k
rather than fake city-tier precision we can't defend. **When real bookings
exist, recalibrate these constants against `price_snapshot` outcomes** — that's
what the event log is for.

### The bigger prize (unbuilt)

Because the industry has no credible impressions metric, **whoever publishes an
open, auditable one owns the category definition.** We already collect traffic,
format, lighting. A published "BookMyBoard Impressions" methodology is a far
bigger moat than any pricing model — and CV verification feeds it.
**Measurement is the prerequisite for pricing, not a parallel track.**

## Market research (done, don't redo)

Sources: Mordor Intelligence, EY, Adgully/Media4Growth, Tracxn, Inc42,
vigyapanmart/shubindia rate guides.

- India OOH ≈ **₹6,000–6,500 cr**; EY projects ₹7,900 cr by 2027. Static still
  ~68% of revenue.
- **DOOH is only ~12% of India OOH** (vs US 40%, China 90%) but growing ~24%+.
  Huge headroom.
- **Fragmentation is real and documented**: top 5 operators hold **<25%** of
  revenue. JCDecaux + Times OOH + Laqshya ≈22% but **only** in premium airport/
  metro/transit. Everything else — highways, tier-2/3, standalone hoardings —
  is unorganised long tail. That's our market.
- **Brokers take 15–25%.** Pricing is openly described as opaque and
  relationship-driven. The user's original thesis (phone numbers painted on
  boards, brokers slow + expensive) **checked out**.
- Competitors:
  - **Times OOH** ₹1,230 cr FY25 (media owner, premium transit, not our lane)
  - **Adonmo** $72.4M raised, Zomato-backed, ~₹150 cr, 66k+ screens — but
    **asset-heavy and metro-focused**, owns its screens
  - **The Media Ant / MyHoardings** — closest conceptually, but **enquiry-based
    lead-gen, not e-commerce**. "Submit enquiry, our team will call you."
  - **AdBoard Booking / Banrboard / BookMyMedia** — same idea as us, very early,
    no traction
  - **Lemma** — programmatic DOOH SSP infra; a potential **partner**, not rival
  - Global proof: **Blip** (US, self-serve pay-per-play), **AdQuick**;
    **Vistar Media acquired by T-Mobile Jan 2025** — validates the category.
- **Key gap:** *nobody in India has built real self-serve checkout.* Every
  player, including funded ones, ends at "enquire and we'll call." That's the
  wedge.
- **Regulatory:** hoardings are municipally licensed; post-2024 Ghatkopar
  collapse (17 deaths, illegal oversized board) enforcement is tightening.
  Capturing permit/licence number turns compliance into a trust badge.

### Strategy corrections already made (don't re-open without reason)

- **Commission: 10–15%, not 5%.** 5% of a ₹30k tier-2 board = ₹1,500/mo — won't
  cover acquisition/support/payments. Owners already give brokers 15–25%, so
  10–15% still *halves* their cost of sale. 5% is the endgame at scale, not the
  opening move. (Currently set to 10.)
- **"Upload a video and it's live" isn't real yet** even for digital. Third-party
  screens need CMS control (Adonmo can do it because it owns the stack; a
  Balangir LED owner uses a USB stick). Ship **"self-serve booking,
  operator-assisted publishing"** first — the customer experience is still
  upload-and-done — then automate via CMS/Lemma integrations.
- **Tier-2/3 first.** Every competitor fights over metros. Balangir-type towns
  have no competition, weakest brokers, individual owners.

## Roadmap / next candidates

Done in the production-readiness pass (all verified end-to-end): legal/consent,
listing site photos, private operator console + manual payout ledger, and the
admin refund/cancellation flow.

- **Click through the live Razorpay test-mode pay loop from the UI** — the only
  untested-in-browser piece; blocked on real test keys. Our own logic (order,
  verify, webhook, refund) is verified; the hosted checkout widget needs keys.
- **CV site verification** (the hackathon's other half) — auto-estimate
  footfall/visibility, confirm specs from a photo. Feeds the measurement
  standard above. **The honest next big build.**
- Map view of inventory; permit/licence number field.
- Razorpay Route for automatic owner payouts (replaces the manual ledger).
- Listing/site photos + proof photos → object storage (S3/R2) instead of base64.
- Recalibrate `pricing.js` constants once bookings exist.
- **Real domain** (kills the stale `advista` URL) + fill the legal-entity
  placeholders in the policy pages — both gate Razorpay live-mode activation.

## Blocked on the user (accounts only they can create)

`integrations.js` is fully written and env-gated — these light up on config
alone, no code changes:

| Env var | Enables | Status |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Google sign-in | **not set** |
| `RAZORPAY_KEY_ID` / `_SECRET` | payments + commission | **not set** |
| `RAZORPAY_WEBHOOK_SECRET` | webhook backstop (route 404s until set) | **not set** |
| `RESEND_API_KEY` | password-reset emails | **not set** (links print to server log meanwhile) |
| `ADMIN_TOKEN` | admin API for scripts/curl (legacy) | **set** |
| `ADMIN_EMAILS` | operator console login (comma-separated) | **not set** — set to your email(s) |
| `DATA_DIR=/data` | SQLite persistence | **set**, volume mounted |

`RAZORPAY_API_BASE` exists only as a test seam (defaults to the real API);
**never set it in production.** Operator console: set `ADMIN_EMAILS` to your
account email, sign in normally, then open `/console.html` (it's unlinked).

Razorpay setup, when the account exists: create the webhook in Dashboard →
Settings → Webhooks pointing at `<APP_URL>/api/webhooks/razorpay`, subscribe to
**`payment.captured`**, and set its secret as `RAZORPAY_WEBHOOK_SECRET`.
**That secret is generated in the webhook form and is *not* the API key secret** —
mixing them up fails every signature check. `RAZORPAY_KEY_ID`/`_SECRET` alone
still take payments; the webhook only adds the dropped-connection backstop.

## Working style that fits this user

- **They want the honest read, not agreement.** Pushing back has been correct
  and welcomed — e.g. telling them the idea didn't fit the hackathon themes
  until real frontier tech was added, and that 5% commission won't work.
- **Never AI-wash.** They explicitly value that the price guide isn't called AI.
- **Verify, don't claim.** Every feature here was tested end-to-end (curl +
  browser) before being called done; several real bugs (timezone, XSS,
  contrast, nav overflow) were caught that way.
- They deploy constantly and check on a real phone.
- Related: MSME IDEA Hackathon 6.0 application (BITS Pilani host, "Other
  Frontier Technologies", deadline was 14 Jul 2026) — pitch text + block diagram
  were drafted; ask before assuming its status.
