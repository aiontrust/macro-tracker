import { describe, expect, it } from "vitest";
import { buildTrendModel, seriesPath, trendSvg, sparkSvg } from "./chart";
import { loadMacroCsv } from "./logic";

const MIXED = `Date,Protein,Carbs,Fat,Calories
2026-09-07,100,,50,
2026-09-08,200,100,,
2026-09-09,,,40,1800
2026-09-10,150,150,50,2000
`;

describe("chart", () => {
  it("breaks the line on blank cells and missing days", () => {
    const { entries } = loadMacroCsv(MIXED);
    const model = buildTrendModel(entries, "2026-09-07", "2026-09-12");
    expect(model.dates).toHaveLength(6);
    expect(model.series.Protein[2]).toBeNull();
    expect(model.series.Protein[4]).toBeNull();
    const path = seriesPath(model.series.Protein, model.yMax);
    expect(path.match(/M/g)?.length).toBe(2);
    expect(path).not.toContain("NaN");
    const svg = buildTrendModel(entries, "2026-09-07", "2026-09-10");
    expect(svg.guides).toEqual([125, 250]);
  });

  it("draws protein, carbs, and fat as separate series even for one or two days", () => {
    const { entries } = loadMacroCsv(`Date,Protein,Carbs,Fat,Calories
2026-10-02,180,160,88.8,1793
2026-10-03,190,140,90.3,1927
`);
    const two = buildTrendModel(entries, "2026-10-02", "2026-10-03", {
      Protein: [175, 300],
      Carbs: [125, 250],
      Fat: [25, 100],
    });
    expect(two.macroDays).toBe(2);
    expect(two.dates).toEqual(["2026-10-02", "2026-10-03"]);
    const light = trendSvg(two, "2026-10-03", "light");
    expect(light).toContain("<circle");
    expect(light).toContain("<polygon");
    expect(light).toContain('stroke-dasharray="8 4"');
    expect(light).toContain('stroke-dasharray="1.5 4"');
    expect(light).toContain('stroke-dasharray="2 4"');
    expect(light).toContain("#9A5A00");
    expect(light).toContain("#0069A8");
    expect(light).toContain("#3A3A3A");
    expect(light).not.toContain("NaN");
    const dark = trendSvg(two, null, "dark");
    expect(dark).toContain("#E8A33A");
    expect(dark).toContain("#6FA8FF");
    expect(dark).toContain("#D9D4CA");

    const one = buildTrendModel(entries.slice(1), "2026-10-03", "2026-10-03");
    expect(one.macroDays).toBe(1);
    const single = trendSvg(one, "2026-10-03", "dark");
    expect(single).toContain("<circle");
    expect(single).toContain("<polygon");
    expect(single.match(/<circle /g)?.length).toBe(1);

    const calories = sparkSvg(two.calories, "2026-10-03", two.dates, "light");
    expect(calories).toContain('id="calorie-chart"');
    expect(calories).not.toContain('id="trend-chart"');
  });
});
