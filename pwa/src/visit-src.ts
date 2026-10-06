/**
 * Campaign tag from links such as `/?src=flyer` or `/?src=trainer-mike`.
 *
 * The first valid slug is stored in localStorage and kept. A later visit
 * with no `src`, an empty `src`, or a value that fails the slug check does
 * not replace it. A later visit with a different valid slug does not replace
 * it either — the first tag is the one that travels with a waitlist signup.
 *
 * `?src=` can sit next to `?demo=1`. This module only reads `src`.
 */

export const SRC_STORAGE_KEY = "oneset.src";

/** Short enough for a flyer or trainer slug, long enough to stay readable. */
export const SRC_MAX_LENGTH = 64;

const SRC_SLUG = new RegExp(`^[A-Za-z0-9_-]{1,${SRC_MAX_LENGTH}}$`);

export interface SrcStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Letters, digits, hyphen, and underscore only. Anything else is dropped. */
export function sanitizeSrc(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const value = raw.trim();
  if (!SRC_SLUG.test(value)) return null;
  return value;
}

export function srcFromSearch(search: string): string | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return sanitizeSrc(new URLSearchParams(query).get("src"));
}

export function readStoredSrc(store: SrcStore): string | null {
  try {
    return sanitizeSrc(store.getItem(SRC_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Remember the first valid `src` on this device.
 * Returns the tag that should be used from now on, or null when there is none.
 */
export function captureSrc(search: string, store: SrcStore): string | null {
  const existing = readStoredSrc(store);
  if (existing) return existing;
  const incoming = srcFromSearch(search);
  if (!incoming) return null;
  try {
    store.setItem(SRC_STORAGE_KEY, incoming);
  } catch {
    return incoming;
  }
  return incoming;
}

/** Form body for the waitlist POST. `src` is included only when one is stored. */
export function signupFormBody(email: string, store: SrcStore): URLSearchParams {
  const body = new URLSearchParams({ email });
  const src = readStoredSrc(store);
  if (src) body.set("src", src);
  return body;
}
