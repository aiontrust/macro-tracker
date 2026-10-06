import { sparkSvg, trendSvg, buildTrendModel, type TrendModel } from "./chart";
import { PRO_SIGNUP_ENDPOINT } from "./config";
import {
  MACRO_NAMES,
  addDays,
  caloriesFromMacros,
  compareWeeks,
  entryOn,
  fingerprint,
  formatNumber,
  gramChartEnd,
  guideLevels,
  mondayOf,
  parseDraftNumber,
  rangesAreDefault,
  rowsInWeek,
  tightenMacroBounds,
  toCsv,
  todayIso,
  weeklySummary,
  type DayInput,
  type FieldName,
  type MacroName,
} from "./logic";
import { committedDay, effectiveDayInput, mealsOn, sameCommittedDay, visibleMeals, type MealRecord } from "./meals";
import { mealDraftDirty, type AppState, type MealDraft, type Preset } from "./state";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_TITLE = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function renderApp(state: AppState): string {
  if (!state.ready) {
    return `<div class="boot"><p class="brand"><span class="mark-word">ONE SET.</span></p></div>`;
  }
  const bare = state.screen === "first" || state.screen === "error";
  return `<div class="shell">
    ${topbar(state)}
    ${state.mode === "demo" && !bare ? `<p class="demo-banner">Sample history. Not your log. Your entries stay separate.</p>` : ""}
    <main class="${bare ? "" : "with-tabs"} ${state.screen === "log" ? "with-save" : ""}">${screen(state)}</main>
    ${state.screen === "log" ? savebar(state) : ""}
    ${bare ? "" : tabs(state)}
    ${sheet(state)}
    <input id="csv-file" type="file" accept=".csv,text/csv" hidden>
  </div>`;
}

export function dayInputFor(state: AppState): DayInput {
  return effectiveDayInput(
    mealsOn(state.meals, state.logDate),
    entryOn(state.entries, state.logDate),
    calorieEditFor(state),
    state.mealDays.includes(state.logDate),
  );
}

export function isDirty(state: AppState): boolean {
  if (mealDraftDirty(state.mealDraft)) return true;
  try {
    return !sameCommittedDay(dayInputFor(state), entryOn(state.entries, state.logDate));
  } catch {
    return true;
  }
}

function calorieEditFor(state: AppState): number | null | undefined {
  if (state.calorieDirty) {
    if (!state.draft.caloriesEdited) return null;
    return parseDraftNumber(state.draft.calories);
  }
  if (Object.hasOwn(state.calorieEdits, state.logDate)) return state.calorieEdits[state.logDate];
  return undefined;
}

function screen(state: AppState): string {
  if (state.screen === "first") return firstRun(false);
  if (state.screen === "error") return firstRun(true, state);
  if (state.screen === "log") return logScreen(state);
  if (state.screen === "trends") return trendsScreen(state);
  if (state.screen === "week") return weekScreen(state);
  return exportScreen(state);
}

function topbar(state: AppState): string {
  const name =
    state.screen === "log"
      ? "TODAY"
      : state.screen === "trends"
        ? "TRENDS"
        : state.screen === "week"
          ? "WEEK"
          : state.screen === "export"
            ? "EXPORT"
            : "";
  const sample = state.mode === "demo" && name ? `<span class="sample-tag">SAMPLE DATA</span>` : "";
  return `<header class="topbar">
    <p class="brand"><span class="mark-word">ONE SET.</span>${name ? `<span class="screen-name">${name}</span>` : ""}</p>
    ${sample}
  </header>`;
}

