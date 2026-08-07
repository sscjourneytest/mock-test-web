// live-mock-engine.js — Live Test Engine (generic: Full Live Mock, Sectional Live Mock,
// Current Affairs Live, or any future live category — nothing below is hardcoded to one shape)
//
// Data source: same pattern as exam-engine.js — one JSON file, fetched by
// exam name derived from the URL (?exam-name or /exam-name/), giving
// {examName}-data.json — e.g. live-test-data.json for this page's URL.
//
// Contract for each item in the JSON (all fields are strings):
//   {
//     "id": "CGL-LIVE-01",
//     "title": "SSC CGL Live Mock #1",
//     "type": "free" | "paid",
//     "linkStr": "",              // optional — falls back to id if empty
//     "qs": "100",
//     "marks": "200",
//     "time": "60 Min",
//     "liveFrom": "28-07-2026 10:00",   // DD-MM-YYYY HH:MM, 24-hour, IST
//     "liveTo":   "28-07-2026 11:00",
//     "releaseDate": ""            // optional — same manual-lock convention as other pages
//   }
//
// Top level of the JSON = categories directly (no PYQ-MOCK-style wrapper):
//   { "data": { "Full Live Mock": <node>, "Sectional Live Mock": <node>, ... },
//     "config": { ... } }
//
// Each category's <node> can be:
//   - a flat array of items straight away, OR
//   - nested filter levels (any depth), auto-detected exactly like ssc-sub-engine.js's
//     _depth()/_countItems() helpers — if the data doesn't nest, no filter row is shown.

let LIVE_JSON = null;
let currentCategory = null;
// currentFilters holds ONLY the dynamically-detected filter levels for the
// active category — keys are invented at runtime (level0, level1, level2...)
// since depth/labels aren't known ahead of time and can differ per category.
let currentFilters = {};
let currentStatusTab = 'live'; // 'upcoming' | 'live' | 'previous'

// { quizId: true } map — populated from localStorage cache, refreshed from Worker
let CLOUD_CHECKLIST = {};
const SYNC_EXPIRY_MS = 48 * 60 * 60 * 1000; // matches Worker KV TTL
const WORKER_URL = "https://mmh-userdata-test.maniyamaniya789.workers.dev/";

let _countdownInterval = null;

// ── Exam Name Resolution (same convention as exam-engine.js / ssc-sub-engine.js) ──
function _getExamNameFromUrl() {
    const pathParts = window.location.pathname.split('/');
    if (window.location.search) return window.location.search.slice(1);
    return pathParts[pathParts.length - 2];
}

// ── IST "now" helper ──────────────────────────────────────────────────────────
// Server/device clock may be in any timezone — always compare against IST,
// since liveFrom/liveTo are authored in IST.
function _nowIST() {
    // en-US + Asia/Kolkata gives a reliably parseable "MM/DD/YYYY, HH:MM:SS" string
    const istString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    return new Date(istString);
}

// Parses "DD-MM-YYYY HH:MM" as an IST wall-clock time and returns a Date
// that's directly comparable to _nowIST() (both are "IST-as-if-local").
function _parseLiveDateTime(str) {
    if (!str) return null;
    const m = str.trim().match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/);
    if (!m) return null;
    const [, dd, mm, yyyy, hh, min] = m;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
}

// ── Status bucket: upcoming | live | previous ─────────────────────────────────
function _getItemStatus(item) {
    const from = _parseLiveDateTime(item.liveFrom);
    const to = _parseLiveDateTime(item.liveTo);
    if (!from || !to) return 'live'; // malformed/missing times — don't hide it, just show as live
    const now = _nowIST();
    if (now < from) return 'upcoming';
    if (now > to) return 'previous';
    return 'live';
}

// ── Countdown text: "Ends in 2h 14m 5s" / "Starts in 1d 3h" / "Ended" ────────
function _formatCountdown(item) {
    const from = _parseLiveDateTime(item.liveFrom);
    const to = _parseLiveDateTime(item.liveTo);
    const now = _nowIST();

    if (from && now < from) {
        return { text: 'Starts ' + _relativeTime(from - now), cls: 'upcoming' };
    }
    if (to && now <= to) {
        return { text: 'Ends in ' + _relativeTime(to - now, true), cls: 'live' };
    }
    return { text: 'Ended', cls: 'ended' };
}

