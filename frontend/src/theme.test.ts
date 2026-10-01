import { describe, expect, it, vi } from "vitest";
import html from "../index.html?raw";
import {
  createThemeStore,
  resolveTheme,
  themePreference,
  THEME_STORAGE_KEY,
} from "./themePreference";

function environment({
  stored = null,
  dark = false,
  blocked = false,
}: {
  stored?: string | null;
  dark?: boolean;
  blocked?: boolean;
} = {}) {
  const values = new Map(stored ? [[THEME_STORAGE_KEY, stored]] : []);
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  const root = {
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  };
  const meta = {
    content: "",
    setAttribute(_key: string, value: string) {
      this.content = value;
    },
  };
  const media = Object.assign(new EventTarget(), { matches: dark });
  const browser = Object.assign(new EventTarget(), {
    matchMedia: () => media,
    document: { documentElement: root, querySelector: () => meta },
  });
  Object.defineProperty(browser, "localStorage", {
    configurable: true,
    get() {
      if (blocked) throw new Error("SecurityError");
      return storage;
    },
  });
  return {
    browser: browser as unknown as Window,
    root,
    media,
    meta,
    storage,
    values,
    system(dark: boolean) {
      media.matches = dark;
      media.dispatchEvent(new Event("change"));
    },
    storageEvent(value: string | null, key: string | null = THEME_STORAGE_KEY) {
      browser.dispatchEvent(
        Object.assign(new Event("storage"), {
          key,
          newValue: value,
          storageArea: storage,
        }),
      );
    },
  };
}

describe("theme preference", () => {
  it("uses the device setting unless a valid light/dark choice exists", () => {
    expect(themePreference("dark")).toBe("dark");
    expect(themePreference("light")).toBe("light");
    for (const value of [null, "system", "invalid", "DARK"])
      expect(themePreference(value)).toBe("system");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("applies saved appearance, native controls, and browser chrome on initialization", () => {
    const env = environment({ stored: "dark" });
    createThemeStore(env.browser);
    expect(env.root.dataset.theme).toBe("dark");
    expect(env.root.style.colorScheme).toBe("dark");
    expect(env.root.style.backgroundColor).toBe("#151e1b");
    expect(env.meta.content).toBe("#151e1b");
  });
  it("follows system changes until a choice, and resumes after resetting to system", () => {
    const env = environment();
    const store = createThemeStore(env.browser);
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    env.system(true);
    expect(store.getSnapshot()).toEqual({
      preference: "system",
      theme: "dark",
    });
    store.setPreference("light");
    env.system(false);
    env.system(true);
    expect(store.getSnapshot()).toEqual({
      preference: "light",
      theme: "light",
    });
    expect(env.values.get(THEME_STORAGE_KEY)).toBe("light");
    store.setPreference("system");
    expect(env.values.has(THEME_STORAGE_KEY)).toBe(false);
    expect(store.getSnapshot().theme).toBe("dark");
    unsubscribe();
    changed.mockClear();
    env.system(false);
    expect(changed).not.toHaveBeenCalled();
  });
  it("syncs other tabs and resets on clearing storage, ignoring unrelated settings", () => {
    const env = environment({ dark: true });
    const store = createThemeStore(env.browser);
    const unsubscribe = store.subscribe(() => {});
    env.storageEvent("light");
    expect(store.getSnapshot().theme).toBe("light");
    env.storageEvent("dark", "unrelated");
    expect(store.getSnapshot().theme).toBe("light");
    env.storageEvent(null, null);
    expect(store.getSnapshot()).toEqual({
      preference: "system",
      theme: "dark",
    });
    unsubscribe();
  });
  it("retains the current choice when writing storage fails", () => {
    const env = environment();
    env.storage.setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    env.storage.removeItem.mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const store = createThemeStore(env.browser);
    expect(() => store.setPreference("dark")).not.toThrow();
    expect(store.getSnapshot().theme).toBe("dark");
    expect(() => store.setPreference("system")).not.toThrow();
    expect(store.getSnapshot().theme).toBe("light");
  });
  it("does not crash when localStorage itself is inaccessible", () => {
    const env = environment({ dark: true });
    Object.defineProperty(env.browser, "localStorage", {
      get() {
        throw new Error("SecurityError");
      },
    });
    const store = createThemeStore(env.browser);
    expect(store.getSnapshot().theme).toBe("dark");
    expect(() => store.setPreference("light")).not.toThrow();
    expect(store.getSnapshot().theme).toBe("light");
  });
  it("keeps a stable snapshot when the resolved theme did not change", () => {
    const env = environment({ stored: "light" });
    const store = createThemeStore(env.browser);
    const before = store.getSnapshot();
    store.setPreference("light");
    expect(store.getSnapshot()).toBe(before);
  });
});

describe("pre-paint theme bootstrap", () => {
  const source = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const initialize = new Function(
    "localStorage",
    "matchMedia",
    "document",
    source,
  );
  it.each([
    ["light", true, "light"],
    ["dark", false, "dark"],
    [null, true, "dark"],
    [null, false, "light"],
    ["invalid", true, "dark"],
  ])(
    "initializes %s with system dark=%s as %s before React",
    (stored, dark, expected) => {
      const env = environment({
        stored: stored as string | null,
        dark: dark as boolean,
      });
      initialize(env.storage, env.browser.matchMedia, env.browser.document);
      expect(env.root.dataset.theme).toBe(expected);
      expect(env.root.style.colorScheme).toBe(expected);
    },
  );
  it("falls back to system appearance when storage throws", () => {
    const env = environment({ dark: true });
    env.storage.getItem.mockImplementation(() => {
      throw new Error("SecurityError");
    });
    initialize(env.storage, env.browser.matchMedia, env.browser.document);
    expect(env.root.dataset.theme).toBe("dark");
  });
});