function firstRun(error: boolean, state?: AppState): string {
  const issues = state?.importIssues ?? [];
  const shown = issues.slice(0, 3);
  const extra = issues.length - shown.length;
  return `<section class="first">
    <h1 class="display">${error ? "THAT FILE DIDN'T LOAD." : "ADD MEALS. SAVE THE DAY."}</h1>
    <p class="lede">${
      error
        ? "Your CSV needs one row per day: date, protein_g, carbs_g, fat_g (kcal optional)."
        : "Protein, carbs, and fat for each meal or snack. One daily total. No account, no food database, no feed."
    }</p>
    ${
      error
        ? `<div class="card error-card" role="alert">
            <h2>${icon("alert")}<span>Couldn't import ${esc(state?.importName || "that file")}</span></h2>
            <ul>${shown.map((issue) => `<li><span aria-hidden="true">×</span><span>${esc(issue)}</span></li>`).join("")}</ul>
            ${extra > 0 ? `<p class="more">+${extra} more</p>` : ""}
            <p>Nothing was imported. Fix the file or choose another one.</p>
          </div>`
        : `<div class="card privacy-card">
            <div>${icon("phone")}</div>
            <div>
              <h2>Your log lives only on this device</h2>
              <p>There is no cloud copy. Download your CSV after logging and upload it next time to pick up where you left off.</p>
            </div>
          </div>`
    }
    <button class="btn btn-primary" type="button" data-action="pick-file">${icon("upload")} ${error ? "Choose another file" : "Upload my CSV"}</button>
    ${
      error
        ? `<button class="btn btn-secondary" type="button" data-action="template">${icon("plus")} Download blank template</button>
           ${state && state.returnScreen !== "first" ? `<button class="btn btn-ghost" type="button" data-action="back">Back</button>` : ""}`
        : `<button class="btn btn-secondary" type="button" data-action="start-fresh">${icon("plus")} Start fresh</button>
           <button class="btn btn-ghost" type="button" data-action="demo">View sample data</button>`
    }
    <p class="cols"><span class="kicker">EXPECTED CSV COLUMNS</span><code>date,protein_g,carbs_g,fat_g,kcal</code></p>
  </section>`;
}

function logScreen(state: AppState): string {
  const today = todayIso();
  const atToday = state.logDate >= today;
  const entry = entryOn(state.entries, state.logDate);
  const authored = state.mealDays.includes(state.logDate);
  const visible = visibleMeals(state.meals, state.logDate, entry, authored);
  const adding = state.mealDraft != null && state.mealDraft.id == null;
  return `<section>
    ${state.warnings.length ? `<div class="card warn-note"><p>${esc(state.warnings[0])}</p><button type="button" data-action="dismiss-warning">Dismiss</button></div>` : ""}
    <div class="stepper">
      <button class="step" type="button" data-action="shift-day" data-dir="-1" aria-label="Previous day">${icon("chevron-left")}</button>
      <div>
        <h1>${formatDayTitle(state.logDate)}</h1>
        <p class="substatus" data-status aria-live="polite">${esc(statusText(state))}</p>
      </div>
      <button class="step" type="button" data-action="shift-day" data-dir="1" aria-label="Next day" ${atToday ? "disabled" : ""}>${icon("chevron-right")}</button>
    </div>
    ${totalsCard(state)}
    <div class="meal-head">
      <h2 class="kicker">MEALS</h2>
    </div>
    ${mealList(state, visible, entry)}
    ${adding ? mealForm(state.mealDraft) : ""}
    ${state.mealDraft ? "" : `<button class="btn btn-secondary add-meal" type="button" data-action="add-meal">${icon("plus")} Add meal or snack</button>`}
    <p class="form-error" data-form-error role="status">${esc(state.formError)}</p>
  </section>`;
}

function totalsCard(state: AppState): string {
  let protein: number | null = null;
  let carbs: number | null = null;
  let fat: number | null = null;
  try {
    const committed = committedDay(dayInputFor(state));
    protein = committed.protein;
    carbs = committed.carbs;
    fat = committed.fat;
  } catch {
    protein = null;
    carbs = null;
    fat = null;
  }
  return `<article class="card totals-card">
    <p class="kicker">RUNNING TOTAL</p>
    <div class="total-grid" aria-live="polite">
      ${totalCell("Protein", protein)}
      ${totalCell("Carbs", carbs)}
      ${totalCell("Fat", fat)}
    </div>
    ${calorieRow(state)}
  </article>`;
}

function totalCell(name: MacroName, value: number | null): string {
  const tone = name.toLowerCase();
  return `<div>
    <span class="kicker ${tone}">${name.toUpperCase()}</span>
    <strong class="${tone}">${value == null ? "—" : formatNumber(value)}</strong>
    <span class="unit">g</span>
  </div>`;
}

