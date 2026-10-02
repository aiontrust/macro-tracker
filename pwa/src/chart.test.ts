import { describe, expect, it } from "vitest";
import { buildTrendModel, seriesPath } from "./chart";
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
});
