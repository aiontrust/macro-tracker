import { describe, expect, it } from "vitest";
import { saveDay, toCsv, type DayRecord } from "./logic";
import {
  committedDay,
  dayInputFromMeals,
  effectiveDayInput,
  emptyMealLog,
  mealsOn,
  reloadMealLog,
  removeMeal,
  sameCommittedDay,
  sumMeals,
  upsertMeal,
  visibleMeals,
  type MealRecord,
} from "./meals";

function meal(partial: Partial<MealRecord> & Pick<MealRecord, "id" | "date">): MealRecord {
  return {
    name: "",
    protein: null,
    carbs: null,
    fat: null,
    ...partial,
  };
}

describe("sum meals", () => {
  it("adds grams and leaves a blank missing instead of zero", () => {
    const totals = sumMeals([
      { protein: 40, carbs: 50, fat: 10 },
      { protein: 30, carbs: null, fat: 5 },
      { protein: 0, carbs: 20, fat: null },
    ]);
    expect(totals).toEqual({ protein: 70, carbs: 70, fat: 15 });
  });

  it("sums an empty list to missing macros", () => {
    expect(sumMeals([])).toEqual({ protein: null, carbs: null, fat: null });
  });

  it("does not mix meals from another day", () => {
    const meals = [
      meal({ id: "a", date: "2026-10-06", name: "Breakfast", protein: 40, carbs: 50, fat: 12 }),
      meal({ id: "b", date: "2026-10-06", name: "Shake", protein: 32, carbs: 8, fat: 3 }),
      meal({ id: "c", date: "2026-10-07", protein: 99, carbs: 99, fat: 99 }),
    ];
    expect(sumMeals(mealsOn(meals, "2026-10-06"))).toEqual({ protein: 72, carbs: 58, fat: 15 });
  });
});

describe("save one daily row", () => {
  it("writes one CSV row in the existing daily format", () => {
    const meals = [
      meal({ id: "a", date: "2026-10-06", name: "Breakfast", protein: 40, carbs: 50, fat: 10 }),
      meal({ id: "b", date: "2026-10-06", name: "Snack", protein: 30, carbs: null, fat: 5 }),
      meal({ id: "c", date: "2026-10-06", protein: 0, carbs: 20, fat: null }),
    ];
    const saved = saveDay([], "2026-10-06", dayInputFromMeals(meals, null));
    expect(saved.status).toBe("saved");
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]).toMatchObject({ date: "2026-10-06", protein: 70, carbs: 70, fat: 15, calories: 695 });
    const csv = toCsv(saved.entries);
    expect(csv).toBe("Date,Protein,Carbs,Fat,Calories\n2026-10-06,70,70,15,695\n");
    expect(csv).not.toContain("Breakfast");
    expect(csv).not.toContain("Snack");
  });

  it("leaves calories blank when a macro is missing across every meal", () => {
    const meals = [
      meal({ id: "a", date: "2026-10-06", protein: 10 }),
      meal({ id: "b", date: "2026-10-06", fat: 5 }),
    ];
    const saved = saveDay([], "2026-10-06", dayInputFromMeals(meals, null));
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]).toMatchObject({ protein: 10, carbs: null, fat: 5, calories: null });
    expect(toCsv(saved.entries)).toBe("Date,Protein,Carbs,Fat,Calories\n2026-10-06,10,,5,\n");
  });

  it("keeps a typed calorie total on that single row", () => {
    const meals = [meal({ id: "a", date: "2026-10-06", protein: 40, carbs: 40, fat: 10 })];
    const saved = saveDay([], "2026-10-06", dayInputFromMeals(meals, 900));
    expect(saved.entries[0].calories).toBe(900);
    expect(toCsv(saved.entries)).toBe("Date,Protein,Carbs,Fat,Calories\n2026-10-06,40,40,10,900\n");
  });

  it("replaces the previous day row instead of appending a second one", () => {
    const existing: DayRecord[] = [{ date: "2026-10-06", protein: 10, carbs: 10, fat: 10, calories: 170 }];
    const meals = [
      meal({ id: "a", date: "2026-10-06", protein: 20, carbs: 30, fat: 5 }),
      meal({ id: "b", date: "2026-10-06", protein: 25, carbs: 10, fat: 5 }),
    ];
    const saved = saveDay(existing, "2026-10-06", dayInputFromMeals(meals, null));
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]).toMatchObject({ protein: 45, carbs: 40, fat: 10, calories: 430 });
  });
});

