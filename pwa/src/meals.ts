/**
 * Meals and snacks for one calendar day.
 *
 * The list lives on the device as soon as a meal is added. Blank grams stay
 * missing and are not treated as zero. Saving the day still writes one
 * Date,Protein,Carbs,Fat,Calories row: the grams added across that day's meals.
 * Targets stay on the daily total.
 */

import { caloriesFromMacros, round2, type DayInput, type DayRecord } from "./logic";

export interface MealRecord {
  id: string;
  date: string;
  name: string;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export interface MealMacros {
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

/** Meals plus the dates the person has edited, including a day they cleared. */
export interface MealLog {
  meals: MealRecord[];
  mealDays: string[];
  /** A number is a typed calorie total. Null means use the macro formula. */
  calorieEdits: Record<string, number | null>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyMealLog(): MealLog {
  return { meals: [], mealDays: [], calorieEdits: {} };
}

export function sumMeals(meals: readonly MealMacros[]): MealMacros {
  const totals: MealMacros = { protein: null, carbs: null, fat: null };
  for (const meal of meals) {
    totals.protein = addMacro(totals.protein, meal.protein);
    totals.carbs = addMacro(totals.carbs, meal.carbs);
    totals.fat = addMacro(totals.fat, meal.fat);
  }
  return totals;
}

export function mealsOn(meals: readonly MealRecord[], date: string): MealRecord[] {
  return meals.filter((meal) => meal.date === date);
}

export function upsertMeal(meals: readonly MealRecord[], meal: MealRecord): MealRecord[] {
  const next = meals.map((item) => ({ ...item }));
  const index = next.findIndex((item) => item.id === meal.id);
  if (index >= 0) next[index] = { ...meal };
  else next.push({ ...meal });
  return next;
}

export function removeMeal(meals: readonly MealRecord[], id: string): MealRecord[] {
  return meals.filter((meal) => meal.id !== id);
}

export function dayInputFromMeals(meals: readonly MealMacros[], calorieOverride: number | null): DayInput {
  return { ...sumMeals(meals), calories: calorieOverride };
}

/**
 * Grams the day will save.
 * A day that still has no meal list keeps its stored row, so older logs and
 * imported CSVs stay as one total. Once the person edits that day, the meal
 * list is the total, even when they remove every meal.
 */
export function effectiveDayInput(
  meals: readonly MealRecord[],
  entry: DayRecord | null,
  calorieEdit: number | null | undefined,
  authored: boolean,
): DayInput {
  const useStoredDay = !authored && meals.length === 0;
  const macros: MealMacros = useStoredDay
    ? {
        protein: entry?.protein ?? null,
        carbs: entry?.carbs ?? null,
        fat: entry?.fat ?? null,
      }
    : sumMeals(meals);
  let calories: number | null;
  if (calorieEdit !== undefined) calories = calorieEdit;
  else if (useStoredDay) calories = entry?.calories ?? null;
  else calories = null;
  return { ...macros, calories };
}

/** The row Save this day would store, including calories filled from macros. */
export function committedDay(input: DayInput): DayInput {
  return {
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    calories: input.calories ?? caloriesFromMacros(input.protein, input.carbs, input.fat),
  };
}

export function sameCommittedDay(input: DayInput, entry: DayRecord | null): boolean {
  const committed = committedDay(input);
  if (!entry) {
    return committed.protein == null && committed.carbs == null && committed.fat == null && committed.calories == null;
  }
  return (
    committed.protein === entry.protein &&
    committed.carbs === entry.carbs &&
    committed.fat === entry.fat &&
    committed.calories === entry.calories
  );
}

/** A saved day with grams, shown until the person edits that day's meals. */
export function legacyMeal(entry: DayRecord): MealRecord | null {
  if (entry.protein == null && entry.carbs == null && entry.fat == null) return null;
  return {
    id: `legacy:${entry.date}`,
    date: entry.date,
    name: "Daily total",
    protein: entry.protein,
    carbs: entry.carbs,
    fat: entry.fat,
  };
}

export function visibleMeals(
  meals: readonly MealRecord[],
  date: string,
  entry: DayRecord | null,
  authored: boolean,
): MealRecord[] {
  const day = mealsOn(meals, date);
  if (day.length > 0 || authored) return day;
  if (!entry || entry.date !== date) return day;
  const legacy = legacyMeal(entry);
  return legacy ? [legacy] : day;
}

export function newMealId(): string {
  return crypto.randomUUID();
}

/** Read a meal log back after it has been stored and loaded. */
export function reloadMealLog(stored: unknown): MealLog {
  const value = stored && typeof stored === "object" ? (stored as Partial<MealLog>) : {};
  return {
    meals: normalizeMeals(value.meals),
    mealDays: normalizeMealDays(value.mealDays),
    calorieEdits: normalizeCalorieEdits(value.calorieEdits),
  };
}

export function normalizeMeals(value: unknown): MealRecord[] {
  if (!Array.isArray(value)) return [];
  const meals: MealRecord[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const meal = item as Partial<MealRecord>;
    if (typeof meal.id !== "string" || meal.id.trim() === "") continue;
    if (typeof meal.date !== "string" || !DATE.test(meal.date)) continue;
    const name = typeof meal.name === "string" ? meal.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    meals.push({
      id: meal.id,
      date: meal.date,
      name,
      protein: finiteOrNull(meal.protein),
      carbs: finiteOrNull(meal.carbs),
      fat: finiteOrNull(meal.fat),
    });
  }
  return meals;
}

export function normalizeMealDays(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const days = value.filter((item): item is string => typeof item === "string" && DATE.test(item));
  return [...new Set(days)];
}

export function normalizeCalorieEdits(value: unknown): Record<string, number | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const edits: Record<string, number | null> = {};
  for (const [date, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!DATE.test(date)) continue;
    if (raw == null) {
      edits[date] = null;
      continue;
    }
    const number = finiteOrNull(raw);
    if (number == null) continue;
    edits[date] = number;
  }
  return edits;
}

function addMacro(total: number | null, value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return total;
  if (total == null) return round2(value);
  return round2(total + value);
}

function finiteOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return round2(number);
}
