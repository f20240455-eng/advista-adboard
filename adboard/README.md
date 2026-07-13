# AdVista — Outdoor Advertising Marketplace

A two-sided marketplace where owners of billboard real estate (fuel stations,
highways, malls, rooftops) list ad spaces, and advertisers browse, filter and
book them for campaign date ranges — directly, with no brokers.

## Run it

```sh
npm install
npm start
# open http://localhost:3000
```

## Data storage

Data is stored in a SQLite database (`advista.db`). By default it sits next to
the app; in production set `DATA_DIR` to a mounted persistent volume so data
survives redeploys:

```sh
DATA_DIR=/data npm start
```

On first run the database seeds a verified house account and starter inventory
so the marketplace isn't empty. Delete the `.db` files to reset.

### Deploying on Railway

1. Connect the GitHub repo (root directory `adboard`).
2. Add a **Volume** mounted at e.g. `/data`.
3. Set env var `DATA_DIR=/data`.

`PORT` is provided by Railway automatically.

## Features

- **Public site** — landing page, browsable listings with search + city /
  format / budget filters and sorting, detail pages with specs, live
  booked-date info, and a campaign cost/impressions estimator.
- **Advertiser accounts** — register/log in, request a booking for a date
  range, track request status.
- **Owner accounts** — publish listings, review booking requests, approve or
  reject. Approvals are blocked when dates clash with an existing approved
  booking.
- **Auth** — scrypt-hashed passwords, HttpOnly session cookies (30-day),
  role-based API authorization.

## Stack

Node + Express, SQLite (`better-sqlite3`), vanilla HTML/CSS/JS frontend. No
build step — `npm start` runs everything.

## Roadmap

- Forgot-password flow and Google sign-in
- Payment gateway with commission-based booking fees
- Supply-side integrations: billboard manufacturers, banner printing,
  digital-screen suppliers
- Map view of inventory and availability calendar UI
