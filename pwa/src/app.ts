import { DEMO_SEED } from "./demo-log";
import {
  MacroLogError,
  MAX_GRAMS,
  addDays,
  caloriesFromMacros,
  entryOn,
  fingerprint,
  formatNumber,
  loadMacroCsv,
  denseMacroDay,
  macroChartAnchor,
  mondayOf,
  normalizeRanges,
  parseDraftNumber,
  saveDay,
  summaryToCsv,
  toCsv,
  todayIso,
  trailingWindow,
  weeklySummary,
  type MacroName,
} from "./logic";
import { legacyMeal, mealsOn, newMealId, removeMeal, upsertMeal, visibleMeals, type MealRecord } from "./meals";
import { blankDraft, blankMealDraft, createState, mealDraftDirty, type Preset, type Screen } from "./state";
import {
  loadBucket,
  loadMeta,
  requestPersistentStorage,
  saveBucket,
  saveMeta,
  seedDemo,
  type Bucket,
} from "./storage";
import { PRO_SIGNUP_ENDPOINT } from "./config";
import { captureSrc, signupFormBody } from "./visit-src";
import { chartBounds, dayInputFor, isDirty, logChrome, renderApp } from "./view";

const state = createState();
let root: HTMLElement;
let saveTimer = 0;
let focusCalories = false;
let focusMeal: "name" | "protein" | "carbs" | "fat" | null = null;
let scrubFrame = 0;

export async function start(): Promise<void> {
  const found = document.getElementById("app");
  if (!found) return;
  root = found;
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("pointerdown", onScrub);
  root.addEventListener("pointermove", onScrub);
  root.addEventListener("toggle", onToggle, true);
  captureVisitSrc();
  try {
    await boot();
  } catch (error) {
    console.error(error);
    root.innerHTML = `<div class="boot"><p>This browser couldn’t open on-device storage.</p></div>`;
  }
}

function captureVisitSrc(): void {
  try {
    captureSrc(location.search, localStorage);
  } catch {
    // localStorage can throw. The signup still posts email alone.
  }
}

async function boot(): Promise<void> {
  const meta = await loadMeta();
  const demoQuery = new URLSearchParams(location.search).get("demo") === "1";
  state.theme = meta.theme;
  state.started = meta.started;
  state.mode = demoQuery ? "demo" : meta.mode;
  applyTheme();
  applyBucket(await loadBucket(state.mode));
  const today = todayIso();
  const latest = state.entries.at(-1)?.date ?? today;
  if (state.mode === "demo") {
    state.screen = "log";
    focusDemo();
  } else if (!state.started) {
    state.anchor = null;
    state.screen = "first";
    state.logDate = today;
    state.weekMonday = mondayOf(today);
    state.trendDate = latest;
  } else {
    state.anchor = null;
    state.screen = "log";
    state.logDate = today;
    const window = trailingWindow(state.entries, 30);
    if (window) {
      state.customStart = window.start;
      state.customEnd = window.end;
    }
    state.weekMonday = state.entries.length ? mondayOf(latest) : mondayOf(today);
    state.trendDate = latest;
  }
  loadDateChrome();
  state.ready = true;
  requestPersistentStorage();
  if (demoQuery && meta.mode !== "demo") await saveMeta(currentMeta());
  render();
}

function render(): void {
  const scroll = root.querySelector("main")?.scrollTop ?? 0;
  root.innerHTML = renderApp(state);
  const main = root.querySelector("main");
  if (main) main.scrollTop = scroll;
  if (focusCalories) {
    focusCalories = false;
    const input = root.querySelector<HTMLInputElement>("[data-field=calories]");
    input?.focus();
    const end = input?.value.length ?? 0;
    input?.setSelectionRange(end, end);
  }
  if (focusMeal) {
    const input = root.querySelector<HTMLInputElement>(`[data-field=meal-${focusMeal}]`);
    focusMeal = null;
    input?.closest(".meal-form, .meal-slot")?.scrollIntoView({ block: "nearest" });
    input?.focus();
    const end = input?.value.length ?? 0;
    input?.setSelectionRange(end, end);
  }
}