function mealList(state: AppState, visible: MealRecord[], entry: ReturnType<typeof entryOn>): string {
  const adding = state.mealDraft != null && state.mealDraft.id == null;
  if (visible.length === 0 && !adding) {
    const caloriesOnly =
      entry != null && entry.protein == null && entry.carbs == null && entry.fat == null && entry.calories != null;
    const copy = caloriesOnly
      ? "Calories are logged for this day. Add a meal to break it down."
      : "No meals yet. Add one as you eat.";
    return `<p class="empty-copy meal-empty">${copy}</p>`;
  }
  if (visible.length === 0) return "";
  return `<ul class="meal-list">
    ${visible
      .map((meal) => {
        if (state.mealDraft?.id === meal.id) return `<li class="meal-slot">${mealForm(state.mealDraft)}</li>`;
        return mealRow(meal);
      })
      .join("")}
  </ul>`;
}

function mealRow(meal: MealRecord): string {
  const title = meal.name.trim() || "Meal";
  const legacy = meal.id.startsWith("legacy:");
  return `<li class="meal">
    <button class="meal-open" type="button" data-action="edit-meal" data-id="${esc(meal.id)}">
      <span class="meal-name">${esc(title)}</span>
      ${legacy ? `<span class="meal-note">Saved day total</span>` : ""}
      <span class="macro-line">
        <span class="p">P ${showNum(meal.protein)}</span>
        <span class="c">C ${showNum(meal.carbs)}</span>
        <span class="f">F ${showNum(meal.fat)}</span>
      </span>
    </button>
    <button class="meal-remove" type="button" data-action="remove-meal" data-id="${esc(meal.id)}" aria-label="Remove ${esc(title)}">${icon("trash")}</button>
  </li>`;
}

function mealForm(draft: MealDraft | null): string {
  if (!draft) return "";
  const editing = draft.id != null;
  return `<div class="card meal-form">
    <label class="meal-name-field">
      <span class="kicker">NAME · OPTIONAL</span>
      <input id="meal-name" data-field="meal-name" maxlength="60" autocomplete="off" enterkeyhint="next" placeholder="Breakfast, shake, snack" aria-label="Meal name" value="${esc(draft.name)}">
    </label>
    <div class="gram-grid">
      ${gramField("protein", "Protein", draft.protein, "next")}
      ${gramField("carbs", "Carbs", draft.carbs, "next")}
      ${gramField("fat", "Fat", draft.fat, "done")}
    </div>
    <p class="form-error" data-meal-error role="status">${esc(draft.error)}</p>
    <button class="btn btn-primary" type="button" data-action="commit-meal">${editing ? "Update meal" : "Add meal"}</button>
    <button class="btn btn-ghost" type="button" data-action="cancel-meal">Cancel</button>
  </div>`;
}

function gramField(key: "protein" | "carbs" | "fat", label: string, value: string, hint: string): string {
  return `<label>
    <span class="kicker ${key}">${label.toUpperCase()}</span>
    <span class="gram-well">
      <input id="meal-${key}" data-field="meal-${key}" inputmode="decimal" enterkeyhint="${hint}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${label} grams" value="${esc(value)}">
      <span class="unit">g</span>
    </span>
  </label>`;
}

function calorieRow(state: AppState): string {
  const text = calorieText(state);
  const editing = state.calorieEditing;
  return `<div class="calorie">
    ${marker("Calories")}
    <span class="macro-copy">
      <span class="macro-label">CALORIES</span>
      <span class="macro-hint" data-cal-hint>${esc(calorieHint(state))}</span>
    </span>
    <button class="cal-value ${editing ? "hidden" : ""}" type="button" data-action="edit-calories" aria-label="Edit calories">
      <span data-cal-value>${esc(text)}</span><span class="unit" ${text ? "" : "hidden"}>kcal</span>
    </button>
      <input id="field-calories" name="calories" class="cal-input ${editing ? "" : "hidden"}" data-field="calories" inputmode="decimal" enterkeyhint="done" autocomplete="off" aria-label="Calories" value="${esc(state.draft.calories)}">
  </div>`;
}

function savebar(state: AppState): string {
  const label = state.saveFlash ? "Saved" : state.logDate === todayIso() ? "Save today" : "Save this day";
  return `<div class="savebar">
    <p class="device-note">${icon("phone")}<span>${esc(deviceNote(state))}</span></p>
    <button class="btn btn-primary" type="button" data-action="save">${icon("check")}<span data-save-label>${label}</span></button>
  </div>`;
}

