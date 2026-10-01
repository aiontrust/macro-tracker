# ONE SET.

A Streamlit prototype for logging daily protein, carbs, fat, and calories. The installed product is meant to be a phone app that keeps the log on the device. This repository is the prototype you can run and deploy now.

The log is a CSV that you keep. When you open the app, upload that file (or start fresh). Edits stay in the session. Download the updated CSV before you leave. Streamlit Community Cloud wipes files the app writes when it restarts or goes idle, so the app does not save your history on the server. If several people share the link, each person still has their own file.

Blank cells are missing values. They are not zeros. Days you never saved are left out of the averages, and they break the chart line instead of being drawn as zero.

## Run locally

```bash
pip install -r requirements.txt
streamlit run app.py
```

Open the local URL Streamlit prints, usually http://localhost:8501.

`sample_macro_log.csv` is fake data you can upload to see the layout. The screen is split into Log, Trends, Week, and Export.

## Deploy on Streamlit Community Cloud

The entry point is `app.py` in the repository root. Dependencies are the root `requirements.txt`. Theme and fonts come from `.streamlit/config.toml`.

If this app was previously deployed from `new-folder/app.py`, open the app settings in Streamlit Community Cloud and change the main file path to `app.py`. Reboot the app after saving. No secrets or database are required.

## CSV format

```text
Date,Protein,Carbs,Fat,Calories
2026-08-24,140,180,55,1850
2026-08-25,160,,,
2026-08-26,,,,2100
```

- `Date` is `YYYY-MM-DD`.
- `Protein`, `Carbs`, and `Fat` are grams. Any of them may be blank.
- `Calories` is optional. Older files without a Calories column still load, and so do headers `date,protein_g,carbs_g,fat_g,kcal`.
- Leave a cell empty when you did not track it. Empty is not zero. Write `0` only when the value was actually 0.
- When protein, carbs, and fat are all filled and calories is left blank, Save stores `4×protein + 4×carbs + 9×fat`. Type a calorie number to keep a different total.
- Do not add a row for a day you did not log. The app will not invent one.
- Each date appears once. A file with a bad cell or a repeated date is rejected and nothing from it is imported.

A day is stored only when you press Save day. The Export tab downloads the full log, which round-trips back through Upload, plus the selected week's summary as CSV or PDF.

## Charts and weeks

Protein is amber, a solid line, and circles. Carbs are steel blue, a dashed line, and squares. Fat is chalk in the dark theme and graphite in the light theme, a dotted line, and triangles. Calories are on a separate chart.

Target ranges start at 125–250 g for each macro and can be changed on the Week tab. Days in range and the guide lines follow whatever you set. Fat is often below 125 g, so the starting fat band can read 0 days until you lower it.

Weeks run Monday–Sunday. Week-over-week shows the change from the previous logged week with an arrow and a sign, not with red or green.

PDF export uses `reportlab` when it is installed and draws the same line styles. Without it, the CSV downloads still work.

## Do not commit a personal log

Keep your real `macro_log.csv` outside this repository. The sample file is the only log that belongs in git.
