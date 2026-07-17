// Shared helpers: nav/footer rendering, real billboard photography, formatting.

// Real photography (Unsplash, free license) per listing theme — chosen to avoid
// any visible third-party trademarks. Photographer credit lives in the footer.
const THEME_PHOTOS = {
  highway: "https://images.unsplash.com/photo-1699480114704-ac153307d2a0",
  digital: "https://images.unsplash.com/photo-1643642969389-6db6b7a0fa56",
  urban: "https://images.unsplash.com/photo-1691480189419-b0c138c00c10",
  fuel: "https://images.unsplash.com/photo-1567777176186-dfa735f1fe20",
};

function themePhoto(theme, width) {
  const base = THEME_PHOTOS[theme] || THEME_PHOTOS.urban;
  return `${base}?auto=format&fit=crop&w=${width}&q=65`;
}

// Anything a user typed must go through this before it reaches innerHTML.
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatINR(n) {
  return "₹" + Number(n).toLocaleString("en-IN");
}

function formatTraffic(n) {
  if (n >= 100000) return (n / 100000).toFixed(1).replace(/\.0$/, "") + "L";
  if (n >= 1000) return Math.round(n / 1000) + "K";
  return String(n);
}

// ---------- availability calendar ----------
// A small, dependency-free month calendar used two ways: 'pick' lets an
// advertiser click a start and end day instead of typing raw dates; 'manage'
// lets an owner click a day to toggle it blocked. Both share one renderer so
// the two views can never visually drift apart.

// Parsing "YYYY-MM-DDT00:00:00" (no zone) makes Date treat it as local
// midnight; converting that back with toISOString() reads it out in UTC,
// which silently shifts every date back a day for anyone east of UTC —
// India included. Do the whole round trip in UTC so it's timezone-invariant.
function expandDateRange(startDate, endDate) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const out = [];
  const d = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// Local calendar date as YYYY-MM-DD — deliberately not toISOString(), which
// would report UTC's date and briefly disagree with "today" every night in
// any UTC+ timezone.
function localISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = new Array(first.getDay()).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function calendarHTML({ year, month, booked, blocked, today, selStart, selEnd }) {
  const monthName = new Date(year, month, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const dow = ["S", "M", "T", "W", "T", "F", "S"];
  const cells = monthMatrix(year, month);
  let html = `
    <div class="cal-head">
      <button type="button" class="cal-nav" data-nav="-1" aria-label="Previous month">‹</button>
      <span class="cal-title">${monthName}</span>
      <button type="button" class="cal-nav" data-nav="1" aria-label="Next month">›</button>
    </div>
    <div class="cal-grid cal-dow">${dow.map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="cal-grid">`;
  cells.forEach((d) => {
    if (!d) { html += `<span class="cal-cell cal-empty"></span>`; return; }
    const classes = ["cal-cell"];
    if (d < today) classes.push("cal-past");
    else if (booked.has(d)) classes.push("cal-booked");
    else if (blocked.has(d)) classes.push("cal-blocked");
    else classes.push("cal-open");
    if (selStart && d === selStart) classes.push("cal-sel-edge");
    if (selEnd && d === selEnd) classes.push("cal-sel-edge");
    if (selStart && selEnd && d > selStart && d < selEnd) classes.push("cal-sel-range");
    html += `<button type="button" class="${classes.join(" ")}" data-date="${d}">${Number(d.slice(8))}</button>`;
  });
  html += `</div>`;
  return html;
}

// mode 'pick': onChange({selStart, selEnd}) as the advertiser clicks two days.
// mode 'manage': onChange({date, wasBlocked}) as the owner clicks a day to toggle it.
function mountCalendar(container, { booked = new Set(), blocked = new Set(), mode = "pick", onChange } = {}) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  const today = localISODate(now);
  let selStart = null;
  let selEnd = null;

  function draw() {
    container.innerHTML = calendarHTML({ year, month, booked, blocked, today, selStart, selEnd });
    container.querySelector('[data-nav="-1"]').addEventListener("click", () => {
      month--; if (month < 0) { month = 11; year--; } draw();
    });
    container.querySelector('[data-nav="1"]').addEventListener("click", () => {
      month++; if (month > 11) { month = 0; year++; } draw();
    });
    container.querySelectorAll(".cal-cell[data-date]").forEach((cell) => {
      cell.addEventListener("click", () => {
        const d = cell.dataset.date;
        if (cell.classList.contains("cal-past") || cell.classList.contains("cal-booked")) return;
        if (mode === "pick") {
          if (cell.classList.contains("cal-blocked")) return;
          if (!selStart || selEnd) { selStart = d; selEnd = null; }
          else if (d < selStart) { selStart = d; }
          else { selEnd = d; }
          draw();
          onChange && onChange({ selStart, selEnd });
        } else {
          const wasBlocked = blocked.has(d);
          onChange && onChange({ date: d, wasBlocked });
        }
      });
    });
  }
  draw();
  return {
    setUnavailable(nextBooked, nextBlocked) { booked = nextBooked; blocked = nextBlocked; draw(); },
    clearSelection() { selStart = null; selEnd = null; draw(); },
  };
}