function _relativeTime(ms, short) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (short) return `${h}h ${m}m ${s}s`;
    return `${h}h ${m}m`;
}

// ── Depth Detection (same as ssc-sub-engine.js _depth/_countItems) ───────────
function _depth(node) {
    if (!node || Array.isArray(node)) return 0;
    const firstVal = Object.values(node)[0];
    if (Array.isArray(firstVal)) return 1;
    return 1 + _depth(firstVal);
}
function _countItems(node) {
    if (!node) return 0;
    if (Array.isArray(node)) return node.length;
    let count = 0;
    Object.values(node).forEach(v => count += _countItems(v));
    return count;
}
// Walks currentFilters (level0, level1, ...) down into the category node and
// returns the array of items at the bottom, or [] if a level isn't picked yet.
function _resolveItems(categoryNode) {
    let node = categoryNode;
    let level = 0;
    while (node && !Array.isArray(node)) {
        const key = currentFilters['level' + level];
        if (!key || !(key in node)) return [];
        node = node[key];
        level++;
    }
    return Array.isArray(node) ? node : [];
}

// ── Filter Persistence (per exam + category, same pattern as other engines) ──
function _filterCacheKey() {
    return `liveMockFilters_${_getExamNameFromUrl()}_${currentCategory}`;
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

// ── Init ──────────────────────────────────────────────────────────────────────
async function initLiveMockEngine() {
    // Same convention as exam-engine.js / ssc-sub-engine.js — exam name is
    // derived from the URL (?exam-name or /exam-name/), and the JSON filename
    // is built from it. In this page's actual URL, that resolves to
    // "live-test", giving live-test-data.json — but the logic itself is
    // generic, not hardcoded to that one value.
    const examName = _getExamNameFromUrl();

    document.getElementById('grid-sync').innerText = "";
    renderSkeleton();

    try {
        const rawUrl = `https://raw.githubusercontent.com/sscjourneytest/sscjourneytest/main/data/${examName}-data.json?t=${Date.now()}`;
        const response = await fetch(rawUrl);
        LIVE_JSON = await response.json();

        const categories = Object.keys(LIVE_JSON.data || {});
        if (categories.length === 0) {
            document.getElementById('quizGrid').innerHTML = `<div class="empty-state">No live mocks configured yet.</div>`;
            return;
        }

        renderCategoryFilters(categories);
        if (!currentCategory || !categories.includes(currentCategory)) {
            currentCategory = categories[0];
        }

        loadSavedFilters();
        setupDeepFilters();
        renderStatusTabs();
        renderMocks();

        syncWithCloud(examName);
        _startCountdownTicker();

    } catch (e) {
        console.error("Live engine initialization failed", e);
        document.getElementById('quizGrid').innerHTML = `<div class="empty-state">Couldn't load live mocks. Please try again.</div>`;
    }
}

function _startCountdownTicker() {
    if (_countdownInterval) clearInterval(_countdownInterval);
    // Re-render every second so countdown pills tick down live, and items
    // automatically flip tabs the moment they cross a live/previous boundary.
    _countdownInterval = setInterval(() => {
        if (LIVE_JSON) renderMocks();
    }, 1000);
}

// ── Category Filters (top row: Full Live Mock / Sectional Live Mock / ...) ──
function renderCategoryFilters(categories) {
    const wrap = document.getElementById('category-wrap');
    if (!wrap) return;
    if (categories.length <= 1) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    wrap.innerHTML = categories.map(cat =>
        `<div class="pill-filter ${cat === currentCategory ? 'active' : ''}" onclick="setCategory('${cat}', this)">${cat}</div>`
    ).join('');
}
function setCategory(cat, el) {
    currentCategory = cat;
    currentFilters = {};
    document.querySelectorAll('#category-wrap .pill-filter').forEach(p => p.classList.remove('active'));
    if (el) el.classList.add('active');
    loadSavedFilters();
    setupDeepFilters();
    renderMocks();
}

// ── Deep Filters (auto-detected depth, any number of levels or none) ─────────
function setupDeepFilters() {
    const wrap = document.getElementById('deep-filter-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    const categoryNode = LIVE_JSON.data[currentCategory];
    const depth = _depth(categoryNode);

    if (depth === 0) { wrap.classList.add('hidden'); return; } // flat array — no filter row needed
    wrap.classList.remove('hidden');

    let node = categoryNode;
    for (let level = 0; level < depth; level++) {
        const keys = Object.keys(node);
        const filterKey = 'level' + level;

        if (!currentFilters[filterKey] || !keys.includes(currentFilters[filterKey])) {
            currentFilters[filterKey] = keys[0];
        }

        const row = document.createElement('div');
        row.className = 'filter-scroll-wrapper';
        row.id = 'deep-filter-level-' + level;
        row.innerHTML = keys.map(k => {
            const count = _countItems(node[k]);
            return `<div class="pill-filter ${k === currentFilters[filterKey] ? 'active' : ''}" onclick="setDeepFilter(${level}, '${k.replace(/'/g, "\\'")}')">${k} (${count})</div>`;
        }).join('');
        wrap.appendChild(row);

        node = node[currentFilters[filterKey]];
        if (Array.isArray(node)) break;
    }
    saveFilters();
}
function setDeepFilter(level, value) {
    currentFilters['level' + level] = value;
    // reset all deeper levels — they're no longer valid once a shallower one changes
    Object.keys(currentFilters).forEach(k => {
        const lvl = parseInt(k.replace('level', ''), 10);
        if (lvl > level) delete currentFilters[k];
    });
    saveFilters();
    setupDeepFilters();
    renderMocks();
}

// ── Status Tabs (Upcoming / Currently Live / Previously Live) ────────────────
function renderStatusTabs() {
    const wrap = document.getElementById('status-tabs-wrap');
    if (!wrap) return;

    const allItems = _getAllItemsForCategory();
    const counts = { upcoming: 0, live: 0, previous: 0 };
    allItems.forEach(item => counts[_getItemStatus(item)]++);

    const tabs = [
        { key: 'upcoming', label: 'Upcoming Live' },
        { key: 'live', label: 'Currently Live' },
        { key: 'previous', label: 'Previously Live' }
    ];
    wrap.innerHTML = tabs.map(t =>
        `<div class="live-status-tab ${currentStatusTab === t.key ? 'active' : ''}" onclick="setStatusTab('${t.key}', this)">${t.label}<span class="tab-count">${counts[t.key]}</span></div>`
    ).join('');
}
function setStatusTab(key, el) {
    currentStatusTab = key;
    document.querySelectorAll('.live-status-tab').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
    renderMocks();
}

// Returns every item under the current category, regardless of currently
// selected deep filter — used only to compute tab counts.
function _getAllItemsForCategory() {
    const node = LIVE_JSON.data[currentCategory];
    const items = [];
    (function walk(n) {
        if (Array.isArray(n)) { items.push(...n); return; }
        if (n && typeof n === 'object') Object.values(n).forEach(walk);
    })(node);
    return items;
}

// ── Render Skeleton ────────────────────────────────────────────────────────
function renderSkeleton() {
    document.getElementById('quizGrid').innerHTML = Array(6).fill(`
        <div class="skeleton-live-card">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line skeleton-meta"></div>
            <div class="skeleton-line skeleton-btn"></div>
        </div>`).join('');
}

// ── Link resolution — same idea as exam-engine.js's getLink(config), but
// keyed per-category (live mocks have no tier concept). Looks up
// LIVE_JSON.config[currentCategory].link first, falls back to
// LIVE_JSON.config.default.link, and only falls back to "/test.html"
// hardcoded if neither is present in the JSON at all — so if config
// data is missing entirely, the page still works instead of breaking.
function getLiveLink() {
    const perCategory = LIVE_JSON.config && LIVE_JSON.config[currentCategory];
    if (perCategory && perCategory.link) return perCategory.link;

    const fallback = LIVE_JSON.config && LIVE_JSON.config.default;
    if (fallback && fallback.link) return fallback.link;

    return "/test.html";
}

// ── Render Mocks ──────────────────────────────────────────────────────────────
function renderMocks() {
    renderStatusTabs();

    const grid = document.getElementById('quizGrid');
    const searchVal = (document.getElementById('mockSearch')?.value || '').toLowerCase();
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const isPaidUser = profile ? profile.is_paid : false;
    const username = profile ? profile.username : "Guest";

    const categoryNode = LIVE_JSON.data[currentCategory];
    const rawItems = _resolveItems(categoryNode);
    const testPageLink = getLiveLink();

    const itemsToDisplay = rawItems
        .map(item => {
            const idPart = (item.linkStr && item.linkStr.trim()) ? item.linkStr.trim() : item.id;
            return { ...item, linkParam: `id=${idPart}`, originalId: item.id };
        })
        .filter(item => _getItemStatus(item) === currentStatusTab);

    let html = '';

    itemsToDisplay.forEach(item => {
        if (searchVal && !item.title.toLowerCase().includes(searchVal)) return;

        // Manual/date lock — same convention as exam-engine.js
        const isManuallyLocked = item.releaseDate && item.releaseDate.trim().toLowerCase() === 'locked';
        let isLockedDate = false;
        if (!isManuallyLocked && item.releaseDate && item.releaseDate.trim() !== "") {
            const [day, month, year] = item.releaseDate.split('-').map(Number);
            const releaseDateObj = new Date(year, month - 1, day);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            isLockedDate = releaseDateObj > today;
        }

        const accessDenied = item.type === 'paid' && !isPaidUser;
        const status = _getItemStatus(item);
        const countdown = _formatCountdown(item);

        const localResult = localStorage.getItem(`result_${username}_${item.id}`);
        const isSubmitted = localResult !== null || !!CLOUD_CHECKLIST[item.id];

        let actionHtml = '';
        if (isManuallyLocked) {
            actionHtml = `<div class="action-btn locked-btn">🔒 LOCKED</div>`;
        } else if (isLockedDate) {
            actionHtml = `<div class="action-btn locked-btn">AVAILABLE ${item.releaseDate}</div>`;
        } else if (accessDenied) {
            actionHtml = `<a href="/buy-premium.html" class="action-btn unlock-btn">🔒 UNLOCK TEST</a>`;
        } else if (status === 'upcoming') {
            actionHtml = `<div class="action-btn waiting-btn">STARTS SOON</div>`;
        } else if (isSubmitted) {
            // Attempted: analysis always available; reattempt only once the
            // live window has ended (no reattempt while still live).
            const reattemptBtn = status === 'live'
                ? `<button class="action-btn reattempt-btn disabled-live" disabled title="Reattempt opens after the live window ends">REATTEMPT</button>`
                : `<button onclick="reattemptLive('${item.id}', '${testPageLink}?${item.linkParam}')" class="action-btn reattempt-btn">REATTEMPT</button>`;
            actionHtml = `<div class="btn-grid btn-dual">
                <a href="${testPageLink}?${item.linkParam}" class="action-btn analysis-btn">ANALYSIS</a>
                ${reattemptBtn}
            </div>`;
        } else if (status === 'previous') {
            actionHtml = `<div class="action-btn ended-btn">LIVE WINDOW ENDED</div>`;
        } else {
            actionHtml = `<a href="${testPageLink}?${item.linkParam}" class="action-btn start-btn">START NOW</a>`;
        }

        html += `
            <div class="live-mock-card">
                <div class="card-body">
                    <div class="card-header-row">
                        <div class="card-title">${item.title}</div>
                        <div class="card-header-badges">
                            <span class="badge-type ${item.type === 'free' ? 'free-badge' : 'paid-badge'}">${item.type.toUpperCase()}</span>
                            <span class="countdown-pill ${countdown.cls}">${countdown.text}</span>
                        </div>
                    </div>
                    <hr class="card-divider">
                    <div class="card-meta-row"><i class="fas fa-calendar-alt"></i> ${item.liveFrom} - ${item.liveTo}</div>
                    <div class="card-meta-row"><i class="fas fa-bullseye"></i> ${item.marks || '--'} Marks</div>
                    <div class="card-meta-row"><i class="fas fa-question-circle"></i> ${item.qs || '--'} Questions</div>
                </div>
                ${actionHtml}
            </div>
        `;
    });

    grid.innerHTML = html || `<div class="empty-state">No mocks in this tab right now.</div>`;
    document.getElementById('grid-sync').innerText = "";
}

// ══════════════════════════════════════════════════════════════════════════════
//  syncWithCloud — identical strategy to exam-engine.js: cache-first, 48h TTL,
//  Worker-mediated Firebase read, no direct Firebase call from this page.
// ══════════════════════════════════════════════════════════════════════════════
async function syncWithCloud(examName) {
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    if (!profile || profile.username === "Guest") return;

    const user = profile.username;
    const exam = examName.toLowerCase();
    const cacheKey = `CLOUD_SYNC_${user}_${exam}`;
    const timeKey = `${cacheKey}_TIME`;

    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
        try {
            CLOUD_CHECKLIST = JSON.parse(cachedRaw);
            renderMocks();
        } catch (e) {
            localStorage.removeItem(cacheKey);
        }
    }

    const lastSync = parseInt(localStorage.getItem(timeKey) || "0");
    const isStale = (Date.now() - lastSync) > SYNC_EXPIRY_MS;
    if (!isStale) return;

    try {
        const res = await fetch(`${WORKER_URL}?user=${encodeURIComponent(user)}&exam=${encodeURIComponent(exam)}`);
        if (!res.ok) throw new Error(`Worker ${res.status}`);
        const freshData = await res.json();

        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(`result_${user}_`)) {
                const id = key.replace(`result_${user}_`, "");
                if (id.toLowerCase().includes(exam) && !freshData[id]) {
                    localStorage.removeItem(`result_${user}_${id}`);
                    localStorage.removeItem(`state_${user}_${id}`);
                }
            }
        });

        CLOUD_CHECKLIST = freshData;
        localStorage.setItem(cacheKey, JSON.stringify(freshData));
        localStorage.setItem(timeKey, Date.now().toString());
        renderMocks();
    } catch (e) {
        console.error("Cloud sync failed (non-fatal):", e.message);
    }
}

