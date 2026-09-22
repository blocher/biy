const NOTIFICATION_SETUP_DISMISSED_KEY =
  "biy-notification-setup-dismissed-on-this-device";

type LocalStore = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export function notificationSetupDismissed(store: LocalStore = localStorage) {
  return store.getItem(NOTIFICATION_SETUP_DISMISSED_KEY) === "true";
}

export function dismissNotificationSetup(store: LocalStore = localStorage) {
  store.setItem(NOTIFICATION_SETUP_DISMISSED_KEY, "true");
}

export function clearNotificationSetupDismissal(
  store: LocalStore = localStorage,
) {
  store.removeItem(NOTIFICATION_SETUP_DISMISSED_KEY);
}

export function shouldOfferNotificationSetup({
  installed,
  deviceChecked,
  deviceSubscribed,
  dismissed,
}: {
  installed: boolean;
  deviceChecked: boolean;
  deviceSubscribed: boolean;
  dismissed: boolean;
}) {
  return installed && deviceChecked && !deviceSubscribed && !dismissed;
}
