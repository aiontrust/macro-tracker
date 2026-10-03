import { describe, expect, it } from "vitest";
import { DEMO_LOG_CSV } from "./demo-log";
import {
  MacroLogError,
  addDays,
  caloriesFromMacros,
  compareWeeks,
  defaultRanges,
  denseMacroDay,
  gramChartEnd,
  hasMacro,
  loadMacroCsv,
  macroChartAnchor,
  rangesAreDefault,
  tightenMacroBounds,
  mondayOf,
  saveDay,
  sliceDates,
  summaryToCsv,
  toCsv,
  trailingWindow,
  weeklySummary,
} from "./logic";

const MIXED = `Date,Protein,Carbs,Fat,Calories
2026-09-07,100,,50,
2026-09-08,200,100,,
2026-09-09,,,40,1800
2026-09-10,150,150,50,2000
2026-09-14,100,100,100,1000
2026-09-15,300,300,100,3000
`;

describe("load", () => {
  it("keeps blanks and does not invent missing days", () => {
    const { entries, warnings } = loadMacroCsv(MIXED);
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(6);
    expect(entries.some((entry) => entry.date === "2026-09-11")).toBe(false);
    const partial = entries.find((entry) => entry.date === "2026-09-07");
    expect(partial?.protein).toBe(100);
    expect(partial?.carbs).toBeNull();
    expect(partial?.fat).toBe(50);
    expect(partial?.calories).toBeNull();
  });

  it("does not fill historical calories on load", () => {
    const { entries } = loadMacroCsv("Date,Protein,Carbs,Fat,Calories\n2026-09-01,100,50,10,\n");
    expect(entries[0].calories).toBeNull();
    expect(caloriesFromMacros(100, 50, 10)).toBe(690);
  });

  it("accepts alias headers and a missing calories column", () => {
    const { entries, warnings } = loadMacroCsv("date,protein_g,carbs_g,fat_g\n2024-05-01,12.5,30,8\n");
    expect(warnings.some((warning) => warning.includes("Calories"))).toBe(true);
    expect(entries[0]).toMatchObject({ protein: 12.5, carbs: 30, fat: 8, calories: null });
  });

  it("treats blank tokens as missing and keeps an explicit zero", () => {
    const { entries } = loadMacroCsv("Date,Protein,Carbs,Fat,Calories\n2024-06-01,0,NA,n/a,\n");
    expect(entries[0]).toMatchObject({ protein: 0, carbs: null, fat: null, calories: null });
  });

  it("round-trips blanks without writing nan or zero", () => {
    const { entries } = loadMacroCsv(MIXED);
    const exported = toCsv(entries);
    expect(exported.toLowerCase()).not.toContain("nan");
    expect(exported).toContain("2026-09-07,100,,50,");
    const again = loadMacroCsv(exported).entries;
    expect(again).toEqual(entries.map(({ updatedAt: _ignored, ...entry }) => entry));
  });

  it("rejects a bad file without a partial result", () => {
    expect(() => loadMacroCsv("Date,Protein,Carbs\n2024-01-01,1,2\n")).toThrow(MacroLogError);
    try {
      loadMacroCsv("Date,Protein,Carbs,Fat\n2024-01-01,lots,2,3\n31/09/2026,1,2,3\n");
    } catch (error) {
      expect(error).toBeInstanceOf(MacroLogError);
      const issues = (error as MacroLogError).issues.join("\n");
      expect(issues).toContain('protein_g = "lots" (not a number)');
      expect(issues).toContain('date "31/09/2026" is not a real date');
    }
  });

  it("rejects duplicates, negatives, empty files, and semicolons", () => {
    expect(() =>
      loadMacroCsv("Date,Protein,Carbs,Fat\n2024-01-01,1,2,3\n2024-01-01,4,5,6\n"),
    ).toThrow(/repeated/);
    expect(() => loadMacroCsv("Date,Protein,Carbs,Fat\n2024-01-01,-5,2,3\n")).toThrow(/negative/);
    expect(() => loadMacroCsv("")).toThrow(/empty/i);
    expect(() => loadMacroCsv("Date;Protein;Carbs;Fat\n2024-01-01;1;2;3\n")).toThrow(/semicolon/i);
    expect(loadMacroCsv("Date,Protein,Carbs,Fat,Calories\n").entries).toEqual([]);
  });

  it("rejects an impossible date and an absurd gram value", () => {
    expect(() => loadMacroCsv("Date,Protein,Carbs,Fat\n2026-02-31,1,2,3\n")).toThrow(/not a real date/);
    expect(() => loadMacroCsv("Date,Protein,Carbs,Fat\n2026-02-01,1001,2,3\n")).toThrow(/above/);
  });
});

