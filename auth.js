
const DIRECT_URL = 'https://duqmejyypqgkrjlpplrz.supabase.co';
const PROXY_URL = 'https://mmh-vault-1.mockmatrixhub.workers.dev';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1cW1lanl5cHFna3JqbHBwbHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDIyNTAsImV4cCI6MjA4NzE3ODI1MH0.aAIITdr-BS-D-TJHY1fEkqgN4CRVwsyz90d2I9IrhVc';
let _supabase = null;
let _initializationPromise = null; // New: tracks the setup process

async function getClient() {
    // If already initialized, return it
    if (_supabase) return _supabase;

    // If currently initializing, wait for the existing process
    if (_initializationPromise) return _initializationPromise;

    // Start initialization
    _initializationPromise = (async () => {
        let activeUrl = DIRECT_URL;
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // Slightly longer timeout
            
            const response = await fetch(`${DIRECT_URL}/auth/v1/health`, {
                method: 'GET',
                headers: { 'apikey': SUPABASE_KEY },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error("Direct URL blocked");
        } catch (err) {
            console.warn("Supabase Direct blocked. Switching to Proxy...");
            activeUrl = PROXY_URL;
        }

        _supabase = supabase.createClient(activeUrl, SUPABASE_KEY);
        return _supabase;
    })();

    return _initializationPromise;
}


// Security Salt for local storage encryption
const SECRET_SALT = "mmh_vault_key_99";

async function initAuth() {
    const client = await getClient();
    const { data: { user } } = await client.auth.getUser();
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

        // OPTIMIZATION: Check for Recovery/Login event or expired weekly cache
        const urlParams = new URLSearchParams(window.location.search);
        const forceFetch = urlParams.get('type') === 'recovery' || !profile;

        if (forceFetch || isCacheExpired()) {
            // Fetch everything on login or weekly refresh
            const { data: dbProfile } = await client.from('profiles').select('*').eq('id', user.id).single();
            if (dbProfile) {
                profile = { ...dbProfile, email: user.email };
                saveLocalProfile(profile);
            }
        }

        const username = profile ? profile.username : "User";
        const isPaid = profile ? profile.is_paid : false;
        const isAdmin = profile ? profile.role === 'admin' : false; // Added Admin Role Check
        const isPartner = profile ? profile.is_partner : false; // Added Partner Status Check
        const expiryDate = profile && profile.expires_at ? new Date(profile.expires_at) : null;
        
        let daysLeft = 0;
        if (expiryDate) {
            daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
        }

        const badge = isPaid ? `<span class="badge premium">PRO</span>` : `<span class="badge free">FREE</span>`;
        const buyBtn = !isPaid ? `<a href="/buy-premium.html" class="buy-btn">🚀 Buy Premium</a>` : '';
        
        // Added Admin Panel Button if user is Admin
        const adminBtn = isAdmin ? `<a href="/admin-vault.html" class="admin-btn">🛠️ Admin</a>` : '';

        // Added Partner/Earnings Button logic
        const partnerBtn = isPartner 
            ? `<a href="/partner-dashboard.html" class="admin-btn" style="background:#16a34a; border-color:#16a34a;">📊 Earnings</a>` 
            : `<a href="/apply-coupon.html" class="buy-btn" style="background:#6366f1;">🎁 Partner</a>`;
authStatus.innerHTML = `
            <div class="top-nav-items">
                <button class="mobile-menu-btn" onclick="toggleMobileMenu()">☰</button>
                
                <div class="nav-actions" id="nav-actions">
                    ${adminBtn}
                    ${partnerBtn}
                    ${buyBtn}
                </div>

                <div class="profile-container">
                    <button class="profile-trigger" onclick="toggleDropdown()">👤 ${username} ${badge}</button>
                    <div id="profile-dropdown" class="dropdown-content">
                        <p><strong>Username:</strong> ${username}</p>
                        <p><strong>Email:</strong> ${user.email}</p>
                        <hr style="border:0; border-top:1px solid #ffffff22; margin:10px 0;">
                        <p>Status: <b>${isPaid ? 'Premium ✅' : 'Free ❌'}</b></p>
                        ${isPaid ? `<p>Access: <b>${daysLeft} Days Left</b></p>` : ''}
                        ${isPartner ? `<p>Partner Code: <b style="color:#fbbf24;">${profile.partner_coupon}</b></p>` : ''}
                        ${isAdmin ? `<p style="color:#ffd700;">Role: <b>Admin 👑</b></p>` : ''}
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

// 1. SAVE DATA (7-Day Cache Logic)
function saveLocalProfile(data) {
    const payload = { ...data, cache_expiry: Date.now() + (7 * 24 * 60 * 60 * 1000) };
    const encrypted = btoa(JSON.stringify(payload) + SECRET_SALT);
    localStorage.setItem('u_vault', encrypted);
}

// 2. GET DATA (Decrypted)
function getLocalProfile() {
    const raw = localStorage.getItem('u_vault');
    if (!raw) return null;
    try {
        const decrypted = atob(raw).replace(SECRET_SALT, '');
        const data = JSON.parse(decrypted);
        // Change 3: Return a safe object with default values if fields are missing
        return {
            username: "User",
            email: "",
            is_paid: false,
            is_partner: false,
            ...data
        };
    } catch (e) { return null; }
}

// 3. EXPIRE CHECK (7-Day Check)
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
        <div class="brand-container" onclick="window.location.href='/'" style="cursor:pointer">
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

        /* Added Admin Button Style */
        .admin-btn {
            background: #1e293b;
            color: white !important; padding: 8px 14px; border-radius: 8px;
            font-weight: 700; text-decoration: none; font-size: 12px;
            white-space: nowrap;
            border: 1px solid #475569;
        }

        .profile-trigger { 
            background: white; border: 1px solid #cbd5e1; padding: 6px 12px; 
            border-radius: 10px; cursor: pointer; font-weight: 600;
            color: #1e293b; font-size: 13px;
            display: flex; align-items: center; gap: 5px;
        }

        .dropdown-content { 
            display: none; position: absolute; right: 5%; top: 65px; 
            background: #1e3a8a; border: 1px solid #e2e8f0; padding: 15px; 
            border-radius: 12px; width: 240px; 
            box-shadow: 0 10px 25px rgba(0,0,0,0.1); 
            z-index: 10000;
        }

        .dropdown-content p { margin: 8px 0; font-size: 13px; color: #cbd5e1; word-break: break-all; }
        .dropdown-content strong { color: white; display: block; font-size: 11px; text-transform: uppercase; opacity: 0.7; }
        .dropdown-content.show { display: block; }

        .logout-btn { 
            background: #ef4444; color: white; border: none; padding: 10px; 
            border-radius: 8px; width: 100%; cursor: pointer; font-weight: 700; 
            margin-top: 10px;
        }

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
            .brand-name { font-size: 14px; }
            .brand-hub { font-size: 10px; padding: 1px 4px; }
            .top-nav-items { gap: 6px; }
            .buy-btn, .admin-btn { padding: 6px 8px; font-size: 10px; }
            .profile-trigger { padding: 5px 6px; font-size: 10px; }
            .profile-trigger span { display: none; }
            .top-login-btn { padding: 6px 10px; font-size: 10px; }

            .mobile-menu-btn {
                display: block;
                background: #1e293b;
                color: white;
                border: none;
                padding: 5px 10px;
                border-radius: 6px;
                font-size: 18px;
                cursor: pointer;
            }

            .nav-actions {
                display: none; /* Hidden by default on mobile */
                flex-direction: column;
                position: absolute;
                top: 60px;
                right: 3%;
                background: #f1f5f9;
                border: 1px solid #e2e8f0;
                padding: 10px;
                border-radius: 10px;
                gap: 8px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            }

            .nav-actions.show {
                display: flex; /* Show when toggled */
            }
        }
/* DESKTOP CONFIGURATION (Add this after your mobile block) */
@media (min-width: 601px) {
    .mobile-menu-btn { 
        display: none !important; 
    }
    .nav-actions { 
        display: flex !important; 
        flex-direction: row; 
        position: static; 
        background: transparent; 
        border: none; 
        box-shadow: none; 
    }
}
    `;
    document.head.appendChild(style);
}

function toggleDropdown() {
    const dropdown = document.getElementById('profile-dropdown');
    if (dropdown) dropdown.classList.toggle('show');
}
function toggleMobileMenu() {
    const navActions = document.getElementById('nav-actions');
    if (navActions) navActions.classList.toggle('show');
}

window.onclick = function(event) {
    // You MUST add these two lines
    const isProfileTrigger = event.target.closest('.profile-trigger');
    const isMenuBtn = event.target.closest('.mobile-menu-btn');

    // Update the IF statement to use these variables
    if (!isProfileTrigger && !isMenuBtn) {
        // Close Profile Dropdown
        const dropdowns = document.getElementsByClassName("dropdown-content");
        for (let i = 0; i < dropdowns.length; i++) {
            if (dropdowns[i].classList.contains('show')) dropdowns[i].classList.remove('show');
        }
        // Close Mobile Nav Menu
        const navActions = document.getElementById('nav-actions');
        if (navActions && navActions.classList.contains('show')) {
            navActions.classList.remove('show');
        }
    }
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
    localStorage.removeItem('u_vault'); // Erase profile cache
    localStorage.removeItem('mmh_guide_seen'); // RESET the guide for next login
    await client.auth.signOut(); // Sign out from Supabase
    window.location.href = "/index.html"; // Redirect home
}
document.addEventListener('DOMContentLoaded', initAuth);
