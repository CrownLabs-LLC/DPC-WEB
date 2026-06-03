# /assets

Production image assets. The HTML references them by absolute path (`/assets/...`).
Vercel serves `/assets/*` with a 1-year immutable cache (configured in `vercel.json`).

| File | Used by | Spec |
| --- | --- | --- |
| `og-image.jpg` | `index.html` `<meta og:image>` | 1200×630, navy bg + primary lockup + "FOUNDING MEMBERSHIP OPEN" |
| `og-partner.jpg` | `partners.html` `<meta og:image>` | 1200×630, lockup left + Founding Partners / Livermore right |
| `dpc-primary-lockup.png` | `partners.html` schema.org `logo` | 1200×900 navy bg, primary lockup |

Optional (nice-to-have):
- `favicon-32.png` (32×32)
- `favicon-192.png` (192×192)

## Regenerating

The PNG/JPG files are rendered from the SVG sources in [`source/`](source/) using
`rsvg-convert` (from librsvg) + `sips` for the JPG conversion. Requires Playfair
Display + Barlow + Barlow Condensed installed locally (`brew install --cask
font-playfair-display font-barlow font-barlow-condensed`).

```sh
# from repo root
rsvg-convert -w 1200          assets/source/primary-lockup.svg -o assets/dpc-primary-lockup.png
rsvg-convert -w 1200 -h 630   assets/source/og-image.svg       -o /tmp/og-image.png
rsvg-convert -w 1200 -h 630   assets/source/og-partner.svg     -o /tmp/og-partner.png
sips -s format jpeg -s formatOptions 92 /tmp/og-image.png   --out assets/og-image.jpg
sips -s format jpeg -s formatOptions 92 /tmp/og-partner.png --out assets/og-partner.jpg
```

Edit the SVG in `source/` then re-run to update the rendered output. Commit both
the SVG and the rendered file together.
