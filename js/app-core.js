// ── App-switch slot (native Android wrapper only) ──────────────────────────
if (window.AndroidBridge) {
    document.getElementById('appSwitchSlot').innerHTML = `
        <div class="app-switch">
          <button class="app-switch__btn" type="button" id="switchToRankMaster">
            <img src="/rank-master-logo.png" alt="">Rank Master
          </button>
          <button class="app-switch__btn app-switch__btn--active" type="button" disabled>
            <img src="/logo.png" alt="">Mock Matrix
          </button>
        </div>`;
    document.getElementById('switchToRankMaster').addEventListener('click', () => {
        window.AndroidBridge.switchToRankMaster();
    });
}

        function toggleSidebar() {
            const sb = document.getElementById('appSidebar');
            const ov = document.getElementById('sidebarOverlay');
            sb.classList.toggle('show');
            ov.style.display = sb.classList.contains('show') ? 'block' : 'none';
        }

        // ===== REFACTORED DOMAIN-WIDE DARK MODE TOGGLE =====
function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    const newTheme = isDark ? 'dark' : 'light';
    
    // Write state synchronization parameters across cross-page files
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('mmh_theme', newTheme);
    
    // Swap dynamic icon presentation parameters natively
    const toggleBtn = document.getElementById('darkModeToggle');
    if (toggleBtn) {
        toggleBtn.textContent = isDark ? '☀️' : '🌙';
    }
}

// Ensure parsing routines apply configuration vectors immediately on render execution
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('mmh_theme') || 'light';
    const isDark = savedTheme === 'dark';
    
    if (isDark) {
        document.body.classList.add('dark-mode');
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.body.classList.remove('dark-mode');
        document.documentElement.setAttribute('data-theme', 'light');
    }
    
    // Set matching top bar icon display parameters
    const toggleBtn = document.getElementById('darkModeToggle');
    if (toggleBtn) {
        toggleBtn.textContent = isDark ? '☀️' : '🌙';
    }

    // Refresh application profile components
    refreshAppUI();
});


// Content is now config-driven (data/home-config.json) via home-engine.js;
// this keeps the exact same trigger point (paid users, on profile load).
function checkTelegramPopup() {
    if (window.HOME_CONFIG && window.HOME_CONFIG.popup) {
        renderPopup(window.HOME_CONFIG.popup);
    }
}

function closeTgPopup() {
    if (window.HOME_CONFIG && window.HOME_CONFIG.popup) {
        closeHomePopup(window.HOME_CONFIG.popup.id);
    }
}
        

        function updateUI(profile) {
            if (!profile) return;
            document.documentElement.classList.remove('user-is-logged-in');
            document.getElementById('authHeaderArea').style.visibility = "visible";
            document.getElementById('authHeaderArea').style.opacity = "1";
            
            const username = profile.username || 'Aspirant';
            document.getElementById('sidebarUserName').innerText = username;
            document.getElementById('userGreetName').innerText = username;
            document.getElementById('logoutArea').classList.remove('hidden');
            if(profile.is_paid) {
        document.getElementById('sidebarPlanBadge').innerHTML = '<span class="badge-pro"><i class="fas fa-crown me-1"></i>PRO USER</span>';
        document.getElementById('buyPremiumArea').classList.add('hidden');

                        // NEW: Trigger the Popup check
        checkTelegramPopup();

        
        // SHOW THE PRIVATE CHANNEL BUTTON HERE
        if(document.getElementById('privateChannelArea')) {
            document.getElementById('privateChannelArea').classList.remove('hidden');
        }
    } else {
        document.getElementById('sidebarPlanBadge').innerHTML = '<span class="badge bg-secondary" style="font-size:10px">FREE PLAN</span>';
        document.getElementById('buyPremiumArea').classList.remove('hidden');
        
        // HIDE IT FOR FREE USERS
        if(document.getElementById('privateChannelArea')) {
            document.getElementById('privateChannelArea').classList.add('hidden');
        }
    }
          
            if(['admin', 'owner', 'subowner'].includes(profile.role)) document.getElementById('adminLinkArea').classList.remove('hidden');

            // Partner status now lives in the coupons table (profiles.is_partner was removed).
            if (profile.id) {
                _supabase.from('coupons').select('code').eq('owner_user_id', profile.id).eq('is_active', true).maybeSingle()
                    .then(({ data: activeCoupon }) => {
                        if (activeCoupon) {
                            document.getElementById('partnerLinkArea').classList.remove('hidden');
                            document.getElementById('partnerApplyArea').classList.add('hidden');
                        }
                    });
            }
            document.getElementById('authHeaderArea').innerHTML = `<div onclick="toggleSidebar()" style="width:38px; height:38px; background:var(--primary-light); color:var(--primary); border-radius:12px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-weight:800; border:2px solid var(--primary); font-size:14px;">${username.charAt(0).toUpperCase()}</div>`;
        }

        // Banner slider (state + moveSlide()) now lives in js/home-engine.js

