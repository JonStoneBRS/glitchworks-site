# Glitchworks website

A fast static site for Cloudflare Pages. No framework, one small CSS file, one icon font set and almost no JavaScript.

## Add a new asset (2 minutes)
1. Copy any file in `content/assets/` (for example `duty-kit.md`) and rename it. The file name becomes the web address, so use lower case and dashes: `police-barriers.md` becomes `/store/police-barriers/`.
2. Change the details at the top:

```
---
title: Police Barriers
category: Script          # MLO, Script or Weapon
status: coming-soon       # for-sale, coming-soon, in-development or showcase
featured: true            # true = shows on the home page
tagline: One line that sells it.
location:                 # MLOs only, e.g. Sandy Shores
frameworks: Standalone, QBCore, Qbox, ESX
tebex_package:            # the package ID from Tebex, once it's on sale
price:                    # leave blank; Tebex fills it in
video:                    # YouTube video ID only, e.g. dQw4w9WgXcQ
images:
  - barriers-1.jpg        # files you put in content/images/
  - barriers-2.jpg
features:
  - First feature
  - Second feature
---
Write the description here in plain text. Leave a blank line between paragraphs.
```

3. Put screenshots in `content/images/`. Any size is fine: the build shrinks them and makes fast WebP versions. The first image is the thumbnail.
4. Save, commit and push. Cloudflare Pages rebuilds the site in about a minute.

## Add a custom project
Same as above, but put the file in `content/projects/` and add `client: London Metro` (or whoever it was for). There's no status or price.

## Selling through Tebex
1. In `config.json`, fill in:
   - `tebex.publicToken`: Tebex control panel, Integrations > API Keys > Public Token
   - `tebex.storeUrl`: your store address, e.g. `https://glitchworks.tebex.io`
2. Put the package ID in the asset's `tebex_package:` line. The site then shows the live price and a **Buy now** button.
3. **Any Tebex package without a file here gets a page automatically**, from its Tebex name, picture, description and price. Name your Tebex categories MLOs, Scripts or Weapons so it sorts correctly.
4. Tebex changes appear when the site next rebuilds. To rebuild without pushing, create a Deploy Hook in Cloudflare Pages (Settings > Builds) and visit or POST it.

## Discord
Put your permanent invite link in `config.json` as `discordInvite`. Until then, buttons go to the Help page.

## Cloudflare Pages settings
- Build command: `npm install && node build.mjs`
- Output directory: `dist`
- Custom domain: glitchworks.uk

## Preview on your PC
`node build.mjs --preview`, then open `dist/index.html`.

## Hosting now: GitHub Pages (free)
- Live at https://jonstonebrs.github.io/glitchworks-site/
- Pages publishes the `docs/` folder on `main`. After changing content, run `OUT=docs node build.mjs`, then commit and push. It's live in about a minute.
- `siteUrl` in config.json is the GitHub address for now. Change it to `https://glitchworks.uk` when you move to Cloudflare Pages with the domain.
