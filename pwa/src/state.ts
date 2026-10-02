import { defaultRanges, todayIso, type DayRecord, type Ranges } from "./logic";
import type { Mode, ThemeName } from "./storage";

export type Screen = "first" | "error" | "log" | "trends" | "week" | "export";
export type Preset = "7" | "14" | "30" | "90" | "all" | "custom";

export interface Draft {
  protein: string;
  carbs: string;
  fat: string;
  calories: string;
  caloriesEdited: boolean;
}

export interface AppState {
  ready: boolean;
  mode: Mode;
  started: boolean;
  theme: ThemeName;
  entries: DayRecord[];
  ranges: Ranges;
  screen: Screen;
  returnScreen: Screen;
  logDate: string;
  draft: Draft;
  importName: string;
  importIssues: string[];
  warnings: string[];
  preset: Preset;
  customStart: string;
  customEnd: string;
  trendDate: string | null;
  anchor: string | null;
  weekMonday: string;
  lastDownloadAt: string | null;
  snapshot: Record<string, string>;
  sheet: null | "clear" | "discard";
  pendingDate: string | null;
  pendingScreen: Screen | null;
  saveFlash: boolean;
  formError: string;
  signupNote: string;
  signupEmail: string;
  calorieEditing: boolean;
  targetsOpen: boolean;
}

export function blankDraft(): Draft {
  return { protein: "", carbs: "", fat: "", calories: "", caloriesEdited: false };
}

export function createState(): AppState {
  const today = todayIso();
  return {
    ready: false,
    mode: "user",
    started: false,
    theme: "dark",
    entries: [],
    ranges: defaultRanges(),
    screen: "first",
    returnScreen: "first",
    logDate: today,
    draft: blankDraft(),
    importName: "",
    importIssues: [],
    warnings: [],
    preset: "30",
    customStart: today,
    customEnd: today,
    trendDate: null,
    anchor: null,
    weekMonday: today,
    lastDownloadAt: null,
    snapshot: {},
    sheet: null,
    pendingDate: null,
    pendingScreen: null,
    saveFlash: false,
    formError: "",
    signupNote: "",
    signupEmail: "",
    calorieEditing: false,
    targetsOpen: false,
  };
}
