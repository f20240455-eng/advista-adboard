// Shared helpers: banner art, nav/footer rendering, auth state, formatting, toasts.

const BANNER_THEMES = {
  highway: { sky: ["#2a5b9e", "#0c1e3d"], ground: "#111a2c", board: "#0f1626" },
  digital: { sky: ["#5c2d94", "#170b33"], ground: "#150e26", board: "#0d0a1c" },
  urban:   { sky: ["#11826f", "#06302a"], ground: "#08211d", board: "#0a1f1b" },
  fuel:    { sky: ["#c05f1e", "#3a1406"], ground: "#22100a", board: "#1c0e07" },
};

// Illustrated billboard scene, themed per format. viewBox is wider than tall so
// `slice` scaling crops gracefully in both card (2:1) and detail (~4:1) frames.
function bannerSVG(theme) {
  const t = BANNER_THEMES[theme] || BANNER_THEMES.urban;
  const uid = "sky-" + theme;
  const stars =
    theme === "fuel"
      ? `<circle cx="330" cy="38" r="16" fill="#f7b544" opacity="0.85"/>
         <circle cx="330" cy="38" r="24" fill="#f7b544" opacity="0.18"/>`
      : `<circle cx="48" cy="26" r="1.6" fill="#fff" opacity="0.6"/>
         <circle cx="96" cy="44" r="1.2" fill="#fff" opacity="0.45"/>
         <circle cx="330" cy="30" r="1.6" fill="#fff" opacity="0.55"/>
         <circle cx="368" cy="52" r="1.2" fill="#fff" opacity="0.4"/>
         <circle cx="210" cy="20" r="1.3" fill="#fff" opacity="0.5"/>`;

  let scenery = "";
  if (theme === "urban") {
    scenery = `
      <g fill="#0b2b26">
        <rect x="6" y="70" width="34" height="62"/>
        <rect x="46" y="88" width="26" height="44"/>
        <rect x="316" y="78" width="30" height="54"/>
        <rect x="352" y="60" width="40" height="72"/>
      </g>
      <g fill="#f5a623" opacity="0.5">
        <rect x="12" y="78" width="4" height="4"/><rect x="24" y="78" width="4" height="4"/>
        <rect x="12" y="92" width="4" height="4"/><rect x="24" y="106" width="4" height="4"/>
        <rect x="360" y="70" width="4" height="4"/><rect x="372" y="84" width="4" height="4"/>
        <rect x="360" y="98" width="4" height="4"/><rect x="324" y="88" width="4" height="4"/>
      </g>`;
  } else if (theme === "fuel") {
    scenery = `
      <g>
        <rect x="330" y="96" width="26" height="36" rx="3" fill="#3d1a0b"/>
        <rect x="334" y="101" width="18" height="10" rx="2" fill="#f7b544" opacity="0.8"/>
        <rect x="336" y="115" width="6" height="12" rx="1" fill="#7a3413"/>
        <path d="M356 100 q8 0 8 10 v14" stroke="#3d1a0b" stroke-width="3.5" fill="none"/>
      </g>`;
  } else if (theme === "highway") {
    scenery = `
      <path d="M0 160 L150 118 L250 118 L400 160 Z" fill="#1a2438"/>
      <g fill="#f5d76e" opacity="0.75">
        <rect x="196" y="122" width="8" height="3" rx="1.5"/>
        <rect x="192" y="132" width="12" height="3.6" rx="1.8"/>
        <rect x="186" y="145" width="18" height="4.4" rx="2.2"/>
      </g>`;
  }

  const screen =
    theme === "digital"
      ? `<linearGradient id="led-${uid}" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0" stop-color="#19d3e6"/><stop offset="1" stop-color="#c026d3"/>
         </linearGradient>
         <rect x="118" y="42" width="164" height="56" rx="3" fill="url(#led-${uid})" opacity="0.9"/>
         <g stroke="#000" stroke-width="1" opacity="0.22">
           <line x1="118" y1="52" x2="282" y2="52"/><line x1="118" y1="62" x2="282" y2="62"/>
           <line x1="118" y1="72" x2="282" y2="72"/><line x1="118" y1="82" x2="282" y2="82"/>
           <line x1="118" y1="92" x2="282" y2="92"/>
         </g>
         <text x="200" y="77" text-anchor="middle" font-family="Inter, sans-serif"
               font-size="17" font-weight="800" fill="#0b0518" letter-spacing="2.5">YOUR AD HERE</text>`
      : `<rect x="118" y="42" width="164" height="56" rx="3" fill="${t.board}"/>
         <text x="200" y="76" text-anchor="middle" font-family="Inter, sans-serif"
               font-size="17" font-weight="800" fill="#f5a623" letter-spacing="2.5">YOUR AD HERE</text>`;

  return `
  <svg viewBox="0 0 400 160" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${t.sky[0]}"/><stop offset="1" stop-color="${t.sky[1]}"/>
      </linearGradient>
    </defs>
    <rect width="400" height="160" fill="url(#${uid})"/>
    ${stars}
    <rect y="130" width="400" height="30" fill="${t.ground}"/>
    ${scenery}
    <g>
      <rect x="146" y="104" width="7" height="30" fill="#0a0f1a"/>
      <rect x="247" y="104" width="7" height="30" fill="#0a0f1a"/>
      <rect x="112" y="36" width="176" height="68" rx="5" fill="#232c3f"/>
      ${screen}
      <rect x="130" y="30" width="4" height="10" fill="#0a0f1a"/>
      <rect x="266" y="30" width="4" height="10" fill="#0a0f1a"/>
      <circle cx="132" cy="29" r="3.2" fill="#f5d76e" opacity="0.9"/>
      <circle cx="268" cy="29" r="3.2" fill="#f5d76e" opacity="0.9"/>
    </g>
  </svg>`;
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

function renderFooter() {
  const footer = document.querySelector("footer");
  if (!footer) return;
  footer.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <a href="/" class="brand"><span class="logo">🪧</span>AdVista</a>
          <p>India's marketplace for outdoor advertising — connecting space owners with brands since 2024.</p>
        </div>
        <div class="footer-col">
          <h4>Explore</h4>
          <ul>
            <li><a href="/listings.html">Browse spaces</a></li>
            <li><a href="/login.html?mode=register&role=owner">List your space</a></li>
            <li><a href="/login.html">Client login</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>Formats</h4>
          <ul>
            <li>Unipoles &amp; billboards</li>
            <li>Digital LED walls</li>
            <li>Gantries &amp; metro pillars</li>
            <li>Building wraps</li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>Contact</h4>
          <ul>
            <li><a href="mailto:hello@advista.example">hello@advista.example</a></li>
            <li>+91 124 400 0000</li>
            <li>Sector 44, Gurugram</li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© 2026 AdVista Outdoor Media · demo build</span>
        <span>Making every kilometre count</span>
      </div>
    </div>`;
}

function listingCardHTML(l) {
  return `
    <a class="listing-card" href="/listing.html?id=${l.id}">
      <div class="card-banner banner-${l.theme}">
        ${bannerSVG(l.theme)}
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