function applyTheme(): void {
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", state.theme === "dark" ? "#0B0B0C" : "#F5F3EF");
}

function applyBucket(bucket: Bucket): void {
  state.entries = bucket.entries;
  state.ranges = bucket.ranges;
  state.lastDownloadAt = bucket.lastDownloadAt;
  state.snapshot = bucket.snapshot ?? {};
  state.meals = bucket.meals;
  state.mealDays = bucket.mealDays;
  state.calorieEdits = bucket.calorieEdits;
}

function currentBucket(): Bucket {
  return {
    entries: state.entries,
    ranges: state.ranges,
    lastDownloadAt: state.lastDownloadAt,
    snapshot: state.snapshot,
    seeded: state.mode === "demo",
    seedId: state.mode === "demo" ? DEMO_SEED : 0,
    meals: state.meals,
    mealDays: state.mealDays,
    calorieEdits: state.calorieEdits,
  };
}

function currentMeta() {
  return { started: state.started, mode: state.mode, theme: state.theme };
}

async function persistBucket(): Promise<void> {
  await saveBucket(state.mode, currentBucket());
}

function loadDateChrome(): void {
  state.draft = blankDraft();
  state.calorieEditing = false;
  state.calorieDirty = false;
  state.mealDraft = null;
  state.formError = "";
  state.saveFlash = false;
  const edit = state.calorieEdits[state.logDate];
  if (edit != null) {
    state.draft.calories = formatNumber(edit);
    state.draft.caloriesEdited = true;
  }
}

function onClick(event: Event): void {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "pick-file") root.querySelector<HTMLInputElement>("#csv-file")?.click();
  if (action === "start-fresh") void startFresh();
  if (action === "demo") void enterDemo();
  if (action === "exit-demo") void exitDemo();
  if (action === "restore-demo") void restoreDemo();
  if (action === "template") void downloadText("macro_log_template.csv", "Date,Protein,Carbs,Fat,Calories\n", false);
  if (action === "back") {
    state.screen = state.returnScreen === "error" ? "log" : state.returnScreen;
    state.importIssues = [];
    render();
  }
  if (action === "tab") requestLeave(null, target.dataset.tab as Screen);
  if (action === "shift-day") requestLeave(addDays(state.logDate, Number(target.dataset.dir)), null);
  if (action === "shift-week") shiftWeek(Number(target.dataset.dir));
  if (action === "save") void saveCurrent();
  if (action === "edit-calories") openCalories();
  if (action === "add-meal") openAddMeal();
  if (action === "edit-meal") openEditMeal(target.dataset.id ?? "");
  if (action === "remove-meal") void removeMealById(target.dataset.id ?? "");
  if (action === "commit-meal") void commitMeal();
  if (action === "cancel-meal") {
    state.mealDraft = null;
    render();
  }
  if (action === "preset") {
    state.preset = target.dataset.preset as Preset;
    snapTrend();
    render();
  }
  if (action === "download-log") void downloadLog(false);
  if (action === "download-summary") void downloadSummary();
  if (action === "download-clear") void downloadLog(true);
  if (action === "ask-clear") {
    state.sheet = "clear";
    render();
  }
  if (action === "clear-anyway") void clearData();
  if (action === "cancel-sheet" || action === "stay") {
    state.sheet = null;
    state.pendingDate = null;
    state.pendingScreen = null;
    render();
  }
  if (action === "discard") applyLeave();
  if (action === "dismiss-warning") {
    state.warnings = [];
    render();
  }
  if (action === "theme") void toggleTheme();
  if (action === "signup") void submitSignup();
}

function onInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  const field = target.dataset.field;
  if (field === "calories") {
    state.draft.calories = target.value;
    state.draft.caloriesEdited = target.value.trim() !== "";
    state.calorieDirty = true;
    state.formError = "";
    paintChrome();
  }
  if (field === "meal-name" || field === "meal-protein" || field === "meal-carbs" || field === "meal-fat") {
    if (!state.mealDraft) return;
    const key = field.slice("meal-".length) as "name" | "protein" | "carbs" | "fat";
    state.mealDraft[key] = target.value;
    state.mealDraft.error = "";
    const error = root.querySelector("[data-meal-error]");
    if (error) error.textContent = "";
    paintChrome();
  }
  if (target.dataset.bound === "signup") state.signupEmail = target.value;
}

function onChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  if (target.id === "csv-file") {
    const file = target.files?.[0];
    target.value = "";
    if (file) void importFile(file);
    return;
  }
  if (target.dataset.bound === "custom-start" || target.dataset.bound === "custom-end") {
    if (target.dataset.bound === "custom-start") state.customStart = target.value;
    else state.customEnd = target.value;
    state.preset = "custom";
    snapTrend();
    render();
    return;
  }
  if (target.dataset.range) void updateRange(target);
}

function onFocusOut(event: FocusEvent): void {
  const target = event.target as HTMLInputElement;
  const field = target.dataset.field;
  if (field === "calories") {
    try {
      applyCalorieDraft();
    } catch (error) {
      state.formError = messageOf(error);
    }
    state.calorieEditing = false;
    window.setTimeout(() => {
      if (!state.calorieEditing) paintChrome();
    }, 0);
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Enter") return;
  const field = (event.target as HTMLElement).dataset.field;
  if (!field) return;
  event.preventDefault();
  if (field === "meal-name") root.querySelector<HTMLInputElement>("[data-field=meal-protein]")?.focus();
  if (field === "meal-protein") root.querySelector<HTMLInputElement>("[data-field=meal-carbs]")?.focus();
  if (field === "meal-carbs") root.querySelector<HTMLInputElement>("[data-field=meal-fat]")?.focus();
  if (field === "meal-fat") void commitMeal();
  if (field === "calories") void saveCurrent();
}

function onScrub(event: PointerEvent): void {
  if (event.type === "pointermove" && event.buttons === 0) return;
  const date = (event.target as HTMLElement).dataset?.date;
  if (!date || date === state.trendDate) return;
  state.trendDate = date;
  window.cancelAnimationFrame(scrubFrame);
  scrubFrame = window.requestAnimationFrame(() => render());
}

function onToggle(event: Event): void {
  const details = event.target as HTMLDetailsElement;
  if (details.classList.contains("targets")) state.targetsOpen = details.open;
}

function paintChrome(): void {
  const chrome = logChrome(state);
  const status = root.querySelector("[data-status]");
  if (status) status.textContent = chrome.status;
  const hint = root.querySelector("[data-cal-hint]");
  if (hint) hint.textContent = chrome.hint;
  const value = root.querySelector("[data-cal-value]");
  if (value) value.textContent = chrome.calorie;
  const unit = root.querySelector<HTMLElement>(".cal-value .unit");
  if (unit) unit.hidden = chrome.calorie === "";
  const error = root.querySelector("[data-form-error]");
  if (error) error.textContent = state.formError;
  if (!state.calorieEditing) {
    root.querySelector("[data-action=edit-calories]")?.classList.remove("hidden");
    root.querySelector("[data-field=calories]")?.classList.add("hidden");
  }
}

function requestLeave(date: string | null, screen: Screen | null): void {
  if (date && (date > todayIso() || date === state.logDate)) return;
  if (screen && screen === state.screen) return;
  const leavingLog = state.screen === "log" && isDirty(state) && (date != null || (screen != null && screen !== "log"));
  if (leavingLog) {
    state.pendingDate = date;
    state.pendingScreen = screen;
    state.sheet = "discard";
    render();
    return;
  }
  if (date) goDate(date);
  if (screen) {
    state.screen = screen;
    state.formError = "";
    render();
  }
}

function applyLeave(): void {
  const date = state.pendingDate;
  const screen = state.pendingScreen;
  state.sheet = null;
  state.pendingDate = null;
  state.pendingScreen = null;
  if (date) goDate(date);
  else {
    loadDateChrome();
    if (screen) state.screen = screen;
    render();
  }
}

function goDate(date: string): void {
  state.logDate = date;
  loadDateChrome();
  render();
}

function shiftWeek(direction: number): void {
  const next = mondayOf(addDays(state.weekMonday, direction * 7));
  const latest = mondayOf(todayIso());
  const earliest = state.entries[0] ? mondayOf(state.entries[0].date) : latest;
  if (next > latest || next < earliest) return;
  state.weekMonday = next;
  state.formError = "";
  render();
}

function openCalories(): void {
  if (!state.draft.caloriesEdited) {
    try {
      const current = dayInputFor(state);
      const shown = current.calories ?? caloriesFromMacros(current.protein, current.carbs, current.fat);
      if (shown != null) state.draft.calories = formatNumber(shown);
    } catch {
      state.formError = "Enter a number, or leave the field blank.";
    }
  }
  state.calorieEditing = true;
  focusCalories = true;
  render();
}

function macroAuto(): number | null {
  const input = dayInputFor(state);
  return caloriesFromMacros(input.protein, input.carbs, input.fat);
}

function normalizeCalories(): void {
  const raw = state.draft.calories.trim();
  if (!raw) {
    state.draft.calories = "";
    state.draft.caloriesEdited = false;
    return;
  }
  try {
    const parsed = parseDraftNumber(raw);
    const auto = macroAuto();
    if (parsed != null && auto != null && Math.abs(parsed - auto) <= 0.05) {
      state.draft.calories = "";
      state.draft.caloriesEdited = false;
      return;
    }
    state.draft.caloriesEdited = parsed != null;
    if (parsed != null) state.draft.calories = formatNumber(parsed);
  } catch {
    state.draft.caloriesEdited = true;
  }
}

function applyCalorieDraft(): void {
  if (!state.calorieDirty && !state.calorieEditing) return;
  normalizeCalories();
  const date = state.logDate;
  if (state.draft.caloriesEdited) {
    const calories = parseDraftNumber(state.draft.calories);
    if (calories == null) throw new MacroLogError(["Enter a number, or leave the field blank."]);
    state.calorieEdits[date] = calories;
  } else if (state.calorieDirty) {
    state.calorieEdits[date] = null;
  }
  state.calorieDirty = false;
}

function rememberSavedCalories(date: string): void {
  const saved = entryOn(state.entries, date);
  if (!saved) {
    delete state.calorieEdits[date];
    return;
  }
  const auto = caloriesFromMacros(saved.protein, saved.carbs, saved.fat);
  if (saved.calories != null && (auto == null || Math.abs(saved.calories - auto) > 0.05)) {
    state.calorieEdits[date] = saved.calories;
  } else {
    delete state.calorieEdits[date];
  }
}

async function saveCurrent(): Promise<void> {
  if (state.mealDraft && mealDraftDirty(state.mealDraft)) {
    const savedMeal = await commitMeal();
    if (!savedMeal) return;
  } else {
    state.mealDraft = null;
  }
  try {
    applyCalorieDraft();
  } catch (error) {
    state.formError = messageOf(error);
    render();
    return;
  }
  try {
    const result = saveDay(state.entries, state.logDate, dayInputFor(state));
    if (result.status === "empty") {
      state.formError = "Nothing was saved. Add a meal with at least one number. An empty field is not zero.";
      render();
      return;
    }
    state.entries = result.entries;
    rememberSavedCalories(state.logDate);
    state.formError = "";
    await persistBucket();
    const flash = result.status === "saved";
    loadDateChrome();
    state.saveFlash = flash;
    if (flash) navigator.vibrate?.(10);
    render();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      state.saveFlash = false;
      const label = root.querySelector("[data-save-label]");
      if (label) label.textContent = state.logDate === todayIso() ? "Save today" : "Save this day";
    }, 1500);
  } catch (error) {
    state.formError = messageOf(error);
    render();
  }
}