describe("save and summary", () => {
  it("fills calories from macros only when the field is blank, and keeps an override", () => {
    expect(caloriesFromMacros(100, null, 0)).toBeNull();
    expect(caloriesFromMacros(100, 50, 0)).toBe(600);
    const saved = saveDay([], "2026-09-01", { protein: 100, carbs: 50, fat: 10, calories: null });
    expect(saved.status).toBe("saved");
    expect(saved.entries[0].calories).toBe(690);
    const overridden = saveDay(saved.entries, "2026-09-01", {
      protein: 100,
      carbs: 50,
      fat: 10,
      calories: 1000,
    });
    expect(overridden.entries[0].calories).toBe(1000);
    const reloaded = loadMacroCsv(toCsv(overridden.entries)).entries;
    expect(reloaded[0].calories).toBe(1000);
  });

  it("skips blanks in weekly stats and does not score calories against a gram range", () => {
    const { entries } = loadMacroCsv(MIXED);
    const summary = weeklySummary(entries, "2026-09-07");
    const protein = summary.find((row) => row.macro === "Protein");
    const carbs = summary.find((row) => row.macro === "Carbs");
    const calories = summary.find((row) => row.macro === "Calories");
    expect(protein).toMatchObject({ average: 150, min: 100, max: 200, daysInTarget: 2, daysLogged: 3 });
    expect(carbs).toMatchObject({ average: 125, min: 100, daysInTarget: 1, daysLogged: 2 });
    expect(calories?.daysInTarget).toBeNull();
    expect(calories?.daysLogged).toBe(2);
    expect(protein?.average).not.toBe((100 + 200 + 0 + 150) / 4);
  });

  it("counts inclusive bounds per macro", () => {
    const { entries } = loadMacroCsv(
      "Date,Protein,Carbs,Fat,Calories\n2026-09-07,125,250,124.99,\n2026-09-08,250.01,124.99,250,\n",
    );
    const summary = weeklySummary(entries, "2026-09-07", { Fat: [50, 90] });
    expect(summary.find((row) => row.macro === "Protein")?.daysInTarget).toBe(1);
    expect(summary.find((row) => row.macro === "Carbs")?.daysInTarget).toBe(1);
    expect(summary.find((row) => row.macro === "Fat")?.daysInTarget).toBe(0);
    const custom = weeklySummary(entries, "2026-09-07", { Fat: [100, 200] });
    expect(custom.find((row) => row.macro === "Fat")?.daysInTarget).toBe(1);
  });

  it("starts weeks on Monday and compares the previous logged week", () => {
    expect(mondayOf("2026-09-13")).toBe("2026-09-07");
    expect(mondayOf("2026-09-14")).toBe("2026-09-14");
    const { entries } = loadMacroCsv(MIXED);
    const { previousMonday, rows } = compareWeeks(entries, "2026-09-14");
    expect(previousMonday).toBe("2026-09-07");
    const protein = rows.find((row) => row.macro === "Protein");
    expect(protein?.delta).toBeCloseTo(50);
    expect(protein?.percent).toBeCloseTo((50 / 150) * 100);
  });

  it("keeps an explicit zero, refuses to insert an all-blank day, and clears with blanks", () => {
    const { entries } = loadMacroCsv(MIXED);
    const saved = saveDay(entries, "2026-09-11", { protein: 180, carbs: null, fat: 0, calories: null });
    const added = saved.entries.find((entry) => entry.date === "2026-09-11");
    expect(added).toMatchObject({ protein: 180, carbs: null, fat: 0, calories: null });
    const empty = saveDay(entries, "2026-09-11", { protein: null, carbs: null, fat: null, calories: null });
    expect(empty.status).toBe("empty");
    expect(empty.entries).toHaveLength(entries.length);
    const cleared = saveDay(entries, "2026-09-10", { protein: null, carbs: null, fat: null, calories: null });
    expect(cleared.status).toBe("cleared");
    expect(cleared.entries.some((entry) => entry.date === "2026-09-10")).toBe(false);
  });

  it("slices and windows without filling the calendar", () => {
    const { entries } = loadMacroCsv(MIXED);
    expect(sliceDates(entries, "2026-09-07", "2026-09-13")).toHaveLength(4);
    expect(() => sliceDates(entries, "2026-09-15", "2026-09-07")).toThrow(MacroLogError);
    expect(trailingWindow(entries, 90)).toEqual({ start: "2026-09-07", end: "2026-09-15" });
    expect(defaultRanges().Protein).toEqual([125, 250]);
  });

  it("writes a summary csv with blanks instead of zeros", () => {
    const { entries } = loadMacroCsv("Date,Protein,Carbs,Fat\n2026-09-07,10,20,30\n");
    const csv = summaryToCsv(weeklySummary(entries, "2026-09-07"));
    expect(csv).toContain("Calories,,,,");
    expect(csv.toLowerCase()).not.toContain("nan");
  });
});

