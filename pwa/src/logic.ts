/**
 * Daily macro log rules, ported from macro_logic.py.
 *
 * Blank cells stay missing. They are never coerced to zero. Days that are
 * not in the file are not invented. Calories are filled from 4P+4C+9F only
 * when a day is saved with all three macros and a blank calorie field.
 * Loading a file does not recompute calories that were left blank, and a
 * typed calorie value is kept as an override.
 */

export type MacroName = "Protein" | "Carbs" | "Fat";
export type FieldName = MacroName | "Calories";

export interface DayRecord {
  date: string;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  calories: number | null;
  /** Local clock time of the last save. Never written to the CSV. */
  updatedAt?: string;
}

export type Ranges = Record<MacroName, [number, number]>;

export interface DayInput {
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  calories: number | null;
}

export type SaveStatus = "saved" | "cleared" | "empty";

export interface LoadResult {
  entries: DayRecord[];
  warnings: string[];
}

export class MacroLogError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "This file could not be imported.");
    this.name = "MacroLogError";
    this.issues = issues;
  }
}

export const MACRO_NAMES: MacroName[] = ["Protein", "Carbs", "Fat"];
export const FIELD_NAMES: FieldName[] = ["Protein", "Carbs", "Fat", "Calories"];
export const TARGET_LOW = 125;
export const TARGET_HIGH = 250;
export const MAX_GRAMS = 1000;
export const MAX_CALORIES = 20000;

const BLANK_TOKENS = new Set(["", "na", "n/a", "null", "none", "nan", "-", "."]);

const HEADER_MAP: Record<string, FieldName | "Date"> = {
  date: "Date",
  protein: "Protein",
  "protein g": "Protein",
  carbs: "Carbs",
  carbohydrates: "Carbs",
  "carbs g": "Carbs",
  fat: "Fat",
  "fat g": "Fat",
  calories: "Calories",
  calorie: "Calories",
  kcal: "Calories",
};

const DISPLAY_COLUMN: Record<FieldName | "Date", string> = {
  Date: "date",
  Protein: "protein_g",
  Carbs: "carbs_g",
  Fat: "fat_g",
  Calories: "kcal",
};

export const MACRO_STYLE: Record<
  MacroName,
  { dark: string; light: string; dash: string; marker: "circle" | "square" | "triangle"; label: string; width: number }
> = {
  Protein: { dark: "#E8A33A", light: "#9A5A00", dash: "", marker: "circle", label: "P", width: 2.6 },
  Carbs: { dark: "#6FA8FF", light: "#0069A8", dash: "8 4", marker: "square", label: "C", width: 2.4 },
  Fat: { dark: "#D9D4CA", light: "#3A3A3A", dash: "1.5 4", marker: "triangle", label: "F", width: 2.4 },
};

export function defaultRanges(): Ranges {
  return {
    Protein: [TARGET_LOW, TARGET_HIGH],
    Carbs: [TARGET_LOW, TARGET_HIGH],
    Fat: [TARGET_LOW, TARGET_HIGH],
  };
}

export function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function formatNumber(value: number): string {
  const rounded = round2(value);
  if (Object.is(rounded, -0) || rounded === 0) return "0";
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function fieldValue(entry: DayRecord, name: FieldName): number | null {
  if (name === "Protein") return entry.protein;
  if (name === "Carbs") return entry.carbs;
  if (name === "Fat") return entry.fat;
  return entry.calories;
}

export function caloriesFromMacros(
  protein: number | null,
  carbs: number | null,
  fat: number | null,
): number | null {
  if (protein == null || carbs == null || fat == null) return null;
  if (!Number.isFinite(protein) || !Number.isFinite(carbs) || !Number.isFinite(fat)) return null;
  return round2(4 * protein + 4 * carbs + 9 * fat);
}

export function normalizeRanges(ranges: Partial<Ranges> | null | undefined): Ranges {
  const active = defaultRanges();
  if (!ranges) return active;
  for (const column of MACRO_NAMES) {
    const pair = ranges[column];
    if (!pair) continue;
    const low = round2(Number(pair[0]));
    const high = round2(Number(pair[1]));
    if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < 0 || low > high) {
      throw new MacroLogError([
        `${column} needs a range from a lower gram value to an equal or higher one.`,
      ]);
    }
    active[column] = [low, high];
  }
  return active;
}

