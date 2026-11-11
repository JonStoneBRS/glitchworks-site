// Glitchworks website builder.
// Usage: node build.mjs            (real site, clean URLs)
//        node build.mjs --preview  (links point at index.html, for previewing from files)
// Reads config.json, content/assets/*.md, content/projects/*.md and (optionally) your Tebex
// packages, and writes the finished site to dist/.

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
// Changes every build so browsers fetch fresh CSS and scripts after an update.
const BUILD_ID = Date.now().toString(36);
const DIST = process.env.OUT ? path.resolve(ROOT, process.env.OUT) : path.join(ROOT, "dist");
const PREVIEW = process.argv.includes("--preview");
const cfg = JSON.parse(await fs.readFile(path.join(ROOT, "config.json"), "utf8"));
let sharp = null;
try { sharp = (await import("sharp")).default; } catch { console.warn("sharp not installed: images copied without resizing"); }

// ---------- helpers ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slugify = s => String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Tiny front-matter reader: "key: value" lines and "key:" followed by "  - item" lists.
function readFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {}; let listKey = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const item = raw.match(/^\s+-\s*(.*)$/);
    if (item && listKey) { data[listKey].push(item[1].trim()); continue; }
    const kv = raw.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (v === "") { data[k] = []; listKey = k; }
    else { listKey = null; data[k] = v === "true" ? true : v === "false" ? false : v.trim(); }
  }
  for (const k of Object.keys(data)) if (Array.isArray(data[k]) && !data[k].length && !["images", "features"].includes(k)) data[k] = "";
  return { data, body: m[2] };
}

// Small Markdown: paragraphs, ## headings, - lists, **bold**, *italic*, [links](url)
function md(src) {
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  return src.trim().split(/\n\s*\n/).map(block => {
    const lines = block.split("\n");
    if (/^#{2,3}\s/.test(lines[0])) { const lvl = lines[0].match(/^#+/)[0].length; return `<h${lvl}>${inline(lines[0].replace(/^#+\s*/, ""))}</h${lvl}>`; }
    if (lines.every(l => /^\s*-\s/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*-\s*/, ""))}</li>`).join("")}</ul>`;
    return `<p>${inline(lines.join(" "))}</p>`;
  }).join("\n");
}

// Strip anything risky from Tebex HTML descriptions.
const cleanHtml = h => String(h || "").replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, "").replace(/\son\w+="[^"]*"/gi, "").replace(/javascript:/gi, "");

const CATS = [
  { key: "MLO", label: "MLOs", blurb: "Interiors and full sites, built with proper collision and portals." },
  { key: "Script", label: "Scripts", blurb: "Gameplay systems with logging, framework bridges and training modes." },
  { key: "Weapon", label: "Weapons", blurb: "High-detail models, fitted to the game's hands and animations." },
];
const SERVICES = [
  { key: "Met", label: "Met", full: "Metropolitan Police", blurb: "Response, firearms and custody kit.", color: "#4d8bff" },
  { key: "LAS", label: "LAS", full: "London Ambulance Service", blurb: "Stretchers, hospitals and medical kit.", color: "#2bd99f" },
  { key: "LFB", label: "LFB", full: "London Fire Brigade", blurb: "Stations, kit and rescue tools.", color: "#ff5a4d" },
  { key: "Highways", label: "Highways", full: "National Highways", blurb: "Traffic, recovery and roadside kit.", color: "#ffb020" },
];
const SVC_ICONS = {
  Met: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m12 7 1.5 3 3.3.5-2.4 2.3.6 3.2L12 14.5 9 16l.6-3.2-2.4-2.3 3.3-.5z"/></svg>',
  LAS: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>',
  LFB: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 22c4 0 7-2.8 7-7 0-4.5-3.5-7-4.5-11-2 2-3 4-3 6-1.2-1-2-2.5-2-4C6.5 8 5 11.2 5 15c0 4.2 3 7 7 7z"/><path d="M12 22c-1.7 0-3-1.3-3-3 0-2 1.5-3 3-5 1.5 2 3 3 3 5 0 1.7-1.3 3-3 3z"/></svg>',
  Highways: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M10 3h4l5 18H5z"/><path d="M8 11h8M6.8 16h10.4"/></svg>',
};
const svcLabel = k => SERVICES.find(x => x.key === k)?.label || k;

const ICONS = {
  MLO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6M9 10h.01M15 10h.01"/></svg>',
  Script: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/></svg>',
  Weapon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/></svg>',
  Vehicle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 16v-4l2-5h11l3 5h2v4h-2M3 16h2m4 0h6"/><circle cx="7" cy="16.5" r="2"/><circle cx="17" cy="16.5" r="2"/><path d="M6 12h13"/></svg>',
  Other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7z"/></svg>',
};
const STATUS = {
  "for-sale": { label: "Available", cls: "b-sale" },
  "showcase": { label: "Showcase", cls: "b-show" },
  "coming-soon": { label: "Coming soon", cls: "b-soon" },
  "in-development": { label: "In development", cls: "b-dev" },
  "custom": { label: "Custom build", cls: "b-show" },
};
const money = (amount, cur = "GBP") => {
  if (amount === "" || amount == null) return "";
  const n = Number(amount);
  if (Number.isNaN(n)) return String(amount);
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format(n); } catch { return `${n} ${cur}`; }
};

// ---------- load content ----------
async function loadFolder(dir, kind) {
  const full = path.join(ROOT, "content", dir);
  let files = [];
  try { files = (await fs.readdir(full)).filter(f => f.endsWith(".md") && !f.startsWith("_")); } catch {}
  const out = [];
  for (const f of files) {
    const { data, body } = readFrontMatter(await fs.readFile(path.join(full, f), "utf8"));
    if (!data.title) { console.warn(`! ${dir}/${f} has no title, skipped`); continue; }
    out.push({
      kind, slug: f.replace(/\.md$/, ""), title: data.title,
      category: CATS.some(c => c.key === data.category) ? data.category : "Other",
      status: kind === "project" ? "custom" : (STATUS[data.status] ? data.status : "showcase"),
      featured: data.featured === true, tagline: data.tagline || "", client: data.client || "",
      location: data.location || "", frameworks: data.frameworks || "",
      services: String(data.services || "").split(",").map(x => x.trim()).filter(x => SERVICES.some(sv => sv.key === x)),
      tebexId: data.tebex_package || "", price: data.price || "", currency: data.currency || "GBP",
      video: data.video || "", images: Array.isArray(data.images) ? data.images : [],
      features: Array.isArray(data.features) ? data.features : [],
      html: md(body), imageUrls: [],
    });
  }
  return out;
}
const assets = await loadFolder("assets", "asset");
const projects = await loadFolder("projects", "project");

