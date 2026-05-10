const PROXY_URL = 'https://mmh-vault-2.mockmatrixhub.workers.dev';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1cW1lanl5cHFna3JqbHBwbHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDIyNTAsImV4cCI6MjA4NzE3ODI1MH0.aAIITdr-BS-D-TJHY1fEkqgN4CRVwsyz90d2I9IrhVc';

let _supabase = null;

async function getClient() {
    if (_supabase) return _supabase;
    _supabase = supabase.createClient(PROXY_URL, SUPABASE_KEY);
    return _supabase;
}

const SECRET_SALT = "mmh_vault_key_99";

async function initAuth() {
    const client = await getClient();
    const { data: { user } } = await client.auth.getUser();
    const path = window.location.pathname;

        const isLoginPage = path.endsWith("login.html") || path.endsWith("/login");
    const isHomePage = path === "/" || path.endsWith("index.html") || path.endsWith("/index");
    const isPricingPage = path.endsWith("pricing.html") || path.endsWith("/pricing");
    const isPublicPage = isLoginPage || isHomePage || isPricingPage;
    
    

    if (user) {
        // 1. BACKGROUND SYNC: If user has a pending request, check status automatically
        if (localStorage.getItem('pending_premium_request') === 'true') {
            await syncPendingPremiumStatus(client, user.email);
        }

        let profile = getLocalProfile();
        const urlParams = new URLSearchParams(window.location.search);
        const forceFetch = urlParams.get('type') === 'recovery' || !profile;

        // 2. CACHE MANAGEMENT: Fetch profile if missing or expired
        if (forceFetch || isCacheExpired()) {
            const { data: dbProfile } = await client.from('profiles').select('*').eq('id', user.id).single();
            if (dbProfile) {
                profile = { ...dbProfile, email: user.email };
                saveLocalProfile(profile);
            }
        }

        // 3. VARIABLE EXPOSURE: Extracting required data for other page functions
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
      
        if (isLoginPage) window.location.href = "/index.html";

    } else {
        if (!isPublicPage) window.location.href = "/login.html";
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