function openAddMeal(): void {
  if (state.mealDraft && mealDraftDirty(state.mealDraft)) {
    state.mealDraft.error = "Add or cancel this meal first.";
    render();
    return;
  }
  state.mealDraft = blankMealDraft();
  state.formError = "";
  focusMeal = "name";
  render();
}

function openEditMeal(id: string): void {
  if (!id) return;
  if (state.mealDraft && state.mealDraft.id !== id && mealDraftDirty(state.mealDraft)) {
    state.mealDraft.error = "Add or cancel this meal first.";
    render();
    return;
  }
  const entry = entryOn(state.entries, state.logDate);
  const meal = visibleMeals(state.meals, state.logDate, entry, state.mealDays.includes(state.logDate)).find(
    (item) => item.id === id,
  );
  if (!meal) return;
  state.mealDraft = {
    id: meal.id,
    name: meal.name,
    protein: meal.protein == null ? "" : formatNumber(meal.protein),
    carbs: meal.carbs == null ? "" : formatNumber(meal.carbs),
    fat: meal.fat == null ? "" : formatNumber(meal.fat),
    error: "",
  };
  state.formError = "";
  focusMeal = "name";
  render();
}

async function commitMeal(): Promise<boolean> {
  const draft = state.mealDraft;
  if (!draft) return false;
  let protein: number | null;
  let carbs: number | null;
  let fat: number | null;
  try {
    protein = parseDraftNumber(draft.protein);
    carbs = parseDraftNumber(draft.carbs);
    fat = parseDraftNumber(draft.fat);
  } catch (error) {
    draft.error = messageOf(error);
    focusMeal = "protein";
    render();
    return false;
  }
  if (
    (protein != null && protein > MAX_GRAMS) ||
    (carbs != null && carbs > MAX_GRAMS) ||
    (fat != null && fat > MAX_GRAMS)
  ) {
    draft.error = `A meal above ${formatNumber(MAX_GRAMS)} g was not added.`;
    focusMeal = "protein";
    render();
    return false;
  }
  if (protein == null && carbs == null && fat == null) {
    draft.error = "Enter at least one number. An empty field is not zero.";
    focusMeal = "protein";
    render();
    return false;
  }
  const date = state.logDate;
  const entry = entryOn(state.entries, date);
  const authored = state.mealDays.includes(date);
  let day = mealsOn(state.meals, date);
  if (!authored && day.length === 0) {
    const legacy = entry ? legacyMeal(entry) : null;
    if (legacy && draft.id !== legacy.id) day = [{ ...legacy, id: newMealId() }];
    adoptStoredCalorie(entry);
  }
  const id = draft.id && !draft.id.startsWith("legacy:") ? draft.id : newMealId();
  const name = draft.name.replace(/\s+/g, " ").trim().slice(0, 60);
  replaceDayMeals(date, upsertMeal(day, { id, date, name, protein, carbs, fat }));
  state.mealDraft = null;
  state.formError = "";
  await persistBucket();
  render();
  return true;
}