export function guideLevels(ranges?: Partial<Ranges> | null): number[] {
  const active = normalizeRanges(ranges);
  const found = new Set<number>();
  for (const [low, high] of Object.values(active)) {
    found.add(low);
    found.add(high);
  }
  return [...found].sort((a, b) => a - b);
}

export function loadMacroCsv(text: string): LoadResult {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!source.trim()) {
    throw new MacroLogError([
      "This file is empty. It needs a header row: Date,Protein,Carbs,Fat,Calories.",
    ]);
  }
  if (source.startsWith("PK")) {
    throw new MacroLogError([
      "This looks like an Excel file renamed to .csv. In the spreadsheet, use Save As and choose CSV UTF-8.",
    ]);
  }

  const table = parseCsv(source);
  if (table.length === 0) {
    throw new MacroLogError(["This file has no header row. Expected: Date,Protein,Carbs,Fat,Calories."]);
  }
  const header = table[0];
  if (header.length === 1) {
    const cell = header[0] ?? "";
    if (cell.includes(";")) {
      throw new MacroLogError([
        "This file looks semicolon-separated. Export it as a comma-separated CSV (Date,Protein,Carbs,Fat,Calories).",
      ]);
    }
    if (cell.includes("\t")) {
      throw new MacroLogError([
        "This file looks tab-separated. Export it as a comma-separated CSV (Date,Protein,Carbs,Fat,Calories).",
      ]);
    }
  }

  const warnings: string[] = [];
  const columns = new Map<FieldName | "Date", number>();
  const extras: string[] = [];
  header.forEach((label, index) => {
    const name = canonicalHeader(label);
    const series = table.slice(1).map((row) => row[index] ?? "");
    if (!name) {
      const trimmed = label.trim();
      const unnamed = trimmed === "" || trimmed.toLowerCase().startsWith("unnamed");
      const hasValue = series.some((value) => value.trim() !== "");
      if (!unnamed || hasValue) extras.push(trimmed || "(blank header)");
      return;
    }
    if (columns.has(name)) {
      throw new MacroLogError([`Column ${name} appears more than once.`]);
    }
    columns.set(name, index);
  });

  const missing = (["Date", "Protein", "Carbs", "Fat"] as const).filter((name) => !columns.has(name));
  if (missing.length) {
    const named = missing.map((name) => `Missing column: ${DISPLAY_COLUMN[name]}`).join(" · ");
    throw new MacroLogError([
      `${named}. Expected a header row: Date,Protein,Carbs,Fat,Calories. Calories may be omitted.`,
    ]);
  }
  if (!columns.has("Calories")) {
    warnings.push(
      "No Calories column was found, so calories were left blank. Older logs without calories still load.",
    );
  }
  if (extras.length) warnings.push(`Ignored extra columns: ${extras.join(", ")}.`);

  const body = table.slice(1).filter((row) => row.some((cell) => cell.trim() !== ""));
  const issues: string[] = [];
  const dates: (string | null)[] = [];
  const numbers: Record<FieldName, (number | null)[]> = {
    Protein: [],
    Carbs: [],
    Fat: [],
    Calories: [],
  };

  body.forEach((row, index) => {
    const rowNumber = index + 2;
    const rawDate = cellAt(row, columns.get("Date"));
    if (rawDate.trim() === "") {
      issues.push(`Row ${rowNumber} · date is blank. Use YYYY-MM-DD.`);
      dates.push(null);
    } else {
      const parsed = parseIsoDate(rawDate.trim());
      if (!parsed) {
        issues.push(`Row ${rowNumber} · date "${rawDate.trim()}" is not a real date`);
        dates.push(null);
      } else {
        dates.push(parsed);
      }
    }
    for (const name of FIELD_NAMES) {
      const columnIndex = columns.get(name);
      const raw = columnIndex == null ? "" : cellAt(row, columnIndex);
      const parsed = parseNumberCell(raw, name);
      if (parsed.issue) {
        issues.push(`Row ${rowNumber} · ${DISPLAY_COLUMN[name]} = "${raw.trim()}" ${parsed.issue}`);
        numbers[name].push(null);
      } else {
        numbers[name].push(parsed.value);
      }
    }
  });

  if (!issues.some((issue) => issue.includes("date"))) {
    const seen = new Map<string, number[]>();
    dates.forEach((iso, index) => {
      if (!iso) return;
      const list = seen.get(iso) ?? [];
      list.push(index + 2);
      seen.set(iso, list);
    });
    for (const [iso, rows] of [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (rows.length > 1) {
        issues.push(`Rows ${rows.join(", ")} · date "${iso}" is repeated`);
      }
    }
  }

  if (issues.length) throw new MacroLogError(issues);

  const entries: DayRecord[] = dates.map((iso, index) => ({
    date: iso as string,
    protein: numbers.Protein[index],
    carbs: numbers.Carbs[index],
    fat: numbers.Fat[index],
    calories: numbers.Calories[index],
  }));
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return { entries, warnings };
}

