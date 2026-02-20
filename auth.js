// auth.js - Place in the root directory of your GitHub repo
const SUPABASE_URL = 'https://duqmejyypqgkrjlpplrz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1cW1lanl5cHFna3JqbHBwbHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDIyNTAsImV4cCI6MjA4NzE3ODI1MH0.aAIITdr-BS-D-TJHY1fEkqgN4CRVwsyz90d2I9IrhVc';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function initAuth() {
    // Check for user session
    const { data: { user } } = await _supabase.auth.getUser();
    const path = window.location.pathname;
    
    // Define which pages are accessible without logging in
    const isPublicPage = path === "/" || path.includes("index.html") || path.includes("login.html");
    const authStatus = document.getElementById('auth-status');

    if (user) {
        // Fetch the unique username from your 'profiles' table
        const { data: profile } = await _supabase
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .single();

        // Use username if found, otherwise use first part of email
        const displayName = profile ? profile.username : user.email.split('@')[0];

        if (authStatus) {
            authStatus.innerHTML = `
                <div class="user-pill">
                    <span>👤 ${displayName}</span>
                    <button onclick="handleLogout()" class="logout-btn">Logout</button>
                </div>`;
        }
    } else {
        // User is not logged in
        if (authStatus) {
            authStatus.innerHTML = `<a href="/login.html" class="login-link">Login / Sign Up</a>`;
        }
        
        // If user tries to access a mock/private page while logged out, redirect to login
        if (!isPublicPage) {
            window.location.href = "/login.html";
        }
    }
}

async function handleLogout() {
    await _supabase.auth.signOut();
    window.location.href = "/index.html"; // Send user to home page after logout
}

// Start the check as soon as the HTML content is loaded
document.addEventListener('DOMContentLoaded', initAuth);
