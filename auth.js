const SUPABASE_URL = 'https://duqmejyypqgkrjlpplrz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1cW1lanl5cHFna3JqbHBwbHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDIyNTAsImV4cCI6MjA4NzE3ODI1MH0.aAIITdr-BS-D-TJHY1fEkqgN4CRVwsyz90d2I9IrhVc';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Security Salt for local storage encryption
const SECRET_SALT = "mmh_vault_key_99";

async function initAuth() {
    const { data: { user } } = await _supabase.auth.getUser();
    const path = window.location.pathname;
    
    // Fix for Cloudflare "Pretty URLs" (Preserved as requested)
    const isLoginPage = path.endsWith("login.html") || path.endsWith("/login");
    const isHomePage = path === "/" || path.endsWith("index.html") || path.endsWith("/index");
    const isPublicPage = isLoginPage || isHomePage;

    // Inject Fixed Top Bar Styles
    setupTopBarStyles();

    const authStatus = document.getElementById('auth-status');
    if (!authStatus) return;

    if (user) {
        // --- USER LOGGED IN ---
        let profile = getLocalProfile();

        // THE AUTO-SYNC: If user is at Home and local cache says "Free", check if status updated to "Paid"
        if (isHomePage && (!profile || profile.is_paid === false)) {
            const { data: fresh } = await _supabase.from('profiles').select('*').eq('id', user.id).single();
            if (fresh && fresh.is_paid === true) {
                profile = fresh;
                saveLocalProfile(profile);
            }
        }
        
        // 24-HOUR CACHE LOGIC: Fetch if missing or older than 24h
        if (!profile || isCacheExpired()) {
            const { data: dbProfile } = await _supabase.from('profiles').select('*').eq('id', user.id).single();
            if (dbProfile) {
                profile = dbProfile;
                saveLocalProfile(profile);
            }
        }
        
        const username = profile ? profile.username : "User";
        const isPaid = profile ? profile.is_paid : false;
        const expiryDate = profile && profile.expires_at ? new Date(profile.expires_at) : null;
        
        let daysLeft = 0;
        if (expiryDate) {
            daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
        }

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
        if (!isPublicPage) window.location.href = "/login.html";
    }
}

// 1. SAVE DATA (24hr Logic)
function saveLocalProfile(data) {
    const payload = { ...data, cache_expiry: Date.now() + (24 * 60 * 60 * 1000) };
    const encrypted = btoa(JSON.stringify(payload) + SECRET_SALT);
    localStorage.setItem('u_vault', encrypted);
}

// 2. GET DATA (Decrypted)
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
    const p = getLocalProfile();
    return !p || !p.cache_expiry || Date.now() > p.cache_expiry;
}

// 4. TOP BAR STYLES & BRANDING (Premium & Mobile-Optimized Version)
function setupTopBarStyles() {
    if (document.getElementById('auth-styles')) return;

    // Create Fixed Header HTML
    const header = document.createElement('header');
    header.className = 'fixed-top-bar';
    header.innerHTML = `
        <div class="brand-container">
            <div class="brand-logo-wrapper">
                <img src="/logo.png" alt="Logo" class="top-bar-logo">
            </div>
            <div class="brand-name">
                MOCK MATRIX <span class="brand-hub">HUB</span>
            </div>
        </div>
        <div id="auth-status"></div>
    `;
    document.body.prepend(header);

    const style = document.createElement('style');
    style.id = 'auth-styles';
    style.innerHTML = `
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;800&display=swap');

        .fixed-top-bar {
            position: fixed; top: 0; left: 0; right: 0; height: 70px;
            /* Professional Light Blue-Grey Background */
            background: rgba(241, 245, 249, 0.98); 
            backdrop-filter: blur(10px);
            border-bottom: 2px solid #e2e8f0;
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 5%; z-index: 9999; 
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);
        }
        
        body { padding-top: 70px; }

        .brand-container {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .brand-logo-wrapper {
            width: 35px;
            height: 35px;
            border-radius: 50%;
            overflow: hidden;
            border: 2px solid #2563eb;
            background: white;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .top-bar-logo {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .brand-name {
            font-family: 'Poppins', sans-serif;
            font-size: 20px;
            font-weight: 800;
            background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
            white-space: nowrap;
        }

        .brand-hub {
            background: #1e293b;
            color: white;
            padding: 2px 6px;
            border-radius: 5px;
            -webkit-text-fill-color: white;
            font-size: 14px;
        }

        .top-nav-items { display: flex; align-items: center; gap: 12px; }

        .badge { 
            font-size: 9px; padding: 2px 6px; border-radius: 50px; 
            font-weight: 800; text-transform: uppercase; 
        }
        
        .premium { 
            background: linear-gradient(90deg, #f59e0b, #d97706); 
            color: white; 
        }
        
        .free { background: #cbd5e1; color: #1e293b; }

        .buy-btn { 
            background: linear-gradient(135deg, #22c55e 0%, #15803d 100%);
            color: white !important; padding: 8px 14px; border-radius: 8px;
            font-weight: 700; text-decoration: none; font-size: 12px;
            white-space: nowrap;
            box-shadow: 0 4px 10px rgba(34, 197, 94, 0.2);
        }

        .profile-trigger { 
            background: white; border: 1px solid #cbd5e1; padding: 6px 12px; 
            border-radius: 10px; cursor: pointer; font-weight: 600;
            color: #1e293b; font-size: 13px;
            display: flex; align-items: center; gap: 5px;
        }

        .dropdown-content { 
            display: none; position: absolute; right: 5%; top: 65px; 
            background: white; border: 1px solid #e2e8f0; padding: 15px; 
            border-radius: 12px; width: 240px; 
            box-shadow: 0 10px 25px rgba(0,0,0,0.1); 
        }

        .dropdown-content.show { display: block; }

        .top-login-btn {
            background: #2563eb; color: white !important; padding: 8px 16px;
            border-radius: 10px; text-decoration: none; font-weight: 700;
            font-size: 13px;
        }

        /* MOBILE OPTIMIZATION */
        @media (max-width: 600px) {
            .fixed-top-bar { height: 60px; padding: 0 3%; }
            body { padding-top: 60px; }
            
            .brand-logo-wrapper { width: 28px; height: 28px; }
            
            .brand-name { font-size: 15px; }
            .brand-hub { font-size: 11px; padding: 1px 4px; }
            
            .top-nav-items { gap: 8px; }
            
            .buy-btn { padding: 6px 10px; font-size: 11px; }
            
            .profile-trigger { padding: 5px 8px; font-size: 11px; }
            .profile-trigger span { display: none; } /* Hides "👤" icon on small mobile to save space */
            
            .top-login-btn { padding: 6px 12px; font-size: 11px; }
        }
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
    localStorage.removeItem('u_vault'); // Erase entire profile cache
    await _supabase.auth.signOut();
    window.location.href = "/index.html";
}

document.addEventListener('DOMContentLoaded', initAuth);
