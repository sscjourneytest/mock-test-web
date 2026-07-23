// --- Domain migration: pages.dev -> mockmatrixhub.in ---
// Add this ONLY in the pages.dev repo's auth.js (top of file, before PROXY_URL).
// Nothing needs to be added to the mockmatrixhub.in repo at all.
(function() {
    if (window.location.hostname !== 'mockmatrixhub.pages.dev') return;

    const isPWA = window.matchMedia('(display-mode: standalone)').matches
                  || window.navigator.standalone === true;

    const newUrl = "https://mockmatrixhub.in" + window.location.pathname + window.location.search;

    if (isPWA) {
        // Installed app — show full install dialog (can't auto-redirect an installed PWA)
        window.addEventListener('DOMContentLoaded', function() {
            const style = document.createElement('style');
            style.textContent = `
                @keyframes mmh-pop-in {
                    from { transform: scale(0.9); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .mmh-migrate-overlay {
                    position: fixed; inset: 0; background: rgba(15, 23, 42, 0.75);
                    backdrop-filter: blur(3px); z-index: 999998;
                    display: flex; align-items: center; justify-content: center; padding: 20px;
                }
                .mmh-migrate-card {
                    background: white; border-radius: 24px; max-width: 380px; width: 100%;
                    padding: 28px 24px; text-align: center;
                    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
                    font-family: 'Poppins', -apple-system, sans-serif;
                    animation: mmh-pop-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                }
                .mmh-migrate-icon-badge {
                    width: 64px; height: 64px; margin: 0 auto 16px; border-radius: 18px;
                    background: linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%);
                    display: flex; align-items: center; justify-content: center;
                    font-size: 32px; box-shadow: 0 10px 20px rgba(37, 99, 235, 0.3);
                }
                .mmh-migrate-title { font-weight: 800; font-size: 19px; color: #0f172a; margin: 0 0 8px 0; }
                .mmh-migrate-sub { font-size: 13.5px; color: #64748b; margin: 0 0 20px 0; line-height: 1.5; }
                .mmh-migrate-steps {
                    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px;
                    padding: 14px 16px; text-align: left; margin-bottom: 20px;
                }
                .mmh-migrate-step { display: flex; align-items: flex-start; gap: 10px; font-size: 12.5px; color: #334155; padding: 6px 0; line-height: 1.4; }
                .mmh-migrate-step-num {
                    flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
                    background: #2563eb; color: white; font-size: 11px; font-weight: 800;
                    display: flex; align-items: center; justify-content: center;
                }
                .mmh-migrate-btn-primary {
                    display: block; width: 100%;
                    background: linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%);
                    color: white; font-weight: 700; font-size: 15px; padding: 14px;
                    border-radius: 12px; text-decoration: none;
                    box-shadow: 0 8px 20px rgba(37, 99, 235, 0.35);
                    box-sizing: border-box; margin-bottom: 10px; border: none;
                }
                .mmh-migrate-later { display: block; width: 100%; background: transparent; color: #94a3b8; font-weight: 600; font-size: 13px; padding: 8px; border: none; cursor: pointer; }
            `;
            document.head.appendChild(style);

            const overlay = document.createElement('div');
            overlay.className = 'mmh-migrate-overlay';
            overlay.innerHTML = `
                <div class="mmh-migrate-card">
                    <div class="mmh-migrate-icon-badge">🚀</div>
                    <p class="mmh-migrate-title">A New, Updated App Is Here!</p>
                    <p class="mmh-migrate-sub">Please install our latest official app to keep getting new features and updates. This old version will stop receiving updates soon.</p>
                    <div class="mmh-migrate-steps">
                        <div class="mmh-migrate-step"><div class="mmh-migrate-step-num">1</div><div>Tap <b>"Install New App"</b> below and add it to your home screen</div></div>
                        <div class="mmh-migrate-step"><div class="mmh-migrate-step-num">2</div><div>Open the <b>new app</b> from your home screen and log in again</div></div>
                        <div class="mmh-migrate-step"><div class="mmh-migrate-step-num">3</div><div>Delete this old app icon — long-press it and choose <b>Remove / Uninstall</b></div></div>
                    </div>
                    <a href="${newUrl}" class="mmh-migrate-btn-primary">Install New App</a>
                    <button class="mmh-migrate-later" id="mmh-migrate-later">Remind me later</button>
                </div>
            `;
            document.body.appendChild(overlay);
            document.getElementById('mmh-migrate-later').addEventListener('click', () => overlay.remove());
        });
    } else {
        // Normal browser tab — show a brief "switching you" toast, THEN redirect.
        // This all happens on pages.dev itself, so .in repo needs zero changes.
        window.addEventListener('DOMContentLoaded', function() {
            const style = document.createElement('style');
            style.textContent = `
                @keyframes mmh-toast-in {
                    from { transform: translate(-50%, -20px); opacity: 0; }
                    to { transform: translate(-50%, 0); opacity: 1; }
                }
                .mmh-switch-toast {
                    position: fixed; top: 16px; left: 50%;
                    background: #0f172a; color: white;
                    padding: 12px 18px; border-radius: 50px;
                    display: flex; align-items: center; gap: 10px;
                    font-family: 'Poppins', -apple-system, sans-serif;
                    font-size: 13px; font-weight: 600;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.25);
                    z-index: 999999;
                    animation: mmh-toast-in 0.35s ease-out;
                    white-space: nowrap;
                }
                .mmh-switch-toast-spinner {
                    width: 14px; height: 14px; border-radius: 50%;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-top-color: #60a5fa;
                    animation: mmh-spin 0.6s linear infinite;
                    flex-shrink: 0;
                }
                @keyframes mmh-spin { to { transform: rotate(360deg); } }
            `;
            document.head.appendChild(style);

            const toast = document.createElement('div');
            toast.className = 'mmh-switch-toast';
            toast.innerHTML = `<span class="mmh-switch-toast-spinner"></span> Switching you to our new official website...`;
            document.body.appendChild(toast);

            setTimeout(() => {
                window.location.replace(newUrl);
            }, 1200);
        });
    }
})();



