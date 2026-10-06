import { DEMO_LOG_CSV, DEMO_SEED } from "./demo-log";
import {
  type DayRecord,
  type Ranges,
  defaultRanges,
  loadMacroCsv,
  normalizeRanges,
} from "./logic";
import { emptyMealLog, reloadMealLog, type MealLog } from "./meals";

export type Mode = "user" | "demo";
export type ThemeName = "dark" | "light";

export interface Bucket extends MealLog {
  entries: DayRecord[];
  ranges: Ranges;
  lastDownloadAt: string | null;
  snapshot: Record<string, string>;
  seeded: boolean;
  seedId: number;
}

export interface Meta {
  started: boolean;
  mode: Mode;
  theme: ThemeName;
}

const DB_NAME = "oneset";
const DB_VERSION = 1;

function emptyBucket(): Bucket {
  return {
    entries: [],
    ranges: defaultRanges(),
    lastDownloadAt: null,
    snapshot: {},
    seeded: false,
    seedId: 0,
    ...emptyMealLog(),
  };
}

export function emptyMeta(): Meta {
  return { started: false, mode: "user", theme: "dark" };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("buckets")) db.createObjectStore("buckets");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed to open."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

async function read<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, "readonly");
    return await requestToPromise(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
  } finally {
    db.close();
  }
}

async function write(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed."));
    });
  } finally {
    db.close();
  }
}

export async function loadMeta(): Promise<Meta> {
  const stored = await read<Meta>("meta", "app");
  return stored ? { ...emptyMeta(), ...stored } : emptyMeta();
}

export async function saveMeta(meta: Meta): Promise<void> {
  await write("meta", "app", meta);
}

function sanitizeBucket(value: Bucket | undefined): Bucket {
  const bucket = value ?? emptyBucket();
  let ranges = defaultRanges();
  try {
    ranges = normalizeRanges(bucket.ranges);
  } catch {
    ranges = defaultRanges();
  }
  const meals = reloadMealLog(bucket);
  return {
    entries: Array.isArray(bucket.entries) ? bucket.entries : [],
    ranges,
    lastDownloadAt: bucket.lastDownloadAt ?? null,
    snapshot: bucket.snapshot ?? {},
    seeded: Boolean(bucket.seeded),
    seedId: bucket.seedId ?? 0,
    meals: meals.meals,
    mealDays: meals.mealDays,
    calorieEdits: meals.calorieEdits,
  };
}

export async function loadBucket(mode: Mode): Promise<Bucket> {
  const stored = await read<Bucket>("buckets", mode);
  const bucket = sanitizeBucket(stored);
  if (mode === "demo" && (!bucket.seeded || bucket.seedId !== DEMO_SEED)) {
    const seeded = seedDemo();
    await saveBucket("demo", seeded);
    return seeded;
  }
  return bucket;
}

export async function saveBucket(mode: Mode, bucket: Bucket): Promise<void> {
  await write("buckets", mode, bucket);
}

export function seedDemo(): Bucket {
  const { entries } = loadMacroCsv(DEMO_LOG_CSV);
  return {
    entries,
    ranges: defaultRanges(),
    lastDownloadAt: null,
    snapshot: {},
    seeded: true,
    seedId: DEMO_SEED,
    ...emptyMealLog(),
  };
}

export function requestPersistentStorage(): void {
  void navigator.storage?.persist?.();
}