describe("trend window", () => {
  it("keeps one or two recent gram days and steps back over a calories-only tail", () => {
    const recent = [
      { date: "2026-09-04", protein: null, carbs: null, fat: null, calories: 2100 },
      { date: "2026-10-02", protein: 180, carbs: 160, fat: 88.8, calories: 1793 },
      { date: "2026-10-03", protein: 190, carbs: 140, fat: 90.3, calories: 1927 },
    ];
    expect(gramChartEnd(recent, "2026-10-03", 30)).toBe("2026-10-03");
    expect(tightenMacroBounds(recent, "2026-09-04", "2026-10-03")).toEqual({
      start: "2026-10-02",
      end: "2026-10-03",
    });

    const tail = [
      { date: "2026-04-01", protein: 150, carbs: 180, fat: 60, calories: 2000 },
      { date: "2026-04-02", protein: 160, carbs: 170, fat: 55, calories: 1900 },
      { date: "2026-04-03", protein: 140, carbs: 150, fat: 50, calories: 1800 },
      { date: "2026-09-17", protein: null, carbs: null, fat: null, calories: 2200 },
    ];
    expect(gramChartEnd(tail, "2026-09-17", 30)).toBe("2026-04-03");
    expect(tightenMacroBounds(tail, "2026-03-05", "2026-04-03")).toEqual({
      start: "2026-03-05",
      end: "2026-04-03",
    });
    expect(rangesAreDefault(defaultRanges())).toBe(true);
  });
});

describe("demo log", () => {
  it("loads the bundled sample without notes and without filling calories", () => {
    const { entries, warnings } = loadMacroCsv(DEMO_LOG_CSV);
    expect(warnings).toEqual([]);
    expect(entries.length).toBeGreaterThan(100);
    expect(new Set(entries.map((entry) => entry.date)).size).toBe(entries.length);
    expect(entries.some((entry) => entry.protein == null)).toBe(true);
    expect(entries.some((entry) => entry.calories == null)).toBe(true);
    const anchor = macroChartAnchor(entries);
    expect(anchor).toBeTruthy();
    if (!anchor) return;
    const window = entries.filter((entry) => entry.date >= addDays(anchor, -29) && entry.date <= anchor);
    expect(window.filter(hasMacro).length).toBeGreaterThanOrEqual(8);
    const focused = denseMacroDay(entries, anchor);
    const week = mondayOf(focused);
    const inWeek = entries.filter((entry) => entry.date >= week && entry.date <= addDays(week, 6) && hasMacro(entry));
    expect(inWeek.length).toBeGreaterThanOrEqual(4);
    const again = loadMacroCsv(toCsv(entries)).entries;
    expect(again.map((entry) => entry.calories)).toEqual(entries.map((entry) => entry.calories));
    const body = DEMO_LOG_CSV.trim().split("\n").slice(1);
    expect(body.length).toBe(entries.length);
    for (const line of body) {
      expect(line).toMatch(/^\d{4}-\d{2}-\d{2},[0-9.,]*$/);
    }
  });
});
