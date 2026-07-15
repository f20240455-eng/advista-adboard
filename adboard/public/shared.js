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
