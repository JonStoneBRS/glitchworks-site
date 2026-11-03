// Glitchworks website builder.
// Usage: node build.mjs            (real site, clean URLs)
//        node build.mjs --preview  (links point at index.html, for previewing from files)
// Reads config.json, content/assets/*.md, content/projects/*.md and (optionally) your Tebex
// packages, and writes the finished site to dist/.

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
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

function page({ rel, title, desc, current, body, canonical, image }) {
  const full = title ? `${title} | ${cfg.siteName}` : `${cfg.siteName} | FiveM MLOs, scripts and weapons`;
  const nav = [["", "Home"], ["store/", "Store"], ...(SHOW_PROJECTS ? [["custom-projects/", "Custom projects"]] : []), ["help/", "Help"]];
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
<link rel="stylesheet" href="${rel}style.css">
<script src="${rel}search-index.js" defer></script>
<script src="${rel}fx.js" defer></script>
</head>
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
<div>&copy; ${new Date().getFullYear()} ${esc(cfg.siteName)}. Built properly, tested on live servers.<br>Purchases are processed by Tebex, our merchant of record. Not affiliated with Rockstar Games, Cfx.re or any emergency service.</div>
<nav aria-label="Footer"><a href="${link(rel, "store/")}">Store</a>${SHOW_PROJECTS ? `<a href="${link(rel, "custom-projects/")}">Custom projects</a>` : ""}<a href="${link(rel, "help/")}">Help and FAQ</a><a href="${ticketHref(rel)}">${discordLabel}</a><a href="${esc(cfg.termsUrl || "#")}">Terms</a><a href="${esc(cfg.privacyUrl || "#")}">Privacy</a></nav>
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
<picture><source type="image/avif" srcset="img/banner-960.avif 960w, img/banner-1600.avif 1600w" sizes="100vw"><img src="img/banner-1600.webp" srcset="img/banner-960.webp 960w, img/banner-1600.webp 1600w" sizes="100vw" alt="Glitchworks" width="1600" height="670" fetchpriority="high"></picture>
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
  const body = `<section style="padding-top:44px"><div class="wrap" style="max-width:860px"><span class="eyebrow">Help</span><h1>Help and FAQ</h1>
<h2 style="margin-top:30px">How buying works</h2>
<div class="steps" style="grid-template-columns:1fr;margin-bottom:40px">
<div class="step"><h3>Buy through Tebex</h3><p>Tebex handles payment, tax and receipts for us. You'll log in with your FiveM account during checkout.</p></div>
<div class="step"><h3>Download from Keymaster</h3><p>Your purchase appears in the Cfx Keymaster straight away.</p></div>
<div class="step"><h3>Install</h3><p>Put the folder in your resources, add <code>ensure</code> lines to server.cfg in the order shown in the notes, then restart the server.</p></div>
</div>
<h2>Questions</h2>
${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}
<h2 id="contact" style="margin-top:40px">Get in touch</h2>
<p style="color:var(--muted)">Support, bespoke orders and questions are all handled through tickets in our Discord.</p>
${cfg.discordInvite ? `<a class="btn btn-primary" href="${esc(cfg.discordInvite)}" rel="noopener">Join the Discord</a>` : `<p><strong>Discord invite coming soon.</strong></p>`}
</div></section>`;
  await write("help/index.html", page({ rel, title: "Help and FAQ", desc: "How buying from Glitchworks works, plus answers to common questions.", current: "help/", body, canonical: "help/" }));
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
  const index = [...assets.map(a => entry(a, "store/")), ...projects.map(p => entry(p, "custom-projects/"))];
  await write("search-index.js", "window.GW_INDEX=" + JSON.stringify(index) + ";");
}

// 404, sitemap, robots, headers
const ROOTPATH = new URL(cfg.siteUrl + "/").pathname.replace(/\/+$/, "/");
await write("404.html", page({ rel: ROOTPATH, title: "Page not found", current: null, canonical: "404", body: `<section><div class="wrap" style="text-align:center"><span class="eyebrow">404</span><h1>That page glitched out</h1><p style="color:var(--muted)">It may have moved. Try the store instead.</p><a class="btn btn-primary" href="${ROOTPATH}store/">Go to the store</a></div></section>` }));
const urls = ["", "store/", ...(SHOW_PROJECTS ? ["custom-projects/"] : []), "help/", ...assets.map(a => `store/${a.slug}/`), ...projects.map(p => `custom-projects/${p.slug}/`)];
await write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${cfg.siteUrl}/${u}</loc></url>`).join("\n")}\n</urlset>\n`);
await write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`);
await write(".nojekyll", "");
await write("_headers", `/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n/img/*\n  Cache-Control: public, max-age=2592000\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`);

console.log(`Built ${urls.length} pages (${assets.length} assets, ${projects.length} custom projects) into dist/${PREVIEW ? " [preview links]" : ""}`);
