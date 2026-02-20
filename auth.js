const SUPABASE_URL = 'https://duqmejyypqgkrjlpplrz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1cW1lanl5cHFna3JqbHBwbHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDIyNTAsImV4cCI6MjA4NzE3ODI1MH0.aAIITdr-BS-D-TJHY1fEkqgN4CRVwsyz90d2I9IrhVc';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function initAuth() {
    const { data: { user } } = await _supabase.auth.getUser();
    const path = window.location.pathname;
    
    // Fix for Cloudflare "Pretty URLs" - checks for both /login and /login.html
    const isLoginPage = path.endsWith("login.html") || path.endsWith("/login");
    const isHomePage = path === "/" || path.endsWith("index.html") || path.endsWith("/index");
    const isPublicPage = isLoginPage || isHomePage;

    const authStatus = document.getElementById('auth-status');
    if (!authStatus) return;

    if (user) {
        // --- USER LOGGED IN ---
        const { data: profile } = await _supabase.from('profiles').select('username').eq('id', user.id).single();
        const username = profile ? profile.username : user.email.split('@')[0];

        // UI: Top Right Profile Button + Dropdown
        authStatus.innerHTML = `
            <div class="profile-container">
                <button class="profile-trigger" onclick="toggleDropdown()">👤 ${username}</button>
                <div id="profile-dropdown" class="dropdown-content">
                    <p><strong>Username:</strong> ${username}</p>
                    <p><strong>Email:</strong> ${user.email}</p>
                    <hr style="border:0; border-top:1px solid #ffffff22; margin:10px 0;">
                    <button onclick="handleLogout()" class="logout-btn">Logout</button>
                </div>
            </div>`;
        
        // Prevent logged-in users from staying on login page
        if (isLoginPage) window.location.href = "/index.html";

    } else {
        // --- USER NOT LOGGED IN ---
        authStatus.innerHTML = `<a href="/login.html" class="top-login-btn">Login / Sign Up</a>`;
        
        // Only redirect if NOT on home or login page
        if (!isPublicPage) {
            window.location.href = "/login.html";
        }
    }
}

// Profile Dropdown Logic
function toggleDropdown() {
    const dropdown = document.getElementById('profile-dropdown');
    if (dropdown) dropdown.classList.toggle('show');
}

// Close dropdown if clicking outside
window.onclick = function(event) {
    if (!event.target.matches('.profile-trigger')) {
        const dropdowns = document.getElementsByClassName("dropdown-content");
        for (let i = 0; i < dropdowns.length; i++) {
            if (dropdowns[i].classList.contains('show')) dropdowns[i].classList.remove('show');
        }
    }
}

async function handleLogout() {
    await _supabase.auth.signOut();
    window.location.href = "/index.html";
}

document.addEventListener('DOMContentLoaded', initAuth);
