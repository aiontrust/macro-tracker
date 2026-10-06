import { describe, expect, it } from "vitest";
import { DEMO_LOG_CSV } from "./demo-log";
import { defaultRanges, loadMacroCsv, macroChartAnchor, type DayRecord } from "./logic";
import type { MealRecord } from "./meals";
import { createState } from "./state";
import { chartBounds, renderApp } from "./view";

function entry(date: string, protein: number | null, carbs: number | null, fat: number | null, calories: number | null): DayRecord {
  return { date, protein, carbs, fat, calories };
}

describe("trends screen", () => {
  it("keeps the demo gram chart on the anchored window", () => {
    const { entries } = loadMacroCsv(DEMO_LOG_CSV);
    const anchor = macroChartAnchor(entries);
    expect(anchor).toBeTruthy();
    const state = createState();
    state.ready = true;
    state.mode = "demo";
    state.anchor = anchor;
    state.entries = entries;
    state.preset = "30";
    state.screen = "trends";
    expect(chartBounds(state)?.end).toBe(anchor);
    const html = renderApp(state);
    const trend = html.slice(html.indexOf('id="trend-chart"'), html.indexOf("calorie-card"));
    expect(trend.match(/data-date="/g)?.length ?? 0).toBeGreaterThan(20);
    expect(html).toContain('id="calorie-chart"');
    expect(html.indexOf('id="trend-chart"')).toBeLessThan(html.indexOf('id="calorie-chart"'));
  });

  it("draws the gram lines for one or two recent days instead of a 30-day stub", () => {
    const state = createState();
    state.ready = true;
    state.started = true;
    state.mode = "user";
    state.screen = "trends";
    state.theme = "light";
    state.preset = "30";
    state.trendDate = "2026-10-03";
    state.entries = [
      entry("2026-09-04", null, null, null, 2100),
      entry("2026-10-02", 180, 160, 88.8, 1793),
      entry("2026-10-03", 190, 140, 90.3, 1927),
    ];
    const bounds = chartBounds(state);
    expect(bounds).toEqual({ start: "2026-09-04", end: "2026-10-03" });
    const html = renderApp(state);
    expect(html).toContain('id="trend-chart"');
    expect(html).toContain('id="calorie-chart"');
    expect(html).not.toContain("Log 2 days to see a trend line.");
    const trend = html.slice(html.indexOf('id="trend-chart"'), html.indexOf("calorie-card"));
    expect(trend.match(/data-date="/g)?.length).toBe(2);
    expect(trend).toContain("OCT 2");
    expect(trend).not.toContain("SEP 4");
    expect(trend).toContain("<circle");
    expect(trend).toContain("<polygon");
    expect(trend).toContain('stroke-dasharray="8 4"');
    expect(trend).toContain('stroke-dasharray="1.5 4"');
    expect(trend).toContain('stroke-dasharray="2 4"');

    state.entries = [entry("2026-10-03", 180, 150, 70, 1900)];
    state.trendDate = "2026-10-03";
    const oneDay = renderApp(state);
    expect(oneDay).toContain('id="trend-chart"');
    expect(oneDay).toContain('id="calorie-chart"');
    expect(oneDay).not.toContain("Log 2 days to see a trend line.");
    expect(oneDay).toContain("<circle");
  });

  it("steps a calories-only tail back to the last gram days", () => {
    const state = createState();
    state.ready = true;
    state.started = true;
    state.mode = "user";
    state.screen = "trends";
    state.preset = "30";
    state.entries = [
      entry("2026-04-01", 150, 180, 60, 2000),
      entry("2026-04-02", 160, 170, 55, 1900),
      entry("2026-04-03", 140, 150, 50, 1800),
      entry("2026-09-17", null, null, null, 2200),
    ];
    expect(chartBounds(state)?.end).toBe("2026-04-03");
    const html = renderApp(state);
    expect(html).toContain('id="trend-chart"');
    expect(html).toContain("<circle");
    expect(html).not.toContain("Log 2 days to see a trend line.");
  });
});

describe("today meals", () => {
  it("shows running totals for the day's meals", () => {
    const state = createState();
    state.ready = true;
    state.started = true;
    state.screen = "log";
    state.logDate = "2026-10-06";
    state.mealDays = ["2026-10-06"];
    state.meals = [
      meal("a", "Breakfast", 40, 50, 10),
      meal("b", "Shake", 30, 20, 5),
    ];
    const html = renderApp(state);
    expect(html).toContain("RUNNING TOTAL");
    expect(html).toContain("Breakfast");
    expect(html).toContain("Shake");
    expect(html).toContain("Add meal or snack");
    expect(html).toContain('<strong class="protein">70</strong>');
    expect(html).toContain('<strong class="carbs">70</strong>');
    expect(html).toContain('<strong class="fat">15</strong>');
    expect(html).toContain("695");
    expect(html).toContain("Not in the daily log yet");
  });

  it("shows an older saved day as one total until it is split into meals", () => {
    const state = createState();
    state.ready = true;
    state.started = true;
    state.screen = "log";
    state.logDate = "2026-10-05";
    state.entries = [entry("2026-10-05", 180, 160, 55, 1855)];
    const html = renderApp(state);
    expect(html).toContain("Daily total");
    expect(html).toContain("Saved day total");
    expect(html).toContain('<strong class="protein">180</strong>');
    expect(html).toContain("1,855");
    expect(html).not.toContain("Not in the daily log yet");
  });
});

function meal(id: string, name: string, protein: number, carbs: number, fat: number): MealRecord {
  return { id, date: "2026-10-06", name, protein, carbs, fat };
}

describe("week target ranges", () => {
  it("stacks the fields, uses a decimal keypad, and explains the defaults only while they last", () => {
    const state = createState();
    state.ready = true;
    state.started = true;
    state.mode = "user";
    state.screen = "week";
    state.targetsOpen = true;
    state.weekMonday = "2026-09-28";
    state.entries = [
      entry("2026-10-02", 180, 160, 88.8, 1793),
      entry("2026-10-03", 190, 140, 90.3, 1927),
    ];
    state.ranges = defaultRanges();
    const defaults = renderApp(state);
    expect(defaults).toContain("They start at 125–250 g");
    expect(defaults).toContain('inputmode="decimal"');
    expect(defaults.indexOf(">Protein<")).toBeLessThan(defaults.indexOf('id="range-Protein-low"'));
    expect(defaults.indexOf('id="range-Protein-low"')).toBeLessThan(defaults.indexOf('id="range-Protein-high"'));

    state.ranges = {
      Protein: [175, 300],
      Carbs: [125, 250],
      Fat: [25, 100],
    };
    const custom = renderApp(state);
    expect(custom).not.toContain("They start at 125–250 g");
    expect(custom).toContain("In range = Protein 175–300 g, Carbs 125–250 g, Fat 25–100 g");
    expect(custom).toContain('id="range-Fat-high"');
    expect(custom).toContain('inputmode="decimal"');
    expect(custom).toContain('class="range-row"');
  });
});
