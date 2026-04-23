let EXAM_JSON = null;
let currentFilters = { tier: 'tier1', year: '', type: 'full_mocks', section: '' };
let CLOUD_CHECKLIST = {};
const SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 Hours 

async function initExamEngine() {
    const pathParts = window.location.pathname.split('/');
    
    // 1. Detect Exam Name: Try URL Query (?AtoZ-V) first, fallback to folder name
    let examName = window.location.search ? window.location.search.slice(1) : pathParts[pathParts.length - 2];
    
    document.getElementById('grid-sync').innerText = "🔄 Syncing Database...";
    try {
       // Change: Use raw.githubusercontent and add a timestamp to force latest content
        const rawUrl = `https://raw.githubusercontent.com/sscjourneytest/sscjourneytest/main/data/${examName}-data.json?t=${Date.now()}`;
        const response = await fetch(rawUrl);
        
        EXAM_JSON = await response.json();
        
        // 2. Identify Years: Handle cases where tiers or years might be missing
        let years = [];
        try {
            years = Object.keys(EXAM_JSON.data[currentFilters.tier]);
        } catch(e) { 
            years = ["default"]; 
        }

        // 3. Set Year: If "default" exists (Series structure), use it; otherwise pick latest year
        if (years.includes("default") || years.length === 0) {
            currentFilters.year = "default";
        } else {
            currentFilters.year = years.sort().reverse()[0];
        }
        
        setupFilters(years);
        renderMocks(); 
        syncWithCloud(examName);
        
    } catch (e) {
        console.error("Engine initialization failed", e);
    }
}


async function syncWithCloud(examName) {
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    if (!profile || profile.username === "Guest") return;

    // 1. IMPROVED: Unique cache keys per exam type to prevent overwriting
    const cacheKey = `CLOUD_SYNC_${profile.username}_${examName.toLowerCase()}`;
    const timeKey = `${cacheKey}_TIME`;

    const lastSync = localStorage.getItem(timeKey);
    const cachedData = localStorage.getItem(cacheKey);

    // 2. Load from local cache immediately if it exists for THIS specific exam
    if (cachedData) {
        CLOUD_CHECKLIST = JSON.parse(cachedData);
        renderMocks(); 
    }

    // 3. Check if 24 hours expired for THIS specific exam
    if (!lastSync || (Date.now() - parseInt(lastSync) > SYNC_EXPIRY_MS)) {
        try {
            const workerURL = "https://mmh-userdata.maniyamaniya789.workers.dev/";
            const res = await fetch(`${workerURL}?user=${profile.username}&exam=${examName}`);
            
            if (res.ok) {
                const freshData = await res.json();
                
                // --- CLEANUP LOGIC ---
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith(`result_${profile.username}_`)) {
                        const id = key.replace(`result_${profile.username}_`, "");
                        // Only sync-delete for the current exam's IDs
                        if (!freshData[id] && id.toLowerCase().includes(examName.toLowerCase())) {
                            localStorage.removeItem(key);
                            localStorage.removeItem(`state_${profile.username}_${id}`);
                        }
                    }
                });

                // 4. Update memory and local storage with fresh data
                CLOUD_CHECKLIST = freshData;
                localStorage.setItem(cacheKey, JSON.stringify(freshData));
                localStorage.setItem(timeKey, Date.now().toString());
                
                renderMocks(); // Final render: Buttons flip to Analysis if cloud data found
            }
        } catch (e) {
            console.error("Background sync failed", e);
        }
    }
}

function setupFilters(years) {
    // 1. Tier Toggle Fallback
    const tierWrap = document.getElementById('tier-wrap');
    if (EXAM_JSON.data.tier2) {
        tierWrap.classList.remove('hidden');
    } else {
        tierWrap.classList.add('hidden');
        currentFilters.tier = 'tier1'; 
    }
    
    // 2. Year Scroll (Updated with Hide Logic)
    const yearScroll = document.getElementById('year-scroll');
    if (years.length === 0 || (years.length === 1 && years[0] === "default")) {
        yearScroll.classList.add('hidden');
    } else {
        yearScroll.classList.remove('hidden');
        let yearHtml = '';
        years.forEach(y => {
            yearHtml += `<div class="pill-filter ${y === currentFilters.year ? 'active' : ''}" data-year="${y}" onclick="setYear('${y}', this)">${y}</div>`;
        });
        yearScroll.innerHTML = yearHtml;
    }

    // 3. Robust Counting (The Fix for NTPCG)
    const source = EXAM_JSON.data[currentFilters.tier][currentFilters.year] || {};
    const config = EXAM_JSON.config[currentFilters.tier] || {};

    const fullCount = (source.full_mocks || []).length;
    const sectionsCount = (config.sections || []).length; 
    const sectionalCount = fullCount * sectionsCount;
    const subjectCount = (source.subject_wise || []).length;

    const typePills = document.querySelectorAll('#type-filters .pill-filter');
    
    if (typePills.length >= 3) {
        typePills[0].innerHTML = `Full Mocks (${fullCount})`;
        typePills[1].innerHTML = `Sectionals (${sectionalCount})`;
        typePills[2].innerHTML = `Subject Wise (${subjectCount})`;

        if (sectionsCount === 0) {
            typePills[1].style.display = 'none';
        } else {
            typePills[1].style.display = 'block';
        }
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

        // Locate the isLockedDate logic in renderMocks and replace it with this:

let isLockedDate = false;
if (item.releaseDate && item.releaseDate.trim() !== "") {
    const [day, month, year] = item.releaseDate.split('-').map(Number);
    const releaseDateObj = new Date(year, month - 1, day); 
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to start of day for fair comparison
    
    isLockedDate = releaseDateObj > today;
} else {
    // If releaseDate is empty or null, the mock is always available
    isLockedDate = false;
}
        

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
            } else if (savedState.isPaused && savedState) {
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
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const username = profile ? profile.username : "Guest";
    
    // Detect exam name from query string first, then path
    let examName = window.location.search ? window.location.search.slice(1) : window.location.pathname.split('/').slice(-2, -1)[0];

    if(confirm("Confirm Reattempt? Are you sure to reattempt.")) {
        localStorage.removeItem(`result_${username}_${id}`);
        localStorage.removeItem(`state_${username}_${id}`);
        localStorage.removeItem(`stream_${username}_${id}`);

        const cacheKey = `CLOUD_SYNC_${username}_${examName.toLowerCase()}`;
        
        if (CLOUD_CHECKLIST[id]) {
            delete CLOUD_CHECKLIST[id];
            localStorage.setItem(cacheKey, JSON.stringify(CLOUD_CHECKLIST));
        }

        window.location.href = url + "&mode=reattempt";
    }
}

// This listener runs every time the page becomes visible
window.addEventListener('pageshow', function(event) {
    initExamEngine();
    // 1. Check if the page is being loaded from the browser cache (Back button)
    if (event.persisted || (window.performance && window.performance.navigation.type === 2)) {
        console.log("Back button detected: Refreshing mock states...");
        
        // 2. Re-run renderMocks to pick up any new results saved in localStorage
        if (typeof renderMocks === 'function' && EXAM_JSON) {
            renderMocks(); 
        }
    }
});