async function removeMealById(id: string): Promise<void> {
  if (!id) return;
  if (state.mealDraft && mealDraftDirty(state.mealDraft) && state.mealDraft.id !== id) {
    state.mealDraft.error = "Add or cancel this meal first.";
    render();
    return;
  }
  const date = state.logDate;
  const authored = state.mealDays.includes(date);
  const day = mealsOn(state.meals, date);
  if (!authored && day.length === 0) {
    if (!id.startsWith("legacy:")) return;
    replaceDayMeals(date, []);
  } else {
    replaceDayMeals(date, removeMeal(day, id));
  }
  if (state.mealDraft?.id === id) state.mealDraft = null;
  await persistBucket();
  render();
}

function replaceDayMeals(date: string, day: MealRecord[]): void {
  state.meals = [...state.meals.filter((meal) => meal.date !== date), ...day];
  if (!state.mealDays.includes(date)) state.mealDays = [...state.mealDays, date];
}

function adoptStoredCalorie(entry: ReturnType<typeof entryOn>): void {
  if (!entry || Object.hasOwn(state.calorieEdits, entry.date)) return;
  const auto = caloriesFromMacros(entry.protein, entry.carbs, entry.fat);
  if (entry.calories == null) return;
  if (auto != null && Math.abs(entry.calories - auto) <= 0.05) return;
  state.calorieEdits[entry.date] = entry.calories;
  state.draft.calories = formatNumber(entry.calories);
  state.draft.caloriesEdited = true;
}

