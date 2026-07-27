// fcm-init.js — include this on pages where you want notification
// opt-in to happen (e.g. right after the existing bell-icon click
// handler, or on first visit). Requires firebase-messaging-sw.js to
// be registered at the site root.
//
// Replaces the old NOTIFY_API_BASE push.js/VAPID subscription flow —
// this now talks to Firebase directly for the token, and only calls
// the Worker once, to subscribe that token to the shared topic.

const NOTIFY_API_BASE = "https://mmh-notify-worker.mockmatrixsupport.workers.dev";

const firebaseConfig = {
  apiKey: "AIzaSyCgAWKBUl_wx7mIk72kVuj1gDlW2S_tEF0",
  authDomain: "mmh-notifications.firebaseapp.com",
  projectId: "mmh-notifications",
  storageBucket: "mmh-notifications.firebasestorage.app",
  messagingSenderId: "727759392578",
  appId: "1:727759392578:web:9c95f613cc17348b7e02db",
};

const FCM_VAPID_KEY = "BMwvOpIo5KmuolDOcKdy2OAZ3ehiVS2LtmnbzLFdRxvnzXmZgqwmWCyjWx5tr9gPFBlzx_oiPz1oRHSC-fmOmJo";

let fcmApp = null;
let fcmMessaging = null;

function loadFirebaseSdk() {
  return new Promise((resolve) => {
    if (window.firebase && firebase.messaging) return resolve();
    const s1 = document.createElement("script");
    s1.src = "https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js";
    s1.onload = () => {
      const s2 = document.createElement("script");
      s2.src = "https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js";
      s2.onload = resolve;
      document.head.appendChild(s2);
    };
    document.head.appendChild(s1);
  });
}

async function initFcmAndSubscribe() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return;

  if (Notification.permission === "denied") {
    console.warn("[fcm] Notifications blocked in browser settings.");
    return;
  }

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();

  if (permission !== "granted") return;

  await loadFirebaseSdk();

  if (!fcmApp) {
    fcmApp = firebase.initializeApp(firebaseConfig);
    fcmMessaging = firebase.messaging();
  }

  const swRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

  const token = await fcmMessaging.getToken({
    vapidKey: FCM_VAPID_KEY,
    serviceWorkerRegistration: swRegistration,
  });

  if (!token) {
    console.warn("[fcm] Could not get an FCM token.");
    return;
  }

  // Only re-subscribe if this is a new/changed token, to avoid hitting
  // the Worker on every single page load.
  const savedToken = localStorage.getItem("mmh_fcm_token");
  if (savedToken === token) return;

  const res = await fetch(`${NOTIFY_API_BASE}/api/fcm/subscribe-topic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (res.ok) {
    localStorage.setItem("mmh_fcm_token", token);
  } else {
    console.error("[fcm] Topic subscribe failed:", await res.text());
  }
}

// Handles a push arriving while a tab IS open and focused (background
// handler in the service worker covers the tab-not-focused case).
async function wireForegroundMessages() {
  if (!fcmMessaging) return;
  fcmMessaging.onMessage((payload) => {
    const title = payload.notification?.title || "Mock Matrix Hub";
    const body = payload.notification?.body || "";
    if (Notification.permission === "granted") {
      const n = new Notification(title, { body, icon: "/logo.png" });
      n.onclick = () => {
        window.focus();
        if (payload.data?.url) window.location.href = payload.data.url;
      };
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".notif-bell-wrap, a[href='/notifications.html']").forEach((el) => {
    el.addEventListener("click", async () => {
      await initFcmAndSubscribe();
      await wireForegroundMessages();
    });
  });
});
