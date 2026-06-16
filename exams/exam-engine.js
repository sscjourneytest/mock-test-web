// exam-engine.js — SSC Journey Mock Page Engine
// Cross-device attempt sync: Worker → Firebase user_attempts index (no GitHub)

let EXAM_JSON = null;
let currentFilters = { category: 'PYQ MOCK', tier: null, year: '', type: 'full_mocks', section: '' };

// ── Tier Label Formatter ──────────────────────────────────────────────────────
// Converts any raw key into a human-readable pill label.
// Known patterns: tier1→"Tier I", tier2→"Tier II", tier3→"Tier III", etc.
// Snake_case keys: higher_secondary→"Higher Secondary", matriculation→"Matriculation", etc.
// Unknown keys: title-cased as-is.
function formatTierLabel(key) {
    const tierMatch = key.match(/^tier(\d+)$/i);
    if (tierMatch) {
        const roman = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
        const n = parseInt(tierMatch[1], 10);
        return 'Tier ' + (roman[n - 1] || n);
    }
    // snake_case / camelCase → Title Case words
    return key
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Filter Persistence ────────────────────────────────────────────────────────
function _filterCacheKey() {
    const pathParts = window.location.pathname.split('/');
    const examName = window.location.search
        ? window.location.search.slice(1)
        : pathParts[pathParts.length - 2];
    return `examFilters_${examName}`;
}
function saveFilters() {
    try { sessionStorage.setItem(_filterCacheKey(), JSON.stringify(currentFilters)); } catch (e) {}
}
function loadSavedFilters() {
    try {
        const saved = sessionStorage.getItem(_filterCacheKey());
        if (saved) Object.assign(currentFilters, JSON.parse(saved));
    } catch (e) {}
}

// ── Cloud Checklist ───────────────────────────────────────────────────────────
// { quizId: true } map — populated from localStorage cache, refreshed from Worker
let CLOUD_CHECKLIST = {};

// 48h expiry matches Worker KV TTL — no point fetching more often than KV refreshes
const SYNC_EXPIRY_MS = 48 * 60 * 60 * 1000;

const WORKER_URL = "https://mmh-userdata-test.maniyamaniya789.workers.dev/";

// ── Init ──────────────────────────────────────────────────────────────────────
async function initExamEngine() {
    loadSavedFilters();

    const pathParts = window.location.pathname.split('/');
    let examName = window.location.search
        ? window.location.search.slice(1)
        : pathParts[pathParts.length - 2];

    document.getElementById('grid-sync').innerText = "Loading...";
    try {
        const rawUrl = `https://raw.githubusercontent.com/sscjourneytest/sscjourneytest/main/data/${examName}-data.json?t=${Date.now()}`;
        const response = await fetch(rawUrl);
        EXAM_JSON = await response.json();

        if (!EXAM_JSON.data['PYQ MOCK'] && EXAM_JSON.data['tier1']) {
            EXAM_JSON.data = { "PYQ MOCK": EXAM_JSON.data };
        }

        const categories = Object.keys(EXAM_JSON.data);
        renderCategoryFilters(categories);

        if (!categories.includes(currentFilters.category)) {
            currentFilters.category = categories[0];
        }

        const categoryData   = EXAM_JSON.data[currentFilters.category];
        const availableTiers = Object.keys(categoryData);

        // Auto-detect: null means first load or new exam — always pick from data
        if (!currentFilters.tier || !availableTiers.includes(currentFilters.tier)) {
            currentFilters.tier = availableTiers[0];
        }

        let years = Object.keys(categoryData[currentFilters.tier] || {});
        if (years.includes("default") || years.length === 0) {
            currentFilters.year = "default";
        } else {
            currentFilters.year = years.sort().reverse()[0];
        }

        setupFilters(years);
        renderMocks();

        // Sync cross-device status in background (non-blocking)
        syncWithCloud(examName);

    } catch (e) {
        console.error("Engine initialization failed", e);
        document.getElementById('grid-sync').innerText = "";
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  syncWithCloud  —  Cross-device attempt checker
//
//  BANDWIDTH STRATEGY:
//    1. Load localStorage cache immediately — instant render, zero network
//    2. If cache < 48h old — skip network entirely (matches Worker KV TTL)
//    3. If stale — GET from Worker (Worker serves KV cache or reads Firebase)
//    4. Worker returns tiny { quizId: true } map (~200 bytes typical)
//    5. Re-render mocks with updated ANALYSIS buttons
//
//  Firebase is NOT called directly from this page.
//  Worker handles Firebase reads with its own 48h KV cache.
// ══════════════════════════════════════════════════════════════════════════════
async function syncWithCloud(examName) {
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    if (!profile || profile.username === "Guest") return;

    const user = profile.username;
    const exam = examName.toLowerCase();

    const cacheKey = `CLOUD_SYNC_${user}_${exam}`;
    const timeKey  = `${cacheKey}_TIME`;

    // ── Step 1: Load cache immediately (instant render) ───────────────────────
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
        try {
            CLOUD_CHECKLIST = JSON.parse(cachedRaw);
            renderMocks();
        } catch (e) {
            localStorage.removeItem(cacheKey);
        }
    }

    // ── Step 2: Check freshness — 48h matches Worker KV TTL ──────────────────
    const lastSync = parseInt(localStorage.getItem(timeKey) || "0");
    const isStale  = (Date.now() - lastSync) > SYNC_EXPIRY_MS;

    if (!isStale) return; // Still fresh — skip all network calls

    // ── Step 3: Fetch from Worker ─────────────────────────────────────────────
    try {
        const res = await fetch(
            `${WORKER_URL}?user=${encodeURIComponent(user)}&exam=${encodeURIComponent(exam)}`
        );
        if (!res.ok) throw new Error(`Worker ${res.status}`);

        // freshData = { "CGL-001": true, "CGL-002-english...": true }
        // Tiny payload — only IDs for this exam belonging to this user
        const freshData = await res.json();

        // ── Step 4: Clean up orphaned local results ───────────────────────────
        // If a quizId no longer appears in the cloud map for this exam,
        // it was deleted (reattempt from another device) — remove local copy
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(`result_${user}_`)) {
                const id = key.replace(`result_${user}_`, "");
                if (id.toLowerCase().includes(exam) && !freshData[id]) {
                    localStorage.removeItem(`result_${user}_${id}`);
                    localStorage.removeItem(`state_${user}_${id}`);
                }
            }
        });

        // ── Step 5: Update memory + cache ─────────────────────────────────────
        CLOUD_CHECKLIST = freshData;
        localStorage.setItem(cacheKey, JSON.stringify(freshData));
        localStorage.setItem(timeKey, Date.now().toString());

        renderMocks(); // Flip buttons to ANALYSIS where cloud data found

    } catch (e) {
        console.error("Cloud sync failed (non-fatal):", e.message);
        // Page works fine — falls back to localStorage-only detection
    }
}

