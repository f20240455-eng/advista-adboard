// Shared helpers: nav rendering, auth state, formatting.

const THEME_ICONS = {
  highway: "🛣️",
  digital: "📺",
  urban: "🏙️",
  fuel: "⛽",
};

function themeIcon(theme) {
  return THEME_ICONS[theme] || "🪧";
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

function renderNav(user, activePage) {
  const nav = document.createElement("nav");
  const links = [];
  links.push(`<a href="/listings.html" class="${activePage === "listings" ? "active" : ""}">Browse Spaces</a>`);
  if (user) {
    links.push(`<a href="/dashboard.html" class="${activePage === "dashboard" ? "active" : ""}">Dashboard</a>`);
    links.push(`<a href="#" id="logout-link">Log out (${user.name.split(" ")[0]})</a>`);
  } else {
    links.push(`<a href="/login.html" class="${activePage === "login" ? "active" : ""}">Log in</a>`);
    links.push(`<a href="/login.html?mode=register" class="btn btn-primary btn-small">Get Started</a>`);
  }
  nav.innerHTML = `
    <div class="nav-inner">
      <a href="/" class="brand"><span class="logo">🪧</span>AdVista</a>
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

function listingCardHTML(l) {
  return `
    <a class="listing-card" href="/listing.html?id=${l.id}">
      <div class="card-banner banner-${l.theme}">
        ${themeIcon(l.theme)}
        <span class="type-tag">${l.type}</span>
        ${l.lit ? '<span class="lit-tag">✦ Backlit</span>' : ""}
      </div>
      <div class="card-body">
        <h3>${l.title}</h3>
        <p class="loc">📍 ${l.location}, ${l.city}</p>
        <div class="card-meta">
          <div class="price">${formatINR(l.pricePerMonth)}<span>/month</span></div>
          <div class="traffic">🚗 ${formatTraffic(l.trafficPerDay)}/day</div>
        </div>
      </div>
    </a>`;
}
