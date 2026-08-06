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
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attempts the profiles fetch up to `retries` times with a short backoff
 * between attempts (network blips, cold-start Worker, etc). Throws the
 * last error if every attempt fails. A "no row found" response is also
 * treated as a failure here (single() errors on 0 rows) so it goes
 * through the same retry path — cheap insurance in case it was actually
 * transient replication lag rather than a truly missing profile.
 */
async function fetchProfileWithRetry(client, userId, retries = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const { data, error } = await client.from('profiles').select('*').eq('id', userId).single();
            if (error) throw error;
            if (data) return data;
            throw new Error('Profile row not found');
        } catch (e) {
            lastError = e;
            if (attempt < retries) await sleep(attempt * 700); // 700ms, then 1400ms
        }
    }
    throw lastError;
}

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
            const dbProfile = await fetchProfileWithRetry(client, user.id, 3);

            // Partner status lives in the coupons table, not profiles.
            // Resolve it HERE — only when we're already doing a fresh
            // fetch (once per login / once every 7 days) — instead of
            // querying it separately on every page load.
            //
            // NOTE: an owner_user_id can have MORE THAN ONE active coupon
            // row (confirmed in production data). maybeSingle() throws
            // when a query matches more than one row, which was silently
            // failing here for those users and leaving is_partner=false
            // even though they do have active coupons. Using a plain
            // select + limit(1) instead — we only need to know whether
            // at least one active coupon exists, not fetch a single row.
            let isPartner = false;
            try {
                const { data: activeCoupons } = await client
                    .from('coupons')
                    .select('code')
                    .eq('owner_user_id', dbProfile.id)
                    .eq('is_active', true)
                    .limit(1);
                isPartner = !!(activeCoupons && activeCoupons.length > 0);
            } catch (e) {
                // Leave isPartner false on error; next cache refresh will retry.
            }

            const freshProfile = { ...dbProfile, email: user.email, is_partner: isPartner };
            saveLocalProfile(freshProfile);

            // GUARANTEE: never treat this as a successful load unless it's
            // actually readable back from localStorage. Protects against a
            // silent write failure (quota exceeded, private-browsing storage
            // caps, etc) where saveLocalProfile() ran but nothing actually
            // persisted — we don't want to hand back a "profile loaded"
            // result that isn't backed by cache.
            const verify = getLocalProfile();
            if (!verify || verify.id !== freshProfile.id) {
                throw new Error('Profile save to localStorage could not be verified');
            }

            // Only now — save confirmed — does this become "the" profile.
            profile = freshProfile;
        } catch (e) {
            console.error('Profile fetch failed after retries:', e);

            if (!profile) {
                // No cached fallback AND every retry failed (or the save
                // itself couldn't be verified) — the app can't safely treat
                // this as "logged in" (no username, no plan, no permissions).
                // Force a clean logout instead of leaving a half-authenticated
                // session dangling, and send them back to login.html with a
                // flag so it can show a clear retry message.
                await handleLogout('/login.html?authFailed=1');
                return null;
            }
            // A cached profile still exists (e.g. this was just a periodic
            // 7-day cache refresh that failed) — keep serving the stale
            // cached copy rather than logging the user out over it.
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

    // getSession() reads the locally persisted session (refreshing it only
    // if actually near expiry) instead of round-tripping to the auth server
    // on every page load like getUser() did. That extra network hop through
    // the Worker proxy was a single point of failure — any blip there made
    // a perfectly valid session look logged-out and bounced the user back
    // to login.html.
    //
    // getSession() can still hit the network itself when the token is near
    // expiry and needs a refresh — if THAT call has a transient blip (bad
    // connection, Worker cold-start), it can throw or come back empty even
    // though the user is genuinely still logged in. Retry once before
    // giving up, since a second attempt a moment later often succeeds.
    let user = null;
    try {
        const { data: { session } } = await client.auth.getSession();
        user = session ? session.user : null;
    } catch (e) {
        console.error('Session check failed, retrying once:', e);
        try {
            const { data: { session } } = await client.auth.getSession();
            user = session ? session.user : null;
        } catch (e2) {
            console.error('Session check failed on retry:', e2);
        }
    }

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
            }
            // If profile is null here, fetchAndCacheProfile() already retried
            // 3x and, finding no cached fallback either, called handleLogout()
            // itself — a redirect to index.html is already in flight, so
            // there's nothing left to do on this page.
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
    const { data: { session } } = await client.auth.getSession();
    const user = session ? session.user : null;
    if (user) {
        const { error } = await client.auth.resetPasswordForEmail(user.email, {
            redirectTo: window.location.origin + '/login.html?type=recovery',
        });
        alert(error ? "Error: " + error.message : "A password reset link has been sent to your Gmail!");
    }
}

async function handleLogout(redirectTo) {
    const client = await getClient();
    localStorage.removeItem('u_vault');
    localStorage.removeItem('mmh_guide_seen');
    // Clear all exam caches to keep data private
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('CLOUD_SYNC_')) localStorage.removeItem(key);
        });
        await client.auth.signOut();
        window.location.href = redirectTo || ("/index.html?v=" + Date.now()); // Force fresh load
   
}


// Keep this for the very first initial load
document.addEventListener('DOMContentLoaded', initAuth);