export function toCsv(entries: DayRecord[]): string {
  const lines = ["Date,Protein,Carbs,Fat,Calories"];
  for (const entry of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(
      [
        entry.date,
        entry.protein == null ? "" : formatNumber(entry.protein),
        entry.carbs == null ? "" : formatNumber(entry.carbs),
        entry.fat == null ? "" : formatNumber(entry.fat),
        entry.calories == null ? "" : formatNumber(entry.calories),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function saveDay(
  entries: DayRecord[],
  date: string,
  values: DayInput,
  now: Date = new Date(),
): { entries: DayRecord[]; status: SaveStatus } {
  if (!parseIsoDate(date)) {
    throw new MacroLogError([`Date "${date}" is not a real date.`]);
  }
  const cleaned: Partial<Record<FieldName, number>> = {};
  for (const name of FIELD_NAMES) {
    const key = name.toLowerCase() as keyof DayInput;
    const number = optionalNumber(values[key], name);
    if (number == null) continue;
    const limit = name === "Calories" ? MAX_CALORIES : MAX_GRAMS;
    const unit = name === "Calories" ? "kcal" : "g";
    if (number > limit) {
      throw new MacroLogError([`${name} above ${formatNumber(limit)} ${unit} was not saved.`]);
    }
    cleaned[name] = number;
  }
  if (cleaned.Calories == null) {
    const calculated = caloriesFromMacros(
      cleaned.Protein ?? null,
      cleaned.Carbs ?? null,
      cleaned.Fat ?? null,
    );
    if (calculated != null) cleaned.Calories = calculated;
  }

  const next = entries.map((entry) => ({ ...entry }));
  const index = next.findIndex((entry) => entry.date === date);
  if (Object.keys(cleaned).length === 0) {
    if (index >= 0) {
      next.splice(index, 1);
      return { entries: next, status: "cleared" };
    }
    return { entries: next, status: "empty" };
  }

  const row: DayRecord = {
    date,
    protein: cleaned.Protein ?? null,
    carbs: cleaned.Carbs ?? null,
    fat: cleaned.Fat ?? null,
    calories: cleaned.Calories ?? null,
    updatedAt: now.toISOString(),
  };
  if (index >= 0) next[index] = row;
  else next.push(row);
  next.sort((a, b) => a.date.localeCompare(b.date));
  return { entries: next, status: "saved" };
}

export function entryOn(entries: DayRecord[], date: string): DayRecord | null {
  return entries.find((entry) => entry.date === date) ?? null;
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mondayOf(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function availableWeeks(entries: DayRecord[]): string[] {
  const mondays = new Set(entries.map((entry) => mondayOf(entry.date)));
  return [...mondays].sort((a, b) => b.localeCompare(a));
}

export function rowsInWeek(entries: DayRecord[], weekMonday: string): DayRecord[] {
  const start = mondayOf(weekMonday);
  const end = addDays(start, 6);
  return entries.filter((entry) => entry.date >= start && entry.date <= end);
}

export interface SummaryRow {
  macro: FieldName;
  average: number | null;
  min: number | null;
  max: number | null;
  daysInTarget: number | null;
  daysLogged: number;
}

export function weeklySummary(entries: DayRecord[], weekMonday: string, ranges?: Partial<Ranges> | null): SummaryRow[] {
  const active = normalizeRanges(ranges);
  const week = rowsInWeek(entries, weekMonday);
  return FIELD_NAMES.map((macro) => {
    const logged = week
      .map((entry) => fieldValue(entry, macro))
      .filter((value): value is number => value != null);
    if (!logged.length) {
      return { macro, average: null, min: null, max: null, daysInTarget: null, daysLogged: 0 };
    }
    const average = logged.reduce((sum, value) => sum + value, 0) / logged.length;
    const daysInTarget =
      macro === "Calories"
        ? null
        : logged.filter((value) => value >= active[macro][0] && value <= active[macro][1]).length;
    return {
      macro,
      average,
      min: Math.min(...logged),
      max: Math.max(...logged),
      daysInTarget,
      daysLogged: logged.length,
    };
  });
}

export function previousLoggedWeek(entries: DayRecord[], weekMonday: string): string | null {
  const current = mondayOf(weekMonday);
  const older = availableWeeks(entries).filter((week) => week < current);
  return older[0] ?? null;
}

export interface CompareRow {
  macro: FieldName;
  thisAverage: number | null;
  previousAverage: number | null;
  delta: number | null;
  percent: number | null;
}

export function compareWeeks(
  entries: DayRecord[],
  weekMonday: string,
  ranges?: Partial<Ranges> | null,
): { previousMonday: string | null; rows: CompareRow[] } {
  const current = weeklySummary(entries, weekMonday, ranges);
  const previousMonday = previousLoggedWeek(entries, weekMonday);
  const previous = previousMonday ? weeklySummary(entries, previousMonday, ranges) : null;
  const rows = current.map((row, index) => {
    const before = previous ? previous[index].average : null;
    if (row.average == null || before == null) {
      return { macro: row.macro, thisAverage: row.average, previousAverage: before, delta: null, percent: null };
    }
    const delta = row.average - before;
    const percent = before === 0 ? null : (delta / before) * 100;
    return { macro: row.macro, thisAverage: row.average, previousAverage: before, delta, percent };
  });
  return { previousMonday, rows };
}

export function sliceDates(entries: DayRecord[], start: string, end: string): DayRecord[] {
  if (end < start) throw new MacroLogError(["The end date is before the start date."]);
  return entries.filter((entry) => entry.date >= start && entry.date <= end);
}

export function trailingWindow(entries: DayRecord[], days: number): { start: string; end: string } | null {
  if (!entries.length) return null;
  return windowEnding(entries, days, entries[entries.length - 1].date);
}

export function windowEnding(entries: DayRecord[], days: number, end: string): { start: string; end: string } | null {
  if (!entries.length) return null;
  if (days < 1) throw new MacroLogError(["The chart window must cover at least one day."]);
  let start = addDays(end, -(days - 1));
  const earliest = entries[0].date;
  if (start < earliest) start = earliest;
  return { start, end };
}

export function hasMacro(entry: DayRecord): boolean {
  return entry.protein != null || entry.carbs != null || entry.fat != null;
}

/** Latest day whose trailing window still has several gram entries.
 *  The sample's newest days are often calories only, which would open an empty chart.
 */
export function macroChartAnchor(entries: DayRecord[], days = 30, minimum = 8): string | null {
  const macroDates = entries.filter(hasMacro).map((entry) => entry.date);
  if (!macroDates.length) return entries.at(-1)?.date ?? null;
  let best: string | null = null;
  for (const entry of entries) {
    const start = addDays(entry.date, -(days - 1));
    let count = 0;
    for (const date of macroDates) {
      if (date >= start && date <= entry.date) count += 1;
    }
    if (count >= minimum) best = entry.date;
  }
  return best ?? macroDates[macroDates.length - 1];
}

export function latestMacroOnOrBefore(entries: DayRecord[], date: string): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.date > date) continue;
    if (hasMacro(entry)) return entry.date;
  }
  return date;
}

/** A day inside `end`'s trailing window whose week still has several gram entries.
 *  The newest gram day can sit alone in a calories-only week.
 */
export function denseMacroDay(entries: DayRecord[], end: string, days = 30, minimum = 4): string {
  const start = addDays(end, -(days - 1));
  const seen = new Set<string>();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.date > end) continue;
    if (entry.date < start) break;
    if (!hasMacro(entry)) continue;
    const monday = mondayOf(entry.date);
    if (seen.has(monday)) continue;
    seen.add(monday);
    const sunday = addDays(monday, 6);
    let count = 0;
    for (const candidate of entries) {
      if (candidate.date < monday) continue;
      if (candidate.date > sunday) break;
      if (hasMacro(candidate)) count += 1;
    }
    if (count >= minimum) return latestMacroOnOrBefore(entries, sunday > end ? end : sunday);
  }
  return latestMacroOnOrBefore(entries, end);
}

export function calendarDays(start: string, end: string): string[] {
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    days.push(cursor);
    if (days.length > 20000) break;
  }
  return days;
}