// ── Filters & Rendering ───────────────────────────────────────────────────────

function setupFilters(years) {
    const tierWrap     = document.getElementById('tier-wrap');
    const availableTiers = Object.keys(EXAM_JSON.data[currentFilters.category] || {});

    if (availableTiers.length > 1) {
        tierWrap.classList.remove('hidden');
        let tierHtml = '';
        availableTiers.forEach(t => {
            tierHtml += `<div class="pill-filter ${t === currentFilters.tier ? 'active' : ''}" onclick="setTier('${t}', this)">${formatTierLabel(t)}</div>`;
        });
        tierWrap.innerHTML = tierHtml;
    } else {
        tierWrap.classList.add('hidden');
        currentFilters.tier = availableTiers[0] || currentFilters.tier;
    }

    const yearScroll = document.getElementById('year-scroll');
    yearScroll.classList.remove('hidden');
    let yearHtml = '';
    years.forEach(y => {
        yearHtml += `<div class="pill-filter ${y === currentFilters.year ? 'active' : ''}" data-year="${y}" onclick="setYear('${y}', this)">${y === 'default' ? 'Tests' : y}</div>`;
    });
    yearScroll.innerHTML = yearHtml;

    const categoryData   = EXAM_JSON.data[currentFilters.category];
    const source         = (categoryData[currentFilters.tier] || {})[currentFilters.year] || {};
    const config         = EXAM_JSON.config[currentFilters.tier] || {};
    const fullCount      = (source.full_mocks   || []).length;
    const sectionsCount  = (config.sections     || []).length;
    const sectionalCount = fullCount * sectionsCount;
    const subjectCount   = (source.subject_wise || []).length;

    const typePills = document.querySelectorAll('#type-filters .pill-filter');
    if (typePills.length >= 3) {
        typePills[0].innerHTML = `Full Mocks (${fullCount})`;
        typePills[1].innerHTML = `Sectionals (${sectionalCount})`;
        typePills[2].innerHTML = `Subject Wise (${subjectCount})`;
        typePills[1].style.display = (sectionsCount === 0) ? 'none' : 'block';
    }

    typePills.forEach(pill => {
        pill.classList.remove('active');
        if (pill.getAttribute('onclick') && pill.getAttribute('onclick').includes(`'${currentFilters.type}'`)) {
            pill.classList.add('active');
        }
    });

    const secWrap = document.getElementById('section-wrap');
    if (currentFilters.type === 'sectional') {
        secWrap.classList.remove('hidden');
        renderSectionPills();
    } else {
        secWrap.classList.add('hidden');
    }
}