function trendsScreen(state: AppState): string {
  const bounds = chartBounds(state);
  const invalid = state.preset === "custom" && state.customEnd < state.customStart;
  const macroBounds = bounds && !invalid ? tightenMacroBounds(state.entries, bounds.start, bounds.end) : null;
  const calorieModel = bounds && !invalid ? buildTrendModel(state.entries, bounds.start, bounds.end, state.ranges) : null;
  const sameWindow =
    macroBounds != null && bounds != null && macroBounds.start === bounds.start && macroBounds.end === bounds.end;
  const model =
    sameWindow && calorieModel
      ? calorieModel
      : macroBounds
        ? buildTrendModel(state.entries, macroBounds.start, macroBounds.end, state.ranges)
        : null;
  const selected = selectedOnChart(model, state.trendDate);
  const picked = selected
    ? (entryOn(state.entries, selected) ?? {
        date: selected,
        protein: null,
        carbs: null,
        fat: null,
        calories: null,
      })
    : null;
  const calorieValues = calorieModel ? calorieModel.calories.filter((value): value is number => value != null) : [];
  const average = calorieValues.length ? calorieValues.reduce((sum, value) => sum + value, 0) / calorieValues.length : null;
  const guides = guideLevels(state.ranges);
  const calorieSelected =
    calorieModel && state.trendDate && calorieModel.dates.includes(state.trendDate) ? state.trendDate : selected;
  return `<section>
    <div class="segment" role="tablist" aria-label="Chart range">
      ${(["7", "14", "30", "90", "all", "custom"] as Preset[]).map((preset) => `<button type="button" role="tab" data-action="preset" data-preset="${preset}" aria-selected="${state.preset === preset}">${presetLabel(preset)}</button>`).join("")}
    </div>
    ${
      state.preset === "custom"
        ? `<div class="custom-range">
            <label>Start<input id="custom-start" name="custom-start" type="date" data-bound="custom-start" value="${esc(state.customStart)}"></label>
            <label>End<input id="custom-end" name="custom-end" type="date" data-bound="custom-end" value="${esc(state.customEnd)}"></label>
          </div>`
        : ""
    }
    <article class="card chart-card">
      <header class="chart-head">
        <span class="kicker">GRAMS / DAY</span>
        <span class="kicker quiet">GUIDES ${guides.map((level) => formatNumber(level)).join(" · ")} g</span>
      </header>
      ${
        invalid
          ? `<p class="empty-copy">The end date is before the start date.</p>`
          : model
            ? trendSvg(model, selected, state.theme)
            : `<p class="empty-copy">Log 2 days to see a trend line.</p>`
      }
      ${model && model.macroDays === 0 ? `<p class="empty-copy">Log protein, carbs, or fat to draw the gram lines.</p>` : ""}
      <div class="legend">
        ${MACRO_NAMES.map((name) => `<span>${marker(name, true)}<span>${name}</span></span>`).join("")}
      </div>
    </article>
    ${
      picked
        ? `<article class="card day-card">
            <div class="split"><h2>${formatDayTitle(picked.date)}</h2><p class="kcal-lg">${picked.calories == null ? "—" : `${formatKcal(picked.calories)} kcal`}</p></div>
            <p class="macro-line">
              <span class="p">P ${showNum(picked.protein)}</span>
              <span class="c">C ${showNum(picked.carbs)}</span>
              <span class="f">F ${showNum(picked.fat)}</span>
            </p>
          </article>`
        : ""
    }
    <article class="card calorie-card">
      <div>
        <p class="kicker">CALORIES · ${averageLabel(state.preset)}</p>
        <p class="kcal-hero">${average == null ? "—" : `${formatKcal(average)} kcal`}</p>
      </div>
      ${calorieModel ? sparkSvg(calorieModel.calories, calorieSelected, calorieModel.dates, state.theme) : ""}
    </article>
  </section>`;
}

function selectedOnChart(model: TrendModel | null, trendDate: string | null): string | null {
  if (!model) return null;
  if (trendDate && model.dates.includes(trendDate)) return trendDate;
  for (let index = model.dates.length - 1; index >= 0; index -= 1) {
    const logged = MACRO_NAMES.some((name) => model.series[name][index] != null) || model.calories[index] != null;
    if (logged) return model.dates[index];
  }
  return model.dates.at(-1) ?? null;
}

