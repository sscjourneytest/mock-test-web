const SUPABASE_URL = 'https://duqmejyypqgkrjlpplrz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1cW1lanl5cHFna3JqbHBwbHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDIyNTAsImV4cCI6MjA4NzE3ODI1MH0.aAIITdr-BS-D-TJHY1fEkqgN4CRVwsyz90d2I9IrhVc';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function initAuth() {
    const { data: { user } } = await _supabase.auth.getUser();
    const path = window.location.pathname;
    const isPublicPage = path === "/" || path.includes("index.html") || path.includes("login.html");
    const authStatus = document.getElementById('auth-status');

    if (user) {
        // Fetch username from profiles table
        const { data: profile } = await _supabase.from('profiles').select('username').eq('id', user.id).single();
        const displayName = profile ? profile.username : user.email.split('@')[0];

        if (authStatus) {
            authStatus.innerHTML = `
                <div class="user-pill" style="color:white; display:flex; gap:10px; align-items:center;">
                    <span>👤 ${displayName}</span>
                    <button onclick="handleLogout()" style="cursor:pointer; background:#ff4b2b; color:white; border:none; border-radius:5px; padding:5px 10px;">Logout</button>
                </div>`;
        }
    } else {
        if (authStatus) {
            authStatus.innerHTML = `<a href="/login.html" style="color:white; text-decoration:none; font-weight:bold;">Login / Sign Up</a>`;
        }
        if (!isPublicPage) window.location.href = "/login.html";
    }
}

async function handleLogout() {
    await _supabase.auth.signOut();
    window.location.href = "/index.html";
}

document.addEventListener('DOMContentLoaded', initAuth);