// ---------- proof-of-play photo capture ----------
// Downscales a phone photo client-side before it ever reaches the server —
// keeps the SQLite row small and the upload fast on a weak connection.
function fileToCompressedDataUrl(file, maxDim = 1400, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That doesn't look like an image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

async function getMe() {
  try {
    const { user } = await api("/api/me");
    return user;
  } catch {
    return null;
  }
}

// Which optional integrations (Google sign-in, payments) are switched on.
let _config = null;
async function getConfig() {
  if (_config) return _config;
  try {
    _config = await api("/api/config");
  } catch {
    _config = { googleEnabled: false, razorpayEnabled: false, commissionPct: 10 };
  }
  return _config;
}

// ---------- install / PWA ----------
// Chrome-family browsers fire beforeinstallprompt when the app qualifies for
// installation. We stash the event so our own button can trigger the native
// prompt later. iOS Safari has no equivalent API — there we can only show the
// manual "Share -> Add to Home Screen" steps.
let _installPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  _installPrompt = e;
  document.dispatchEvent(new CustomEvent("bmb:installable"));
});

window.addEventListener("appinstalled", () => {
  _installPrompt = null;
  document.dispatchEvent(new CustomEvent("bmb:installed"));
});

// True once the app is launched from the home screen rather than a browser tab.
function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    // iPadOS 13+ identifies as a Mac; touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function canPromptInstall() {
  return Boolean(_installPrompt);
}

async function promptInstall() {
  if (!_installPrompt) return { outcome: "unavailable" };
  _installPrompt.prompt();
  const choice = await _installPrompt.userChoice;
  _installPrompt = null; // the event can only be used once
  return choice;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((e) => console.warn("Service worker registration failed:", e));
  });
}

function showToast(message, type = "success") {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const toast = document.createElement("div");
  toast.className = "toast" + (type === "error" ? " error" : "");
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3800);
}

function renderNav(user, activePage) {
  const nav = document.createElement("nav");
  const links = [];
  links.push(`<a href="/listings.html" class="${activePage === "listings" ? "active" : ""}">Browse spaces</a>`);
  links.push(`<a href="/services.html" class="hide-sm ${activePage === "services" ? "active" : ""}">Suppliers</a>`);
  if (user) {
    links.push(`<a href="/dashboard.html" class="${activePage === "dashboard" ? "active" : ""}">Dashboard</a>`);
    links.push(`<a href="#" id="logout-link" class="hide-sm">Log out</a>`);
  } else {
    links.push(`<a href="/login.html" class="hide-sm ${activePage === "login" ? "active" : ""}">Log in</a>`);
    links.push(`<a href="/login.html?mode=register" class="btn btn-primary btn-small">Get started</a>`);
  }
  nav.innerHTML = `
    <div class="nav-inner">
      <a href="/" class="brand">Book<span class="accent-word">MyBoard</span></a>
      <div class="nav-links">
        <button type="button" class="btn btn-outline btn-small nav-install" id="nav-install" hidden>Install app</button>
        ${links.join("")}
      </div>
    </div>`;
  document.body.prepend(nav);

  const logout = document.getElementById("logout-link");
  if (logout) {
    logout.addEventListener("click", async (e) => {
      e.preventDefault();
      await api("/api/logout", { method: "POST" });
      window.location.href = "/";
    });
  }

  mountInstallBanner();

  // Offer the install button only where it can actually do something: a browser
  // that has told us the app is installable, and not already installed.
  const installBtn = document.getElementById("nav-install");
  if (installBtn && !isStandalone()) {
    const reveal = () => { installBtn.hidden = false; };
    if (canPromptInstall()) reveal();
    document.addEventListener("bmb:installable", reveal);
    document.addEventListener("bmb:installed", () => { installBtn.hidden = true; });
    installBtn.addEventListener("click", async () => {
      const { outcome } = await promptInstall();
      if (outcome === "accepted") showToast("Installing BookMyBoard…");
      installBtn.hidden = true;
    });
  }
}