function weekScreen(state: AppState): string {
  const week = rowsInWeek(state.entries, state.weekMonday);
  const summary = weeklySummary(state.entries, state.weekMonday, state.ranges);
  const comparison = compareWeeks(state.entries, state.weekMonday, state.ranges);
  const earliest = state.entries[0]?.date;
  const canPrev = Boolean(earliest) && state.weekMonday > mondayOf(earliest);
  const canNext = state.weekMonday < mondayOf(todayIso());
  return `<section>
    <div class="stepper">
      <button class="step" type="button" data-action="shift-week" data-dir="-1" aria-label="Previous week" ${canPrev ? "" : "disabled"}>${icon("chevron-left")}</button>
      <div>
        <h1>${formatWeekTitle(state.weekMonday)}</h1>
        <p class="substatus">${week.length} of 7 days logged</p>
      </div>
      <button class="step" type="button" data-action="shift-week" data-dir="1" aria-label="Next week" ${canNext ? "" : "disabled"}>${icon("chevron-right")}</button>
    </div>
    ${
      week.length === 0
        ? `<article class="card empty-week"><p>No entries this week.</p><button class="btn btn-secondary" type="button" data-action="tab" data-tab="log">Log a day</button></article>`
        : ""
    }
    <article class="card table-card">
      <table class="stats">
        <thead><tr><th>G / DAY</th><th>AVG</th><th>MIN</th><th>MAX</th><th>IN RNG</th></tr></thead>
        <tbody>
          ${summary
            .map((row) => {
              const grams = row.macro !== "Calories";
              return `<tr>
                <th>${marker(row.macro, true)}<span>${row.macro === "Calories" ? "kcal" : row.macro}</span></th>
                <td>${stat(row.average, grams)}</td>
                <td>${stat(row.min, grams)}</td>
                <td>${stat(row.max, grams)}</td>
                <td>${row.daysInTarget == null ? "—" : `${row.daysInTarget}/${row.daysLogged}`}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </article>
    ${
      comparison.previousMonday
        ? `<article class="card">
            <header class="split head-tight">
              <h2 class="kicker">VS PREVIOUS WEEK (${formatWeekTitle(comparison.previousMonday)})</h2>
              <span class="kicker quiet">AVG Δ</span>
            </header>
            <ul class="deltas">
              ${comparison.rows
                .map((row) => {
                  const unit = row.macro === "Calories" ? "kcal" : "g";
                  return `<li>
                    <div>${marker(row.macro, true)}<div><strong>${row.macro === "Calories" ? "Calories" : row.macro}</strong><span>${pair(row.thisAverage, row.previousAverage, unit)}</span></div></div>
                    <div class="delta"><span>${formatDelta(row.delta, unit)}</span><small>${formatPercent(row.percent)}</small></div>
                  </li>`;
                })
                .join("")}
            </ul>
          </article>`
        : `<p class="footnote">Log another week to compare averages. Up and down are not scored as good or bad.</p>`
    }
    <p class="footnote">${esc(rangeFootnote(state))}</p>
    <details class="targets" ${state.targetsOpen ? "open" : ""}>
      <summary>Target ranges</summary>
      ${
        rangesAreDefault(state.ranges)
          ? `<p class="range-help">Days in range and the dotted guides use these gram bands. They start at 125–250 g. Fat is often under 125 g, so that band can read 0 days until you set one that fits, such as 50–90 g.</p>`
          : ""
      }
      ${MACRO_NAMES.map((name) => {
        const [low, high] = state.ranges[name];
        return `<div class="range-row">
          <span>${name}</span>
          <label>Low<input id="range-${name}-low" name="${name}-low" type="text" data-range="${name}" data-edge="0" inputmode="decimal" enterkeyhint="done" autocomplete="off" value="${formatNumber(low)}" aria-label="${name} low grams"></label>
          <label>High<input id="range-${name}-high" name="${name}-high" type="text" data-range="${name}" data-edge="1" inputmode="decimal" enterkeyhint="done" autocomplete="off" value="${formatNumber(high)}" aria-label="${name} high grams"></label>
        </div>`;
      }).join("")}
      <p class="form-error">${esc(state.formError && state.screen === "week" ? state.formError : "")}</p>
    </details>
  </section>`;
}

function exportScreen(state: AppState): string {
  const bytes = new TextEncoder().encode(toCsv(state.entries)).length;
  const fileName = state.mode === "demo" ? `macro_log_sample_${todayIso()}.csv` : `macro_log_${todayIso()}.csv`;
  const weekLabel = formatWeekTitle(state.weekMonday);
  const endpoint = PRO_SIGNUP_ENDPOINT.trim();
  return `<section class="export">
    <article class="card warning-card">
      <h2>${icon("alert")}<span>${state.mode === "demo" ? "THIS IS SAMPLE DATA" : "THIS PHONE HAS YOUR ONLY COPY"}</span></h2>
      <p>${
        state.mode === "demo"
          ? "The numbers on this phone right now are a public sample. Your own log, if you started one, is stored separately and is not in this file."
          : "No account, no cloud. Download your log CSV and keep it somewhere safe (Files, Drive, email to yourself). Upload it next time to continue. iPhone can erase a site’s data if the app isn’t on your home screen, so the file is the backup."
      }</p>
      <p class="download-meta">${esc(downloadLine(state))}</p>
    </article>
    <button class="btn btn-primary" type="button" data-action="download-log">${icon("download")} Download full log (CSV)</button>
    <p class="file-meta">${esc(fileName)} · ${state.entries.length} rows · ${formatBytes(bytes)}</p>
    <button class="btn btn-ghost" type="button" data-action="pick-file">Upload a different CSV</button>
    <p class="kicker section-gap">WEEKLY SUMMARY · ${weekLabel}</p>
    <div class="list-row is-disabled" aria-disabled="true">
      ${icon("file")}
      <span><strong>Summary PDF</strong><small>Not in this version</small></span>
    </div>
    <button class="list-row" type="button" data-action="download-summary">
      ${icon("file")}
      <span><strong>Summary CSV</strong><small>avg / min / max / in range</small></span>
      ${icon("chevron-right")}
    </button>
    <article class="card signup">
      <h2 class="kicker">PRO EARLY ACCESS</h2>
      <p>A branded version for your gym.</p>
      <label class="sr" for="signup-email">Email</label>
      <input id="signup-email" type="email" inputmode="email" autocomplete="email" placeholder="you@gym.com" data-bound="signup" value="${esc(state.signupEmail)}" ${endpoint ? "" : "disabled"}>
      <button class="btn btn-secondary" type="button" data-action="signup" ${endpoint ? "" : "disabled"}>Request early access</button>
      <p class="footnote">${endpoint ? esc(state.signupNote) : "Early access isn’t open yet. The form stays off until a signup link is added."}</p>
    </article>
    <div class="appearance">
      <span>Appearance</span>
      <button type="button" data-action="theme">${state.theme === "dark" ? "Dark" : "Light"}</button>
    </div>
    ${
      state.mode === "demo"
        ? `<button class="btn btn-ghost" type="button" data-action="exit-demo">Back to my log</button>
           ${state.entries.length === 0 ? `<button class="btn btn-secondary" type="button" data-action="restore-demo">Restore sample data</button>` : ""}`
        : `<button class="btn btn-ghost" type="button" data-action="demo">View sample data</button>`
    }
    <button class="btn btn-danger" type="button" data-action="ask-clear">${icon("trash")} Clear data from this device</button>
  </section>`;
}

function tabs(state: AppState): string {
  const items: [string, string, string][] = [
    ["log", "Log", "log"],
    ["trends", "Trends", "trends"],
    ["week", "Week", "week"],
    ["export", "Export", "export"],
  ];
  return `<nav class="tabbar" aria-label="Sections">
    ${items
      .map(([id, label, iconName]) => {
        const current = state.screen === id;
        const dot = id === "export" && showNudge(state) ? `<i class="dot" aria-label="Download reminder"></i>` : "";
        return `<button type="button" data-action="tab" data-tab="${id}" aria-current="${current ? "page" : "false"}">${icon(iconName)}${dot}<span>${label}</span></button>`;
      })
      .join("")}
  </nav>`;
}

function sheet(state: AppState): string {
  if (state.sheet === "clear") {
    const demo = state.mode === "demo";
    return `<div class="backdrop" role="presentation">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <h2 id="sheet-title">${demo ? "Clear the sample?" : "Download first?"}</h2>
        <p>${demo ? "This removes the sample log from this browser. Your own log is not affected." : "Clearing removes the log from this phone. A file you already downloaded is not affected."}</p>
        ${demo ? "" : `<button class="btn btn-primary" type="button" data-action="download-clear">Download & clear</button>`}
        <button class="btn btn-danger" type="button" data-action="clear-anyway">Clear anyway</button>
        <button class="btn btn-secondary" type="button" data-action="cancel-sheet">Cancel</button>
      </div>
    </div>`;
  }
  if (state.sheet === "discard") {
    return `<div class="backdrop" role="presentation">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <h2 id="sheet-title">Leave without saving the day?</h2>
        <p>Meals already added stay on this phone. Trends, Week, and Export use the saved daily total.</p>
        <button class="btn btn-primary" type="button" data-action="stay">Stay</button>
        <button class="btn btn-danger" type="button" data-action="discard">Leave</button>
      </div>
    </div>`;
  }
  return "";
}

function marker(name: FieldName, small = false): string {
  const size = small ? 12 : 14;
  if (name === "Protein") {
    return `<svg class="mark protein" viewBox="0 0 12 12" width="${size}" height="${size}" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor"/></svg>`;
  }
  if (name === "Carbs") {
    return `<svg class="mark carbs" viewBox="0 0 12 12" width="${size}" height="${size}" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="1.5" fill="currentColor"/></svg>`;
  }
  if (name === "Fat") {
    return `<svg class="mark fat" viewBox="0 0 12 12" width="${size}" height="${size}" aria-hidden="true"><polygon points="6,1 11.2,11 0.8,11" fill="currentColor"/></svg>`;
  }
  return `<svg class="mark kcal" viewBox="0 0 12 12" width="${size}" height="${size}" aria-hidden="true"><line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function icon(name: string): string {
  const common = `viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const paths: Record<string, string> = {
    log: `<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/>`,
    trends: `<path d="M4 16l5-5 3.5 3.5L20 7"/><path d="M4 20h16"/>`,
    week: `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/>`,
    export: `<path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M5 19h14"/>`,
    download: `<path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M5 19h14"/>`,
    upload: `<path d="M12 16V6"/><path d="m8 9 4-4 4 4"/><path d="M5 19h14"/>`,
    plus: `<path d="M12 5v14M5 12h14"/>`,
    check: `<path d="m5 12.5 4.5 4.5L19 7"/>`,
    "chevron-left": `<path d="m14 6-6 6 6 6"/>`,
    "chevron-right": `<path d="m10 6 6 6-6 6"/>`,
    phone: `<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>`,
    alert: `<path d="M12 4 3.5 19h17L12 4z"/><path d="M12 10v4"/><path d="M12 16.5h.01"/>`,
    trash: `<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="m7.5 7 .7 12h7.6l.7-12"/>`,
    file: `<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/>`,
  };
  return `<svg ${common}>${paths[name] ?? ""}</svg>`;
}

