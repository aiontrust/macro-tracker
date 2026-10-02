import {
  type DayRecord,
  type MacroName,
  type Ranges,
  MACRO_NAMES,
  MACRO_STYLE,
  calendarDays,
  entryOn,
  fieldValue,
  guideLevels,
} from "./logic";

export interface TrendModel {
  dates: string[];
  yMax: number;
  guides: number[];
  series: Record<MacroName, (number | null)[]>;
  calories: (number | null)[];
  macroDays: number;
}

export function buildTrendModel(
  entries: DayRecord[],
  start: string,
  end: string,
  ranges?: Partial<Ranges> | null,
): TrendModel {
  const dates = calendarDays(start, end);
  const series = {
    Protein: [] as (number | null)[],
    Carbs: [] as (number | null)[],
    Fat: [] as (number | null)[],
  };
  const calories: (number | null)[] = [];
  let macroDays = 0;
  for (const date of dates) {
    const entry = entryOn(entries, date);
    let any = false;
    for (const name of MACRO_NAMES) {
      const value = entry ? fieldValue(entry, name) : null;
      series[name].push(value);
      if (value != null) any = true;
    }
    calories.push(entry?.calories ?? null);
    if (any) macroDays += 1;
  }
  const guides = guideLevels(ranges);
  const peak = Math.max(
    0,
    ...guides,
    ...MACRO_NAMES.flatMap((name) => series[name].filter((value): value is number => value != null)),
  );
  const yMax = peak <= 300 ? 300 : Math.ceil(peak / 50) * 50;
  return { dates, yMax, guides, series, calories, macroDays };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const WIDTH = 326;
const HEIGHT = 212;
const PAD_L = 34;
const PAD_R = 18;
const PAD_T = 10;
const PAD_B = 26;

function xAt(index: number, count: number): number {
  const plot = WIDTH - PAD_L - PAD_R;
  if (count <= 1) return PAD_L + plot / 2;
  return PAD_L + (index / (count - 1)) * plot;
}

function yAt(value: number, yMax: number): number {
  const plot = HEIGHT - PAD_T - PAD_B;
  return PAD_T + (1 - value / yMax) * plot;
}

export function seriesPath(values: (number | null)[], yMax: number): string {
  let path = "";
  let drawing = false;
  values.forEach((value, index) => {
    if (value == null) {
      drawing = false;
      return;
    }
    const command = drawing ? "L" : "M";
    drawing = true;
    path += `${command}${xAt(index, values.length).toFixed(1)} ${yAt(value, yMax).toFixed(1)}`;
  });
  return path;
}

export function trendSvg(model: TrendModel, selected: string | null, theme: "dark" | "light"): string {
  const tickFill = theme === "light" ? "#5C5852" : "#A19D95";
  const ticks = yTicks(model.yMax);
  const grid = ticks
    .map((tick) => {
      const y = yAt(tick, model.yMax).toFixed(1);
      return `<line x1="${PAD_L}" y1="${y}" x2="${WIDTH - PAD_R}" y2="${y}" stroke="${theme === "light" ? "#E4E0D8" : "#2A2A2E"}" stroke-width="1"/>
        <text x="${PAD_L - 6}" y="${Number(y) + 3}" text-anchor="end" fill="${tickFill}" font-size="11" font-family="JetBrains Mono, ui-monospace, monospace">${tick}</text>`;
    })
    .join("");
  const guideColor = theme === "light" ? "#8A847C" : "#A19D95";
  const guides = model.guides
    .map((level) => {
      const y = yAt(level, model.yMax).toFixed(1);
      return `<line x1="${PAD_L}" y1="${y}" x2="${WIDTH - PAD_R}" y2="${y}" stroke="${guideColor}" stroke-width="1" stroke-dasharray="2 4"/>`;
    })
    .join("");
  const selectedIndex = selected ? model.dates.indexOf(selected) : -1;
  const step = model.dates.length > 1 ? (WIDTH - PAD_L - PAD_R) / (model.dates.length - 1) : 12;
  const band =
    selectedIndex >= 0
      ? `<rect x="${(xAt(selectedIndex, model.dates.length) - step / 2).toFixed(1)}" y="${PAD_T}" width="${Math.max(step, 2).toFixed(1)}" height="${HEIGHT - PAD_T - PAD_B}" fill="${theme === "light" ? "rgba(20,20,20,0.06)" : "rgba(242,239,232,0.07)"}"/>`
      : "";
  const lines = MACRO_NAMES.map((name) => {
    const style = MACRO_STYLE[name];
    const color = style[theme];
    const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : "";
    const cap = name === "Fat" ? ` stroke-linecap="round"` : "";
    return `<path d="${seriesPath(model.series[name], model.yMax)}" fill="none" stroke="${color}" stroke-width="${style.width}"${dash}${cap}/>`;
  }).join("");
  const dense = model.dates.length > 48;
  const markers = MACRO_NAMES.map((name) => {
    const style = MACRO_STYLE[name];
    const color = style[theme];
    return model.series[name]
      .map((value, index) => {
        if (value == null) return "";
        if (dense && index % 2 === 1 && model.dates[index] !== selected) return "";
        return marker(style.marker, xAt(index, model.dates.length), yAt(value, model.yMax), color, dense ? 2.2 : 3.1);
      })
      .join("");
  }).join("");
  const labels = MACRO_NAMES.map((name) => {
    const style = MACRO_STYLE[name];
    let last = -1;
    model.series[name].forEach((value, index) => {
      if (value != null) last = index;
    });
    if (last < 0) return "";
    const x = xAt(last, model.dates.length);
    const y = yAt(model.series[name][last] as number, model.yMax);
    const anchor = x > WIDTH - 36 ? "end" : "start";
    const dx = anchor === "end" ? -8 : 8;
    return `<text x="${(x + dx).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" fill="${style[theme]}" font-size="13" font-weight="700" font-family="Barlow Condensed, Impact, sans-serif">${style.label}</text>`;
  }).join("");
  const tickIndexes = xTickIndexes(model.dates.length);
  const xLabels = tickIndexes
    .map((index, tickIndex) => {
      const date = model.dates[index];
      const day = Number(date.slice(8, 10));
      const month = MONTHS[Number(date.slice(5, 7)) - 1];
      const previous = tickIndex > 0 ? model.dates[tickIndexes[tickIndex - 1]] : "";
      const showMonth = tickIndex === 0 || date.slice(0, 7) !== previous.slice(0, 7);
      const label = showMonth ? `${month} ${day}` : String(day);
      return `<text x="${xAt(index, model.dates.length).toFixed(1)}" y="${HEIGHT - 6}" text-anchor="middle" fill="${tickFill}" font-size="11" font-family="JetBrains Mono, ui-monospace, monospace">${label}</text>`;
    })
    .join("");
  const hits = model.dates
    .map((date, index) => {
      const x = xAt(index, model.dates.length) - step / 2;
      return `<rect data-date="${date}" x="${x.toFixed(1)}" y="0" width="${Math.max(step, 8).toFixed(1)}" height="${HEIGHT}" fill="transparent"/>`;
    })
    .join("");
  return `<svg id="trend-chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" role="img" aria-label="Grams per day. Protein is a solid line, carbs a dashed line, fat a dotted line.">
    ${grid}${guides}${band}${lines}${markers}${labels}${xLabels}${hits}
  </svg>`;
}

export function sparkSvg(
  calories: (number | null)[],
  selected: string | null,
  dates: string[],
  theme: "dark" | "light" = "dark",
): string {
  const values = calories.filter((value): value is number => value != null);
  const max = Math.max(1, ...values);
  const width = 148;
  const height = 46;
  const count = Math.max(calories.length, 1);
  const gap = 2;
  const barWidth = Math.max(2, (width - gap * (count - 1)) / count);
  const activeFill = theme === "light" ? "#141414" : "#F2EFE8";
  const restFill = theme === "light" ? "rgba(79,75,69,0.4)" : "rgba(201,196,186,0.45)";
  const bars = calories
    .map((value, index) => {
      if (value == null) return "";
      const h = Math.max(2, (value / max) * (height - 2));
      const x = index * (barWidth + gap);
      const active = dates[index] === selected;
      const fill = active ? activeFill : restFill;
      return `<rect x="${x.toFixed(1)}" y="${(height - h).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${fill}"/>`;
    })
    .join("");
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="148" height="46" aria-hidden="true">${bars}</svg>`;
}

function marker(shape: "circle" | "square" | "triangle", x: number, y: number, color: string, size: number): string {
  if (shape === "circle") return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size}" fill="${color}"/>`;
  if (shape === "square") {
    const s = size * 1.7;
    return `<rect x="${(x - s / 2).toFixed(1)}" y="${(y - s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" fill="${color}"/>`;
  }
  const h = size * 2.1;
  return `<polygon points="${x.toFixed(1)},${(y - h * 0.55).toFixed(1)} ${(x - size * 1.15).toFixed(1)},${(y + h * 0.45).toFixed(1)} ${(x + size * 1.15).toFixed(1)},${(y + h * 0.45).toFixed(1)}" fill="${color}"/>`;
}

function yTicks(yMax: number): number[] {
  if (yMax <= 300) return [0, 100, 200, 300];
  const step = yMax <= 500 ? 100 : 150;
  const ticks: number[] = [];
  for (let value = 0; value <= yMax; value += step) ticks.push(value);
  if (ticks[ticks.length - 1] !== yMax) ticks.push(yMax);
  return ticks;
}

function xTickIndexes(count: number): number[] {
  if (count <= 1) return [0];
  const target = count > 40 ? 5 : 5;
  const indexes = new Set<number>([0, count - 1]);
  for (let i = 1; i < target - 1; i += 1) indexes.add(Math.round((i * (count - 1)) / (target - 1)));
  return [...indexes].sort((a, b) => a - b);
}
