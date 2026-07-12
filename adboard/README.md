# AdVista — Outdoor Advertising Marketplace

A two-sided marketplace where owners of billboard real estate (fuel stations,
highway plots, malls) list ad spaces, and advertiser clients browse, filter and
request bookings for campaign date ranges.

## Run it

```sh
npm install
npm start
# open http://localhost:3000
```

Data lives in `data.json` (auto-created with seed listings on first run).
Delete the file to reset the demo.

## Demo accounts

| Role   | Email            | Password |
| ------ | ---------------- | -------- |
| Client | client@demo.com  | demo123  |
| Owner  | owner@demo.com   | demo123  |

## Features

- **Public site** — landing page, browsable listings with search + city /
  format / budget filters, detail pages with specs and live booked-date info.
- **Client portal** — register/log in, request a booking for a date range,
  track request status on the dashboard.
- **Owner portal** — publish new listings, review booking requests,
  approve/reject. Approvals are blocked if dates clash with an existing
  approved booking.
- **Auth** — scrypt-hashed passwords, HttpOnly session cookies, role-based
  API authorization.

## Stack

Node + Express, JSON-file storage, vanilla HTML/CSS/JS frontend. No build
step, no database — everything runs with `npm start`.

## Roadmap ideas

Map view of inventory, estimated-impressions analytics, availability
calendar UI, online payments/escrow, owner verification badges, slot-based
leasing for digital LED screens, admin moderation.
