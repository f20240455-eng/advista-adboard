// Transparent price guide. Deliberately NOT machine learning: the product's
// entire thesis is fixing opaque OOH pricing, so a black-box number would
// betray the promise we're making. Every constant below is a plain rule
// anyone can read, and estimatePrice() returns the arithmetic as a list of
// steps so the UI can show its work, not just a result.
//
// This is a starting point, not a finished model. As real bookings
// accumulate (see events.price_snapshot via /api/admin/insights), these
// constants should be recalibrated against what actually got booked and
// paid for — that recalibration is exactly what step 1 (the event log) was
// built to make possible later. Until then, this is grounded in published
// industry rate cards, not guesswork: tier-2 hoardings commonly run
// ₹20k-1.5L/month, and digital formats carry a widely quoted 30-60% premium
// over static.

// Curated, not exhaustive. Cities outside this list fall back to the wider
// "other city" band rather than a guessed tier — a smaller list we can stand
// behind beats a large one we can't.
const METRO_CITIES = new Set([
  "mumbai", "delhi", "new delhi", "bengaluru", "bangalore", "hyderabad",
  "chennai", "kolkata", "pune", "ahmedabad", "gurugram", "gurgaon", "noida",
]);

// "Other" deliberately does not stretch all the way to the tier-2-capital
// ceiling (Jaipur/Lucknow can run to ~₹1.5L). Most non-metro Indian towns are
// smaller than that, and a band wide enough to cover both ends means traffic
// positioning alone silently assumes "small town" == "tier-2 capital" at
// high traffic — checked against a real listing (a Balangir hoarding, 48K
// traffic/day, actually listed at ₹55,000) and the untrimmed band overshot
// it by ~50%. Erring toward the more common case reads better here than
// erring toward the ceiling.
const BANDS = {
  metro: { low: 100000, high: 600000, label: "Metro city baseline" },
  other: { low: 15000, high: 90000, label: "Other city baseline" },
};

// Relative to a static billboard/unipole = 1.0x.
const FORMAT_MULTIPLIER = {
  "Digital LED": 1.45,
  "Wall Wrap": 1.10,
  "Gantry": 1.05,
  "Billboard": 1.0,
  "Unipole": 1.0,
  "Metro Pillar": 0.60,
};

const LIT_BONUS = 0.10; // extended visible hours
const SPREAD = 0.15; // +/- shown around the point estimate

function tierFor(city) {
  const key = String(city || "").trim().toLowerCase();
  return METRO_CITIES.has(key) ? "metro" : "other";
}

function trafficPosition(trafficPerDay) {
  const t = Number(trafficPerDay) || 0;
  if (t < 25000) return { frac: 0.2, label: `${t.toLocaleString("en-IN")}/day — lower band (under 25K)` };
  if (t < 75000) return { frac: 0.5, label: `${t.toLocaleString("en-IN")}/day — middle band (25K-75K)` };
  return { frac: 0.8, label: `${t.toLocaleString("en-IN")}/day — upper band (75K+)` };
}

function round100(n) {
  return Math.round(n / 100) * 100;
}

function pct(n) {
  return `${n >= 0 ? "+" : ""}${Math.round(n * 100)}%`;
}

// Every step is { label, detail, running } so the UI can render the exact
// arithmetic in order — this is the whole point of the module.
function estimatePrice({ city, type, trafficPerDay, lit }) {
  const tier = tierFor(city);
  const band = BANDS[tier];
  const pos = trafficPosition(trafficPerDay);
  const steps = [];

  let value = band.low + (band.high - band.low) * pos.frac;
  steps.push({
    label: band.label,
    detail: `₹${band.low.toLocaleString("en-IN")}–₹${band.high.toLocaleString("en-IN")}/month`,
    running: round100(value),
  });
  steps.push({
    label: "Traffic positioning",
    detail: pos.label,
    running: round100(value),
  });

  const mult = FORMAT_MULTIPLIER[type];
  if (mult != null && mult !== 1.0) {
    value *= mult;
    steps.push({
      label: `${type} adjustment`,
      detail: mult > 1
        ? `${pct(mult - 1)} — digital/large-format carries a premium over static`
        : `${pct(mult - 1)} — typically sold as part of a multi-unit run`,
      running: round100(value),
    });
  }

  if (lit) {
    value *= 1 + LIT_BONUS;
    steps.push({
      label: "Backlit / illuminated",
      detail: `${pct(LIT_BONUS)} for extended visible hours`,
      running: round100(value),
    });
  }

  const mid = round100(value);
  return {
    tier,
    low: round100(mid * (1 - SPREAD)),
    mid,
    high: round100(mid * (1 + SPREAD)),
    steps,
  };
}

module.exports = { estimatePrice, METRO_CITIES };