// 1. Function to handle the UI refresh logic
function refreshAppUI() {
    const p = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    if (p) {
        updateUI(p);
        document.documentElement.classList.add('user-is-logged-in');
    } else {
        document.documentElement.classList.remove('user-is-logged-in');
    }
}

// 2. Run on initial page load
document.addEventListener('DOMContentLoaded', () => {
    // Handle theme
    if (localStorage.getItem('mmh_theme') === 'dark') document.body.classList.add('dark-mode');
    
    // Check if profile already exists in localStorage
    refreshAppUI();
});

// 3. Listen for the "Handshake" from auth.js (Instant Login Update)
window.addEventListener('profileUpdated', () => {
    refreshAppUI();
});

// 4. Handle Back/Forward browser navigation
window.addEventListener('pageshow', (event) => {
    refreshAppUI();
});
        
// What's New ticker logic now lives in js/home-engine.js (loadWhatsNew(),
// formatWhatsNewDate(), startMarqueeRow()) — no changes needed here.

// ---------------------------------------------------------------
// Recover from a killed tab mid-payment: if buy-premium.html set a
// pending flag before opening the Razorpay modal, force one fresh
// profile fetch here so premium status isn't stuck showing stale
// (cached) data for up to 7 days. Runs once on initial load, and
// again every time the page becomes visible (tab switch back,
// browser bfcache restore) — see the pageshow/visibilitychange
// listeners below.
// ---------------------------------------------------------------
async function checkPendingPayment() {
    const raw = localStorage.getItem('mmh_payment_pending');
    if (!raw) return;

    let pending;
    try { pending = JSON.parse(raw); } catch (e) { localStorage.removeItem('mmh_payment_pending'); return; }

    const oneHour = 60 * 60 * 1000;
    if (!pending.ts || Date.now() - pending.ts > oneHour) {
        localStorage.removeItem('mmh_payment_pending'); // give up, likely abandoned
        return;
    }

    try {
        const { data: userData } = await _supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) return;

        const { data: profile } = await _supabase
            .from('profiles')
            .select('is_paid, expires_at')
            .eq('id', userId)
            .maybeSingle();

        if (profile && profile.is_paid) {
            const cached = getLocalProfile() || {};
            saveLocalProfile({ ...cached, is_paid: true, expires_at: profile.expires_at });
            localStorage.removeItem('mmh_payment_pending');
            refreshAppUI(); // reflect the now-unlocked premium status immediately
        }
        // else: leave the flag in place, will retry on next visibility/pageshow
    } catch (e) {
        // silent — will retry on next visibility/pageshow
    }
}

// Initial run on script load (covers the killed-tab-then-reloaded case)
checkPendingPayment();

// Re-run every time the tab becomes visible again — covers the
// stays-alive-but-backgrounded case (user pays in a UPI app, switches
// back to this same tab) which a one-time load-time check misses.
window.addEventListener('pageshow', () => checkPendingPayment());
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkPendingPayment();
});

let deferredPrompt;
const installModal = document.getElementById('pwaInstallModal');
const sidebarBtn = document.getElementById('sidebarInstallBtn');

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  
  // Show the Sidebar button
  if(sidebarBtn) sidebarBtn.style.display = 'block';

  // Check if we have already shown the popup this session to avoid annoyance
  if (!sessionStorage.getItem('pwaPromptShown')) {
    setTimeout(() => {
      installModal.style.display = 'flex';
      sessionStorage.setItem('pwaPromptShown', 'true');
    }, 3000); // Show after 3 seconds
  }
});

// Handle the "Install" button in the modal or sidebar
const triggerInstall = async () => {
  if (!deferredPrompt) return;
  
  installModal.style.display = 'none';
  deferredPrompt.prompt();
  
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    console.log('User accepted the install prompt');
    if(sidebarBtn) sidebarBtn.style.display = 'none';
  }
  deferredPrompt = null;
};

document.getElementById('doInstall').onclick = triggerInstall;
if(sidebarBtn) sidebarBtn.onclick = triggerInstall;

