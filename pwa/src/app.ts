import { DEMO_SEED } from "./demo-log";
import {
  MacroLogError,
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
import { blankDraft, createState, type Preset, type Screen } from "./state";
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
import { chartBounds, isDirty, logChrome, renderApp } from "./view";

const state = createState();
let root: HTMLElement;
let saveTimer = 0;
let focusCalories = false;
let scrubFrame = 0;

export async function start(): Promise<void> {
  const found = document.getElementById("app");
  if (!found) return;
  root = found;
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("pointerdown", onScrub);
  root.addEventListener("pointermove", onScrub);
  root.addEventListener("toggle", onToggle, true);
  try {
    await boot();
  } catch (error) {
    console.error(error);
    root.innerHTML = `<div class="boot"><p>This browser couldn’t open on-device storage.</p></div>`;
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
  loadDraft(state.logDate);
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
}

function currentBucket(): Bucket {
  return {
    entries: state.entries,
    ranges: state.ranges,
    lastDownloadAt: state.lastDownloadAt,
    snapshot: state.snapshot,
    seeded: state.mode === "demo",
    seedId: state.mode === "demo" ? DEMO_SEED : 0,
  };
}

function currentMeta() {
  return { started: state.started, mode: state.mode, theme: state.theme };
}

async function persistBucket(): Promise<void> {
  await saveBucket(state.mode, currentBucket());
}

function loadDraft(date: string): void {
  const entry = entryOn(state.entries, date);
  state.draft = blankDraft();
  state.calorieEditing = false;
  state.formError = "";
  state.saveFlash = false;
  if (!entry) return;
  state.draft.protein = entry.protein == null ? "" : formatNumber(entry.protein);
  state.draft.carbs = entry.carbs == null ? "" : formatNumber(entry.carbs);
  state.draft.fat = entry.fat == null ? "" : formatNumber(entry.fat);
  const auto = caloriesFromMacros(entry.protein, entry.carbs, entry.fat);
  const edited = entry.calories != null && (auto == null || Math.abs(entry.calories - auto) > 0.05);
  if (edited && entry.calories != null) {
    state.draft.calories = formatNumber(entry.calories);
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
  if (field === "protein" || field === "carbs" || field === "fat" || field === "calories") {
    state.draft[field] = target.value;
    if (field === "calories") state.draft.caloriesEdited = target.value.trim() !== "";
    state.formError = "";
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

function onFocusIn(event: FocusEvent): void {
  const target = event.target as HTMLElement;
  const field = target.dataset.field;
  if (field === "protein" || field === "carbs" || field === "fat") {
    const hint = target.closest(".macro")?.querySelector(".macro-hint");
    if (hint) hint.textContent = "Numeric keypad open";
  }
}

function onFocusOut(event: FocusEvent): void {
  const target = event.target as HTMLInputElement;
  const field = target.dataset.field;
  if (field === "protein" || field === "carbs" || field === "fat") {
    const hint = target.closest(".macro")?.querySelector(".macro-hint");
    const rest = hint?.getAttribute("data-rest");
    if (hint && rest) hint.textContent = rest;
  }
  if (field === "calories") {
    normalizeCalories();
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
  if (field === "protein") root.querySelector<HTMLInputElement>("[data-field=carbs]")?.focus();
  if (field === "carbs") root.querySelector<HTMLInputElement>("[data-field=fat]")?.focus();
  if (field === "fat" || field === "calories") void saveCurrent();
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
  else if (screen) {
    state.screen = screen;
    state.formError = "";
    render();
  } else render();
}

function goDate(date: string): void {
  state.logDate = date;
  loadDraft(date);
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
      const auto = caloriesFromMacros(
        parseDraftNumber(state.draft.protein),
        parseDraftNumber(state.draft.carbs),
        parseDraftNumber(state.draft.fat),
      );
      if (auto != null) state.draft.calories = formatNumber(auto);
    } catch {
      state.formError = "Enter a number, or leave the field blank.";
    }
  }
  state.calorieEditing = true;
  focusCalories = true;
  render();
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
    const auto = caloriesFromMacros(
      parseDraftNumber(state.draft.protein),
      parseDraftNumber(state.draft.carbs),
      parseDraftNumber(state.draft.fat),
    );
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

async function saveCurrent(): Promise<void> {
  normalizeCalories();
  let protein: number | null;
  let carbs: number | null;
  let fat: number | null;
  let calories: number | null;
  try {
    protein = parseDraftNumber(state.draft.protein);
    carbs = parseDraftNumber(state.draft.carbs);
    fat = parseDraftNumber(state.draft.fat);
    calories = state.draft.caloriesEdited ? parseDraftNumber(state.draft.calories) : null;
  } catch (error) {
    state.formError = messageOf(error);
    render();
    return;
  }
  try {
    const result = saveDay(state.entries, state.logDate, { protein, carbs, fat, calories });
    if (result.status === "empty") {
      state.formError = "Nothing was saved. Enter at least one number. An empty field is not zero.";
      render();
      return;
    }
    state.entries = result.entries;
    state.formError = "";
    await persistBucket();
    loadDraft(state.logDate);
    state.saveFlash = result.status === "saved";
    if (result.status === "saved") navigator.vibrate?.(10);
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
    loadDraft(state.logDate);
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
  loadDraft(state.logDate);
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
  loadDraft(state.logDate);
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
    loadDraft(state.logDate);
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
  loadDraft(state.logDate);
  await saveBucket("demo", seeded);
  render();
}

async function clearData(): Promise<void> {
  state.sheet = null;
  if (state.mode === "demo") {
    state.entries = [];
    state.snapshot = {};
    state.lastDownloadAt = null;
    state.anchor = null;
    state.screen = "log";
    state.logDate = todayIso();
    loadDraft(state.logDate);
    await persistBucket();
    render();
    return;
  }
  state.entries = [];
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
      body: new URLSearchParams({ email }),
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
