// auth.js - Place in the root directory of your GitHub repo
const SUPABASE_URL = 'https://duqmejyypqgkrjlpplrz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1cW1lanl5cHFna3JqbHBwbHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDIyNTAsImV4cCI6MjA4NzE3ODI1MH0.aAIITdr-BS-D-TJHY1fEkqgN4CRVwsyz90d2I9IrhVc';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function initAuth() {
    // 1. Get the current user session
    const { data: { user } } = await _supabase.auth.getUser();
    
    // 2. Identify the current page accurately
    const path = window.location.pathname;
    const page = path.split("/").pop(); // Gets the last part of the URL (e.g., 'login.html')

    // 3. Define page types to prevent redirect loops
    const isLoginPage = page === "login.html";
    const isHomePage = page === "" || page === "index.html" || path === "/";
    const isPublicPage = isLoginPage || isHomePage;

    const authStatus = document.getElementById('auth-status');

    if (user) {
        // --- USER IS LOGGED IN ---
        
        // Fetch the unique username from your 'profiles' table
        const { data: profile } = await _supabase
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .single();

        const displayName = profile ? profile.username : user.email.split('@')[0];

        // Update the Navbar UI
        if (authStatus) {
            authStatus.innerHTML = `
                <div class="user-pill">
                    <span>👤 ${displayName}</span>
                    <button onclick="handleLogout()" class="logout-btn">Logout</button>
                </div>`;
        }

        // If logged in and accidentally on login page, send to home
        if (isLoginPage) {
            window.location.href = "/index.html";
        }

    } else {
        // --- USER IS NOT LOGGED IN ---
        
        // Show Login link in Navbar
        if (authStatus) {
            authStatus.innerHTML = `<a href="/login.html" class="login-link">Login / Sign Up</a>`;
        }
        
        // IMPORTANT: Only redirect if NOT already on a public page
        // This stops the infinite refresh/flicker loop
        if (!isPublicPage) {
            window.location.href = "/login.html";
        }
    }
}

async function handleLogout() {
    await _supabase.auth.signOut();
    window.location.href = "/index.html"; 
}

// Start the check as soon as the HTML content is loaded
document.addEventListener('DOMContentLoaded', initAuth);
