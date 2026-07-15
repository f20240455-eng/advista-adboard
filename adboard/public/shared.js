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
      <div class="nav-links">${links.join("")}</div>
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
