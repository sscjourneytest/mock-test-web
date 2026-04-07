let EXAM_JSON = null;
let currentFilters = { tier: 'tier1', year: '', type: 'full_mocks', section: '' };
let CLOUD_SUBMISSIONS = new Set(); // Stores quiz IDs found in Firebase

async function initExamEngine() {
    const pathParts = window.location.pathname.split('/');
    // Assumes path like /cgl/index.html -> examName = 'cgl'
    const examName = pathParts[pathParts.length - 2].toLowerCase();
    
    document.getElementById('grid-sync').innerText = "🔄 Syncing Cloud Data...";
    
    // 1. DYNAMIC FIREBASE INITIALIZATION
    // Decides config from the search bar/URL context provided by folder name
    if (typeof FIREBASE_PROJECTS !== 'undefined' && FIREBASE_PROJECTS[examName]) {
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_PROJECTS[examName]);
        }
    }

    try {
        const response = await fetch(`https://sscjourneytest.github.io/sscjourneytest/data/${examName}-data.json`);
        EXAM_JSON = await response.json();
        
        // 2. BACKGROUND STATUS SYNC
        // Runs before rendering to ensure buttons are accurate across devices
        await syncCloudStatus();

        const years = Object.keys(EXAM_JSON.data[currentFilters.tier]);
        currentFilters.year = years.sort().reverse()[0];
        
        setupFilters(years);
        renderMocks();
    } catch (e) {
        console.error(e);
        document.getElementById('grid-sync').innerHTML = "⚠️ Sync Error.";
    }
}

async function syncCloudStatus() {
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    if (!profile) return;
    
    const username = profile.username;
    const db = firebase.database();

    try {
        // LIGHTWEIGHT CHECK: Only fetch keys from quiz_results node
        // This confirms if a username exists for a specific Quiz ID
        const snap = await db.ref("quiz_results").once("value");
        const allResults = snap.val() || {};
        
        Object.keys(allResults).forEach(quizId => {
            if (allResults[quizId][username]) {
                CLOUD_SUBMISSIONS.add(quizId);
            }
        });

        // LOCAL CLEANUP: If Device B thinks it's submitted but Firebase says NO, remove local cache
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(`result_${username}_`)) {
                const qid = key.replace(`result_${username}_`, "");
                if (!CLOUD_SUBMISSIONS.has(qid)) {
                    localStorage.removeItem(key);
                }
            }
        });
    } catch (e) {
        console.warn("Cloud status sync failed:", e);
    }
}

