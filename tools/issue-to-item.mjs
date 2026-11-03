// Turns a "New website item" issue form into content/assets/<slug>.md plus
// its pictures. Run by .github/workflows/new-item.yml.
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const body = process.env.ISSUE_BODY || "";
const issue = process.env.ISSUE_NUMBER || "0";
const token = process.env.GITHUB_TOKEN || "";

// Issue forms come through as "### Label" then the answer.
const fields = {};
for (const part of body.split(/^### /m).slice(1)) {
  const nl = part.indexOf("\n");
  const label = part.slice(0, nl).trim();
  const value = part.slice(nl + 1).trim();
  fields[label] = value === "_No response_" ? "" : value;
}
const get = k => fields[k] || "";
const one = s => s.replace(/\s+/g, " ").trim();
const ticked = s => [...s.matchAll(/^- \[[xX]\] (.+)$/gm)].map(m => m[1].trim());

// Closed issue = take the item down (its file and pictures are removed).
if (process.env.ISSUE_STATE === "closed") {
  const dir = path.join(ROOT, "content", "assets");
  for (const f of await fs.readdir(dir)) {
    const text = await fs.readFile(path.join(dir, f), "utf8");
    if (!new RegExp(`^issue: ${issue}$`, "m").test(text)) continue;
    for (const m of text.matchAll(/^  - (.+\.(?:png|jpe?g|webp|gif))$/gim)) await fs.rm(path.join(ROOT, "content", "images", m[1]), { force: true });
    await fs.rm(path.join(dir, f));
    console.log(`Removed content/assets/${f}`);
    await fs.appendFile(process.env.GITHUB_OUTPUT || "/dev/null", `slug=${f.replace(/\.md$/, "")}\nremoved=1\n`);
  }
  process.exit(0);
}

const name = one(get("Name"));
if (!name) { console.error("No name in the form"); process.exit(1); }
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `item-${issue}`;
const STATUS = { "Coming soon": "coming-soon", "In development": "in-development", "Available": "for-sale", "Showcase": "showcase" };
const yt = (get("YouTube video (optional)").match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/) || [])[1] || "";
const price = (get("Price (optional)").match(/\d+(?:\.\d{1,2})?/) || [""])[0];

// Pictures: markdown images or <img src> tags GitHub makes when you drag files in.
const urls = [...get("Pictures").matchAll(/!\[[^\]]*\]\((https:\/\/[^)\s]+)\)|<img[^>]+src="(https:\/\/[^"]+)"/g)].map(m => m[1] || m[2]);
const images = [];
// On an edit, clear this item's old pictures first so removed ones don't linger.
for (const f of await fs.readdir(path.join(ROOT, "content", "images")).catch(() => [])) if (new RegExp(`^${slug}-\\d+\\.`).test(f)) await fs.rm(path.join(ROOT, "content", "images", f));
await fs.mkdir(path.join(ROOT, "content", "images"), { recursive: true });
for (const [i, url] of urls.entries()) {
  const res = await fetch(url, { headers: token && url.startsWith("https://github.com/") ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) { console.warn(`! picture ${i + 1} failed: ${res.status}`); continue; }
  const type = res.headers.get("content-type") || "";
  const ext = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : type.includes("gif") ? ".gif" : ".jpg";
  const file = `${slug}-${i + 1}${ext}`;
  await fs.writeFile(path.join(ROOT, "content", "images", file), Buffer.from(await res.arrayBuffer()));
  images.push(file);
}

const lines = [
  "---",
  `title: ${name}`,
  `category: ${one(get("Type")) || "Script"}`,
  `status: ${STATUS[one(get("Status"))] || "coming-soon"}`,
  `featured: ${ticked(get("Home page")).length > 0}`,
  `tagline: ${one(get("Short description"))}`,
  `services: ${ticked(get("Services")).join(", ")}`,
  `frameworks: ${one(get("Frameworks"))}`,
  "tebex_package:",
  `price: ${price}`,
  `video: ${yt}`,
  "images:",
  ...images.map(f => `  - ${f}`),
  "features:",
  ...get("Key features").split("\n").map(l => one(l.replace(/^[-*•]\s*/, ""))).filter(Boolean).map(f => `  - ${f}`),
  `issue: ${issue}`,
  "---",
  get("Full description").replace(/\r/g, ""),
  "",
];
await fs.writeFile(path.join(ROOT, "content", "assets", `${slug}.md`), lines.join("\n"));
await fs.appendFile(process.env.GITHUB_OUTPUT || "/dev/null", `slug=${slug}\npictures=${images.length}\n`);
console.log(`Wrote content/assets/${slug}.md with ${images.length} picture(s)`);
