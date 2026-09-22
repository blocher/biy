import { api } from "./api";
import {
  clearNotificationSetupDismissal,
  dismissNotificationSetup,
} from "./notificationSetup";

export type PushDevice = {
  id: number;
  endpoint: string;
  device_name: string;
  created_at: string;
  last_seen_at: string;
};

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let pendingInstall: InstallPrompt | null = null;
const installListeners = new Set<() => void>();
const installedListeners = new Set<() => void>();

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  pendingInstall = event as InstallPrompt;
  installListeners.forEach((listener) => listener());
});

window.addEventListener("appinstalled", () => {
  pendingInstall = null;
  installListeners.forEach((listener) => listener());
  installedListeners.forEach((listener) => listener());
});

export function onInstallPromptChange(listener: () => void) {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}

export function onAppInstalled(listener: () => void) {
  installedListeners.add(listener);
  return () => {
    installedListeners.delete(listener);
  };
}

export function canPromptInstall() {
  return pendingInstall !== null;
}

export async function promptInstall() {
  if (!pendingInstall) return false;
  await pendingInstall.prompt();
  const result = await pendingInstall.userChoice;
  pendingInstall = null;
  installListeners.forEach((listener) => listener());
  return result.outcome === "accepted";
}

export function isInstalled() {
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    (import.meta.env.DEV &&
      new URLSearchParams(window.location.search).has("installed-preview")) ||
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

export function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function pushSupported() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

function deviceName() {
  const agent = navigator.userAgent;
  const device = /iPhone/.test(agent)
    ? "iPhone"
    : /iPad/.test(agent)
      ? "iPad"
      : /Android/.test(agent)
        ? "Android"
        : /Mac/.test(agent)
          ? "Mac"
          : /Windows/.test(agent)
            ? "Windows"
            : "device";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser";
  return `${browser} on ${device}`;
}

export async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function enablePush() {
  if (!pushSupported())
    throw new Error("This browser does not support push notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("Notification permission was not granted.");
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const { public_key } = await api<{ public_key: string }>(
      "/push/public-key",
    );
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(public_key),
    });
  }
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth)
    throw new Error(
      "The browser returned an incomplete notification subscription.",
    );
  await api("/push/subscriptions", "POST", {
    endpoint: serialized.endpoint,
    p256dh: serialized.keys.p256dh,
    auth: serialized.keys.auth,
    device_name: deviceName(),
  });
  clearNotificationSetupDismissal();
  return subscription;
}

export async function disableCurrentPush(subscription: PushSubscription) {
  await api("/push/subscriptions", "DELETE", {
    endpoint: subscription.endpoint,
  });
  await subscription.unsubscribe();
  dismissNotificationSetup();
}
