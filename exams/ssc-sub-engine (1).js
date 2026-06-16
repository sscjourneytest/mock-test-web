let EXAM_JSON = null;
// Four-layer filters: year → subject → topic → subtopic
let currentFilters = { year: '', subject: '', topic: '', subtopic: '' };
// { quizId: true } map — populated from localStorage cache, refreshed from Worker
let CLOUD_CHECKLIST = {};

// 48h expiry matches Worker KV TTL — no point fetching more often than KV refreshes
const SYNC_EXPIRY_MS = 48 * 60 * 60 * 1000;

const WORKER_URL = "https://mmh-userdata-test.maniyamaniya789.workers.dev";

// ── Filter Persistence Helpers ──────────────────────────────────────────────
function _filterCacheKey() {
    const pathParts = window.location.pathname.split('/');
    const examName = window.location.search
        ? window.location.search.slice(1)
        : pathParts[pathParts.length - 2];
    return `examFilters_${examName}`;
}

function saveFilters() {
    try {
        sessionStorage.setItem(_filterCacheKey(), JSON.stringify(currentFilters));
    } catch (e) { /* quota / private-mode – silently ignore */ }
}

function loadSavedFilters() {
    try {
        const saved = sessionStorage.getItem(_filterCacheKey());
        if (saved) {
            const parsed = JSON.parse(saved);
            Object.assign(currentFilters, parsed);
        }
    } catch (e) { /* corrupt data – ignore and use defaults */ }
}
// ────────────────────────────────────────────────────────────────────────────

// ── Depth Detection Helper ────────────────────────────────────────────────
// Returns how many layers deep the data goes under a given node:
//   Array                          → 0  (leaf — items here)
//   { key: [...] }                 → 1  (topic layer)
//   { key: { key: [...] } }        → 2  (topic + subtopic layer)
function _depth(node) {
    if (!node || Array.isArray(node)) return 0;
    const firstVal = Object.values(node)[0];
    if (Array.isArray(firstVal)) return 1;
    return 2;
}
// ────────────────────────────────────────────────────────────────────────────

async function initExamEngine() {
    loadSavedFilters();
    const pathParts = window.location.pathname.split('/');
    let examName = window.location.search ? window.location.search.slice(1) : pathParts[pathParts.length - 2];

    document.getElementById('grid-sync').innerText = "🔄 Syncing Database...";
    try {
        const rawUrl = `https://raw.githubusercontent.com/sscjourneytest/sscjourneytest/main/data/${examName}-data.json?t=${Date.now()}`;
        const response = await fetch(rawUrl);
        EXAM_JSON = await response.json();

        let years = Object.keys(EXAM_JSON.data || {});

        if (!currentFilters.year || !years.includes(currentFilters.year)) {
            currentFilters.year = years.length > 0 ? years.sort().reverse()[0] : "default";
        }

        // Validate subject
        const subjectsForYear = Object.keys(EXAM_JSON.data[currentFilters.year] || {});
        if (!currentFilters.subject || !subjectsForYear.includes(currentFilters.subject)) {
            currentFilters.subject = subjectsForYear.length > 0 ? subjectsForYear[0] : '';
            currentFilters.topic = '';
            currentFilters.subtopic = '';
        }

        // Validate topic
        if (currentFilters.topic) {
            const subData = EXAM_JSON.data[currentFilters.year][currentFilters.subject];
            if (!subData || Array.isArray(subData) || !Object.keys(subData).includes(currentFilters.topic)) {
                currentFilters.topic = '';
                currentFilters.subtopic = '';
            }
        }

        // Validate subtopic
        if (currentFilters.subtopic && currentFilters.topic) {
            const topicData = (EXAM_JSON.data[currentFilters.year][currentFilters.subject] || {})[currentFilters.topic];
            if (!topicData || Array.isArray(topicData) || !Object.keys(topicData).includes(currentFilters.subtopic)) {
                currentFilters.subtopic = '';
            }
        }

        setupFilters(years);
        renderMocks();
        syncWithCloud(examName);

    } catch (e) {
        console.error("Engine initialization failed", e);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  syncWithCloud  —  Cross-device attempt checker
// ══════════════════════════════════════════════════════════════════════════════
async function syncWithCloud(examName) {
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    if (!profile || profile.username === "Guest") return;

    const user = profile.username.toLowerCase();
    const exam = examName.toLowerCase();

    const cacheKey = `CLOUD_SYNC_${user}_${exam}`;
    const timeKey  = `${cacheKey}_TIME`;

    // Step 1: Load cache immediately (instant render)
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
        try {
            CLOUD_CHECKLIST = JSON.parse(cachedRaw);
            renderMocks();
        } catch (e) {
            localStorage.removeItem(cacheKey);
        }
    }

    // Step 2: Check freshness
    const lastSync = parseInt(localStorage.getItem(timeKey) || "0");
    const isStale  = (Date.now() - lastSync) > SYNC_EXPIRY_MS;

    if (!isStale) return;

    // Step 3: Fetch from Worker
    try {
        const res = await fetch(
            `${WORKER_URL}?user=${encodeURIComponent(user)}&exam=${encodeURIComponent(exam)}`
        );
        if (!res.ok) throw new Error(`Worker ${res.status}`);

        const freshData = await res.json();

        // Step 4: Clean up orphaned local results
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(`result_${user}_`)) {
                const id = key.replace(`result_${user}_`, "");
                if (id.toLowerCase().includes(exam) && !freshData[id]) {
                    localStorage.removeItem(`result_${user}_${id}`);
                    localStorage.removeItem(`state_${user}_${id}`);
                }
            }
        });

        // Step 5: Update memory + cache
        CLOUD_CHECKLIST = freshData;
        localStorage.setItem(cacheKey, JSON.stringify(freshData));
        localStorage.setItem(timeKey, Date.now().toString());

        renderMocks();

    } catch (e) {
        console.error("Cloud sync failed (non-fatal):", e.message);
    }
}