// ── Reattempt (only reachable once live window has ended — see renderMocks) ──
async function reattemptLive(id, url) {
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const username = profile ? profile.username : "Guest";
    const examName = _getExamNameFromUrl();

    if (!confirm("Confirm Reattempt? Are you sure to reattempt.")) return;

    try {
        localStorage.removeItem(`result_${username}_${id}`);
        localStorage.removeItem(`state_${username}_${id}`);
        localStorage.removeItem(`stream_${username}_${id}`);

        const user = username;
        const exam = examName.toLowerCase();
        const cacheKey = `CLOUD_SYNC_${user}_${exam}`;

        delete CLOUD_CHECKLIST[id];
        localStorage.setItem(cacheKey, JSON.stringify(CLOUD_CHECKLIST));
        localStorage.setItem(`${cacheKey}_TIME`, Date.now().toString());

        const allCleared = [
            `result_${username}_${id}`,
            `state_${username}_${id}`,
            `stream_${username}_${id}`
        ].every(key => localStorage.getItem(key) === null);

        if (!allCleared) throw new Error("Cache clear failed — some keys still present");

        window.location.href = url + "&mode=reattempt";
    } catch (err) {
        console.error("Reattempt cleanup failed:", err);
        alert("Something went wrong while clearing your previous attempt. Please try again.");
    }
}

// ── Page Lifecycle (same bfcache-safe pattern as exam-engine.js) ─────────────
window.addEventListener('pageshow', function (event) {
    initLiveMockEngine();
    if (event.persisted || (window.performance && window.performance.navigation.type === 2)) {
        if (LIVE_JSON) renderMocks();
    }
});

// If getLocalProfile() was empty/broken when renderMocks() first ran
// (session live, cache not yet populated), mock cards would have rendered
// using the "Guest" default instead of the visitor's real is_paid status.
// auth.js fires this once the real profile lands — re-render to correct.
window.addEventListener('profileUpdated', function () {
    if (LIVE_JSON) renderMocks();
});