function clearMeals(): void {
  state.meals = [];
  state.mealDays = [];
  state.calorieEdits = {};
  state.mealDraft = null;
}

async function importFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    showImportError(file.name, ["This looks like an Excel file renamed to .csv. Use Save As and choose CSV UTF-8."]);
    return;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    showImportError(file.name, ["This file is not UTF-8 text. Use Save As and choose CSV UTF-8."]);
    return;
  }
  try {
    const loaded = loadMacroCsv(text);
    const user = state.mode === "user" ? currentBucket() : await loadBucket("user");
    state.mode = "user";
    state.anchor = null;
    state.started = true;
    state.entries = loaded.entries;
    clearMeals();
    state.ranges = user.ranges;
    state.lastDownloadAt = user.lastDownloadAt;
    state.snapshot = user.snapshot;
    state.warnings = loaded.warnings;
    state.screen = "log";
    state.logDate = todayIso();
    const latest = state.entries.at(-1)?.date;
    state.weekMonday = latest ? mondayOf(latest) : mondayOf(state.logDate);
    state.trendDate = latest ?? state.logDate;
    const window = trailingWindow(state.entries, 30);
    if (window) {
      state.customStart = window.start;
      state.customEnd = window.end;
    }
    setDemoQuery(false);
    loadDateChrome();
    await saveMeta(currentMeta());
    await persistBucket();
    requestPersistentStorage();
    render();
  } catch (error) {
    showImportError(file.name, error instanceof MacroLogError ? error.issues : ["This file could not be parsed as a CSV."]);
  }
}

function showImportError(name: string, issues: string[]): void {
  if (state.screen !== "error") state.returnScreen = state.screen;
  state.importName = name;
  state.importIssues = issues;
  state.screen = "error";
  render();
}

async function startFresh(): Promise<void> {
  const user = state.mode === "user" ? currentBucket() : await loadBucket("user");
  state.mode = "user";
  state.started = true;
  state.entries = [];
  clearMeals();
  state.ranges = user.ranges;
  state.lastDownloadAt = null;
  state.snapshot = {};
  state.warnings = [];
  state.anchor = null;
  state.screen = "log";
  state.logDate = todayIso();
  state.weekMonday = mondayOf(state.logDate);
  state.trendDate = state.logDate;
  setDemoQuery(false);
  loadDateChrome();
  await saveMeta(currentMeta());
  await persistBucket();
  requestPersistentStorage();
  render();
}

async function enterDemo(): Promise<void> {
  applyBucket(await loadBucket("demo"));
  state.mode = "demo";
  state.warnings = [];
  state.screen = "log";
  focusDemo();
  setDemoQuery(true);
  loadDateChrome();
  await saveMeta(currentMeta());
  render();
}

async function exitDemo(): Promise<void> {
  applyBucket(await loadBucket("user"));
  state.mode = "user";
  state.anchor = null;
  state.warnings = [];
  setDemoQuery(false);
  if (!state.started) state.screen = "first";
  else {
    state.screen = "log";
    state.logDate = todayIso();
    loadDateChrome();
  }
  await saveMeta(currentMeta());
  render();
}

async function restoreDemo(): Promise<void> {
  const seeded = seedDemo();
  applyBucket(seeded);
  state.mode = "demo";
  state.screen = "log";
  focusDemo();
  loadDateChrome();
  await saveBucket("demo", seeded);
  render();
}

async function clearData(): Promise<void> {
  state.sheet = null;
  if (state.mode === "demo") {
    state.entries = [];
    clearMeals();
    state.snapshot = {};
    state.lastDownloadAt = null;
    state.anchor = null;
    state.screen = "log";
    state.logDate = todayIso();
    loadDateChrome();
    await persistBucket();
    render();
    return;
  }
  state.entries = [];
  clearMeals();
  state.snapshot = {};
  state.lastDownloadAt = null;
  state.started = false;
  state.warnings = [];
  state.screen = "first";
  await persistBucket();
  await saveMeta(currentMeta());
  render();
}