export function parseDraftNumber(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const cleaned = text.replace(/,/g, "");
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    throw new MacroLogError(["Enter a number, or leave the field blank."]);
  }
  const number = Number(cleaned);
  if (!Number.isFinite(number)) throw new MacroLogError(["Enter a number, or leave the field blank."]);
  return round2(number);
}

export function summaryToCsv(rows: SummaryRow[]): string {
  const lines = ["Macro,Average,Min,Max,In range"];
  for (const row of rows) {
    const inRange =
      row.daysInTarget == null || row.daysLogged === 0 ? "" : `${row.daysInTarget}/${row.daysLogged}`;
    lines.push(
      [
        row.macro,
        row.average == null ? "" : row.average.toFixed(1),
        row.min == null ? "" : row.min.toFixed(1),
        row.max == null ? "" : row.max.toFixed(1),
        inRange,
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function fingerprint(entry: DayRecord): string {
  return [entry.protein, entry.carbs, entry.fat, entry.calories].map((value) => (value == null ? "" : formatNumber(value))).join("|");
}

function canonicalHeader(header: string): FieldName | "Date" | null {
  const key = header
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\s*\(.*?\)\s*/g, "")
    .trim();
  return HEADER_MAP[key] ?? null;
}

function cellAt(row: string[], index: number | undefined): string {
  if (index == null) return "";
  return row[index] ?? "";
}

function parseIsoDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseNumberCell(
  raw: string,
  column: FieldName,
): { value: number | null; issue: string | null } {
  const text = raw.trim();
  if (BLANK_TOKENS.has(text.toLowerCase())) return { value: null, issue: null };
  const cleaned = text.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { value: null, issue: "(not a number)" };
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return { value: null, issue: "(not a number)" };
  if (number < 0) return { value: null, issue: "(negative)" };
  const limit = column === "Calories" ? MAX_CALORIES : MAX_GRAMS;
  const unit = column === "Calories" ? "kcal" : "g";
  if (number > limit) return { value: null, issue: `(above ${formatNumber(limit)} ${unit})` };
  return { value: round2(number), issue: null };
}

function optionalNumber(value: number | null, column: string): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) throw new MacroLogError([`${column} has to be a number or blank.`]);
  const number = round2(value);
  if (number < 0) throw new MacroLogError([`${column} cannot be negative.`]);
  return number;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
