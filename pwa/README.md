# ONE SET. PWA

The phone app. One entry a day for protein, carbs, fat, and calories. The log stays in IndexedDB on the device. There is no account and no server-side copy.

The Streamlit app in the repository root is the prototype. This folder is the product.

## Run locally

```bash
cd pwa
npm install
npm test
npm run dev
```

Open http://localhost:5173. `npm run build` then `npm run preview` serves the production build at http://localhost:4173/. Demo mode on that build is http://localhost:4173/?demo=1.

To open the public sample immediately, use http://localhost:5173/?demo=1. Sample history is bundled, date-shifted, and stored apart from a log you import or start yourself.

## Deploy on Cloudflare Pages

Cloudflare Pages is the only deploy target. The site is served at the domain root. Demo mode is `/?demo=1`.

Connect this repository and set:

1. Root directory: `pwa`
2. Build command: `npm run build`
3. Build output directory: `dist`

`pwa/.node-version` asks for Node 22, which this build needs. If the build log shows an older Node, set the environment variable `NODE_VERSION` to `22`.

`public/_headers` is copied into `dist`. It tells Cloudflare to revalidate `index.html`, `sw.js`, and `manifest.webmanifest` instead of holding them for a long time. No `wrangler.toml` is required for the Git build.

Turn off GitHub Pages for this repository (Settings → Pages → source None) if it is still enabled. The GitHub Actions workflow that published `pwa/dist` has been removed.

### Moving an existing log

The log is in IndexedDB for the site origin. A browser treats `https://aiontrust.github.io` and the new domain as different sites, so the log does not come along. On the old page (`https://aiontrust.github.io/macro-tracker/`), open Export and download the full log CSV, then import that file on the new site. A new origin starts empty.

## CSV

Full-log export is `Date,Protein,Carbs,Fat,Calories`. Blank cells stay blank. Import also accepts `date,protein_g,carbs_g,fat_g,kcal`. A file with a bad cell or a repeated date is rejected and nothing from it is imported.

When protein, carbs, and fat are filled and calories is left blank, Save stores `4×protein + 4×carbs + 9×fat`. A typed calorie number is kept. Loading a file does not recompute calories that were left blank.

## Pro early access

The Export screen has a signup form for a branded gym version. It is disabled until `PRO_SIGNUP_ENDPOINT` in `src/config.ts` is a URL that accepts a form field named `email` (Formspree works). Set it, rebuild, and redeploy. The macro log is not sent.

## Deferred

Meals, accounts, sync, a leaderboard, PDF export, and app stores are not in this version. Summary PDF is shown as unavailable. Light mode is included as a stretch and can be switched on Export.