// ── Filter Setup ──────────────────────────────────────────────────────────────
function setupFilters(years) {
    // 1. Year Scroll
    const yearScroll = document.getElementById('year-scroll');
    if (yearScroll) {
        if (years.length <= 1) {
            yearScroll.style.display = 'none';
        } else {
            yearScroll.style.display = 'flex';
            yearScroll.innerHTML = years.map(y =>
                `<div class="pill-filter ${y === currentFilters.year ? 'active' : ''}" onclick="setYear('${y}', this)">${y}</div>`
            ).join('');
        }
    }

    // 2. Subject Scroll
    const subjects = Object.keys(EXAM_JSON.data[currentFilters.year] || {});
    if (!currentFilters.subject && subjects.length > 0) currentFilters.subject = subjects[0];

    const subScroll = document.getElementById('subject-scroll');
    if (subScroll) {
        subScroll.innerHTML = subjects.map(s => {
            const subData = EXAM_JSON.data[currentFilters.year][s];
            const count = _countItems(subData);
            return `<div class="pill-filter ${s === currentFilters.subject ? 'active' : ''}" onclick="setDeepFilter('subject', '${s}')">${s} (${count})</div>`;
        }).join('');
    }

    // 3. Topic Scroll
    const selectedSubData = EXAM_JSON.data[currentFilters.year][currentFilters.subject];
    const topicWrap   = document.getElementById('topic-wrap');
    const topicScroll = document.getElementById('topic-scroll');
    const depth = _depth(selectedSubData);

    if (topicScroll && depth >= 1) {
        topicWrap?.classList.remove('hidden');
        const topics = Object.keys(selectedSubData);
        if (!currentFilters.topic || !topics.includes(currentFilters.topic)) {
            currentFilters.topic = topics[0];
            currentFilters.subtopic = '';
        }

        topicScroll.innerHTML = topics.map(t => {
            const count = _countItems(selectedSubData[t]);
            return `<div class="pill-filter ${t === currentFilters.topic ? 'active' : ''}" onclick="setDeepFilter('topic', '${t}')">${t} (${count})</div>`;
        }).join('');
    } else {
        topicWrap?.classList.add('hidden');
        currentFilters.topic = '';
        currentFilters.subtopic = '';
    }

    // 4. Subtopic Scroll — only shown when depth === 2
    const subtopicWrap   = document.getElementById('subtopic-wrap');
    const subtopicScroll = document.getElementById('subtopic-scroll');

    if (depth === 2 && currentFilters.topic) {
        const topicData = selectedSubData[currentFilters.topic];

        if (subtopicScroll && topicData && !Array.isArray(topicData)) {
            subtopicWrap?.classList.remove('hidden');
            const subtopics = Object.keys(topicData);
            if (!currentFilters.subtopic || !subtopics.includes(currentFilters.subtopic)) {
                currentFilters.subtopic = subtopics[0];
            }

            subtopicScroll.innerHTML = subtopics.map(st => {
                const count = Array.isArray(topicData[st]) ? topicData[st].length : 0;
                return `<div class="pill-filter ${st === currentFilters.subtopic ? 'active' : ''}" onclick="setDeepFilter('subtopic', '${st}')">${st} (${count})</div>`;
            }).join('');
        } else {
            subtopicWrap?.classList.add('hidden');
        }
    } else {
        subtopicWrap?.classList.add('hidden');
        currentFilters.subtopic = '';
    }

    // Scroll active pills into view
    ['#subject-scroll', '#topic-scroll', '#subtopic-scroll', '#year-scroll'].forEach(sel => {
        document.querySelector(`${sel} .pill-filter.active`)?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
    });
}