function statusText(state: AppState): string {
  if (mealDraftDirty(state.mealDraft)) return "Finish this meal";
  if (isDirty(state)) return "Not in the daily log yet";
  const entry = entryOn(state.entries, state.logDate);
  if (!entry) return "No meals yet";
  if (!entry.updatedAt) return "Logged";
  const when = new Date(entry.updatedAt);
  if (Number.isNaN(when.getTime())) return "Logged";
  const time = when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const savedDay = todayIso(when);
  if (savedDay === todayIso()) return `Saved ${time}`;
  return `Saved ${MONTHS_TITLE[when.getMonth()]} ${when.getDate()}`;
}

function deviceNote(state: AppState): string {
  if (state.mode === "demo") return "Sample data on this device · not your log";
  if (showNudge(state)) return "Saved on this device only · Download to keep it";
  if (!state.lastDownloadAt) return "Saved on this device only · no CSV downloaded yet";
  const when = new Date(state.lastDownloadAt);
  return `Saved on this device only · last CSV download ${MONTHS_TITLE[when.getMonth()]} ${when.getDate()}`;
}

function downloadLine(state: AppState): string {
  if (state.mode === "demo") return "Sample file · dates were shifted";
  if (!state.lastDownloadAt) return state.entries.length ? "No download yet" : "Nothing saved yet";
  const when = new Date(state.lastDownloadAt);
  const fresh = newSince(state);
  const noun = fresh === 1 ? "day" : "days";
  const tail = fresh === 0 ? "up to date" : `${fresh} new ${noun} since`;
  return `Last download: ${MONTHS_TITLE[when.getMonth()]} ${when.getDate()} · ${tail}`;
}

