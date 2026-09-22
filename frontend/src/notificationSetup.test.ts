import { describe, expect, it } from "vitest";
import {
  clearNotificationSetupDismissal,
  dismissNotificationSetup,
  notificationSetupDismissed,
  shouldOfferNotificationSetup,
} from "./notificationSetup";

function store() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("per-device notification setup", () => {
  it("offers setup only to an installed, checked, unsubscribed device", () => {
    expect(
      shouldOfferNotificationSetup({
        installed: true,
        deviceChecked: true,
        deviceSubscribed: false,
        dismissed: false,
      }),
    ).toBe(true);
    expect(
      shouldOfferNotificationSetup({
        installed: false,
        deviceChecked: true,
        deviceSubscribed: false,
        dismissed: false,
      }),
    ).toBe(false);
    expect(
      shouldOfferNotificationSetup({
        installed: true,
        deviceChecked: true,
        deviceSubscribed: true,
        dismissed: false,
      }),
    ).toBe(false);
  });

  it("remembers and clears a dismissal only in the supplied device store", () => {
    const firstDevice = store();
    const newDevice = store();

    dismissNotificationSetup(firstDevice);
    expect(notificationSetupDismissed(firstDevice)).toBe(true);
    expect(notificationSetupDismissed(newDevice)).toBe(false);
    clearNotificationSetupDismissal(firstDevice);
    expect(notificationSetupDismissed(firstDevice)).toBe(false);
  });
});