function renderMocks() {
    const grid      = document.getElementById('quizGrid');
    const config    = EXAM_JSON.config[currentFilters.tier];
    const source    = EXAM_JSON.data[currentFilters.category][currentFilters.tier][currentFilters.year];
    const searchVal = document.getElementById('mockSearch').value.toLowerCase();

    const profile    = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const isPaidUser = profile ? profile.is_paid  : false;
    const username   = profile ? profile.username : "Guest";

    let html = '';
    let rawList        = source[currentFilters.type] || [];
    let itemsToDisplay = [];

    if (currentFilters.type === 'sectional') {
        const fullMocksForSection = source.full_mocks || [];
        const sectionDef = config.sections.find(s => s.id === currentFilters.section);
        fullMocksForSection.forEach(mock => {
            const cleanSec = sectionDef.backendName.replace(/\s+/g, '').toLowerCase();
            itemsToDisplay.push({
                ...mock,
                id:         `${mock.id}-${cleanSec}`,
                originalId: mock.id,
                title:      `${mock.title} - ${sectionDef.name}`,
                qs:         sectionDef.qs,
                time:       sectionDef.time,
                marks:      sectionDef.marks,
                linkParam:  `id=${mock.id}&section=${encodeURIComponent(sectionDef.backendName)}`
            });
        });
    } else {
        itemsToDisplay = rawList.map(item => ({ ...item, linkParam: `id=${item.id}`, originalId: item.id }));
    }

    itemsToDisplay.forEach(item => {
        if (searchVal && !item.title.toLowerCase().includes(searchVal)) return;

        // Date lock
        let isLockedDate = false;
        if (item.releaseDate && item.releaseDate.trim() !== "") {
            const [day, month, year] = item.releaseDate.split('-').map(Number);
            const releaseDateObj = new Date(year, month - 1, day);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            isLockedDate = releaseDateObj > today;
        }

        const accessDenied = item.type === 'paid' && !isPaidUser;

        // Check attempt: localStorage (device) OR CLOUD_CHECKLIST (cross-device via Worker)
        const localResult = localStorage.getItem(`result_${username}_${item.id}`);
        const savedState  = JSON.parse(localStorage.getItem(`state_${username}_${item.id}`) || "{}");
        const isSubmitted = localResult !== null || !!CLOUD_CHECKLIST[item.id];

        let actionHtml = '';
        if (isLockedDate) {
            actionHtml = `<div class="action-btn unlock-btn" style="opacity:0.6;cursor:default;">Available ${item.releaseDate}</div>`;
        } else if (accessDenied) {
            actionHtml = `<a href="/buy-premium.html" class="action-btn unlock-btn">🔒 UNLOCK TEST</a>`;
        } else if (isSubmitted) {
            actionHtml = `
                <div class="btn-grid btn-dual">
                    <a href="${getLink(config)}?${item.linkParam}" class="action-btn analysis-btn">ANALYSIS</a>
                    <button onclick="reattempt('${item.id}', '${getLink(config)}?${item.linkParam}')" class="action-btn reattempt-btn">REATTEMPT</button>
                </div>`;
        } else if (savedState.isPaused && savedState) {
            actionHtml = `<a href="${getLink(config)}?${item.linkParam}" class="action-btn resume-btn">▶️ RESUME TEST</a>`;
        } else {
            actionHtml = `<a href="${getLink(config)}?${item.linkParam}" class="action-btn start-btn">START TEST</a>`;
        }

        html += `
            <div class="mock-card">
                <div class="card-top">
                    <div class="card-info">
                        <div class="card-title">${item.title} <span class="badge-type ${item.type === 'free' ? 'free-badge' : 'paid-badge'}">${item.type.toUpperCase()}</span></div>
                        <div class="card-meta">${item.qs || 100} Questions ⏱️ ${item.time || '60 Min'}</div>
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
    if (currentFilters.type === 'sectional')  return "../" + config.sectional_link;
    return "../" + config.subject_link;
}

function setYear(y, el) {
    document.querySelectorAll('#year-scroll .pill-filter').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    currentFilters.year = y;
    saveFilters();
    const years = Object.keys(EXAM_JSON.data[currentFilters.category][currentFilters.tier]);
    setupFilters(years);
    renderMocks();
}

function setTier(t, el) {
    document.querySelectorAll('#tier-wrap .pill-filter').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    currentFilters.tier = t;
    const years = Object.keys(EXAM_JSON.data[currentFilters.category][currentFilters.tier] || {});
    currentFilters.year = years.includes("default") ? "default" : years.sort().reverse()[0];
    saveFilters();
    setupFilters(years);
    renderMocks();
}

function filterType(type, el) {
    document.querySelectorAll('#type-filters .pill-filter').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    currentFilters.type = type;
    saveFilters();
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
    const sections      = EXAM_JSON.config[currentFilters.tier].sections;
    const source        = EXAM_JSON.data[currentFilters.category][currentFilters.tier][currentFilters.year];
    const fullMockCount = (source.full_mocks || []).length;

    const validIds = sections.map(s => s.id);
    if (!validIds.includes(currentFilters.section)) {
        currentFilters.section = sections[0].id;
    }

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
    saveFilters();
    renderMocks();
}

function renderCategoryFilters(categories) {
    const wrap = document.getElementById('category-wrap');
    if (!wrap) return;
    wrap.classList.remove('hidden');
    let html = '';
    categories.forEach(cat => {
        html += `<div class="pill-filter ${cat === currentFilters.category ? 'active' : ''}" onclick="setCategory('${cat}', this)">${cat}</div>`;
    });
    wrap.innerHTML = html;
}

function setCategory(cat, el) {
    currentFilters.category = cat;
    document.querySelectorAll('#category-wrap .pill-filter').forEach(p => p.classList.remove('active'));
    el.classList.add('active');

    const categoryData   = EXAM_JSON.data[cat];
    const availableTiers = Object.keys(categoryData);
    if (!availableTiers.includes(currentFilters.tier)) {
        currentFilters.tier = availableTiers[0];
    }
    const years = Object.keys(categoryData[currentFilters.tier] || {});
    currentFilters.year = years.includes("default") ? "default" : years.sort().reverse()[0];
    saveFilters();
    setupFilters(years);
    renderMocks();
}


async function reattempt(id, url) {
    const profile  = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const username = profile ? profile.username : "Guest";

    let examName = window.location.search
        ? window.location.search.slice(1)
        : window.location.pathname.split('/').slice(-2, -1)[0];

    if (!confirm("Confirm Reattempt? Are you sure to reattempt.")) return;

    try {
        // Step 1: Remove all local keys for this quiz
        localStorage.removeItem(`result_${username}_${id}`);
        localStorage.removeItem(`state_${username}_${id}`);
        localStorage.removeItem(`stream_${username}_${id}`);

        // Step 2: Update in-memory checklist and save updated cache
        const user     = username.toLowerCase();
        const exam     = examName.toLowerCase();
        const cacheKey = `CLOUD_SYNC_${user}_${exam}`;

        delete CLOUD_CHECKLIST[id];
        localStorage.setItem(cacheKey, JSON.stringify(CLOUD_CHECKLIST));

        // Step 3: Reset sync timestamp to now — prevents Worker re-fetch on return
        // (Worker still has old Firebase data; local removal is source of truth)
        localStorage.setItem(`${cacheKey}_TIME`, Date.now().toString());

        // Step 4: Verify all keys are actually gone before navigating
        const allCleared = [
            `result_${username}_${id}`,
            `state_${username}_${id}`,
            `stream_${username}_${id}`
        ].every(key => localStorage.getItem(key) === null);

        if (!allCleared) throw new Error("Cache clear failed — some keys still present");

        // Step 5: Navigate only after confirmed cleanup
        window.location.href = url + "&mode=reattempt";

    } catch (err) {
        console.error("Reattempt cleanup failed:", err);
        alert("Something went wrong while clearing your previous attempt. Please try again.");
    }
}
// ── Page lifecycle ─────────────────────────────────────────────────────────────
window.addEventListener('pageshow', function (event) {
    initExamEngine();
    if (event.persisted || (window.performance && window.performance.navigation.type === 2)) {
        if (typeof renderMocks === 'function' && EXAM_JSON) {
            renderMocks();
        }
    }
});