export function newSince(state: AppState): number {
  return state.entries.filter((entry) => state.snapshot[entry.date] !== fingerprint(entry)).length;
}

export function showNudge(state: AppState): boolean {
  if (state.mode !== "user") return false;
  if (newSince(state) >= 3) return true;
  if (!state.lastDownloadAt) return false;
  return Date.now() - Date.parse(state.lastDownloadAt) > 7 * 24 * 60 * 60 * 1000;
}

function previewCalories(state: AppState): number | null {
  try {
    return committedDay(dayInputFor(state)).calories;
  } catch {
    return null;
  }
}

function calorieText(state: AppState): string {
  const value = previewCalories(state);
  if (value == null) return "";
  return formatKcal(value);
}

function calorieHint(state: AppState): string {
  try {
    const input = dayInputFor(state);
    const auto = caloriesFromMacros(input.protein, input.carbs, input.fat);
    const shown = committedDay(input).calories;
    if (shown != null && (auto == null || Math.abs(shown - auto) > 0.05)) return "Edited · tap to change";
  } catch {
    return "Enter a number, or leave the field blank.";
  }
  return "Auto from macros · tap to edit";
}

export function chartBounds(state: AppState): { start: string; end: string } | null {
  if (!state.entries.length) return null;
  if (state.preset === "all") {
    return { start: state.entries[0].date, end: state.entries[state.entries.length - 1].date };
  }
  if (state.preset === "custom") return { start: state.customStart, end: state.customEnd };
  const latest = state.entries[state.entries.length - 1].date;
  const end = state.mode === "demo" && state.anchor ? state.anchor : gramChartEnd(state.entries, latest, Number(state.preset));
  let start = addDays(end, -(Number(state.preset) - 1));
  if (start < state.entries[0].date) start = state.entries[0].date;
  return { start, end };
}