const PROXY_URL = 'https://mmh-vault-2.mockmatrixhub.workers.dev';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1cW1lanl5cHFna3JqbHBwbHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDIyNTAsImV4cCI6MjA4NzE3ODI1MH0.aAIITdr-BS-D-TJHY1fEkqgN4CRVwsyz90d2I9IrhVc';

let _supabase = null;

async function getClient() {
    if (_supabase) return _supabase;
    _supabase = supabase.createClient(PROXY_URL, SUPABASE_KEY);
    return _supabase;
}

const SECRET_SALT = "mmh_vault_key_99";

/**
 * Fetches (and caches) the full profile for a logged-in user.
 * Used both by initAuth() and by login.html's login/signup flows so that
 * nobody gets redirected to another page before their profile data
 * has actually arrived.
 * Returns the profile object on success, or null if it could not be loaded.
 */
async function fetchAndCacheProfile(client, user) {
    // 1. BACKGROUND SYNC: If user has a pending request, check status automatically
    if (localStorage.getItem('pending_premium_request') === 'true') {
        await syncPendingPremiumStatus(client, user.email);
    }

    let profile = getLocalProfile();
    const urlParams = new URLSearchParams(window.location.search);
    const forceFetch = urlParams.get('type') === 'recovery' || !profile;

    // 2. CACHE MANAGEMENT: Fetch profile if missing or expired
    if (forceFetch || isCacheExpired()) {
        try {
            const { data: dbProfile } = await client.from('profiles').select('*').eq('id', user.id).single();
            if (dbProfile) {
                profile = { ...dbProfile, email: user.email };
                saveLocalProfile(profile);
            } else if (!profile) {
                return null; // nothing cached and nothing fetched = failure
            }
        } catch (e) {
            if (!profile) return null;
        }
    }

    return profile;
}

/**
 * Works out where to send the user after they finish logging in / registering.
 * Priority: explicit ?redirect= param (the page that bounced them to login) >
 * same-origin referrer (if it isn't the login page itself) > home page.
 */
function getSafeRedirectTarget() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('redirect');
    if (raw) {
        try {
            const decoded = decodeURIComponent(raw);
            // Only allow internal, same-site paths (never redirect off-site)
            if (decoded.startsWith('/') && !decoded.startsWith('//')) {
                return decoded;
            }
        } catch (e) {}
    }

    if (document.referrer) {
        try {
            const refUrl = new URL(document.referrer);
            if (refUrl.origin === window.location.origin && !refUrl.pathname.endsWith('login.html')) {
                return refUrl.pathname + refUrl.search;
            }
        } catch (e) {}
    }

    return "/index.html";
}

