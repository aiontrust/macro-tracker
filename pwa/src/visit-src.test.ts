import { describe, expect, it } from "vitest";
import {
  SRC_MAX_LENGTH,
  SRC_STORAGE_KEY,
  captureSrc,
  readStoredSrc,
  sanitizeSrc,
  signupFormBody,
  srcFromSearch,
  type SrcStore,
} from "./visit-src";

function memoryStore(initial: Record<string, string> = {}): SrcStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("visit src", () => {
  it("keeps a short slug of letters, digits, hyphen, and underscore", () => {
    expect(sanitizeSrc("flyer")).toBe("flyer");
    expect(sanitizeSrc("trainer-mike")).toBe("trainer-mike");
    expect(sanitizeSrc("trainer_mike")).toBe("trainer_mike");
    expect(sanitizeSrc("  Flyer1  ")).toBe("Flyer1");
    expect(sanitizeSrc("a".repeat(SRC_MAX_LENGTH))).toHaveLength(SRC_MAX_LENGTH);
  });

  it("drops empty values and anything that is not a slug", () => {
    expect(sanitizeSrc("")).toBeNull();
    expect(sanitizeSrc("   ")).toBeNull();
    expect(sanitizeSrc(null)).toBeNull();
    expect(sanitizeSrc(undefined)).toBeNull();
    expect(sanitizeSrc("flyer drop")).toBeNull();
    expect(sanitizeSrc("flyer?x=1")).toBeNull();
    expect(sanitizeSrc("<script>")).toBeNull();
    expect(sanitizeSrc("https://evil.example")).toBeNull();
    expect(sanitizeSrc("café")).toBeNull();
    expect(sanitizeSrc("a".repeat(SRC_MAX_LENGTH + 1))).toBeNull();
  });

  it("reads src beside demo=1 and ignores a missing or invalid tag", () => {
    expect(srcFromSearch("?demo=1&src=flyer")).toBe("flyer");
    expect(srcFromSearch("src=trainer-mike&demo=1")).toBe("trainer-mike");
    expect(srcFromSearch("?demo=1")).toBeNull();
    expect(srcFromSearch("?src=")).toBeNull();
    expect(srcFromSearch("?src=not%20a%20slug")).toBeNull();
  });

  it("persists the first src and leaves it alone on a later empty visit", () => {
    const store = memoryStore();
    expect(captureSrc("?src=flyer", store)).toBe("flyer");
    expect(store.data[SRC_STORAGE_KEY]).toBe("flyer");

    expect(captureSrc("", store)).toBe("flyer");
    expect(captureSrc("?demo=1", store)).toBe("flyer");
    expect(captureSrc("?src=", store)).toBe("flyer");
    expect(captureSrc("?src=not a slug", store)).toBe("flyer");
    expect(captureSrc("?src=trainer-mike", store)).toBe("flyer");
    expect(readStoredSrc(store)).toBe("flyer");
  });

  it("does not store an invalid src", () => {
    const store = memoryStore();
    expect(captureSrc("?src=../etc", store)).toBeNull();
    expect(store.data[SRC_STORAGE_KEY]).toBeUndefined();
  });

  it("adds src to the signup body only when one is stored", () => {
    const empty = memoryStore();
    expect(signupFormBody("you@gym.com", empty).toString()).toBe("email=you%40gym.com");

    const tagged = memoryStore({ [SRC_STORAGE_KEY]: "trainer-mike" });
    const body = signupFormBody("you@gym.com", tagged);
    expect(body.get("email")).toBe("you@gym.com");
    expect(body.get("src")).toBe("trainer-mike");

    const junk = memoryStore({ [SRC_STORAGE_KEY]: "has a space" });
    expect(signupFormBody("you@gym.com", junk).has("src")).toBe(false);
  });
});
