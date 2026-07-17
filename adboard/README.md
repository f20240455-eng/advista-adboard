# BookMyBoard — Outdoor Advertising Marketplace

A two-sided marketplace where owners of billboard real estate (fuel stations,
highways, malls, rooftops) list ad spaces, and advertisers browse, filter and
book them for campaign date ranges — directly, with no brokers.

## Run it

```sh
npm install
npm start
# open http://localhost:3000
```

The marketplace starts empty — owners add real listings from their dashboard.
There is no seeded demo inventory.

## Data storage

Data is stored in a SQLite database (`bookmyboard.db`). By default it sits next
to the app; in production set `DATA_DIR` to a mounted persistent volume so data
survives redeploys:

```sh
DATA_DIR=/data npm start
```

### Deploying on Railway

1. Connect the GitHub repo (root directory `adboard`).
2. Add a **Volume** mounted at e.g. `/data`.
3. Set env var `DATA_DIR=/data`.

`PORT` is provided by Railway automatically.

## Optional integrations

Every integration below is off by default. The app runs fine without them and
switches each feature on only when its variables are present. Set these in the
Railway dashboard (or a local shell) — never commit them.

| Variable | Enables | Where to get it |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Continue with Google" | Google Cloud Console → OAuth 2.0 Client ID (Web). Add `<your-url>/auth/google/callback` as an authorised redirect URI. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Online payment + commission | Razorpay Dashboard → API Keys (needs a verified merchant account) |
| `RESEND_API_KEY`, `MAIL_FROM` | Password-reset emails | resend.com API key + a verified sender |
| `PLATFORM_COMMISSION_PCT` | Platform fee %, default `10` | your call |
| `APP_URL` | Absolute links in emails / OAuth redirects | e.g. `https://yourdomain.com` |
| `ADMIN_TOKEN` | `/api/admin/insights` (marketplace analytics) | any long random string you choose. Without it the route returns 404. |

Without `RESEND_API_KEY`, password-reset links are printed to the server log
instead of emailed, so the flow stays testable in development.

## Features

- **Public site** — landing page, browsable listings with search + city /
  format / budget filters and sorting, detail pages with specs, live
  booked-date info, and a campaign cost/impressions estimator.
- **Advertiser accounts** — register/log in, request a booking for a date
  range, track request status, pay online once approved.
- **Owner accounts** — publish listings, review booking requests, approve or
  reject. Approvals are blocked when dates clash with an existing approved
  booking. Owners see their net payout after the platform fee.
- **Supplier accounts** — banner printers, fabricators, LED-screen suppliers
  and installers publish a service listing and receive quote requests.
- **Payments & commission** — the quote is locked when the advertiser requests
  the booking; on payment the platform fee and owner payout are recorded
  against it. Amounts are stored in paise to avoid rounding drift.
- **Auth** — scrypt-hashed passwords, HttpOnly session cookies (30-day),
  role-based API authorization, Google sign-in, and password reset with
  single-use, one-hour tokens that invalidate existing sessions.

## Price guide (not AI, on purpose)

`GET /api/price-estimate?city=&type=&trafficPerDay=&lit=` returns a suggested
price range plus the exact arithmetic used to reach it — see `pricing.js`.
This is a plain rules engine, not a model, and that is deliberate: the
product's whole thesis is fixing opaque OOH pricing, so a black-box "AI
price" would contradict the promise being made. Every constant is a comment
in that file; every step is returned to the client and rendered as a visible
"see the math" breakdown, both on the owner's Add a space form (a live
suggestion, informing but never overwriting the price field) and on the
public listing page (an audit of the actual asking price — including telling
an owner their own listing is priced above range).

Band constants are grounded in published rate cards, then checked against
one real data point (a Balangir hoarding, 48K traffic/day, actually listed at
₹55,000 — the untrimmed "other city" band overshot that by ~50% before the
band ceiling was pulled down). As real bookings accumulate, recalibrate these
constants against what actually got booked and paid for — that's what the
event log's `price_snapshot` field exists to make possible. Checking a price
against a real listing (not every keystroke) logs a `price_suggested` event
for exactly that future comparison.

## Event log (pricing groundwork)

Every meaningful marketplace action is recorded in the `events` table: searches
(including zero-result ones), listing views, booking requests, owner decisions,
payments, and turned-away demand. This is deliberate groundwork — a pricing or
demand model can only ever be trained on history that was captured as it
happened, and none of it is recoverable retroactively.

Three design rules, all load-bearing:

- **Prices are snapshotted, never joined.** `events.price_snapshot` is copied in
  at event time, so an owner editing their price later cannot silently rewrite
  past observations.
- **Logging can never break the product.** `analytics.track()` swallows its own
  errors; a failure drops one event and nothing else.
- **No personal or cross-site data.** No IP addresses, no user agents, no
  third-party ids. `visitor_id` is a first-party random id (90-day cookie) used
  only to group one person's own activity on this site.

Read the aggregates with `ADMIN_TOKEN` set:

```sh
curl "$APP_URL/api/admin/insights?days=30&token=$ADMIN_TOKEN"
```

`zeroResultSearches` is the most immediately useful output: it maps demand the
marketplace currently cannot supply, i.e. which owners to recruit in which city.

## Stack

Node + Express, SQLite (`better-sqlite3`), vanilla HTML/CSS/JS frontend. No
build step — `npm start` runs everything. Billboard-format photography is
hotlinked from Unsplash (free license, no attribution required).

## Roadmap

- AI dynamic pricing and demand prediction from traffic, seasonality and
  booking history
- Computer-vision site verification: auto-estimate footfall/visibility and
  confirm a site's specs from a photo
- Map view of inventory and an availability calendar UI
- Automated payouts to owners (Razorpay Route) so the split settles itself
