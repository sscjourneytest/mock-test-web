let EXAM_JSON = null;
let currentFilters = { tier: 'tier1', year: '', type: 'full_mocks', section: '' };
let db = null; 
// Helper to ensure Firebase scripts are loaded before init
async function loadFirebaseScripts() {
    if (window.firebase) return; // Already loaded
    
    const scripts = [
        "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
        "https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"
    ];

    for (const src of scripts) {
        await new Promise((resolve) => {
            const script = document.createElement("script");
            script.src = src;
            script.onload = resolve;
            document.head.appendChild(script);
        });
    }
}
async function initExamEngine() {
    const pathParts = window.location.pathname.split('/');
    const examName = pathParts[pathParts.length - 2];
    
    document.getElementById('grid-sync').innerText = "🔄 Syncing Premium Database...";
    
    try {
        // 1. Ensure Firebase scripts are present
        await loadFirebaseScripts();

        // 2. Load Config and Init Firebase
        try {
            await import('/firebase-config.js');
            if (typeof FIREBASE_PROJECTS !== 'undefined' && FIREBASE_PROJECTS[examName]) {
                if (!firebase.apps.length) {
                    firebase.initializeApp(FIREBASE_PROJECTS[examName]);
                }
                db = firebase.database();
            }
        } catch (e) {
            if (window.FIREBASE_PROJECTS && window.FIREBASE_PROJECTS[examName]) {
                if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_PROJECTS[examName]);
                db = firebase.database();
            }
        }

        // 3. Fetch Mock Data
        const response = await fetch(`https://sscjourneytest.github.io/sscjourneytest/data/${examName}-data.json`);
        EXAM_JSON = await response.json();
        
        const years = Object.keys(EXAM_JSON.data[currentFilters.tier]);
        currentFilters.year = years.sort().reverse()[0];
        
        setupFilters(years);
        renderMocks();
        syncStatusFromFirebase(); 
    } catch (e) {
        document.getElementById('grid-sync').innerHTML = "⚠️ Failed to sync. Check connection.";
    }
}

async function syncStatusFromFirebase() {
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    if (!profile || !db) return;
    const username = profile.username;

    try {
        const snapshot = await db.ref(`quiz_results`).once('value');
        const allResults = snapshot.val() || {};

        let cloudStatus = JSON.parse(localStorage.getItem('CLOUD_SYNC_STATUS') || "{}");
        let needsReRender = false;

        const source = EXAM_JSON.data[currentFilters.tier][currentFilters.year];
        const config = EXAM_JSON.config[currentFilters.tier];

        const checkId = (id) => {
            const cloudExists = allResults[id] && allResults[id][username];
            if (cloudExists && !cloudStatus[id]) {
                cloudStatus[id] = true;
                needsReRender = true;
            }
        };

        // 1. Check Full Mocks
        (source.full_mocks || []).forEach(m => checkId(m.id));

        // 2. Check Sectionals (Using backendName cleaning to match Template/Firebase)
        (source.full_mocks || []).forEach(m => {
            (config.sections || []).forEach(sec => {
                const cleanSec = sec.backendName.replace(/\s+/g, '').toLowerCase();
                checkId(`${m.id}-${cleanSec}`);
            });
        });

        // 3. Check Subject Wise
        (source.subject_wise || []).forEach(m => checkId(m.id));

        localStorage.setItem('CLOUD_SYNC_STATUS', JSON.stringify(cloudStatus));
        if (needsReRender) renderMocks();
    } catch (err) {
        console.error("Firebase Sync Failed:", err);
    }
}

function setupFilters(years) {
    // Tier Toggle
    if (!EXAM_JSON.data.tier2) document.getElementById('tier-wrap').classList.add('hidden');
    
    // Year Scroll
    let yearHtml = '';
    years.forEach(y => {
        yearHtml += `<div class="pill-filter ${y === currentFilters.year ? 'active' : ''}" data-year="${y}" onclick="setYear('${y}', this)">${y}</div>`;
    });
    document.getElementById('year-scroll').innerHTML = yearHtml;

    // Type Filter Counting (Full, Sectional, Subject)
    const source = EXAM_JSON.data[currentFilters.tier][currentFilters.year];
    const fullCount = (source.full_mocks || []).length;
    const sectionalCount = fullCount * (EXAM_JSON.config[currentFilters.tier].sections.length);
    const subjectCount = (source.subject_wise || []).length;

    const typePills = document.querySelectorAll('#type-filters .pill-filter');
    typePills[0].innerHTML = `Full Mocks (${fullCount})`;
    typePills[1].innerHTML = `Sectionals (${sectionalCount})`;
    typePills[2].innerHTML = `Subject Wise (${subjectCount})`;
}

function renderMocks() {
    const grid = document.getElementById('quizGrid');
    const config = EXAM_JSON.config[currentFilters.tier];
    const source = EXAM_JSON.data[currentFilters.tier][currentFilters.year];
    const searchVal = document.getElementById('mockSearch').value.toLowerCase();
    
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const isPaidUser = profile ? profile.is_paid : false;
    const username = profile ? profile.username : "Guest";

    const cloudStatus = JSON.parse(localStorage.getItem('CLOUD_SYNC_STATUS') || "{}");

    let html = '';
    let rawList = source[currentFilters.type] || [];
    let itemsToDisplay = [];

    if (currentFilters.type === 'sectional') {
        const fullMocksForSection = source.full_mocks || [];
        const sectionDef = config.sections.find(s => s.id === currentFilters.section);
        
        fullMocksForSection.forEach(mock => {
            // FIXED: Now using backendName for ID generation to match Firebase/Test Template
            const cleanSec = sectionDef.backendName.replace(/\s+/g, '').toLowerCase();
            itemsToDisplay.push({
                ...mock,
                id: `${mock.id}-${cleanSec}`,
                originalId: mock.id,
                title: `${mock.title} - ${sectionDef.name}`,
                qs: sectionDef.qs,
                time: sectionDef.time,
                marks: sectionDef.marks,
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
        
        const localResult = localStorage.getItem(`result_${username}_${item.id}`);
        const savedState = JSON.parse(localStorage.getItem(`state_${username}_${item.id}`) || "{}");
        
        const isSubmitted = localResult !== null || cloudStatus[item.id];

        let actionHtml = '';

        if (isLockedDate) {
            actionHtml = `<div class="action-btn unlock-btn" style="opacity:0.6; cursor:default;">Available ${item.releaseDate}</div>`;
        } else if (accessDenied) {
            actionHtml = `<a href="/buy-premium.html" class="action-btn unlock-btn">🔒 UNLOCK TEST</a>`;
        } else {
            if (isSubmitted) {
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
    syncStatusFromFirebase(); 
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
    syncStatusFromFirebase(); 
}

function reattempt(id, url) {
    const profile = getLocalProfile();
    const username = profile ? profile.username : "Guest";
    if(confirm("Confirm Reattempt? Previous result will be deleted.")) {
        localStorage.removeItem(`result_${username}_${id}`);
        localStorage.removeItem(`state_${username}_${id}`);
        let cloudStatus = JSON.parse(localStorage.getItem('CLOUD_SYNC_STATUS') || "{}");
        delete cloudStatus[id];
        localStorage.setItem('CLOUD_SYNC_STATUS', JSON.stringify(cloudStatus));
        window.location.href = url + "&mode=reattempt";
    }
}
