const SUPABASE_URL = 'https://duqmejyypqgkrjlpplrz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1cW1lanl5cHFna3JqbHBwbHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDIyNTAsImV4cCI6MjA4NzE3ODI1MH0.aAIITdr-BS-D-TJHY1fEkqgN4CRVwsyz90d2I9IrhVc';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Security Salt for local storage encryption
const SECRET_SALT = "mmh_vault_key_99";

async function initAuth() {
    const { data: { user } } = await _supabase.auth.getUser();
    const path = window.location.pathname;
    
    // Fix for Cloudflare "Pretty URLs"
    const isLoginPage = path.endsWith("login.html") || path.endsWith("/login");
    const isHomePage = path === "/" || path.endsWith("index.html") || path.endsWith("/index");
    const isPublicPage = isLoginPage || isHomePage;

    // Inject the Fixed Top Bar Styles
    setupTopBarStyles();

    const authStatus = document.getElementById('auth-status');
    if (!authStatus) return;

    if (user) {
        // --- USER LOGGED IN ---
        let profile = getLocalProfile();
        
        // Check if cache is missing or older than 24 hours
        if (!profile || isCacheExpired()) {
            // Fetch all profile fields (is_paid, expires_at, etc.)
            const { data: dbProfile } = await _supabase.from('profiles').select('*').eq('id', user.id).single();
            if (dbProfile) {
                profile = dbProfile;
                saveLocalProfile(profile);
            }
        }
        
        const username = profile ? profile.username : "User";
        const isPaid = profile ? profile.is_paid : false;
        const expiryDate = profile && profile.expires_at ? new Date(profile.expires_at) : null;
        
        // Days remaining logic
        let daysLeft = 0;
        if (expiryDate) {
            daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
        }

        // Badges and Buy Button
        const badge = isPaid ? `<span class="badge premium">PRO</span>` : `<span class="badge free">FREE</span>`;
        const buyBtn = !isPaid ? `<a href="/buy-premium.html" class="buy-btn">🚀 Buy Premium</a>` : '';

        authStatus.innerHTML = `
            <div class="top-nav-items">
                ${buyBtn}
                <div class="profile-container">
                    <button class="profile-trigger" onclick="toggleDropdown()">👤 ${username} ${badge}</button>
                    <div id="profile-dropdown" class="dropdown-content">
                        <p><strong>Username:</strong> ${username}</p>
                        <p><strong>Email:</strong> ${user.email}</p>
                        <hr style="border:0; border-top:1px solid #ffffff22; margin:10px 0;">
                        <p>Status: <b>${isPaid ? 'Premium ✅' : 'Free ❌'}</b></p>
                        ${isPaid ? `<p>Access: <b>${daysLeft} Days Left</b></p>` : ''}
                        <button onclick="handleChangePassword()" style="width:100%; background: #2563eb; color:white; border:none; padding:8px; border-radius:6px; cursor:pointer; margin-bottom:8px; font-weight:bold;">Change Password</button>
                        <button onclick="handleLogout()" class="logout-btn">Logout Manually</button>
                    </div>
                </div>
            </div>`;
        
        if (isLoginPage) window.location.href = "/index.html";

    } else {
        // --- USER NOT LOGGED IN ---
        authStatus.innerHTML = `<a href="/login.html" class="top-login-btn">Login / Sign Up</a>`;
        
        if (!isPublicPage) {
            window.location.href = "/login.html";
        }
    }
}

// 1. SAVE DATA (24hr Logic)
function saveLocalProfile(data) {
    const payload = { 
        ...data, 
        cache_expiry: Date.now() + (24 * 60 * 60 * 1000) 
    };
    const encrypted = btoa(JSON.stringify(payload) + SECRET_SALT);
    localStorage.setItem('u_vault', encrypted);
}

// 2. GET DATA
function getLocalProfile() {
    const raw = localStorage.getItem('u_vault');
    if (!raw) return null;
    try {
        const decrypted = atob(raw).replace(SECRET_SALT, '');
        return JSON.parse(decrypted);
    } catch (e) { return null; }
}

// 3. EXPIRE CHECK
function isCacheExpired() {
    const profile = getLocalProfile();
    if (!profile || !profile.cache_expiry) return true;
    return Date.now() > profile.cache_expiry;
}

// 4. STICKY TOP BAR STYLE
function setupTopBarStyles() {
    if (document.getElementById('auth-styles')) return;
    const style = document.createElement('style');
    style.id = 'auth-styles';
    style.innerHTML = `
        header, .top-bar { position: fixed; top: 0; left: 0; right: 0; background: #fff; height: 60px; z-index: 2000; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; border-bottom: 1px solid #eee; }
        body { padding-top: 60px; }
        .top-nav-items { display: flex; align-items: center; gap: 10px; }
        .badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; }
        .premium { background: #ffd700; color: #000; font-weight:bold; }
        .free { background: #eee; color: #666; }
        .buy-btn { background: #2563eb; color: white !important; padding: 6px 12px; border-radius: 6px; font-weight: bold; text-decoration: none; font-size: 13px; }
        .logout-btn { background: #dc3545; color: white; border: none; padding: 8px; border-radius: 6px; cursor: pointer; width: 100%; font-weight: bold; }
    `;
    document.head.appendChild(style);
}

function toggleDropdown() {
    const dropdown = document.getElementById('profile-dropdown');
    if (dropdown) dropdown.classList.toggle('show');
}

async function handleChangePassword() {
    const { data: { user } } = await _supabase.auth.getUser();
    if (user) {
        const { error } = await _supabase.auth.resetPasswordForEmail(user.email);
        alert(error ? "Error: " + error.message : "A password reset link has been sent to your Gmail!");
    }
}

window.onclick = function(event) {
    if (!event.target.matches('.profile-trigger')) {
        const dropdowns = document.getElementsByClassName("dropdown-content");
        for (let i = 0; i < dropdowns.length; i++) {
            if (dropdowns[i].classList.contains('show')) dropdowns[i].classList.remove('show');
        }
    }
}

async function handleLogout() {
    localStorage.removeItem('u_vault'); // Wipe all cached profile data
    await _supabase.auth.signOut();
    window.location.href = "/index.html";
}

document.addEventListener('DOMContentLoaded', initAuth);
