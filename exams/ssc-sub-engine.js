let EXAM_JSON = null;
// Updated filters for the Deep Hierarchy
let currentFilters = { year: '', subject: '', topic: '' };
let CLOUD_CHECKLIST = {};
const SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000; 

async function initExamEngine() {
    const pathParts = window.location.pathname.split('/');
    let examName = window.location.search ? window.location.search.slice(1) : pathParts[pathParts.length - 2];
    
    document.getElementById('grid-sync').innerText = "🔄 Syncing Database...";
    try {
        const rawUrl = `https://raw.githubusercontent.com/sscjourneytest/sscjourneytest/main/data/${examName}-data.json?t=${Date.now()}`;
        const response = await fetch(rawUrl);
        EXAM_JSON = await response.json();
        
        // IDENTIFY YEARS: For this format, years are the top-level keys of 'data'
        let years = Object.keys(EXAM_JSON.data || {});
        currentFilters.year = years.length > 0 ? years.sort().reverse()[0] : "default";

        setupFilters(years);
        renderMocks(); 
        syncWithCloud(examName);
        
    } catch (e) {
        console.error("Engine initialization failed", e);
    }
}

// --- CLOUD SYNC & REATTEMPT (DIRECT COPY FROM ORIGINAL) ---
async function syncWithCloud(examName) {
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    if (!profile || profile.username === "Guest") return;
    const cacheKey = `CLOUD_SYNC_${profile.username}_${examName.toLowerCase()}`;
    const timeKey = `${cacheKey}_TIME`;
    const cachedData = localStorage.getItem(cacheKey);
    if (cachedData) { CLOUD_CHECKLIST = JSON.parse(cachedData); renderMocks(); }
    const lastSync = localStorage.getItem(timeKey);
    if (!lastSync || (Date.now() - parseInt(lastSync) > SYNC_EXPIRY_MS)) {
        try {
            const workerURL = "https://mmh-userdata.maniyamaniya789.workers.dev/";
            const res = await fetch(`${workerURL}?user=${profile.username}&exam=${examName}`);
            if (res.ok) {
                const freshData = await res.json();
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith(`result_${profile.username}_`)) {
                        const id = key.replace(`result_${profile.username}_`, "");
                        if (!freshData[id] && id.toLowerCase().includes(examName.toLowerCase())) {
                            localStorage.removeItem(key); localStorage.removeItem(`state_${profile.username}_${id}`);
                        }
                    }
                });
                CLOUD_CHECKLIST = freshData;
                localStorage.setItem(cacheKey, JSON.stringify(freshData));
                localStorage.setItem(timeKey, Date.now().toString());
                renderMocks();
            }
        } catch (e) { console.error("Background sync failed", e); }
    }
}

// --- UPDATED FILTER LOGIC FOR DEEP HIERARCHY ---
function setupFilters(years) {
    // 1. Year Scroll
    const yearScroll = document.getElementById('year-scroll');
    if (yearScroll) {
        yearScroll.innerHTML = years.map(y => 
            `<div class="pill-filter ${y === currentFilters.year ? 'active' : ''}" onclick="setYear('${y}', this)">${y}</div>`
        ).join('');
    }

    // 2. Subject Scroll
    const subjects = Object.keys(EXAM_JSON.data[currentFilters.year] || {});
    if (!currentFilters.subject && subjects.length > 0) currentFilters.subject = subjects[0];
    
    const subScroll = document.getElementById('subject-scroll');
    if (subScroll) {
        subScroll.innerHTML = subjects.map(s => {
            const dataAtSubject = EXAM_JSON.data[currentFilters.year][s];
            // Count logic: if array, count length. If object, count nested array lengths.
            let count = 0;
            if (Array.isArray(dataAtSubject)) count = dataAtSubject.length;
            else Object.values(dataAtSubject).forEach(arr => count += arr.length);
            
            return `<div class="pill-filter ${s === currentFilters.subject ? 'active' : ''}" onclick="setDeepFilter('subject', '${s}')">${s} (${count})</div>`;
        }).join('');
    }

    // 3. Topic Scroll (Shows only if Subject is an Object, not a Direct Array)
    const selectedSubData = EXAM_JSON.data[currentFilters.year][currentFilters.subject];
    const topicWrap = document.getElementById('topic-wrap');
    const topicScroll = document.getElementById('topic-scroll');

    if (topicScroll && !Array.isArray(selectedSubData) && selectedSubData !== undefined) {
        topicWrap?.classList.remove('hidden');
        const topics = Object.keys(selectedSubData);
        if (!currentFilters.topic && topics.length > 0) currentFilters.topic = topics[0];
        
        topicScroll.innerHTML = topics.map(t => {
            const count = selectedSubData[t].length;
            return `<div class="pill-filter ${t === currentFilters.topic ? 'active' : ''}" onclick="setDeepFilter('topic', '${t}')">${t} (${count})</div>`;
        }).join('');
    } else {
        topicWrap?.classList.add('hidden');
    }
}

function setDeepFilter(level, value) {
    currentFilters[level] = value;
    if (level === 'subject') currentFilters.topic = ''; // Reset topic on subject change
    setupFilters(Object.keys(EXAM_JSON.data));
    renderMocks();
}

