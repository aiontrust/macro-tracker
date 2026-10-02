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

Open http://localhost:5173. `npm run build` then `npm run preview` serves the production build at http://localhost:4173/macro-tracker/.

To open the public sample immediately, use http://localhost:5173/?demo=1. Sample history is bundled, date-shifted, and stored apart from a log you import or start yourself.

## Deploy on GitHub Pages

The workflow `.github/workflows/pages.yml` builds this folder and deploys `pwa/dist` with GitHub Actions.

1. In the repository settings, open Pages.
2. Set the source to GitHub Actions.
3. Push to `main` (or run the workflow by hand).

The site is published at `https://aiontrust.github.io/macro-tracker/`. The sample link is `https://aiontrust.github.io/macro-tracker/?demo=1`.

The production `base` is `/macro-tracker/`, set in `vite.config.ts`. If the repository name changes, set `VITE_BASE` (include the leading and trailing slash) and rebuild.

## CSV

Full-log export is `Date,Protein,Carbs,Fat,Calories`. Blank cells stay blank. Import also accepts `date,protein_g,carbs_g,fat_g,kcal`. A file with a bad cell or a repeated date is rejected and nothing from it is imported.

When protein, carbs, and fat are filled and calories is left blank, Save stores `4×protein + 4×carbs + 9×fat`. A typed calorie number is kept. Loading a file does not recompute calories that were left blank.

## Pro early access

The Export screen has a signup form for a branded gym version. It is disabled until `PRO_SIGNUP_ENDPOINT` in `src/config.ts` is a URL that accepts a form field named `email` (Formspree works). Set it, rebuild, and redeploy. The macro log is not sent.

## Deferred

Meals, accounts, sync, a leaderboard, PDF export, and app stores are not in this version. Summary PDF is shown as unavailable. Light mode is included as a stretch and can be switched on Export.
