# Repo guide

This repo holds two unrelated things:

- **`adboard/` — BookMyBoard.** The active project: a live, deployed marketplace
  for Indian outdoor advertising. Essentially all work happens here.
  **Read `adboard/CLAUDE.md` before doing anything in it** — it carries the
  product thesis, architecture, market research, the reasoning behind each
  feature, and invariants that have already caused real bugs when broken.
- **`*.c` at the root** — old, unrelated C practice programs. The root
  `README.md` describes only these and is stale with respect to the repo as a
  whole. Leave them alone unless asked.

Quick start for BookMyBoard:

```sh
cd adboard && npm install && npm start   # http://localhost:3000
```

Deploys to Railway on push to `main` (`git push origin HEAD:main`).
Live: https://advista-adboard-production.up.railway.app