describe("persist a mid-day list", () => {
  it("reloads added, edited, and removed meals for that day", () => {
    let log = emptyMealLog();
    const breakfast = meal({ id: "a", date: "2026-10-06", name: "Breakfast", protein: 40, carbs: 50, fat: 12 });
    log = {
      meals: upsertMeal(log.meals, breakfast),
      mealDays: ["2026-10-06"],
      calorieEdits: {},
    };
    log = {
      ...log,
      meals: upsertMeal(log.meals, meal({ id: "b", date: "2026-10-06", name: "Shake", protein: 32, carbs: 8, fat: 3 })),
    };
    let stored = reloadMealLog(JSON.parse(JSON.stringify(log)));
    expect(stored).toEqual(log);
    expect(sumMeals(mealsOn(stored.meals, "2026-10-06"))).toEqual({ protein: 72, carbs: 58, fat: 15 });

    log = {
      ...stored,
      meals: upsertMeal(stored.meals, meal({ id: "b", date: "2026-10-06", name: "Shake", protein: 28, carbs: 4, fat: 2 })),
    };
    stored = reloadMealLog(JSON.parse(JSON.stringify(log)));
    expect(mealsOn(stored.meals, "2026-10-06").map((item) => item.protein)).toEqual([40, 28]);

    log = { ...stored, meals: removeMeal(stored.meals, "a"), calorieEdits: { "2026-10-06": null } };
    stored = reloadMealLog(JSON.parse(JSON.stringify(log)));
    expect(mealsOn(stored.meals, "2026-10-06")).toEqual([
      meal({ id: "b", date: "2026-10-06", name: "Shake", protein: 28, carbs: 4, fat: 2 }),
    ]);
    expect(stored.calorieEdits).toEqual({ "2026-10-06": null });
    expect(stored.mealDays).toEqual(["2026-10-06"]);
  });

  it("drops a corrupt meal and keeps the rest", () => {
    const stored = reloadMealLog({
      meals: [
        { id: "ok", date: "2026-10-06", name: "  Lunch  ", protein: "25", carbs: 10, fat: null },
        { id: "", date: "2026-10-06", protein: 5 },
        { date: "2026-10-06", protein: 5 },
        { id: "bad-date", date: "Monday", protein: 5 },
        { id: "neg", date: "2026-10-06", protein: -3, carbs: 4, fat: 1 },
      ],
      mealDays: ["2026-10-06", "2026-10-06", "nope"],
      calorieEdits: { "2026-10-06": 1800, "yesterday": 10, "2026-10-07": null },
    });
    expect(stored.meals).toEqual([
      meal({ id: "ok", date: "2026-10-06", name: "Lunch", protein: 25, carbs: 10 }),
      meal({ id: "neg", date: "2026-10-06", protein: null, carbs: 4, fat: 1 }),
    ]);
    expect(stored.mealDays).toEqual(["2026-10-06"]);
    expect(stored.calorieEdits).toEqual({ "2026-10-06": 1800, "2026-10-07": null });
  });
});

describe("legacy daily rows", () => {
  const entry: DayRecord = { date: "2026-10-05", protein: 180, carbs: 160, fat: 55, calories: 1855 };

  it("keeps a saved day unchanged until that day has meals", () => {
    const input = effectiveDayInput([], entry, undefined, false);
    expect(sameCommittedDay(input, entry)).toBe(true);
    expect(visibleMeals([], entry.date, entry, false).map((item) => item.name)).toEqual(["Daily total"]);
    expect(committedDay(input)).toMatchObject({ protein: 180, carbs: 160, fat: 55, calories: 1855 });
  });

  it("sums meals once the day has been edited, and an empty list clears it", () => {
    const meals = [meal({ id: "a", date: "2026-10-05", name: "Dinner", protein: 50, carbs: 40, fat: 15 })];
    const edited = effectiveDayInput(meals, entry, undefined, true);
    expect(sameCommittedDay(edited, entry)).toBe(false);
    expect(committedDay(edited)).toMatchObject({ protein: 50, carbs: 40, fat: 15, calories: 495 });

    const cleared = effectiveDayInput([], entry, undefined, true);
    expect(committedDay(cleared)).toEqual({ protein: null, carbs: null, fat: null, calories: null });
    expect(sameCommittedDay(cleared, entry)).toBe(false);
    expect(visibleMeals([], entry.date, entry, true)).toEqual([]);
  });
});