// Cancel button
document.getElementById('closeInstall').onclick = () => {
  installModal.style.display = 'none';
};

// Hide UI if installed
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installModal.style.display = 'none';
  if(sidebarBtn) sidebarBtn.style.display = 'none';
});
        // ============================================================
// MOCK MATRIX HUB — Notifications (Service Worker + Push + Bell)
// ============================================================
const NOTIFY_API_BASE = 'https://mmh-notify-worker.mockmatrixsupport.workers.dev';

let swRegistration = null;

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((reg) => {
                console.log('Service worker registered:', reg.scope);
                swRegistration = reg;
                if (Notification.permission === 'granted') {
                    initPushSubscription(reg);
                }
            })
            .catch((err) => console.error('SW registration failed:', err));
    });
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function initPushSubscription(registration) {
    if (!('PushManager' in window)) return;
    if (Notification.permission === 'denied') return;

    try {
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            const keyRes = await fetch(`${NOTIFY_API_BASE}/api/notify/vapid-key`);
            const { publicKey } = await keyRes.json();

            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });
        }

        const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
        await fetch(`${NOTIFY_API_BASE}/api/notify/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subscription: subscription.toJSON(),
                user_id: profile ? profile.id || profile.user_id || null : null
            })
        });
    } catch (err) {
        console.error('Push subscription failed:', err);
    }
}


function handleBellTap(event) {
    if (!('Notification' in window)) return;

    const currentPermission = Notification.permission;

    if (currentPermission === 'granted') {
        if (swRegistration) initPushSubscription(swRegistration);
        return;
    }

    if (currentPermission === 'denied') {
        showPermissionBlockedNotice();
        return;
    }

    Notification.requestPermission().then((permission) => {
        if (permission === 'granted' && swRegistration) {
            initPushSubscription(swRegistration);
        }
    });
}

function showPermissionBlockedNotice() {
    if (window.__mmhPermissionNoticeShown) return;
    window.__mmhPermissionNoticeShown = true;

    alert(
        'Notifications are blocked for this site in your browser settings.\n\n' +
        'To enable them: open your browser settings → Site settings → Notifications, ' +
        'find this site, and set it to "Allow".'
    );
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.notif-bell-wrap, a[href="/notifications.html"]').forEach(el => {
        el.addEventListener('click', handleBellTap);
    });
});


async function refreshNotificationBadge() {
    try {
        const res = await fetch(`${NOTIFY_API_BASE}/api/notify/list?limit=11`);
        const data = await res.json();
        const list = data.notifications || [];
        if (list.length === 0) return;

        const lastSeenId = parseInt(localStorage.getItem('mmh_last_seen_notif_id') || '0', 10);
        const unreadCount = list.filter(n => n.id > lastSeenId).length;

        const displayValue = unreadCount > 10 ? '10+' : String(unreadCount);
        const dots = document.querySelectorAll('.notif-badge-dot');

        dots.forEach(el => {
            if (unreadCount > 0) {
                el.textContent = displayValue;
                el.style.display = 'flex';
            } else {
                el.style.display = 'none';
            }
        });
    } catch (err) {
        console.error('Failed to refresh notification badge:', err);
    }
}

document.addEventListener('DOMContentLoaded', refreshNotificationBadge);
window.addEventListener('pageshow', refreshNotificationBadge);
        
        


// -----------------------------------------------------------
// Mobile number backfill — only for existing users who signed
// up before the mobile field existed. New signups already
// provide it, so this naturally stops firing once everyone's
// backfilled.
// -----------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
  if (!profile || !profile.id) return;
  if (profile.mobile) return; // already has one

  const overlay = document.getElementById('mobilePromptOverlay');
  if (!overlay) return;
  overlay.classList.add('active');

  document.getElementById('mobilePromptSubmit').addEventListener('click', async () => {
    const input = document.getElementById('mobilePromptInput');
    const msgEl = document.getElementById('mobilePromptMsg');
    const mobile = input.value.trim();

    if (!/^[0-9]{10}$/.test(mobile)) {
      msgEl.textContent = "Enter a valid 10-digit mobile number.";
      return;
    }

    const { error } = await _supabase.from('profiles').update({ mobile }).eq('id', profile.id);
    if (error) {
      msgEl.textContent = "Error: " + error.message;
      return;
    }

    // Save to local cache immediately, as requested — no need to
    // wait for the next full profile refetch to reflect it.
    const cached = getLocalProfile() || {};
    saveLocalProfile({ ...cached, mobile });

    overlay.classList.remove('active');
  });
});