function renderFooter() {
  const footer = document.querySelector("footer");
  if (!footer) return;
  footer.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <a href="/" class="brand">Book<span class="accent-word">MyBoard</span></a>
          <p>India's marketplace for outdoor advertising — book billboard space directly from the people who own it.</p>
        </div>
        <div class="footer-col">
          <h4>Explore</h4>
          <ul>
            <li><a href="/listings.html">Browse spaces</a></li>
            <li><a href="/services.html">Suppliers &amp; services</a></li>
            <li><a href="/login.html?mode=register&role=owner">List your space</a></li>
            <li><a href="/login.html?mode=register&role=vendor">List your service</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>Get in touch</h4>
          <ul>
            <li><a href="/install.html">Get the app</a></li>
            <li><a href="mailto:hello@bookmyboard.in">hello@bookmyboard.in</a></li>
            <li>Mon–Sat, 10am–7pm</li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getFullYear()} BookMyBoard</span>
        <span>Photography via Unsplash</span>
      </div>
    </div>`;
}

function listingCardHTML(l) {
  return `
    <a class="listing-card" href="/listing.html?id=${encodeURIComponent(l.id)}">
      <div class="card-banner">
        <img src="${themePhoto(l.theme, 600)}" alt="" loading="lazy" />
        <span class="type-tag">${esc(l.type)}</span>
        ${l.lit ? '<span class="lit-tag">Backlit</span>' : ""}
      </div>
      <div class="card-body">
        <h3>${esc(l.title)}</h3>
        <p class="loc">${esc(l.location)}, ${esc(l.city)}</p>
        <div class="card-meta">
          <div class="price">${formatINR(l.pricePerMonth)}<span>/month</span></div>
          <div class="traffic">${formatTraffic(l.trafficPerDay)} vehicles/day</div>
        </div>
      </div>
    </a>`;
}

// The nav button is desktop-only (the mobile nav has no room for it), so phones
// get a dismissible banner instead — which is also where installing matters most.
function mountInstallBanner() {
  if (isStandalone()) return;
  if (localStorage.getItem("bmb-install-dismissed") === "1") return;

  const show = () => {
    if (document.getElementById("install-banner")) return;
    const bar = document.createElement("div");
    bar.id = "install-banner";
    bar.className = "install-banner";
    bar.innerHTML = `
      <img src="/icons/icon-192.png" alt="" width="38" height="38" />
      <div class="ib-text">
        <strong>Add to home screen</strong>
        <span>Open BookMyBoard like an app</span>
      </div>
      <button type="button" class="btn btn-primary btn-small" id="ib-install">Install</button>
      <button type="button" class="ib-close" id="ib-close" aria-label="Dismiss">&times;</button>`;
    document.body.appendChild(bar);

    document.getElementById("ib-install").addEventListener("click", async () => {
      const { outcome } = await promptInstall();
      bar.remove();
      if (outcome === "unavailable") window.location.href = "/install.html";
    });
    document.getElementById("ib-close").addEventListener("click", () => {
      localStorage.setItem("bmb-install-dismissed", "1"); // don't nag again
      bar.remove();
    });
  };

  if (canPromptInstall()) show();
  document.addEventListener("bmb:installable", show);
  document.addEventListener("bmb:installed", () => {
    const b = document.getElementById("install-banner");
    if (b) b.remove();
  });
}

// Every page that loads this file gets the service worker, which is what makes
// the app installable and gives it an offline fallback.
registerServiceWorker();

// ---------- price guide ----------
// Renders the arithmetic from /api/price-estimate as a plain numbered list —
// no chart, no black box. The whole point is that anyone can read every step.
function priceGuideStepsHTML(steps) {
  return steps
    .map(
      (s) => `<li><span class="pg-step-label">${esc(s.label)}</span>
        <span class="pg-step-detail">${esc(s.detail)}</span>
        <span class="pg-step-running">${formatINR(s.running)}</span></li>`
    )
    .join("");
}

async function fetchPriceEstimate({ city, type, trafficPerDay, lit, listingId }) {
  const params = new URLSearchParams({
    city: city || "",
    type: type || "",
    trafficPerDay: String(trafficPerDay || 0),
    lit: lit ? "true" : "false",
  });
  if (listingId) params.set("listingId", listingId);
  return api("/api/price-estimate?" + params.toString());
}

function vendorCardHTML(v) {
  return `
    <div class="listing-card vendor-card">
      <div class="card-body">
        <span class="cat-tag">${esc(v.category)}</span>
        <h3>${esc(v.name)}</h3>
        <p class="loc">${esc(v.city)}</p>
        ${v.description ? `<p class="vendor-desc">${esc(v.description)}</p>` : ""}
        <div class="card-meta">
          <div class="price">${v.minPrice ? formatINR(v.minPrice) + '<span> onwards</span>' : '<span>Ask for a quote</span>'}</div>
          <button class="btn btn-outline btn-small" data-vendor="${esc(v.id)}">Get a quote</button>
        </div>
      </div>
    </div>`;
}