async function initAuth() {
    const client = await getClient();
    const { data: { user } } = await client.auth.getUser();
    const path = window.location.pathname;

        const isLoginPage = path.endsWith("login.html") || path.endsWith("/login");
    const isHomePage = path === "/" || path.endsWith("index.html") || path.endsWith("/index");
    const isPricingPage = path.endsWith("pricing.html") || path.endsWith("/pricing");
    const isPublicPage = isLoginPage || isHomePage || isPricingPage;
    
    

    if (user) {
        // Fetch the full profile and WAIT for it before doing anything that
        // depends on it (like leaving the login page).
        const profile = await fetchAndCacheProfile(client, user);

        // VARIABLE EXPOSURE: Extracting required data for other page functions
        const username = profile ? profile.username : "User";
        const isPaid = profile ? profile.is_paid : false;
        const isAdmin = profile ? profile.role === 'admin' : false;
        const isPartner = profile ? profile.is_partner : false;
        const expiryDate = profile && profile.expires_at ? new Date(profile.expires_at) : null;
        
        let daysLeft = 0;
        if (expiryDate) {
            daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
        }

        // (Note: UI rendering logic moved to individual index.html files)

        if (isLoginPage) {
            if (profile) {
                // Profile confirmed loaded — safe to leave the login page now.
                window.location.href = getSafeRedirectTarget();
            } else {
                // Profile failed to load — stay put and let the login page know.
                window.dispatchEvent(new Event('profileLoadFailed'));
            }
        }

    } else {
        if (!isPublicPage) {
            const returnTo = path + window.location.search;
            window.location.href = "/login.html?redirect=" + encodeURIComponent(returnTo);
        }
    }
}

/**
 * Background Sync Logic: Checks if a pending payment has been approved
 */
async function syncPendingPremiumStatus(client, email) {
    const { data } = await client.from('payment_requests')
        .select('status')
        .eq('email', email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (data && data.status === 'success') {
        const { data: dbProfile } = await client.from('profiles').select('*').eq('email', email).single();
        if (dbProfile) {
            const profile = { ...dbProfile, email: email, is_paid: true };
            saveLocalProfile(profile);
            localStorage.removeItem('pending_premium_request');
            location.reload(); // Refresh to update premium UI across the site
        }
    } else if (data && data.status === 'rejected') {
        localStorage.removeItem('pending_premium_request');
    }
}

function saveLocalProfile(data) {
    const payload = { ...data, cache_expiry: Date.now() + (7 * 24 * 60 * 60 * 1000) };
    const encrypted = btoa(JSON.stringify(payload) + SECRET_SALT);
    localStorage.setItem('u_vault', encrypted);
    
    // ADD THIS LINE: It tells index.html to update RIGHT NOW
    window.dispatchEvent(new Event('profileUpdated'));
}


function getLocalProfile() {
    const raw = localStorage.getItem('u_vault');
    if (!raw) return null;
    try {
        const decrypted = atob(raw).replace(SECRET_SALT, '');
        const data = JSON.parse(decrypted);
        return {
            username: "User",
            email: "",
            is_paid: false,
            is_partner: false,
            ...data
        };
    } catch (e) { return null; }
}

function isCacheExpired() {
    const p = getLocalProfile();
    return !p || !p.cache_expiry || Date.now() > p.cache_expiry;
}

async function handleChangePassword() {
    const client = await getClient();
    const { data: { user } } = await client.auth.getUser();
    if (user) {
        const { error } = await client.auth.resetPasswordForEmail(user.email, {
            redirectTo: window.location.origin + '/login.html?type=recovery',
        });
        alert(error ? "Error: " + error.message : "A password reset link has been sent to your Gmail!");
    }
}

async function handleLogout() {
    const client = await getClient();
    localStorage.removeItem('u_vault');
    localStorage.removeItem('mmh_guide_seen');
    // Clear all exam caches to keep data private
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('CLOUD_SYNC_')) localStorage.removeItem(key);
        });
        await client.auth.signOut();
        window.location.href = "/index.html?v=" + Date.now(); // Force fresh load
   
}


// Keep this for the very first initial load
document.addEventListener('DOMContentLoaded', initAuth);