async function downloadLog(thenClear: boolean): Promise<void> {
  const stamp = todayIso();
  const name = state.mode === "demo" ? `macro_log_sample_${stamp}.csv` : `macro_log_${stamp}.csv`;
  const wrote = await downloadText(name, toCsv(state.entries), state.mode === "user");
  if (wrote && thenClear) await clearData();
}

async function downloadSummary(): Promise<void> {
  const stamp = state.weekMonday.replaceAll("-", "");
  const csv = summaryToCsv(weeklySummary(state.entries, state.weekMonday, state.ranges));
  await downloadText(`macro_summary_${stamp}.csv`, csv, false);
}

async function downloadText(filename: string, text: string, recordBackup: boolean): Promise<boolean> {
  const file = new File([text], filename, { type: "text/csv" });
  const canShare = typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  if (canShare) {
    try {
      await navigator.share({ files: [file], title: filename });
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return false;
    }
  } else {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  if (recordBackup) {
    state.lastDownloadAt = new Date().toISOString();
    state.snapshot = Object.fromEntries(state.entries.map((entry) => [entry.date, fingerprint(entry)]));
    await persistBucket();
  }
  state.sheet = null;
  render();
  return true;
}

async function updateRange(input: HTMLInputElement): Promise<void> {
  const name = input.dataset.range as MacroName;
  const edge = Number(input.dataset.edge) as 0 | 1;
  try {
    const parsed = parseDraftNumber(input.value);
    if (parsed == null) throw new MacroLogError(["Enter a number for the range."]);
    const next = {
      Protein: [...state.ranges.Protein] as [number, number],
      Carbs: [...state.ranges.Carbs] as [number, number],
      Fat: [...state.ranges.Fat] as [number, number],
    };
    next[name][edge] = parsed;
    state.ranges = normalizeRanges(next);
    state.formError = "";
    state.targetsOpen = true;
    await persistBucket();
  } catch (error) {
    state.formError = messageOf(error);
    state.targetsOpen = true;
  }
  render();
}

async function toggleTheme(): Promise<void> {
  state.theme = state.theme === "dark" ? "light" : "dark";
  applyTheme();
  await saveMeta(currentMeta());
  render();
}

async function submitSignup(): Promise<void> {
  const endpoint = PRO_SIGNUP_ENDPOINT.trim();
  const email = state.signupEmail.trim();
  if (!endpoint) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    state.signupNote = "Enter an email address.";
    render();
    return;
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: signupFormBody(email, localStorage),
    });
    state.signupNote = response.ok ? "Request sent." : "The signup service didn’t accept that.";
  } catch {
    state.signupNote = "Couldn’t reach the signup service.";
  }
  render();
}

function focusDemo(): void {
  const anchor = macroChartAnchor(state.entries);
  state.anchor = anchor;
  state.preset = "30";
  const fallback = state.entries.at(-1)?.date ?? todayIso();
  const day = anchor ? denseMacroDay(state.entries, anchor) : fallback;
  state.logDate = day;
  state.weekMonday = mondayOf(day);
  state.trendDate = day;
  if (anchor && state.entries.length) {
    let start = addDays(anchor, -29);
    if (start < state.entries[0].date) start = state.entries[0].date;
    state.customStart = start;
    state.customEnd = anchor;
  }
}

function snapTrend(): void {
  const bounds = chartBounds(state);
  if (!bounds || bounds.end < bounds.start) return;
  const inside = state.entries.filter((entry) => entry.date >= bounds.start && entry.date <= bounds.end);
  if (state.trendDate && inside.some((entry) => entry.date === state.trendDate)) return;
  state.trendDate = inside.at(-1)?.date ?? bounds.end;
}

function setDemoQuery(on: boolean): void {
  const url = new URL(location.href);
  if (on) url.searchParams.set("demo", "1");
  else url.searchParams.delete("demo");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function messageOf(error: unknown): string {
  if (error instanceof MacroLogError) return error.issues[0] ?? "That didn’t work.";
  return "That didn’t work.";
}
