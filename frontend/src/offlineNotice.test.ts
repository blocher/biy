import { afterEach, describe, expect, it, vi } from "vitest";
import { noticeKey, readDismissals, saveDismissal } from "./offlineNotice";

const ready = {
  availability: { bible: true, catechism: true },
  ready: true,
  busy: false,
  error: null,
  total: 8,
  version: "catalog-1",
};
afterEach(() => vi.unstubAllGlobals());

describe("offline notice dismissal", () => {
  it("persists by account and tolerates damaged or unavailable storage", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const key = noticeKey(ready);
    saveDismissal("ben", [], key);
    expect(readDismissals("ben")).toEqual([key]);
    expect(readDismissals("other")).toEqual([]);
    values.set("biy-offline-notices-v1-ben", "broken");
    expect(readDismissals("ben")).toEqual([]);
    values.set("biy-offline-notices-v1-ben", '[1,"valid",null]');
    expect(readDismissals("ben")).toEqual(["valid"]);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("denied");
      },
      setItem: () => {
        throw Error("denied");
      },
    });
    expect(readDismissals("ben")).toEqual([]);
    expect(saveDismissal("ben", [], key)).toEqual([key]);
  });

  it("surfaces changed editions, catalogs, plan size and errors, with stable preparation keys", () => {
    const key = noticeKey(ready);
    for (const changes of [
      { version: "catalog-2" },
      { total: 9 },
      { availability: { bible: true, catechism: false } },
      { error: "Storage full", ready: false },
    ])
      expect(noticeKey({ ...ready, ...changes })).not.toEqual(key);
    expect(noticeKey({ ...ready, busy: true, total: 3 })).toEqual(
      noticeKey({
        ...ready,
        busy: true,
        total: 5,
        error: "earlier error",
        version: "other",
      }),
    );
    expect(noticeKey({ ...ready, error: "Storage full" })).not.toEqual(
      noticeKey({ ...ready, error: "Reconnect" }),
    );
  });

  it("deduplicates and bounds history so repeated visits do not grow storage", () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    let keys: string[] = [];
    for (let i = 0; i < 30; i++) keys = saveDismissal("ben", keys, String(i));
    expect(keys).toHaveLength(20);
    expect(saveDismissal("ben", keys, "29")).toEqual(keys);
  });
});