// ---------- Tebex (optional) ----------
const tebexOn = Boolean(cfg.tebex?.publicToken);
if (tebexOn) {
  try {
    const res = await fetch(`https://headless.tebex.io/api/accounts/${cfg.tebex.publicToken}/categories?includePackages=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cats = (await res.json()).data || [];
    const linked = new Map(assets.filter(a => a.tebexId).map(a => [String(a.tebexId), a]));
    for (const c of cats) for (const p of c.packages || []) {
      const price = p.total_price ?? p.base_price;
      const existing = linked.get(String(p.id));
      if (existing) {
        existing.price = price; existing.currency = p.currency || existing.currency; existing.status = "for-sale";
        if (!existing.images.length && p.image) existing.imageUrls.push(p.image);
        continue;
      }
      // Package added in Tebex but with no file here: make a page for it automatically.
      const guess = CATS.find(k => new RegExp(k.key, "i").test(c.name))?.key || "Other";
      assets.push({
        kind: "asset", slug: slugify(p.name), title: p.name, category: guess, status: "for-sale", featured: false,
        services: SERVICES.filter(sv => new RegExp(`\\b${sv.key}\\b`, "i").test(c.name + " " + p.name)).map(sv => sv.key),
        tagline: "", client: "", location: "", frameworks: "", tebexId: String(p.id), price, currency: p.currency || "GBP",
        video: "", images: [], features: [], html: cleanHtml(p.description), imageUrls: p.image ? [p.image] : [],
      });
    }
    console.log(`Tebex: ${cats.reduce((n, c) => n + (c.packages?.length || 0), 0)} packages loaded`);
  } catch (e) { console.warn(`! Tebex fetch failed (${e.message}); building from local files only`); }
}

// ---------- build ----------
await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(DIST, { recursive: true });
await fs.cp(path.join(ROOT, "src"), DIST, { recursive: true });

// Images: content/images/<file> -> dist/img/u/<name>-<w>.webp
async function processImages(item) {
  for (const name of item.images) {
    const src = path.join(ROOT, "content", "images", name);
    try { await fs.access(src); } catch { console.warn(`! image not found: content/images/${name} (${item.title})`); continue; }
    const base = slugify(name.replace(/\.[^.]+$/, ""));
    await fs.mkdir(path.join(DIST, "img", "u"), { recursive: true });
    if (sharp) {
      for (const w of [640, 1280]) await sharp(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(DIST, "img", "u", `${base}-${w}.webp`));
      item.imageUrls.push({ small: `img/u/${base}-640.webp`, large: `img/u/${base}-1280.webp` });
    } else {
      const f = `${base}${path.extname(name)}`; await fs.copyFile(src, path.join(DIST, "img", "u", f));
      item.imageUrls.push({ small: `img/u/${f}`, large: `img/u/${f}` });
    }
  }
}
// Custom projects stay private unless config.json has "showCustomProjects": true.
const SHOW_PROJECTS = cfg.showCustomProjects === true;
if (!SHOW_PROJECTS) projects.length = 0;
for (const it of [...assets, ...projects]) await processImages(it);

const order = { "for-sale": 0, "coming-soon": 1, "showcase": 2, "in-development": 3 };
assets.sort((a, b) => (order[a.status] - order[b.status]) || a.title.localeCompare(b.title));

// ---------- templates ----------
const link = (rel, p) => PREVIEW ? `${rel}${p}${p === "" || p.endsWith("/") ? "index.html" : ""}` : `${rel}${p}`;
const imgSrc = (rel, u, size) => typeof u === "string" ? u : `${rel}${u[size]}`;
const ticketHref = rel => cfg.discordInvite || link(rel, "help/") + "#contact";
const discordLabel = cfg.discordInvite ? "Join the Discord" : "Contact us";
// Live bot status feed (public, no secrets) and the Glitch Guard invite link.
const STATUS_URL = cfg.statusUrl || "";
const GUARD_INVITE = cfg.guardInvite || "https://discord.com/oauth2/authorize?client_id=1569758234057773086&permissions=1426734836983&scope=bot%20applications.commands";
const statusPill = rel => STATUS_URL ? `<a class="status-pill" href="${link(rel, "status/")}" data-status-pill data-status-url="${esc(STATUS_URL)}"><span class="sp-dot" aria-hidden="true"></span><span class="sp-text">System status</span></a>` : "";

function page({ rel, title, desc, current, body, canonical, image, scripts = [] }) {
  const full = title ? `${title} | ${cfg.siteName}` : `${cfg.siteName} | FiveM MLOs, scripts and weapons`;
  const nav = [["", "Home"], ["store/", "Store"], ...(SHOW_PROJECTS ? [["custom-projects/", "Custom projects"]] : []), ["guard/", '<span class="hide-sm">Glitch </span>Guard'], ["help/", "Help"], ["status/", "Status"]];
  return `<!doctype html>
<html lang="en-GB" data-root="${rel}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc || cfg.description)}">
<link rel="canonical" href="${esc(cfg.siteUrl + "/" + (canonical || ""))}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(desc || cfg.description)}">
<meta property="og:image" content="${esc(image || cfg.siteUrl + "/img/og.jpg")}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#07080d">
<link rel="icon" href="${rel}icon.svg" type="image/svg+xml">
<link rel="icon" href="${rel}favicon.png" sizes="48x48">
<link rel="apple-touch-icon" href="${rel}img/icon-180.png">
<link rel="preload" href="${rel}fonts/chakra-petch-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${rel}fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${rel}style.css?v=${BUILD_ID}">
<script src="${rel}search-index.js?v=${BUILD_ID}" defer></script>
<script src="${rel}fx.js?v=${BUILD_ID}" defer></script>
${scripts.map(s => `<script src="${rel}${s}?v=${BUILD_ID}" defer></script>\n`).join("")}</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head"><div class="wrap">
<a class="brand" href="${link(rel, "")}"><img src="${rel}icon.svg" alt="" width="34" height="34"><span>GLITCHWORKS</span></a>
<button class="search-btn" type="button" data-search-open aria-label="Search assets"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="sb-label">Search assets</span><kbd>Ctrl K</kbd></button>
<nav class="nav" aria-label="Main">${nav.map(([p, l]) => `<a href="${link(rel, p)}"${current === p ? ' aria-current="page"' : ""}${p === "" ? ' class="hide-sm"' : ""}>${l}</a>`).join("")}</nav>
</div></header>
<div class="search-dlg" id="search" hidden role="dialog" aria-modal="true" aria-label="Search"><div class="search-box"><div class="search-inner">
<div class="search-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="search-input" type="search" placeholder="Search MLOs, scripts, weapons..." autocomplete="off" role="combobox" aria-controls="search-results" aria-expanded="true"><kbd>Esc</kbd></div>
<ul id="search-results" role="listbox"></ul>
<div class="search-foot"><span>&uarr; &darr; to move</span><span>Enter to open</span><span>Esc to close</span></div>
</div></div></div>
<main id="main">
${body}
</main>
<footer class="site-foot"><div class="wrap">
<div>&copy; ${new Date().getFullYear()} ${esc(cfg.siteName)}. Built properly, tested on live servers.<br>Purchases are processed by Tebex, our merchant of record. Not affiliated with Rockstar Games, Cfx.re or any emergency service.${STATUS_URL ? `<br>${statusPill(rel)}` : ""}</div>
<nav aria-label="Footer"><a href="${link(rel, "store/")}">Store</a>${SHOW_PROJECTS ? `<a href="${link(rel, "custom-projects/")}">Custom projects</a>` : ""}<a href="${link(rel, "guard/")}">Glitch Guard</a><a href="${link(rel, "help/")}">Help and FAQ</a><a href="${link(rel, "status/")}">Status</a><a href="${ticketHref(rel)}">${discordLabel}</a><a href="${esc(cfg.termsUrl || "#")}">Terms</a><a href="${esc(cfg.privacyUrl || "#")}">Privacy</a></nav>
</div></footer>
</body>
</html>`;
}

function thumb(rel, it, eager) {
  const u = it.imageUrls[0];
  if (u) return `<img src="${imgSrc(rel, u, "small")}" alt="" loading="${eager ? "eager" : "lazy"}" decoding="async" width="640" height="360">`;
  return `<div class="ph">${ICONS[it.category] || ICONS.Other}</div>`;
}
function card(rel, it, eager = false) {
  const base = it.kind === "project" ? "custom-projects/" : "store/";
  const st = STATUS[it.status];
  const right = it.kind === "project" ? `<span class="tag">For ${esc(it.client || "a client")}</span>`
    : it.status === "for-sale" && it.price !== "" ? `<span class="price">${esc(money(it.price, it.currency))}</span>` : "";
  return `<a class="card" href="${link(rel, `${base}${it.slug}/`)}" data-cat="${esc(it.category)}" data-svc="${esc(it.services.join(" "))}">
<div class="thumb">${thumb(rel, it, eager)}</div>
<div class="body"><span class="tag">${esc(it.category === "Other" ? "Asset" : it.category)}${it.services.length ? " &middot; " + it.services.map(svcLabel).join(", ") : ""}</span><h3>${esc(it.title)}</h3><p>${esc(it.tagline)}</p>
<div class="meta"><span class="badge ${st.cls}">${st.label}</span>${right}</div></div></a>`;
}

function buyPanel(rel, it) {
  const rows = [];
  if (it.kind === "project" && it.client) rows.push(["Made for", it.client]);
  rows.push(["Type", it.category === "Other" ? "Asset" : it.category]);
  if (it.services.length) rows.push(["For", it.services.map(k => SERVICES.find(x => x.key === k).full).join(", ")]);
  if (it.location) rows.push(["Location", it.location]);
  if (it.frameworks) rows.push(["Works with", it.frameworks]);
  const dl = `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  const st = STATUS[it.status];
  if (it.kind === "project") return `<aside class="panel"><span class="badge ${st.cls}" style="align-self:start">${st.label}</span>${dl}
<p style="margin:0">This was a commissioned build and isn't for sale. Want something like it for your server?</p>
<a class="btn btn-primary btn-block" href="${ticketHref(rel)}">Commission a build</a>
<small>Open a "Bespoke order" ticket in our Discord with what you have in mind.</small></aside>`;
  if (it.status === "for-sale" && it.tebexId && cfg.tebex?.storeUrl) return `<aside class="panel"><span class="badge ${st.cls}" style="align-self:start">${st.label}</span>
<div class="price">${esc(money(it.price, it.currency))}</div>${dl}
<a class="btn btn-primary btn-block" href="${esc(cfg.tebex.storeUrl.replace(/\/$/, ""))}/package/${esc(it.tebexId)}" rel="noopener">Buy now</a>
<small>Checkout is through Tebex. You'll log in with your FiveM account, and the asset appears in your Cfx Keymaster straight away.</small></aside>`;
  return `<aside class="panel"><span class="badge ${st.cls}" style="align-self:start">${st.label}</span>${dl}
<p style="margin:0">${it.status === "showcase" ? "Interested in this? Ask us about it." : "Not on sale yet. Join the Discord to hear first when it lands."}</p>
<a class="btn btn-primary btn-block" href="${ticketHref(rel)}">${cfg.discordInvite ? "Ask on Discord" : "Get in touch"}</a></aside>`;
}

function detail(it) {
  const rel = "../../";
  const base = it.kind === "project" ? "custom-projects/" : "store/";
  const back = it.kind === "project" ? "Custom projects" : "Store";
  const imgs = it.imageUrls;
  const media = imgs.length
    ? `<div class="media"><img id="main-img" src="${imgSrc(rel, imgs[0], "large")}" alt="${esc(it.title)}" width="1280" height="720"></div>
${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<button type="button" data-large="${imgSrc(rel, u, "large")}" aria-label="Image ${i + 1}"${i === 0 ? ' aria-current="true"' : ""}><img src="${imgSrc(rel, u, "small")}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}`
    : `<div class="media"><div class="ph">${ICONS[it.category] || ICONS.Other}</div></div>`;
  const yt = it.video ? `<div class="yt" data-id="${esc(it.video)}"><img src="https://i.ytimg.com/vi/${esc(it.video)}/hqdefault.jpg" alt="" loading="lazy"><button type="button" aria-label="Play video"></button></div>` : "";
  const others = (it.kind === "project" ? projects : assets).filter(o => o !== it).slice(0, 3);
  const body = `<div class="wrap">
<p class="crumbs"><a href="${link(rel, base)}">${back}</a> / ${esc(it.title)}</p>
<div class="asset"><div>
<h1>${esc(it.title)}</h1>
${it.tagline ? `<p class="lead">${esc(it.tagline)}</p>` : ""}
${media}
${yt}
<div class="prose">
${it.features.length ? `<h2>Features</h2><ul class="features">${it.features.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
<h2>About</h2>
${it.html}
</div></div>
${buyPanel(rel, it)}
</div>
${others.length ? `<section style="padding-top:0"><div class="section-head"><h2>More ${it.kind === "project" ? "custom builds" : "from Glitchworks"}</h2></div><div class="grid">${others.map(o => card(rel, o)).join("")}</div></section>` : ""}
</div>
<script>
document.querySelectorAll(".thumbs button").forEach(b=>b.addEventListener("click",()=>{document.getElementById("main-img").src=b.dataset.large;document.querySelectorAll(".thumbs button").forEach(x=>x.removeAttribute("aria-current"));b.setAttribute("aria-current","true")}));
document.querySelectorAll(".yt").forEach(y=>y.addEventListener("click",()=>{y.innerHTML='<iframe src="https://www.youtube-nocookie.com/embed/'+y.dataset.id+'?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Video"></iframe>'},{once:true}));
</script>`;
  const firstImg = imgs[0] && typeof imgs[0] !== "string" ? `${cfg.siteUrl}/${imgs[0].large}` : undefined;
  return page({ rel, title: it.title, desc: it.tagline, current: base, body, canonical: `${base}${it.slug}/`, image: firstImg });
}

// ---------- pages ----------
const write = async (p, html) => { const f = path.join(DIST, p); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, html); };

// Home
{
  const rel = "";
  const featured = assets.filter(a => a.featured).concat(assets.filter(a => !a.featured)).slice(0, 3);
  const featProjects = projects.filter(p => p.featured).slice(0, 2);
  const body = `<div class="hero">
<picture><source type="image/avif" srcset="img/banner-960.avif 960w, img/banner-1600.avif 1600w" sizes="100vw"><img src="img/banner-1600.webp" srcset="img/banner-960.webp 960w, img/banner-1600.webp 1600w" sizes="100vw" alt="Glitchworks" width="1600" height="670" fetchpriority="high" data-parallax></picture>
<div class="hero-text wrap"><h1 class="hero-title">FiveM assets, built properly</h1>
<p class="lead">MLOs, scripts and weapons with real collision, proper logging and detail you notice. Every one is tested on a live server before it ships.</p>
<div class="btns"><a class="btn btn-primary" href="${link(rel, "store/")}">Browse the store</a>${SHOW_PROJECTS ? `<a class="btn btn-ghost" href="${link(rel, "custom-projects/")}">See custom projects</a>` : `<a class="btn btn-ghost" href="${ticketHref(rel)}">${discordLabel}</a>`}</div></div></div>
<section><div class="wrap"><span class="eyebrow">What we make</span><h2>Pick a category</h2>
<div class="cats" style="margin-top:22px">${CATS.map(c => `<a class="cat" href="${link(rel, "store/")}?cat=${c.key}">${ICONS[c.key]}<strong>${c.label}</strong><span>${c.blurb}</span></a>`).join("")}</div></div></section>
<section style="padding-top:0"><div class="wrap"><span class="eyebrow">Shop by service</span><h2>Built for UK emergency services roleplay</h2>
<div class="svcs" style="margin-top:22px">${SERVICES.map(sv => { const n = assets.filter(a => a.services.includes(sv.key)).length; return `<a class="svc" style="--svc:${sv.color}" href="${link(rel, "store/")}?svc=${sv.key}">${SVC_ICONS[sv.key]}<strong>${sv.label}</strong><span class="svc-full">${sv.full}</span><span>${sv.blurb}</span><em>${n ? `${n} item${n > 1 ? "s" : ""}` : "Coming soon"}</em></a>`; }).join("")}</div></div></section>
<section style="padding-top:0"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Latest</span><h2>From the workshop</h2></div><a class="btn btn-ghost" href="${link(rel, "store/")}">View all</a></div>
<div class="grid">${featured.map((a, i) => card(rel, a, i < 3)).join("")}</div></div></section>
${featProjects.length ? `<section style="padding-top:0"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Custom projects</span><h2>Built for real servers</h2></div><a class="btn btn-ghost" href="${link(rel, "custom-projects/")}">All projects</a></div>
<div class="grid">${featProjects.map(p => card(rel, p)).join("")}</div></div></section>` : ""}
<section style="padding-top:0"><div class="wrap"><span class="eyebrow">How buying works</span><h2>Three steps, no fuss</h2>
<div class="steps" style="margin-top:22px">
<div class="step"><h3>Buy through Tebex</h3><p>Check out securely and log in with the FiveM account that owns your server key.</p></div>
<div class="step"><h3>Download from Keymaster</h3><p>The asset appears in your Cfx Keymaster straight away, ready to download.</p></div>
<div class="step"><h3>Drop it in</h3><p>Add it to your resources, ensure it in server.cfg and restart. Short, plain install notes come with everything.</p></div>
</div></div></section>
<section style="padding-top:0"><div class="wrap"><div class="band"><div><span class="eyebrow">Bespoke builds</span><h2>Need something made for your server?</h2><p>We build custom MLOs and scripts to order. Tell us what you need and we'll talk it through.</p></div><a class="btn btn-primary" href="${ticketHref(rel)}">Start a bespoke order</a></div></div></section>`;
  await write("index.html", page({ rel, current: "", body, canonical: "" }));
}

// Store
{
  const rel = "../";
  const present = CATS;
  const body = `<section style="padding-top:44px"><div class="wrap"><span class="eyebrow">Store</span><h1>All assets</h1>
<p style="color:var(--muted);max-width:640px">Everything we've made for release. Items marked "Coming soon" are finished or in testing and will be available shortly.</p>
<div class="filters" role="group" aria-label="Filter by type"><button type="button" data-g="cat" data-f="all" aria-pressed="true">All types</button>${present.map(c => `<button type="button" data-g="cat" data-f="${c.key}" aria-pressed="false">${c.label}</button>`).join("")}</div>
<div class="filters svc-filters" role="group" aria-label="Filter by service"><button type="button" data-g="svc" data-f="all" aria-pressed="true">All services</button>${SERVICES.map(sv => `<button type="button" data-g="svc" data-f="${sv.key}" aria-pressed="false" style="--svc:${sv.color}">${sv.label}</button>`).join("")}</div>
<div class="grid" id="list">${assets.map((a, i) => card(rel, a, i < 3)).join("")}</div>
<p class="empty" id="empty" hidden>Nothing here yet. Join our <a href="${ticketHref(rel)}">Discord</a> to hear when it lands.</p></div></section>
<script>
(function(){var b=document.querySelectorAll(".filters button"),c=document.querySelectorAll("#list .card"),e=document.getElementById("empty"),st={cat:"all",svc:"all"};
function apply(){var n=0;b.forEach(function(x){x.setAttribute("aria-pressed",st[x.dataset.g]===x.dataset.f)});c.forEach(function(x){var s=(st.cat==="all"||x.dataset.cat===st.cat)&&(st.svc==="all"||(" "+x.dataset.svc+" ").indexOf(" "+st.svc+" ")>-1);x.hidden=!s;if(s)n++});e.hidden=n>0;
var q=[];if(st.cat!=="all")q.push("cat="+st.cat);if(st.svc!=="all")q.push("svc="+st.svc);try{history.replaceState(null,"",q.length?"?"+q.join("&"):location.pathname)}catch(_){}}
b.forEach(function(x){x.addEventListener("click",function(){st[x.dataset.g]=x.dataset.f;apply()})});
var p=new URLSearchParams(location.search);["cat","svc"].forEach(function(g){var v=(p.get(g)||"").toLowerCase();b.forEach(function(x){if(v&&x.dataset.g===g&&x.dataset.f.toLowerCase()===v)st[g]=x.dataset.f})});apply()})();
</script>`;
  await write("store/index.html", page({ rel, title: "Store", desc: "Browse Glitchworks FiveM MLOs, scripts and weapons.", current: "store/", body, canonical: "store/" }));
}

// Custom projects
if (SHOW_PROJECTS) {
  const rel = "../";
  const body = `<section style="padding-top:44px"><div class="wrap"><span class="eyebrow">Custom projects</span><h1>Built to order</h1>
<p style="color:var(--muted);max-width:680px">Bespoke builds we've made for other servers. These aren't for sale, but they show what we can do. If you'd like something similar, start a bespoke order.</p>
<div class="grid" style="margin-top:26px">${projects.map((p, i) => card(rel, p, i < 3)).join("")}</div>
<div class="band" style="margin-top:44px"><div><h2>Want one for your server?</h2><p>Tell us the location, what it's for and any must-haves. We'll come back with ideas and a quote.</p></div><a class="btn btn-primary" href="${ticketHref(rel)}">Start a bespoke order</a></div>
</div></section>`;
  await write("custom-projects/index.html", page({ rel, title: "Custom projects", desc: "Bespoke FiveM MLOs and scripts Glitchworks has built for other servers.", current: "custom-projects/", body, canonical: "custom-projects/" }));
}

// ---------- shared bits for the help centre, guides, Glitch Guard and status ----------
const UI_PATHS = {
  shield: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/>',
  shieldCheck: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  wand: '<path d="m4 20 10-10"/><path d="M15 3v3M15 12v3M10.5 7.5h3M16.5 7.5h3M19 15v3M17.5 16.5h3"/>',
  logs: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  verify: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  bug: '<rect x="8" y="7" width="8" height="13" rx="4"/><path d="M12 3v4M4 9l4 2M20 9l-4 2M3 14h5M16 14h5M4 20l4-2M20 20l-4-2"/>',
  ticket: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
  wave: '<path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 10.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3 15a1.6 1.6 0 0 1 2.5-2L7 14.5V11"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  backup: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  gavel: '<path d="m14 3 7 7M10.5 6.5l7 7M12 5 6.5 10.5l7 7L19 12M9 14l-6 6"/>',
  data: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 9h3M15 13h3"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  rules: '<path d="M9 5h11M9 12h11M9 19h11"/><path d="m3.5 5 1 1 2-2M3.5 12l1 1 2-2M3.5 19l1 1 2-2"/>',
  eraser: '<path d="m7 21-4-4L14 6l6 6-9 9z"/><path d="M11 21h10M9.5 10.5l6 6"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2M11.5 9 9 12.5h3L9.5 16"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.3L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4.3L20 15M20 20v-5h-5"/>',
  book: '<path d="M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14"/><path d="M8 7h8"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  cart: '<path d="M3 4h2l2.4 11h10.2L20 8H6.2"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5v.7M12 17h.01"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};
const ic = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_PATHS[name] || UI_PATHS.shield}</svg>`;
// Heading with a "#" link so people can share a link to that exact section.
const anchored = (tag, id, html) => `<${tag} id="${id}">${html}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></${tag}>`;
const guardButton = (label = "Add Glitch Guard to your server", cls = "btn btn-primary") => `<a class="${cls}" href="${esc(GUARD_INVITE)}" rel="noopener">${ic("plus")}${label}</a>`;
const HELP_GUIDES = [
  { slug: "glitch-guard-setup", title: "Set up Glitch Guard", icon: "shieldCheck", blurb: "Add the free bot, run /setup and pick the right options for each of the 10 steps.", keys: "discord bot setup wizard settings safeguarding verification tickets protection honeypot logs partnership discount" },
  { slug: "install-mlos-and-scripts", title: "Install MLOs and scripts", icon: "box", blurb: "Download from the Cfx.re portal, add the resource to your server and fix the common errors.", keys: "fivem install resources server.cfg ensure entitlement escrow game build keymaster portal cache troubleshooting" },
];

// Guide page: breadcrumb, sticky "On this page" contents and anchored sections.
function guidePage({ slug, title, desc, intro, sections }) {
  const rel = "../../";
  const toc = sections.map(s => `<li><a href="#${s.id}">${esc(s.toc || s.title)}</a></li>`).join("");
  const body = `<div class="wrap">
<p class="crumbs"><a href="${link(rel, "help/")}">Help centre</a> / ${esc(title)}</p>
<div class="doc">
<aside class="toc"><nav data-toc aria-label="On this page"><strong>On this page</strong><ol>${toc}</ol></nav>
<div class="toc-extra"><a class="btn btn-ghost btn-sm btn-block" href="${ticketHref(rel)}" rel="noopener">Still stuck? Open a ticket</a></div></aside>
<article class="doc-body">
<span class="eyebrow">Guide</span><h1>${esc(title)}</h1>
<p class="lead">${intro}</p>
${sections.map(s => `<section class="doc-sec" aria-labelledby="${s.id}">${anchored("h2", s.id, esc(s.title))}\n${s.html}</section>`).join("\n")}
<div class="band doc-band"><div><h2>Still stuck?</h2><p>Open a ticket on our Discord and tell us what you've tried. Screenshots of any errors help us sort it faster.</p></div><a class="btn btn-primary" href="${ticketHref(rel)}" rel="noopener">Open a ticket on Discord</a></div>
<p class="doc-more">More help: ${HELP_GUIDES.filter(g => g.slug !== slug).map(g => `<a href="${link(rel, `help/${g.slug}/`)}">${esc(g.title)}</a>`).join(" &middot; ")} &middot; <a href="${link(rel, "help/")}#faq">Common questions</a></p>
</article></div></div>`;
  return page({ rel, title, desc, current: "help/", body, canonical: `help/${slug}/` });
}

// Help
{
  const rel = "../";
  const faqs = [
    ["Which FiveM account should I use at checkout?", "Use the account that owns your server's license key. Assets are tied to that account and only run on servers using one of its keys."],
    ["Where do I download what I bought?", "From the Cfx Keymaster, under your granted assets. You'll also get an email with a download link."],
    ["Why can't I see or edit some of the code?", "Paid scripts are protected by Cfx's Asset Escrow so they can't be leaked. Config files are left open so you can set things up for your server."],
    ["\"You lack the required entitlement\" error", "Your server key belongs to a different FiveM account from the one that bought the asset. Use a key from the buying account, or transfer the asset in Keymaster."],
    ["Do you support QBCore, Qbox and ESX?", "Our scripts run standalone and include bridges for QBCore, Qbox and ESX. Each asset page lists what it works with."],
    ["Can I get a refund?", "Contact us first and we'll do our best to fix any problem. Payments go through Tebex, so their checkout terms also apply."],
    ["Can I share or resell what I buy?", "No. Everything is licensed for use on your own servers only."],
  ];
  const guardFaqs = [
    ["Is Glitch Guard free?", "Yes. Glitch Guard is free for any Discord server. Add it with the button on the Glitch Guard page, then run /setup."],
    ["Does Glitch Guard's safeguarding use AI?", "No. It's a rules-based system using word and pattern lists, so it's predictable and transparent. Server admins choose which checks are on, and it only ever alerts staff. It never punishes anyone for these."],
    ["How do I change a setting after setup?", "Use /settings. You can change any of the 10 setup steps at any time."],
  ];
  const faqItem = ([q, a]) => `<details id="faq-${slugify(q)}"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`;
  const hubCards = [
    ...HELP_GUIDES.map(g => ({ href: link(rel, `help/${g.slug}/`), icon: g.icon, title: g.title, text: g.blurb, cta: "Read the guide" })),
    { href: "#buying", icon: "cart", title: "Buying and downloads", text: "How checkout through Tebex works and where to find what you bought.", cta: "How buying works" },
    { href: "#faq", icon: "question", title: "Common questions", text: "Accounts, escrow, frameworks, refunds and licences.", cta: "See the answers" },
    { href: link(rel, "status/"), icon: "pulse", title: "Bot status", text: "Live status and uptime for the Glitchworks Bot and Glitch Guard.", cta: "Check status" },
    { href: "#contact", icon: "chat", title: "Get in touch", text: "Support, bespoke orders and questions are handled through Discord tickets.", cta: "Contact us" },
  ];
  const body = `<section class="page-hero"><div class="ph-glow" data-parallax aria-hidden="true"></div><div class="wrap">
<span class="eyebrow">Help centre</span><h1>How can we help?</h1>
<p class="lead">Step-by-step guides for our FiveM assets and Glitch Guard, answers to common questions, and how to reach us.</p>
<div class="btns"><button class="btn btn-ghost" type="button" data-search-open>${ic("search")}Search the site</button><a class="btn btn-ghost" href="${ticketHref(rel)}" rel="noopener">Open a ticket</a></div>
</div></section>
<section class="hub"><div class="wrap">
<div class="hub-grid">${hubCards.map(c => `<a class="hub-card" href="${c.href}">${ic(c.icon)}<strong>${esc(c.title)}</strong><span>${esc(c.text)}</span><em>${esc(c.cta)} ${ic("arrow")}</em></a>`).join("")}</div>
</div></section>
<section style="padding-top:0"><div class="wrap"><div class="doc doc-hub">
<aside class="toc"><nav data-toc aria-label="On this page"><strong>On this page</strong><ol>
<li><a href="#buying">How buying works</a></li><li><a href="#faq">Questions</a></li><li><a href="#guard-faq">Glitch Guard questions</a></li><li><a href="#guides">Guides</a></li><li><a href="#contact">Get in touch</a></li>
</ol></nav></aside>
<div class="doc-body">
<section class="doc-sec" aria-labelledby="buying">${anchored("h2", "buying", "How buying works")}
<div class="steps" style="grid-template-columns:1fr;margin-bottom:12px">
<div class="step"><h3>Buy through Tebex</h3><p>Tebex handles payment, tax and receipts for us. You'll log in with your FiveM account during checkout.</p></div>
<div class="step"><h3>Download from Keymaster</h3><p>Your purchase appears in the Cfx Keymaster straight away.</p></div>
<div class="step"><h3>Install</h3><p>Put the folder in your resources, add <code>ensure</code> lines to server.cfg in the order shown in the notes, then restart the server.</p></div>
</div>
<p><a href="${link(rel, "help/install-mlos-and-scripts/")}">Read the full install guide</a></p>
</section>
<section class="doc-sec" aria-labelledby="faq">${anchored("h2", "faq", "Questions")}
${faqs.map(faqItem).join("")}
</section>
<section class="doc-sec" aria-labelledby="guard-faq">${anchored("h2", "guard-faq", "Glitch Guard questions")}
${guardFaqs.map(faqItem).join("")}
<p><a href="${link(rel, "help/glitch-guard-setup/")}">Read the Glitch Guard setup guide</a> or <a href="${link(rel, "guard/")}">see everything Glitch Guard does</a>.</p>
</section>
<section class="doc-sec" aria-labelledby="guides">${anchored("h2", "guides", "Guides")}
<ul class="guide-list">${HELP_GUIDES.map(g => `<li><a href="${link(rel, `help/${g.slug}/`)}">${ic(g.icon)}<span><strong>${esc(g.title)}</strong><span>${esc(g.blurb)}</span></span></a></li>`).join("")}</ul>
</section>
<section class="doc-sec" aria-labelledby="contact">${anchored("h2", "contact", "Get in touch")}
<p style="color:var(--muted)">Support, bespoke orders and questions are all handled through tickets in our Discord.</p>
${cfg.discordInvite ? `<a class="btn btn-primary" href="${esc(cfg.discordInvite)}" rel="noopener">Join the Discord</a>` : `<p><strong>Discord invite coming soon.</strong></p>`}
</section>
</div></div></div></section>`;
  await write("help/index.html", page({ rel, title: "Help centre", desc: "Guides for installing Glitchworks FiveM assets and setting up Glitch Guard, plus answers to common questions.", current: "help/", body, canonical: "help/" }));
}

// Help guide: Set up Glitch Guard
{
  const step = (n, title, what, rec, choices) => `<div class="gstep" id="step-${n}"><h3><span class="n" aria-hidden="true">${n}</span>Step ${n}: ${title}</h3>
<dl><dt>What it is</dt><dd>${what}</dd><dt>We recommend</dt><dd>${rec}</dd><dt>Your choices</dt><dd>${choices}</dd></dl></div>`;
  const sections = [
    { id: "add-the-bot", title: "Add Glitch Guard to your server", toc: "Add the bot", html: `<p>Glitch Guard is free. To add it you need the <strong>Manage Server</strong> permission on the Discord server you want to protect.</p>
<p>${guardButton()}</p>
<ol><li>Press the button above and choose your server from the list.</li><li>Discord shows the permissions Glitch Guard asks for. Leave them all ticked so every feature works.</li><li>Press <strong>Authorise</strong>. Glitch Guard joins your server straight away.</li></ol>` },
    { id: "role-position", title: "Move its role near the top", toc: "Move its role up", html: `<p>Discord only lets a bot manage roles and members that sit <strong>below its own role</strong>. If Glitch Guard's role is near the bottom, it can't give people the Verified role, time out or ban raiders, or undo permission changes.</p>
<ol><li>Open <strong>Server Settings &gt; Roles</strong>.</li><li>Find the <strong>Glitch Guard</strong> role and drag it up, above your member, Verified and staff roles. Just under your owner or admin roles is ideal.</li><li>Save the changes.</li></ol>
<p class="note">Glitch Guard can never act on the server owner, whatever its role position. That's a Discord rule.</p>` },
    { id: "run-setup", title: "Run /setup", toc: "Run /setup", html: `<p>Type <code>/setup</code> in any channel and press Enter. A step-by-step wizard walks you through 10 steps.</p>
<p>Every step has a <strong>recommended</strong> button that creates everything for you, so if you're not sure, pick the recommended option and move on. Nothing is final: you can change any step later with <code>/settings</code>.</p>` },
    { id: "the-10-steps", title: "The 10 steps explained", toc: "The 10 steps", html: `<p>Here's what each step does, what we recommend and what the choices mean.</p>
${step(1, "Staff role", "The role your moderators have. People with it can see tickets and logs and use the moderation commands. Admins always can, whether or not they have the role.", "Pick your existing moderator role. If you don't have one yet, use the recommended button.", "Choose any role. Only give it to people you trust with tickets, logs and moderation.")}
${step(2, "Roles and channels", "A starter set of roles and channels to suit your type of server. It only adds things and <strong>never deletes anything</strong>.", "Use the starter set if your server is new or still being built. You can rename or move anything afterwards.", "Pick the server type closest to yours to get a matching starter set, or skip this step if you're happy with your current layout.")}
${step(3, "Logs channel", "A private channel that only staff can see. It records joins and leaves, deleted and edited messages, moderation actions, honeypot catches and ticket transcripts as PDFs.", "Turn it on. It's the easiest way to see what happened and when.", "Let Glitch Guard create the channel, or choose one you already have.")}
${step(4, "Protection", "The automatic defences. Pick a level, then switch individual options on or off.", "<strong>Balanced</strong> suits most servers.", "<strong>Relaxed</strong> is the lightest touch, <strong>Strict</strong> is the tightest, and <strong>Balanced</strong> sits in between. Each option is explained below.")}
<div class="tbl"><table><caption class="sr-only">Protection options</caption><thead><tr><th scope="col">Option</th><th scope="col">What it does</th></tr></thead><tbody>
<tr><td>Anti-nuke</td><td>Stops mass deletes, bans and kicks.</td></tr>
<tr><td>Permission guard</td><td>Undoes admin permissions given by untrusted people.</td></tr>
<tr><td>Bot guard</td><td>Removes bots added by untrusted people.</td></tr>
<tr><td>Anti-raid</td><td>Locks the server during join floods.</td></tr>
<tr><td>Scam and phishing links</td><td>Deletes the message and bans the sender.</td></tr>
<tr><td>Spam filter</td><td>Catches message spam.</td></tr>
<tr><td>Mass-mention filter</td><td>Catches messages that mention 6 or more people.</td></tr>
<tr><td>No links from brand-new members</td><td>Brand-new members can't post links.</td></tr>
<tr><td>Block other servers' invites</td><td>Removes invite links to other Discord servers.</td></tr>
<tr><td>Guard network ban list</td><td>Keeps out scammers and nukers already caught in other Glitch Guard servers.</td></tr>
</tbody></table></div>
${step(5, "Verification", "A <strong>#verify</strong> channel with a button. Pressing it gives the member the <strong>Verified</strong> role.", "Turn verification on. Lock the server too if you've had trouble with bots or raids.", "Optionally lock the server, so members who haven't verified can only see #verify.")}
${step(6, "Honeypot", "A <strong>#do-not-post</strong> channel. Real members are told to leave it alone, so anything that posts there is almost certainly a bot, and it gets caught. Catches show in your logs.", "Turn it on. It costs nothing and catches spam bots early.", "On or off.")}
${step(7, "Tickets", "A <strong>#support</strong> channel where members open private tickets. When a ticket closes, its transcript is saved as a PDF.", "Start with a preset. You can add more ticket types later with /settings.", "Pick presets or your own ticket types, and choose which teams can see each type.")}
${step(8, "Welcome messages", "A message that greets people when they join.", "Turn it on if you'd like new members to feel welcome. It's optional.", "On or off.")}
${step(9, "Safeguarding (optional)", `Rules-based checks that privately alert your senior team about worrying messages. It's not AI and it never punishes anyone. <a href="${link("../../", "guard/")}#safeguarding">How safeguarding works</a>.`, "Pick a small group of trusted senior roles to receive the alerts, and turn on the checks that fit your community.", "Choose the senior roles that get alerts (the owner always gets them), choose which checks are on, and set two switches: <strong>Remove details</strong> deletes personal details, a child's age and doxxing straight away (staff still get the alert), and <strong>Check staff</strong> also checks staff messages, which is useful for testing.")}
${step(10, "Partnership (optional)", "Get your server listed in the Glitchworks Discord.", "Join if you'd like more people to find your server.", "Every Glitch Guard server gets a 5% store discount, and partners get 10%. Use <code>/discount</code> to get yours.")}` },
    { id: "changing-later", title: "Changing things later: /settings", toc: "Changing things later", html: `<p>Use <code>/settings</code> at any time to change any of the 10 steps: add a ticket type, change your protection level, pick different safeguarding roles, and so on. You don't need to run the whole setup again.</p>` },
    { id: "testing-safeguarding", title: "Testing safeguarding", toc: "Testing safeguarding", html: `<p>Staff aren't checked by default, so if you test from your own staff account, nothing happens. That's expected. To test, either:</p>
<ul><li>turn on <strong>Check staff</strong> in <code>/settings</code> (and turn it off again when you're done), or</li><li>post from a non-staff account, such as a spare test account.</li></ul>
<p>Use harmless test messages. For example, to test the personal details check, use a made-up mobile number from the 07700 900000 to 07700 900999 range, which Ofcom keeps aside for TV and drama.</p>` },
    { id: "troubleshooting", title: "Troubleshooting", html: `<div class="tbl"><table><caption class="sr-only">Glitch Guard problems and fixes</caption><thead><tr><th scope="col">Problem</th><th scope="col">Fix</th></tr></thead><tbody>
<tr><td>The bot can't manage roles, give the Verified role, time out or ban</td><td>Its role is too low. Open Server Settings &gt; Roles and drag the Glitch Guard role above the roles and members it needs to manage. <a href="#role-position">See how</a>.</td></tr>
<tr><td>Slash commands like /setup are missing</td><td>Wait a minute, then restart Discord (Ctrl+R on desktop). If they still don't show, add the bot again with the button at the top of this guide. You don't need to remove it first.</td></tr>
<tr><td>Safeguarding test alerts don't arrive</td><td>Staff aren't checked unless Check staff is on. Turn it on, or test from a non-staff account. <a href="#testing-safeguarding">More on testing</a>.</td></tr>
<tr><td>New members can't see any channels</td><td>The server is locked for unverified members. They need to press the button in #verify. You can change this in Step 5 with /settings.</td></tr>
</tbody></table></div>` },
  ];
  await write("help/glitch-guard-setup/index.html", guidePage({ slug: "glitch-guard-setup", title: "Set up Glitch Guard", desc: "Add the free Glitch Guard bot to your Discord server and set it up with /setup, step by step.", intro: "A plain-English walkthrough: add the bot, give it the right role position, then run <code>/setup</code> and choose what suits your server.", sections }));
}

// Help guide: Install MLOs and scripts
{
  const sections = [
    { id: "before-you-start", title: "Before you start", html: `<ul><li>Access to your FiveM server's files: the <code>resources</code> folder and <code>server.cfg</code>.</li><li>The Cfx.re account that owns your server key. Assets are tied to that account.</li><li>A few minutes to restart your server at the end.</li></ul>` },
    { id: "buy", title: "Buy through Tebex", html: `<p>Checkout is handled by Tebex. During checkout you log in with your <strong>Cfx.re account</strong>, and the purchase is linked to that account.</p>
<p class="note">Use the same Cfx.re account that owns your server key. If you buy on a different account, your server can't run the asset and you'll see a "required entitlement" error.</p>` },
    { id: "download", title: "Download from the Cfx.re portal", html: `<p>Our paid assets are protected by Cfx's Asset Escrow, so you download them from Cfx rather than from us.</p>
<ol><li>Go to <a href="https://portal.cfx.re" rel="noopener">portal.cfx.re</a> (formerly Keymaster) and sign in with the account you used at checkout.</li><li>Open <strong>Assets &gt; Granted Assets</strong>.</li><li>Find the item and download it. You'll get a zip file.</li></ol>` },
    { id: "add-to-server", title: "Add it to your server", html: `<ol><li><strong>Unzip</strong> the download. FiveM can't read zip files.</li><li>Put the folder inside your server's <code>resources</code> folder. We suggest a <code>[glitchworks]</code> subfolder to keep things tidy: <code>resources/[glitchworks]/resource_name</code>. Folders in square brackets are just for organising; FiveM still finds everything inside.</li><li>Check the folder name. It must match the resource name exactly. If your download added something like <code>-main</code> or <code>(1)</code> to the end, remove it.</li></ol>` },
    { id: "server-cfg", title: "Add it to server.cfg", html: `<p>Open <code>server.cfg</code> and add an <code>ensure</code> line for each resource, using the exact folder name. Anything it depends on must start <strong>before</strong> it.</p>
<pre><code># Dependencies first (only if the product needs them and they aren't already started)
ensure ox_lib
ensure ox_target

# Glitchworks
ensure resource_name</code></pre>
<p>Each product page and the install notes that come with it list its dependencies, for example <code>ox_lib</code> or <code>ox_target</code>.</p>` },
    { id: "game-build", title: "Check the game build", html: `<p>Many MLOs and some scripts need a newer game build. You set this in <code>server.cfg</code>:</p>
<pre><code>sv_enforceGameBuild 3095</code></pre>
<p>Builds such as 3095 or 3258 are common. <strong>Check each product page</strong> for the build it needs, and use that build or a newer one. Players download the matching game update the next time they join.</p>` },
    { id: "config", title: "Change the settings in config.lua", html: `<p>Config files are left open, even on escrowed assets, so you can set things up for your server. Open <code>config.lua</code> in a text editor such as VS Code or Notepad++ and change the values you need.</p>
<p class="note">Keep the quotes, commas and brackets exactly as they are. One missing comma stops the resource starting. Your server console shows the line number if something is wrong.</p>` },
    { id: "restart", title: "Restart the server", html: `<p>Restart the <strong>whole server</strong>, not just the resource. MLOs and maps are streamed to players when they join, so restarting only the resource can leave interiors missing or broken until everyone reconnects.</p>` },
    { id: "clear-cache", title: "Clear your FiveM cache", toc: "Clear the FiveM cache", html: `<p>If textures look wrong or an interior still shows the old version, clear your FiveM cache:</p>
<ol><li>Close FiveM completely.</li><li>Press <kbd>Windows</kbd> + <kbd>R</kbd>, type <code>%localappdata%\\FiveM\\FiveM.app\\data</code> and press Enter.</li><li>Delete the <code>cache</code>, <code>server-cache</code> and <code>server-cache-priv</code> folders. Leave <code>game-storage</code> alone, or FiveM will download the game files again.</li><li>Start FiveM and join the server.</li></ol>` },
    { id: "troubleshooting", title: "Troubleshooting", html: `<div class="tbl"><table><caption class="sr-only">Install problems and fixes</caption><thead><tr><th scope="col">What you see</th><th scope="col">What it means and how to fix it</th></tr></thead><tbody>
<tr><td>"You lack the required entitlement"</td><td>The asset was bought on a different Cfx.re account, or your server key isn't linked to the same account that bought it. Use a server key from the buying account, or transfer the asset to the right account in the Cfx.re portal.</td></tr>
<tr><td>"Couldn't find resource"</td><td>The folder name and the <code>ensure</code> line don't match. Check spelling and capitals, and remove any <code>-main</code> suffix from the folder.</td></tr>
<tr><td>Interiors flicker or are missing</td><td>Another MLO is at the same location and the two are fighting, or your game build is too low. Remove or move the conflicting MLO and check <a href="#game-build">the game build</a>.</td></tr>
<tr><td>"Oversized asset" warnings in the console</td><td>This is a warning, not an error. It's normal for detailed MLOs. Only worry if textures are also missing in game; if so, <a href="#clear-cache">clear your cache</a>.</td></tr>
<tr><td>Falling through floors or walking through walls</td><td>The resource isn't streaming properly. Check it started without errors, <a href="#restart">restart the whole server</a> and check <a href="#game-build">the game build</a>.</td></tr>
</tbody></table></div>` },
  ];
  await write("help/install-mlos-and-scripts/index.html", guidePage({ slug: "install-mlos-and-scripts", title: "Install MLOs and scripts", desc: "How to download and install Glitchworks FiveM MLOs and scripts, plus fixes for common errors.", intro: "From checkout to your server in a few steps, plus fixes for the errors people run into most.", sections }));
}

// Glitch Guard
{
  const rel = "../";
  const mention = s => `<span class="m-mention">${s}</span>`;
  const msg = inner => `<div class="mock-msg"><span class="mock-av">G</span><div class="mock-c"><span class="mock-who">Glitch Guard <em>APP</em></span>${inner}</div></div>`;
  const VIS = {
    setup: `<div class="mock"><div class="mock-top"><span class="mcmd">/setup</span></div>${msg(`<div class="embed"><b>Step 4 of 10: Protection</b><div class="mprog"><i style="width:40%"></i></div><p>Pick a protection level. You can switch individual options on or off next.</p><div class="seg"><span>Relaxed</span><span class="on">Balanced</span><span>Strict</span></div><div class="mbtns"><span class="mbtn g">Recommended</span><span class="mbtn">Next</span></div></div>`)}</div>`,
    protect: `<div class="mock"><div class="mock-top">Protection options</div>${["Anti-nuke", "Permission guard", "Bot guard", "Anti-raid", "Scam and phishing links", "Mass-mention filter", "Guard network ban list"].map(o => `<div class="mrow"><span>${o}</span><span class="sw on"></span></div>`).join("")}</div>`,
    safeguard: `<div class="mock"><div class="mock-top">Private alert &middot; senior team only</div>${msg(`<div class="embed" style="--ec:var(--warn)"><b>Safeguarding alert</b><p>A message in ${mention("#general")} may show a risk of self-harm.</p><p>Support numbers to share: Samaritans 116 123 &middot; Shout 85258 &middot; Childline 0800 1111</p><div class="mbtns"><span class="mbtn p">Go to message</span></div></div>`)}</div>`,
    verify: `<div class="mock"><div class="mock-top"><span class="mock-ch">#</span>verify</div>${msg(`<div class="embed" style="--ec:var(--ok)"><b>Welcome! Verify to join in</b><p>Press the button to get the Verified role and see the rest of the server.</p><div class="mbtns"><span class="mbtn g">Verify</span></div></div>`)}<div class="mock-top mock-gap"><span class="mock-ch">#</span>do-not-post</div>${msg(`<div class="embed" style="--ec:var(--bad)"><b>Don't post here</b><p>This channel is a trap for bots. Anything that posts here gets caught.</p></div>`)}</div>`,
    tickets: `<div class="mock"><div class="mock-top"><span class="mock-ch">#</span>support</div>${msg(`<div class="embed"><b>Need help?</b><p>Open a private ticket and the team will reply.</p><div class="mbtns"><span class="mbtn p">Open a ticket</span></div></div>`)}<div class="mock-top mock-gap"><span class="mock-ch">#</span>logs</div><div class="mrow"><span>Ticket closed</span><span class="mfile">transcript.pdf</span></div><div class="mrow"><span>Message deleted in ${mention("#general")}</span><span class="mtime">2m</span></div><div class="mrow"><span>Member joined</span><span class="mtime">5m</span></div></div>`,
    backup: `<div class="mock"><div class="mock-top"><span class="mcmd">/backup restore</span></div>${msg(`<div class="embed" style="--ec:var(--violet)"><b>Backup ready to restore</b><div class="mrow"><span>Roles</span><span class="mok">&#10003;</span></div><div class="mrow"><span>Channels</span><span class="mok">&#10003;</span></div><div class="mrow"><span>Permissions</span><span class="mok">&#10003;</span></div></div>`)}<div class="mcmds">${["/warn", "/timeout", "/kick", "/ban", "/unban", "/purge", "/lockdown"].map(c => `<span class="mcmd">${c}</span>`).join("")}</div></div>`,
  };
  const STORY = [
    { id: "setup", title: "Set up in ten guided steps", text: "Run <code>/setup</code> and Glitch Guard walks you through ten steps. Each one has a recommended button that creates everything for you.", points: ["A starter set of roles and channels for your type of server. It never deletes anything.", "Choose your staff role so moderators can see tickets and logs.", "Change any step later with <code>/settings</code>."] },
    { id: "protect", title: "Protection that fits your server", text: "Pick Relaxed, Balanced (recommended) or Strict, then switch individual protections on or off.", points: ["Anti-nuke stops mass deletes, bans and kicks.", "Permission guard and bot guard undo risky changes made by untrusted people.", "Anti-raid locks the server during join floods, and scam links are deleted and the sender banned."] },
    { id: "safeguard", title: "Safeguarding alerts for your senior team", text: "Rules-based checks spot text messages that suggest someone could be at risk, and privately alert only the senior roles you pick, plus the owner.", points: ["Not AI: predictable, transparent word and pattern lists.", "A \"Go to message\" button takes staff straight there.", "It never punishes anyone for these."] },
    { id: "verify", title: "Verification and a honeypot for bots", text: "New members press a button in #verify to get the Verified role. A #do-not-post channel catches bots that post where real people never would.", points: ["Optionally lock the server so unverified members only see #verify.", "Honeypot catches are recorded in your logs."] },
    { id: "tickets", title: "Tickets and private logs", text: "A #support channel opens private tickets for members. A private logs channel shows staff what happened and when.", points: ["Pick ticket presets or types, and which teams see each one.", "Ticket transcripts are saved as PDFs.", "Logs cover joins and leaves, deleted and edited messages, moderation actions and honeypot catches."] },
    { id: "backup", title: "Backups and moderation tools", text: "Back up your roles, channels and permissions, and put them back with <code>/backup restore</code>.", points: ["Moderation commands: /warn, /timeout, /kick, /ban, /unban, /purge and /lockdown.", "Moderators with your staff role can use them. Admins always can."] },
  ];
  const FEATURES = [
    ["wand", "Guided /setup", "Ten steps, each with a recommended option. Change anything later with /settings."],
    ["logs", "Private logs channel", "Joins and leaves, deleted and edited messages, moderation actions, honeypot catches and ticket transcripts as PDFs."],
    ["shieldCheck", "Protection levels", "Relaxed, Balanced (recommended) or Strict, with every option switchable."],
    ["verify", "Verification", "A #verify button gives the Verified role. Optionally lock the server until people verify."],
    ["bug", "Honeypot", "A #do-not-post channel that catches bots."],
    ["ticket", "Tickets", "Private tickets from a #support channel, with PDF transcripts."],
    ["wave", "Welcome messages", "Greet new members when they join."],
    ["users", "Partner network", "Get listed in the Glitchworks Discord, plus a store discount with /discount."],
    ["backup", "Backups", "Back up roles, channels and permissions. Put them back with /backup restore."],
    ["gavel", "Moderation commands", "/warn, /timeout, /kick, /ban, /unban, /purge and /lockdown."],
    ["data", "/mydata", "Helps members use their UK GDPR rights over the data Glitch Guard holds about them."],
    ["heart", "Safeguarding", "Optional, rules-based alerts for your senior team. Never punishes anyone."],
  ];
  const PROTECT = [
    ["Anti-nuke", "Stops mass deletes, bans and kicks."],
    ["Permission guard", "Undoes admin permissions given by untrusted people."],
    ["Bot guard", "Removes bots added by untrusted people."],
    ["Anti-raid", "Locks the server during join floods."],
    ["Scam and phishing links", "Deletes the message and bans the sender."],
    ["Spam filter", "Catches message spam."],
    ["Mass-mention filter", "Catches messages that mention 6 or more people."],
    ["No links from brand-new members", "Brand-new members can't post links."],
    ["Block other servers' invites", "Removes invite links to other Discord servers."],
    ["Guard network ban list", "Keeps out scammers and nukers already caught in other Glitch Guard servers."],
  ];
  const CHECKS = [
    ["Self-harm or suicide risk", `Staff get UK support numbers to share.<span class="helplines"><span>Samaritans 116 123</span><span>Shout 85258</span><span>Childline 0800 1111</span></span>`],
    ["Grooming-style messages", "Secrecy, asking for pictures, moving the chat to other apps, or asking \"are you alone\"."],
    ["Threats of violence", "Real-world threats of violence."],
    ["Personal details", "People sharing UK mobile numbers, postcodes, street addresses or email addresses."],
    ["Children sharing their age", "Messages such as \"I'm 13\" or \"I'm in Year 8\"."],
    ["Doxxing", "Posting someone else's real name, address, number or school."],
  ];
  const body = `<section class="page-hero guard-hero"><div class="ph-glow" data-parallax aria-hidden="true"></div><div class="wrap">
<span class="eyebrow">Glitch Guard &middot; Free</span>
<h1>Security and safeguarding for any Discord server</h1>
<p class="lead">Glitch Guard is our free Discord bot. A guided setup, protection against nukes, raids and scams, tickets, logs and backups, plus optional safeguarding alerts that help your team look out for people.</p>
<div class="btns">${guardButton()}<a class="btn btn-ghost" href="${link(rel, "help/glitch-guard-setup/")}">Read the setup guide</a></div>
<ul class="hero-facts"><li>Free for any server</li><li>Set up with <code>/setup</code></li><li>Rules-based safeguarding, not AI</li></ul>
</div></section>
<section class="story-sec"><div class="wrap">
<div class="section-head"><div><span class="eyebrow">How it works</span><h2>What Glitch Guard does</h2></div></div>
<div class="story" data-story>
<div class="story-steps">${STORY.map((s, i) => `<article class="story-step" data-step="${s.id}">
<div class="vis-inline" aria-hidden="true">${VIS[s.id]}</div>
<span class="story-num">${String(i + 1).padStart(2, "0")} / ${String(STORY.length).padStart(2, "0")}</span>
<h3>${s.title}</h3><p>${s.text}</p><ul class="ticks">${s.points.map(p => `<li>${p}</li>`).join("")}</ul>
${s.id === "safeguard" ? `<p><a href="#safeguarding">How safeguarding works</a></p>` : ""}</article>`).join("\n")}</div>
<div class="story-stage" aria-hidden="true"><div class="stage-frame">${STORY.map((s, i) => `<div class="vis${i === 0 ? " on" : ""}" data-vis="${s.id}">${VIS[s.id]}</div>`).join("")}<div class="story-rail"><i></i></div></div></div>
</div></div></section>
<section class="sg-wrap" id="safeguarding" aria-labelledby="sg-title"><div class="wrap"><div class="sg"><div class="sg-inner">
<span class="eyebrow">Safeguarding</span><h2 id="sg-title">Helping your team look out for people</h2>
<p class="sg-lead">Discord servers bring together people of all ages. Glitch Guard's optional safeguarding checks give your senior team a private heads-up when a message suggests someone could be at risk, so a real person can step in.</p>
<div class="sg-points">
<div class="sg-point">${ic("rules")}<h3>Not AI</h3><p>A rules-based system using word and pattern lists, so it's predictable and transparent. Server admins choose which checks are on.</p></div>
<div class="sg-point">${ic("bell")}<h3>Private alerts, never punishment</h3><p>It watches text messages and privately alerts only the senior roles your server picks, plus the owner, with a "Go to message" button. It never punishes anyone for these.</p></div>
<div class="sg-point">${ic("eraser")}<h3>Optional: Remove details</h3><p>With Remove details on, personal details, a child's age and doxxing are deleted straight away. Staff still get the alert.</p></div>
</div>
<h3>What it checks for</h3>
<ul class="sg-checks">${CHECKS.map(([t, d]) => `<li><strong>${t}</strong><span>${d}</span></li>`).join("")}</ul>
<div class="limits"><h3>Honest limits</h3><ul>
<li><strong>Text only.</strong> It can't see images, GIFs, video or voice.</li>
<li><strong>Pattern-based,</strong> so it can miss things or flag harmless messages.</li>
<li><strong>A helping hand, not a replacement for a team.</strong></li>
<li>Staff aren't checked unless <strong>Check staff</strong> is turned on (useful for testing).</li>
</ul></div>
</div></div></div></section>
<section><div class="wrap">
<div class="section-head"><div><span class="eyebrow">Protection</span><h2>Every protection option</h2></div><p>Choose Relaxed, Balanced or Strict, then switch any of these on or off.</p></div>
<div class="opt-grid">${PROTECT.map(([t, d]) => `<div class="opt"><strong>${t}</strong><span>${d}</span></div>`).join("")}</div>
</div></section>
<section style="padding-top:0"><div class="wrap">
<div class="section-head"><div><span class="eyebrow">Features</span><h2>What's included</h2></div><p>All free, all set up from one command.</p></div>
<div class="feat-grid">${FEATURES.map(([i, t, d]) => `<div class="feat">${ic(i)}<h3>${t}</h3><p>${d}</p></div>`).join("")}</div>
</div></section>
<section style="padding-top:0"><div class="wrap"><div class="band"><div><span class="eyebrow">Free for any server</span><h2>Add Glitch Guard to your server</h2><p>Add the bot, move its role near the top and run <code>/setup</code>. The <a href="${link(rel, "help/glitch-guard-setup/")}">setup guide</a> explains every step.</p></div>${guardButton("Add Glitch Guard")}</div></div></section>`;
  await write("guard/index.html", page({ rel, title: "Glitch Guard: free Discord security and safeguarding bot", desc: "Glitch Guard is a free Discord bot: guided setup, anti-nuke and anti-raid protection, verification, tickets, logs, backups and rules-based safeguarding alerts.", current: "guard/", body, canonical: "guard/" }));
}

// Status
{
  const rel = "../";
  const BOTS = [
    { name: "Glitchworks Bot", role: "Runs the Glitchworks Discord: the store, support tickets, product certificates and security." },
    { name: "Glitch Guard", role: `Our free security and safeguarding bot for any Discord server. <a href="${link(rel, "guard/")}">About Glitch Guard</a>` },
  ];
  const WINDOWS = [["day", "24 hours"], ["week", "7 days"], ["month", "30 days"]];
  const botCard = b => `<article class="bot-card" data-bot="${esc(b.name)}" data-state="unknown">
<div class="bot-head"><span class="dot" aria-hidden="true"></span><div class="bot-id"><h2 class="bot-name">${esc(b.name)}</h2><p class="bot-role">${b.role}</p></div><span class="bot-state" data-f="state">Unknown</span></div>
<div class="bot-up"><span class="bot-up-label" data-f="label">Up for</span><strong class="bot-up-fig" data-f="fig">&mdash;</strong><span class="bot-up-note" data-f="note"></span></div>
<ul class="ut" aria-label="Uptime">${WINDOWS.map(([k, l]) => `<li data-w="${k}" data-empty><span class="ut-label">${l}</span><span class="ut-val">&mdash;</span><span class="ut-bar" aria-hidden="true"><i></i></span><span class="ut-note"></span></li>`).join("")}</ul>
</article>`;
  const TRUST = [
    ["server", "Our own dedicated hardware", "Hosted on our own dedicated hardware in the UK, not shared cloud servers."],
    ["battery", "Battery backup", "Battery backup keeps it running through power cuts."],
    ["refresh", "Self-healing", "If a bot crashes or freezes, it's detected and restarted automatically, usually back within about a minute. Routine maintenance restarts take seconds."],
    ["lock", "Private by design", "Connections are encrypted, and the status feed contains no customer or server data."],
  ];
  const body = `<section class="page-hero page-hero-sm"><div class="ph-glow" data-parallax aria-hidden="true"></div><div class="wrap">
<span class="eyebrow">Status</span><h1>Bot status</h1>
<p class="lead">Live status and uptime for the Glitchworks Discord bots. This page checks again every minute.</p>
</div></section>
<section class="st" data-status-page data-status-url="${esc(STATUS_URL)}"><div class="wrap">
<noscript><style>.st-banner,.st-meta{display:none}</style><p class="st-noscript">Live status needs JavaScript. Turn it on to see whether our bots are online.</p></noscript>
<div class="st-banner" data-banner data-state="loading"><span class="dot" aria-hidden="true"></span><div class="st-text" role="status" aria-live="polite" aria-atomic="true"><strong data-banner-title>Checking status&hellip;</strong><span class="st-sub" data-banner-sub>Getting the latest figures.</span></div></div>
<div class="st-meta"><span data-checked>Not checked yet</span><span data-tracking></span><button class="btn btn-ghost btn-sm" type="button" data-refresh>${ic("refresh")}Check now</button></div>
<div class="bots" data-bots>${BOTS.map(botCard).join("\n")}</div>
</div></section>
<section class="trust"><div class="wrap">
<span class="eyebrow">Reliability</span><h2>How we keep them running</h2>
<div class="trust-grid">${TRUST.map(([i, t, d]) => `<div class="trust-item">${ic(i)}<h3>${t}</h3><p>${d}</p></div>`).join("")}</div>
<p class="trust-quote">Don't take our word for it: these uptime figures are live.</p>
</div></section>`;
  await write("status/index.html", page({ rel, title: "Status", desc: "Live status and uptime of the Glitchworks Discord bots: Glitchworks Bot and Glitch Guard.", current: "status/", body, canonical: "status/", scripts: ["status.js"] }));
}

// LCL Bot legal pages (linked from the LCL Bot app in the Discord Developer Portal)
{
  const rel = "../../";
  const updated = "4 November 2026";
  const legal = (title, intro, sections) => `<section style="padding-top:44px"><div class="wrap" style="max-width:860px"><span class="eyebrow">LCL Bot</span><h1>${title}</h1>
<p style="color:var(--muted)">Last updated ${updated}</p>
<p>${intro}</p>
${sections.map(([h, items]) => `<h2 style="margin-top:30px">${h}</h2>${Array.isArray(items) ? `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>` : `<p>${items}</p>`}`).join("\n")}
<p style="margin-top:34px;color:var(--muted)">See also: <a href="${link(rel, title === "Terms of Service" ? "lcl-bot/privacy/" : "lcl-bot/terms/")}">${title === "Terms of Service" ? "Privacy Policy" : "Terms of Service"}</a></p>
</div></section>`;
  const terms = legal("Terms of Service",
    "LCL Bot is the Discord bot for the London City Life community server. It is built and run by Glitchworks for London City Life. By using LCL Bot in the London City Life Discord, you agree to these terms.",
    [
      ["What LCL Bot does", ["Opens and manages support tickets, and saves ticket transcripts.", "Handles role requests, callsigns and community events.", "Helps staff keep the server safe: automatic moderation, checks on new members, a spam-catching channel and an AI safety check on suspicious messages.", "Gives staff moderation tools such as warnings, timeouts, bans and message clean-up."]],
      ["Using it properly", ["Use the bot only as intended, within Discord's Terms of Service and Community Guidelines and the London City Life rules.", "Don't try to break, overload, trick or misuse the bot, its commands or its buttons.", "Don't use tickets to harass staff or other members, or to send spam."]],
      ["Moderation", "Decisions about warnings, timeouts, kicks, bans, roles and refunds are made by London City Life staff, not by the bot. The bot only carries out what staff decide, apart from removing clear spam and scam links automatically. Appeals go through a ban appeal ticket."],
      ["Availability", "We aim to keep LCL Bot running, but it is provided as it is, with no promise that it will always be available or free of errors. Features may change or be removed."],
      ["Ending use", "London City Life staff can stop anyone using the bot, for example after a ban. You can stop using it at any time by leaving the server."],
      ["Changes", "We may update these terms. The date at the top shows the latest version. Continuing to use the bot after a change means you accept the new terms."],
      ["Contact", `Questions about these terms: open a ticket in the London City Life Discord, or contact Glitchworks through our <a href="${esc(cfg.discordInvite || "")}" rel="noopener">Discord</a>.`],
    ]);
  const privacy = legal("Privacy Policy",
    "This policy explains what information LCL Bot keeps when you use the London City Life Discord, why, and for how long. LCL Bot is built and run by Glitchworks for London City Life.",
    [
      ["What we keep", ["Your Discord user ID, username, server nickname, account age and roles.", "Tickets you open: the form answers, messages and files in the ticket, and the transcript saved when it closes.", "Moderation records: warnings, timeouts, kicks, bans, strikes, staff notes and their reasons.", "Messages that trip a filter, the spam-catching channel or the AI safety check, with the reason they were flagged.", "Role requests, callsigns, event sign-ups and join check results."]],
      ["What we don't keep", "LCL Bot does not read or store your direct messages to other people. It does not keep a copy of ordinary chat messages that don't trip a filter. It does not sell data or use it for advertising."],
      ["AI safety check", "To catch scams, threats and similar problems, messages that a basic filter has already marked as suspicious may be sent to an AI service for a second check. Only those messages are sent, never your DMs, tickets or staff channels. The AI never bans or kicks anyone; a member of staff decides."],
      ["Why we keep it", "To run support tickets, keep the community safe, enforce the server rules, and keep a fair record of staff decisions."],
      ["How long we keep it", ["Ticket transcripts: 12 months, then deleted.", "Moderation records and staff notes: for as long as they are needed to enforce the rules, and reviewed at least once a year.", "Flagged messages: 90 days, unless they form part of a moderation record.", "Join check results: 90 days."]],
      ["Who can see it", "London City Life staff, depending on their role. Staff complaints are visible to management only. The bot runs on a hosting provider that stores the data on our behalf, and Discord itself handles all messages under its own privacy policy."],
      ["Your rights", "You can ask for a copy of the information LCL Bot holds about you, ask for something to be corrected, or ask for it to be deleted. Some moderation records may be kept where they are needed to enforce a ban. Open a ticket in the London City Life Discord to make a request."],
      ["Changes", "We may update this policy. The date at the top shows the latest version."],
      ["Contact", `Privacy questions: open a ticket in the London City Life Discord, or contact Glitchworks through our <a href="${esc(cfg.discordInvite || "")}" rel="noopener">Discord</a>.`],
    ]);
  await write("lcl-bot/terms/index.html", page({ rel, title: "LCL Bot Terms of Service", desc: "Terms of Service for LCL Bot, the London City Life Discord bot.", current: null, body: terms, canonical: "lcl-bot/terms/" }));
  await write("lcl-bot/privacy/index.html", page({ rel, title: "LCL Bot Privacy Policy", desc: "Privacy Policy for LCL Bot, the London City Life Discord bot.", current: null, body: privacy, canonical: "lcl-bot/privacy/" }));
}

for (const a of assets) await write(`store/${a.slug}/index.html`, detail(a));
for (const p of projects) await write(`custom-projects/${p.slug}/index.html`, detail(p));

// search index (loaded on every page)
{
  const entry = (it, base) => ({
    t: it.title, d: it.tagline, c: it.category === "Other" ? "Asset" : it.category,
    k: [it.client, it.location, it.frameworks, ...it.services, ...it.services.map(k => SERVICES.find(x => x.key === k).full), ...it.features].join(" "),
    s: it.kind === "project" ? "Custom build" : STATUS[it.status].label,
    u: link("", `${base}${it.slug}/`),
    i: it.imageUrls[0] ? (typeof it.imageUrls[0] === "string" ? "" : it.imageUrls[0].small) : "",
  });
  // Site pages and help guides, so Ctrl+K finds them too (listed after the assets).
  const pages = [
    { t: "Glitch Guard", d: "Free security and safeguarding bot for any Discord server.", c: "Discord bot", k: "discord bot security safeguarding anti-nuke anti-raid verification tickets logs backups moderation free", s: "Free", u: link("", "guard/"), i: "" },
    { t: "Bot status", d: "Live status and uptime of the Glitchworks Discord bots.", c: "Status", k: "status uptime online offline outage glitchworks bot glitch guard", s: "Live", u: link("", "status/"), i: "" },
    { t: "Help centre", d: "Guides, common questions and how to contact us.", c: "Help", k: "help faq support ticket contact refund buying download", s: "Help", u: link("", "help/"), i: "" },
    ...HELP_GUIDES.map(g => ({ t: g.title, d: g.blurb, c: "Guide", k: g.keys, s: "Guide", u: link("", `help/${g.slug}/`), i: "" })),
  ];
  const index = [...assets.map(a => entry(a, "store/")), ...projects.map(p => entry(p, "custom-projects/")), ...pages];
  await write("search-index.js", "window.GW_INDEX=" + JSON.stringify(index) + ";");
}

// 404, sitemap, robots, headers
const ROOTPATH = new URL(cfg.siteUrl + "/").pathname.replace(/\/+$/, "/");
await write("404.html", page({ rel: ROOTPATH, title: "Page not found", current: null, canonical: "404", body: `<section><div class="wrap" style="text-align:center"><span class="eyebrow">404</span><h1>That page glitched out</h1><p style="color:var(--muted)">It may have moved. Try the store instead.</p><a class="btn btn-primary" href="${ROOTPATH}store/">Go to the store</a></div></section>` }));
const urls = ["", "store/", ...(SHOW_PROJECTS ? ["custom-projects/"] : []), "guard/", "help/", ...HELP_GUIDES.map(g => `help/${g.slug}/`), "status/", ...assets.map(a => `store/${a.slug}/`), ...projects.map(p => `custom-projects/${p.slug}/`)];
await write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${cfg.siteUrl}/${u}</loc></url>`).join("\n")}\n</urlset>\n`);
await write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`);
await write(".nojekyll", "");
await write("_headers", `/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n/img/*\n  Cache-Control: public, max-age=2592000\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`);

console.log(`Built ${urls.length} pages (${assets.length} assets, ${projects.length} custom projects) into dist/${PREVIEW ? " [preview links]" : ""}`);