// ── Count helper — total leaf items under any node ────────────────────────
function _countItems(node) {
    if (!node) return 0;
    if (Array.isArray(node)) return node.length;
    let count = 0;
    Object.values(node).forEach(v => count += _countItems(v));
    return count;
}

// ── Filter Setters ────────────────────────────────────────────────────────────
function setDeepFilter(level, value) {
    currentFilters[level] = value;
    // Reset layers below the changed level
    if (level === 'subject') { currentFilters.topic = ''; currentFilters.subtopic = ''; }
    if (level === 'topic')   { currentFilters.subtopic = ''; }
    saveFilters();
    setupFilters(Object.keys(EXAM_JSON.data));
    renderMocks();
}

function setYear(y) {
    currentFilters.year    = y;
    currentFilters.subject = '';
    currentFilters.topic   = '';
    currentFilters.subtopic = '';
    saveFilters();
    setupFilters(Object.keys(EXAM_JSON.data));
    renderMocks();
}

// ── Render Mocks ──────────────────────────────────────────────────────────────
function renderMocks() {
    const grid      = document.getElementById('quizGrid');
    const config    = EXAM_JSON.config.default || {};
    const searchVal = document.getElementById('mockSearch').value.toLowerCase();
    const profile   = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const isPaidUser = profile ? profile.is_paid : false;
    const username   = profile ? profile.username : "Guest";

    let html = '';

    // ── Resolve items based on how deep the data is ──────────────────────────
    const yearData     = EXAM_JSON.data[currentFilters.year] || {};
    const selectedSub  = yearData[currentFilters.subject];
    const depth        = _depth(selectedSub);

    let rawItems = [];

    if (depth === 0) {
        // year → subject → [items]
        rawItems = Array.isArray(selectedSub) ? selectedSub : [];

    } else if (depth === 1) {
        // year → subject → topic → [items]
        rawItems = (selectedSub && currentFilters.topic)
            ? (selectedSub[currentFilters.topic] || [])
            : [];

    } else if (depth === 2) {
        // year → subject → topic → subtopic → [items]
        const topicData = (selectedSub && currentFilters.topic)
            ? selectedSub[currentFilters.topic]
            : null;
        rawItems = (topicData && currentFilters.subtopic && !Array.isArray(topicData))
            ? (topicData[currentFilters.subtopic] || [])
            : [];
    }

    // Map linkStr → linkParam
    const itemsToDisplay = rawItems.map(item => ({
        ...item,
        linkParam: item.linkStr ? `id=${item.linkStr}` : `id=${item.id}`,
        originalId: item.id
    }));

    itemsToDisplay.forEach(item => {
        if (searchVal && !item.title.toLowerCase().includes(searchVal)) return;

        // Release date lock
        let isLockedDate = false;
        if (item.releaseDate && item.releaseDate.trim() !== "") {
            const [day, month, year] = item.releaseDate.split('-').map(Number);
            const releaseDateObj = new Date(year, month - 1, day);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            isLockedDate = releaseDateObj > today;
        }

        const accessDenied = item.type === 'paid' && !isPaidUser;
        const localResult  = localStorage.getItem(`result_${username}_${item.id}`);
        const savedState   = JSON.parse(localStorage.getItem(`state_${username}_${item.id}`) || "{}");
        const isSubmitted  = localResult !== null || !!CLOUD_CHECKLIST[item.id];

        let actionHtml = '';
        if (isLockedDate) {
            actionHtml = `<div class="action-btn unlock-btn" style="opacity:0.6; cursor:default;">Available ${item.releaseDate}</div>`;
        } else if (accessDenied) {
            actionHtml = `<a href="/buy-premium.html" class="action-btn unlock-btn">🔒 UNLOCK TEST</a>`;
        } else if (isSubmitted) {
            actionHtml = `<div class="btn-grid btn-dual">
                <a href="../${config.subject_link}?${item.linkParam}" class="action-btn analysis-btn">ANALYSIS</a>
                <button onclick="reattempt('${item.id}', '../${config.subject_link}?${item.linkParam}')" class="action-btn reattempt-btn">REATTEMPT</button>
            </div>`;
        } else if (savedState.isPaused) {
            actionHtml = `<a href="../${config.subject_link}?${item.linkParam}" class="action-btn resume-btn">▶️ RESUME TEST</a>`;
        } else {
            actionHtml = `<a href="../${config.subject_link}?${item.linkParam}" class="action-btn start-btn">START TEST</a>`;
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

// ── Reattempt ─────────────────────────────────────────────────────────────────
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

// ── Page Lifecycle ─────────────────────────────────────────────────────────────
window.addEventListener('pageshow', function(event) {
    initExamEngine();
    if (event.persisted || (window.performance && window.performance.navigation.type === 2)) {
        if (typeof renderMocks === 'function' && EXAM_JSON) { renderMocks(); }
    }
});