function renderMocks() {
    const grid = document.getElementById('quizGrid');
    const config = EXAM_JSON.config[currentFilters.tier];
    const source = EXAM_JSON.data[currentFilters.tier][currentFilters.year];
    const searchVal = document.getElementById('mockSearch').value.toLowerCase();
    
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const isPaidUser = profile ? profile.is_paid : false;
    const username = profile ? profile.username : "Guest";

    let html = '';
    let rawList = source[currentFilters.type] || [];
    let itemsToDisplay = [];

    // Existing Sectional Logic
    if (currentFilters.type === 'sectional') {
        const fullMocksForSection = source.full_mocks || [];
        const sectionDef = config.sections.find(s => s.id === currentFilters.section);
        fullMocksForSection.forEach(mock => {
            const cleanSec = sectionDef.name.replace(/\s+/g, '').toLowerCase();
            itemsToDisplay.push({
                ...mock,
                id: `${mock.id}-${cleanSec}`,
                originalId: mock.id,
                title: `${mock.title} - ${sectionDef.name}`,
                qs: sectionDef.qs, time: sectionDef.time, marks: sectionDef.marks,
                linkParam: `id=${mock.id}&section=${encodeURIComponent(sectionDef.backendName)}`
            });
        });
    } else {
        itemsToDisplay = rawList.map(item => ({...item, linkParam: `id=${item.id}`, originalId: item.id }));
    }

    itemsToDisplay.forEach(item => {
        if (searchVal && !item.title.toLowerCase().includes(searchVal)) return;

        const isLockedDate = item.releaseDate && new Date(item.releaseDate) > new Date();
        const accessDenied = item.type === 'paid' && !isPaidUser;
        const stateKey = `state_${username}_${item.id}`;
        const savedState = JSON.parse(localStorage.getItem(stateKey) || "{}");

        // REQUIREMENT: Check if username exists in Cloud for this Quiz ID
        const isSubmitted = CLOUD_SUBMISSIONS.has(item.id) || localStorage.getItem(`result_${username}_${item.id}`);

        let actionHtml = '';

        if (isLockedDate) {
            actionHtml = `<div class="action-btn unlock-btn" style="opacity:0.6; cursor:default;">Available ${item.releaseDate}</div>`;
        } else if (accessDenied) {
            actionHtml = `<a href="/buy-premium.html" class="action-btn unlock-btn">🔒 UNLOCK TEST</a>`;
        } else if (isSubmitted) {
            // REQUIREMENT: Analysis and Reattempt buttons only. NO SCORE BARS.
            actionHtml = `
                <div class="btn-grid btn-dual">
                    <a href="${getLink(config)}?${item.linkParam}" class="action-btn analysis-btn">ANALYSIS</a>
                    <button onclick="reattempt('${item.id}', '${getLink(config)}?${item.linkParam}')" class="action-btn reattempt-btn">REATTEMPT</button>
                </div>
            `;
        } else if (savedState.isPaused) {
            actionHtml = `<a href="${getLink(config)}?${item.linkParam}" class="action-btn resume-btn">▶️ RESUME TEST</a>`;
        } else {
            actionHtml = `<a href="${getLink(config)}?${item.linkParam}" class="action-btn start-btn">START TEST</a>`;
        }

        html += `
            <div class="mock-card">
                <div class="card-top">
                    <div class="card-info">
                        <div class="card-title">${item.title} <span class="badge-type ${item.type === 'free' ? 'free-badge' : 'paid-badge'}">${item.type.toUpperCase()}</span></div>
                        <div class="card-meta">${item.qs || 100} Questions • ${item.time || '60 Min'}</div>
                    </div>
                </div>
                <div class="btn-grid">${actionHtml}</div>
            </div>
        `;
    });

    grid.innerHTML = html || `<div class="text-center p-5 text-muted">🚀 Tests Coming Soon...</div>`;
    document.getElementById('grid-sync').innerText = "";
}

function reattempt(id, baseUrl) {
    const profile = getLocalProfile();
    const username = profile ? profile.username : "Guest";
    if(confirm("Confirm Reattempt? Previous result will be deleted.")) {
        localStorage.removeItem(`result_${username}_${id}`);
        localStorage.removeItem(`state_${username}_${id}`);
        // REQUIREMENT: Add mode=reattempt to URL
        window.location.href = baseUrl + "&mode=reattempt";
    }
}

// REST OF THE EXISTING HELPER FUNCTIONS (getLink, setYear, filterType, etc.) STAY THE SAME
function getLink(config) {
    if (currentFilters.type === 'full_mocks') return "../" + config.full_link;
    if (currentFilters.type === 'sectional') return "../" + config.sectional_link;
    return "../" + config.subject_link;
}

function setYear(y, el) {
    document.querySelectorAll('#year-scroll .pill-filter').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    currentFilters.year = y;
    setupFilters(Object.keys(EXAM_JSON.data[currentFilters.tier]));
    renderMocks();
}

function filterType(type, el) {
    document.querySelectorAll('#type-filters .pill-filter').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    currentFilters.type = type;
    const secWrap = document.getElementById('section-wrap');
    if (type === 'sectional') {
        secWrap.classList.remove('hidden');
        renderSectionPills();
    } else {
        secWrap.classList.add('hidden');
        renderMocks();
    }
}

function renderSectionPills() {
    const sections = EXAM_JSON.config[currentFilters.tier].sections;
    const source = EXAM_JSON.data[currentFilters.tier][currentFilters.year];
    const fullMockCount = (source.full_mocks || []).length;
    currentFilters.section = sections[0].id;
    let html = '';
    sections.forEach(s => {
        html += `<div class="pill-filter ${s.id === currentFilters.section ? 'active' : ''}" onclick="setSection('${s.id}', this)">${s.name} (${fullMockCount})</div>`;
    });
    document.getElementById('section-scroll').innerHTML = html;
    renderMocks();
}

function setSection(id, el) {
    document.querySelectorAll('#section-scroll .pill-filter').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    currentFilters.section = id;
    renderMocks();
}

function setTier(t, el) {
    document.querySelectorAll('#tier-wrap .pill-filter').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    currentFilters.tier = t;
    setupFilters(Object.keys(EXAM_JSON.data[currentFilters.tier]));
    renderMocks();
}
