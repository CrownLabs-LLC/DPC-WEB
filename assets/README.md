# /assets

Drop these production files in here before deploy. The HTML references them by absolute path (`/assets/...`).

| File | Used by | Spec |
| --- | --- | --- |
| `og-image.jpg` | `index.html` `<meta og:image>` | 1200×630, navy bg + primary lockup |
| `og-partner.jpg` | `partners.html` `<meta og:image>` | 1200×630, "FOUNDING PARTNERS · LIVERMORE" |
| `dpc-primary-lockup.png` | `partners.html` schema.org `logo` | transparent PNG, primary lockup |

Optional (nice-to-have):
- `favicon-32.png` (32×32)
- `favicon-192.png` (192×192)

Once dropped in, commit them — Vercel serves `/assets/*` with a 1-year immutable cache (configured in `vercel.json`).