function presetLabel(preset: Preset): string {
  if (preset === "all") return "ALL";
  if (preset === "custom") return "CUSTOM";
  return `${preset}D`;
}

function averageLabel(preset: Preset): string {
  if (preset === "all") return "ALL-TIME AVG";
  if (preset === "custom") return "RANGE AVG";
  return `${preset}-DAY AVG`;
}

function formatDayTitle(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${DAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function formatWeekTitle(mondayIso: string): string {
  const end = addDays(mondayOf(mondayIso), 6);
  const [sy, sm, sd] = mondayOf(mondayIso).split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sd} – ${ed}`;
  return `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}`;
}

function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function showNum(value: number | null): string {
  return value == null ? "—" : formatNumber(value);
}

function stat(value: number | null, grams: boolean): string {
  if (value == null) return "—";
  if (!grams) return Math.round(value).toLocaleString("en-US");
  return value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function pair(current: number | null, previous: number | null, unit: "g" | "kcal"): string {
  const show = (value: number | null) => {
    if (value == null) return "—";
    if (unit === "kcal") return Math.round(value).toLocaleString("en-US");
    return `${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} g`;
  };
  return `${show(current)} vs ${show(previous)}`;
}

function formatDelta(value: number | null, unit: "g" | "kcal"): string {
  if (value == null) return "—";
  const shown = unit === "kcal" ? Math.round(value) : Math.round(value * 10) / 10;
  if (shown === 0) return unit === "kcal" ? "· 0" : "· +0.0 g";
  const arrow = shown > 0 ? "▲" : "▼";
  if (unit === "kcal") {
    const text = `${shown > 0 ? "+" : ""}${shown.toLocaleString("en-US")}`;
    return `${arrow} ${text}`;
  }
  const text = `${shown > 0 ? "+" : "-"}${Math.abs(shown).toFixed(1)} g`;
  return `${arrow} ${text}`;
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const shown = Math.round(value * 10) / 10;
  return `${shown > 0 ? "+" : ""}${shown.toFixed(1)}%`;
}

function rangeFootnote(state: AppState): string {
  const same = rangesAreDefault(state.ranges);
  const band = same
    ? "In range = 125–250 g guide."
    : `In range = ${MACRO_NAMES.map((name) => `${name} ${formatNumber(state.ranges[name][0])}–${formatNumber(state.ranges[name][1])} g`).join(", ")}.`;
  return `${band} Deltas are neutral (no red/green): up is not automatically good.`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function logChrome(state: AppState): { status: string; calorie: string; hint: string } {
  return { status: statusText(state), calorie: calorieText(state), hint: calorieHint(state) };
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