function setYear(y, el) {
    currentFilters.year = y;
    currentFilters.subject = ''; // Reset deep path on year change
    currentFilters.topic = '';
    setupFilters(Object.keys(EXAM_JSON.data));
    renderMocks();
}

// --- UPDATED RENDER LOGIC FOR DEEP HIERARCHY ---
function renderMocks() {
    const grid = document.getElementById('quizGrid');
    const config = EXAM_JSON.config.default || {}; 
    const searchVal = document.getElementById('mockSearch').value.toLowerCase();
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const isPaidUser = profile ? profile.is_paid : false;
    const username = profile ? profile.username : "Guest";

    let html = '';
    let itemsToDisplay = [];

    const yearData = EXAM_JSON.data[currentFilters.year] || {};
    const selectedSub = yearData[currentFilters.subject] || [];

    if (Array.isArray(selectedSub)) {
        itemsToDisplay = selectedSub; 
    } else {
        itemsToDisplay = selectedSub[currentFilters.topic] || []; 
    }

    itemsToDisplay.forEach(item => {
        if (searchVal && !item.title.toLowerCase().includes(searchVal)) return;

        // --- UPDATED: SECTIONAL ID PREPARATION ---
        // 1. Store the direct JSON ID for the link param BEFORE we change item.id
        const finalLinkParam = `id=${item.id}`; 

        // 2. If it is the new structure (&section=), set item.id to the Merged Clean version
        if (item.id.includes('&section=')) {
            const parts = item.id.split('&section=');
            const baseId = parts[0];
            const cleanSec = parts[1].replace(/\s+/g, '').toLowerCase();
            item.id = `${baseId}-${cleanSec}`; // Updated for all portal-side tasks
        }
        // --- END OF UPDATED LOGIC ---

        // RELEASE DATE LOGIC (DIRECT COPY)
        let isLockedDate = false;
        if (item.releaseDate && item.releaseDate.trim() !== "") {
            const [day, month, year] = item.releaseDate.split('-').map(Number);
            const releaseDateObj = new Date(year, month - 1, day); 
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            isLockedDate = releaseDateObj > today;
        }

        const accessDenied = item.type === 'paid' && !isPaidUser;
        
        // These now use the updated item.id automatically
        const localResult = localStorage.getItem(`result_${username}_${item.id}`);
        const savedState = JSON.parse(localStorage.getItem(`state_${username}_${item.id}`) || "{}");
        const isSubmitted = localResult !== null || CLOUD_CHECKLIST[item.id];
        
        let actionHtml = '';
        const targetUrl = `../${config.subject_link}?${finalLinkParam}`; // Uses raw JSON ID

        if (isLockedDate) {
            actionHtml = `<div class="action-btn unlock-btn" style="opacity:0.6; cursor:default;">Available ${item.releaseDate}</div>`;
        } else if (accessDenied) {
            actionHtml = `<a href="/buy-premium.html" class="action-btn unlock-btn">🔒 UNLOCK TEST</a>`;
        } else {
            if (isSubmitted) {
                actionHtml = `<div class="btn-grid btn-dual">
                    <a href="${targetUrl}" class="action-btn analysis-btn">ANALYSIS</a>
                    <button onclick="reattempt('${item.id}', '${targetUrl}')" class="action-btn reattempt-btn">REATTEMPT</button>
                </div>`;
            } else if (savedState.isPaused) {
                actionHtml = `<a href="${targetUrl}" class="action-btn resume-btn">▶️ RESUME TEST</a>`;
            } else {
                actionHtml = `<a href="${targetUrl}" class="action-btn start-btn">START TEST</a>`;
            }
        }

        html += `<div class="mock-card">
            <div class="card-top"><div class="card-info">
                <div class="card-title">${item.title} <span class="badge-type ${item.type === 'free' ? 'free-badge' : 'paid-badge'}">${item.type.toUpperCase()}</span></div>
                <div class="card-meta">${item.qs || 25} Questions • ${item.time || '15 Min'}</div>
            </div></div>
            <div class="btn-grid">${actionHtml}</div>
        </div>`;
    });

    grid.innerHTML = html || `<div class="text-center p-5 text-muted">🚀 Tests Coming Soon...</div>`;
    document.getElementById('grid-sync').innerText = "";
}



// --- UTILITY FUNCTIONS (DIRECT COPY) ---
function reattempt(id, url) {
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const username = profile ? profile.username : "Guest";
    let examName = window.location.search ? window.location.search.slice(1) : window.location.pathname.split('/').slice(-2, -1)[0];
    if(confirm("Confirm Reattempt? Are you sure to reattempt.")) {
        localStorage.removeItem(`result_${username}_${id}`);
        localStorage.removeItem(`state_${username}_${id}`);
        localStorage.removeItem(`stream_${username}_${id}`);
        const cacheKey = `CLOUD_SYNC_${username}_${examName.toLowerCase()}`;
        if (CLOUD_CHECKLIST[id]) { delete CLOUD_CHECKLIST[id]; localStorage.setItem(cacheKey, JSON.stringify(CLOUD_CHECKLIST)); }
        window.location.href = url + "&mode=reattempt";
    }
}

window.addEventListener('pageshow', function(event) {
    initExamEngine();
    if (event.persisted || (window.performance && window.performance.navigation.type === 2)) {
        if (typeof renderMocks === 'function' && EXAM_JSON) { renderMocks(); }
    }
});
                          
