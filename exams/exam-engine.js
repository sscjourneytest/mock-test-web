let EXAM_JSON = null;
let currentFilters = { tier: 'tier1', year: '', type: 'full_mocks', section: '' };
let CLOUD_CHECKLIST = {};
const SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 Hours 
async function initExamEngine() {
    const pathParts = window.location.pathname.split('/');
    const examName = pathParts[pathParts.length - 2];
    document.getElementById('grid-sync').innerText = "🔄 Syncing Database...";
    try {
        // 1. Fetch Mock Data immediately (Normal Way - Fast)
        const response = await fetch(`https://sscjourneytest.github.io/sscjourneytest/data/${examName}-data.json`);
        EXAM_JSON = await response.json();
        
        const years = Object.keys(EXAM_JSON.data[currentFilters.tier]);
        currentFilters.year = years.sort().reverse()[0];
        
        setupFilters(years);
        renderMocks(); // First render: Shows cards immediately

        // 2. Start Cloud Sync in the background (Does not block the cards)
        syncWithCloud(examName);
        
    } catch (e) {
        console.error("Engine initialization failed", e);
    }
}

async function syncWithCloud(examName) {
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    if (!profile || profile.username === "Guest") return;

    const cacheKey = `CLOUD_SYNC_${profile.username}_${examName}`;
    const lastSync = localStorage.getItem(`${cacheKey}_TIME`);
    const cachedData = localStorage.getItem(cacheKey);

    // Load from local cache immediately if it exists so buttons flip quickly
    if (cachedData) {
        CLOUD_CHECKLIST = JSON.parse(cachedData);
        renderMocks(); 
    }

    // Check if 24 hours expired to fetch fresh data from GitHub via Worker
    if (!lastSync || (Date.now() - parseInt(lastSync) > SYNC_EXPIRY_MS)) {
        try {
            const workerURL = "https://mmh-userdata.maniyamaniya789.workers.dev/";
            const res = await fetch(`${workerURL}?user=${profile.username}&exam=${examName}`);
            
            if (res.ok) {
                const freshData = await res.json();
                
                // --- CLEANUP LOGIC ---
                // If local results exist but are NOT in GitHub, delete them (Remote delete sync)
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith(`result_${profile.username}_`)) {
                        const id = key.replace(`result_${profile.username}_`, "");
                        // Only sync-delete for the current exam's IDs
                        if (!freshData[id] && id.includes(examName.toUpperCase())) {
                            localStorage.removeItem(key);
                            localStorage.removeItem(`state_${profile.username}_${id}`);
                        }
                    }
                });

                CLOUD_CHECKLIST = freshData;
                localStorage.setItem(cacheKey, JSON.stringify(freshData));
                localStorage.setItem(`${cacheKey}_TIME`, Date.now().toString());
                
                renderMocks(); // Final render: Buttons flip to Analysis if cloud data found
            }
        } catch (e) {
            console.error("Background sync failed", e);
        }
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

        const isSubmitted = localResult !== null || CLOUD_CHECKLIST[item.id];
        
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
function reattempt(id, url) {
    const profile = getLocalProfile();
    const username = profile ? profile.username : "Guest";
    const examName = window.location.pathname.split('/').slice(-2, -1)[0];

    if(confirm("Confirm Reattempt? Are you sure to reattempt.")) {
        // 1. Clear actual local results
        localStorage.removeItem(`result_${username}_${id}`);
        localStorage.removeItem(`state_${username}_${id}`);

        // 2. Remove from Cloud Cache and RAM so button flips back to "START"
        if (CLOUD_CHECKLIST[id]) {
            delete CLOUD_CHECKLIST[id];
            const cacheKey = `CLOUD_SYNC_${username}_${examName}`;
            localStorage.setItem(cacheKey, JSON.stringify(CLOUD_CHECKLIST));
        }

        window.location.href = url + "&mode=reattempt";
    }
}

