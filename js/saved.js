// ============================================================
// Mock Matrix Hub — Saved Questions Page Logic
// ============================================================

let SAVED_DATA_RAW = {};      // raw firebase tree (subject-nested + any legacy leaves)
let QUESTION_LIST = [];       // flattened: [{key, quiz_id, question_data, saved_at, subject, legacy}]
let FILTERED_LIST = [];       // after search + subject-chip filtering
let currentFocusIdx = 0;
let currentLang = localStorage.getItem("quiz_lang") || "en";
let USER_EMAIL_KEY = "";

// Canonical subject taxonomy — same list used by the "Save Question" modal elsewhere.
const SUBJECTS = ["REASONING", "MATH", "GK", "ENGLISH", "HINDI", "MISCELLANEOUS"];

let REATTEMPT_MODE = localStorage.getItem('mmh_saved_reattempt') === '1';
let PALETTE_MODE = localStorage.getItem('mmh_saved_palette') === '1';
let activeSubjectFilter = "ALL";
let MOVE_CONTEXT = null;

if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_PROJECTS.common); }
const savedDb = firebase.database();

// ------------------------------------------------------------
// Auth gate (unchanged behavior from before)
// ------------------------------------------------------------
async function loadSavedQuestionsWithAuth() {
    if (localStorage.getItem('mmh_theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }
    if (typeof getLocalProfile !== 'function') {
        setTimeout(loadSavedQuestionsWithAuth, 100);
        return;
    }
    const profile = getLocalProfile();
    if (!profile || (profile.username === "User" && !profile.id)) {
        window.location.replace("/login.html");
        return;
    }
    USER_EMAIL_KEY = profile.username;

    // Restore toggle states in the UI
    document.getElementById('reattemptToggle').checked = REATTEMPT_MODE;
    document.getElementById('paletteToggle').checked = PALETTE_MODE;

    loadSavedQuestions();
}
window.addEventListener('DOMContentLoaded', loadSavedQuestionsWithAuth);

// ------------------------------------------------------------
// Subject auto-detection for legacy (un-subjected) saved questions.
// Only ever called for items that don't already have a subject node —
// items already sitting under a subject bucket are never re-classified.
// ------------------------------------------------------------
function detectSubjectFromRules(quizId, qId) {
    const idL = (quizId || "").toLowerCase();
    const idx = parseInt(String(qId).slice(1), 10); // strip leading digit, same as image-URL logic

    // Single-subject exams named directly in the quiz ID (e.g. SSC-SUB-25-MATH)
    if (idL.includes("ssc-sub")) {
        if (idL.includes("math")) return "MATH";
        if (idL.includes("eng")) return "ENGLISH";
        if (idL.includes("reason")) return "REASONING";
        if (idL.includes("hindi")) return "HINDI";
        if (idL.includes("gk") || idL.includes("awareness") || idL.includes("gs")) return "GK";
        return "MISCELLANEOUS";
    }

    // Section-range based exams (position within the exam determines subject).
    // Index = strip the first digit from the left of the question ID, parse
    // the remainder (e.g. "50005" -> "0005" -> 5) — same convention already
    // used for the image-URL lookup and the "No:" display elsewhere.
    if (!isNaN(idx)) {
        if (idL.includes("cgl") || idL.includes("chsl") || idL.includes("cpo") || idL.includes("selection-post")) {
            if (idx >= 1 && idx <= 25) return "REASONING";
            if (idx >= 26 && idx <= 50) return "GK";
            if (idx >= 51 && idx <= 75) return "MATH";
            if (idx >= 76 && idx <= 100) return "ENGLISH";
        }
        if (idL.includes("gd")) {
            if (idx >= 1 && idx <= 20) return "REASONING";
            if (idx >= 21 && idx <= 40) return "GK";
            if (idx >= 41 && idx <= 60) return "MATH";
            if (idx >= 61 && idx <= 80) return "HINDI";
        }
        if (idL.includes("mts")) {
            if (idx >= 1 && idx <= 20) return "MATH";
            if (idx >= 21 && idx <= 40) return "REASONING";
            if (idx >= 41 && idx <= 65) return "GK";
            if (idx >= 66 && idx <= 90) return "ENGLISH";
        }
        if (idL.includes("steno")) {
            if (idx >= 1 && idx <= 50) return "REASONING";
            if (idx >= 51 && idx <= 100) return "GK";
            if (idx >= 101 && idx <= 200) return "ENGLISH";
        }
    }

    return "MISCELLANEOUS";
}

// ------------------------------------------------------------
// Flatten the raw Firebase tree. Two shapes possible under
// saved_questions/{user}/:
//   1) {subjectName}/{key} -> {quiz_id, question_data, saved_at}   (new, subject-nested)
//   2) {key} -> {quiz_id, question_data, saved_at}                 (legacy, no subject level)
// A node is "legacy" if it directly has a question_data field
// instead of being a bucket of further keys.
// ------------------------------------------------------------
function parseRawTree(raw) {
    const result = [];
    for (const topKey in raw) {
        const topVal = raw[topKey];
        if (!topVal || typeof topVal !== 'object') continue;

        if (topVal.question_data) {
            // Legacy leaf — no subject node yet
            const subject = detectSubjectFromRules(topVal.quiz_id, topVal.question_data.id) || "MISCELLANEOUS";
            result.push({
                key: topKey,
                quiz_id: topVal.quiz_id,
                question_data: topVal.question_data,
                saved_at: topVal.saved_at || 0,
                subject,
                legacy: true
            });
        } else {
            // Subject bucket — topKey IS the subject name
            const subjectName = topKey.toUpperCase();
            for (const qKey in topVal) {
                const qVal = topVal[qKey];
                if (!qVal || !qVal.question_data) continue;
                result.push({
                    key: qKey,
                    quiz_id: qVal.quiz_id,
                    question_data: qVal.question_data,
                    saved_at: qVal.saved_at || 0,
                    subject: subjectName,
                    legacy: false
                });
            }
        }
    }
    return result.sort((a, b) => b.saved_at - a.saved_at);
}

// One-time background migration: move legacy (un-subjected) questions
// into their auto-detected subject bucket. Runs silently after the
// page has already rendered — never blocks the UI.
async function migrateLegacyItems() {
    const legacyItems = QUESTION_LIST.filter(i => i.legacy);
    for (const item of legacyItems) {
        const payload = { quiz_id: item.quiz_id, question_data: item.question_data, saved_at: item.saved_at };
        const newPath = `saved_questions/${USER_EMAIL_KEY}/${item.subject}/${item.key}`;
        const oldPath = `saved_questions/${USER_EMAIL_KEY}/${item.key}`;
        try {
            await savedDb.ref(newPath).set(payload);
            await savedDb.ref(oldPath).remove();
            item.legacy = false; // now correctly filed under its subject node
        } catch (e) {
            // Leave as legacy — will retry on next page load
        }
    }
}

async function loadSavedQuestions() {
    const snap = await savedDb.ref(`saved_questions/${USER_EMAIL_KEY}`).once('value');
    SAVED_DATA_RAW = snap.val() || {};
    QUESTION_LIST = parseRawTree(SAVED_DATA_RAW);
    processData();
    migrateLegacyItems(); // fire-and-forget
}

function processData() {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    renderSubjectChips();
    applyFilters();
}

// ------------------------------------------------------------
// Subject filter chips (below header) — only shows subjects that
// actually have at least one saved question.
// ------------------------------------------------------------
function renderSubjectChips() {
    const present = new Set(QUESTION_LIST.map(i => i.subject));
    const order = ["ALL", ...SUBJECTS.filter(s => present.has(s))];
    const row = document.getElementById('subjectFilterRow');
    row.innerHTML = order.map(s =>
        `<button class="subject-chip ${activeSubjectFilter === s ? 'active' : ''}" onclick="setSubjectFilter('${s}')">${s}</button>`
    ).join('');
}

function setSubjectFilter(s) {
    activeSubjectFilter = s;
    renderSubjectChips();
    applyFilters();
}

function applyFilters() {
    const term = document.getElementById('searchBar').value.toLowerCase();
    let list = QUESTION_LIST;
    if (activeSubjectFilter !== 'ALL') list = list.filter(i => i.subject === activeSubjectFilter);
    if (term) list = list.filter(i => JSON.stringify(i).toLowerCase().includes(term));
    FILTERED_LIST = list;

    const isFocus = document.getElementById('focusView').style.display === 'block';
    if (isFocus) {
        if (currentFocusIdx >= FILTERED_LIST.length) currentFocusIdx = Math.max(0, FILTERED_LIST.length - 1);
        renderFocusMode();
    } else {
        renderListView();
    }
}

// ------------------------------------------------------------
// Shared helpers (language, bold-highlight, image URLs) — unchanged logic
// ------------------------------------------------------------
const applyBoldHighlight = (html) => html ? html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') : "";

const getLangText = (obj) => {
    if (!obj) return "";
    const decodeHTML = (h) => { const t = document.createElement("textarea"); t.innerHTML = h; return t.value; };
    let raw = (typeof obj === "string") ? obj : (currentLang === "bilingual") ?
        ((obj.en || "") + (obj.en && obj.hi ? "<hr style='border:none; border-top:1px dashed #ccc; margin:10px 0;'>" : "") + (obj.hi || "")) :
        (obj[currentLang] || obj["en"] || "");
    return decodeHTML(raw);
};

function getDynamicUrl(quizId, qId, imgNum) {
    let cleanQuizId = quizId;
    const lowerQuizId = quizId.toLowerCase();

    const suffixes = [
        "-mathandreasoning", "-englishandgk", "-generalawareness",
        "-maths", "-reasoning", "-english", "-gk", "-math",
        "-section1", "-section2", "-section3"
    ];

    for (const s of suffixes) {
        if (lowerQuizId.endsWith(s)) {
            cleanQuizId = quizId.substring(0, quizId.length - s.length);
            break;
        }
    }

    cleanQuizId = cleanQuizId.replace(/-part-\d+$/i, "");

    const idL = lowerQuizId;
    let path = "misc";

    if (idL.includes("cgl")) path = "ssc/cgl";
    else if (idL.includes("chsl")) path = "ssc/chsl";
    else if (idL.includes("cpo")) path = "ssc/cpo";
    else if (idL.includes("mts")) path = "ssc/mts";
    else if (idL.includes("steno")) path = "ssc/steno";
    else if (idL.includes("ntpcg")) path = "rrb/ntpcg";
    else if (idL.includes("imps")) path = "imps";
    else if (idL.includes("selection-post")) path = "ssc/phase";
    else if (idL.includes("gd")) path = "ssc/gd";
    else if (idL.includes("ssc-sub-25")) path = "ssc-sub/2025";

    const cleanIdx = parseInt(String(qId).slice(1));

    return `https://raw.githubusercontent.com/mockmatrixhub/mmhimg/main/${path}/${cleanQuizId}/q-${cleanIdx}-image${imgNum}.jpg`;
}

function renderImg(url, quizId, qId, num, isOpt = false) {
    const dyn = getDynamicUrl(quizId, qId, num);
    const cls = isOpt ? "opt-img" : "q-img";
    if (url && url.trim() !== "") return `<img src="${url}" class="${cls}" onerror="this.style.display='none'">`;
    return `<img src="${dyn}" class="${cls}" style="display:none;" onload="this.style.display='block'" onerror="this.style.display='none'">`;
}

// ------------------------------------------------------------
// Options rendering — supports Reattempt Mode (hide answer until tapped)
// ------------------------------------------------------------
function renderOptions(item) {
    const q = item.question_data;
    let html = "";
    for (let i = 1; i <= 5; i++) {
        if (!q[`option_${i}`]) continue;
        const isCor = String(q.answer) === String(i);
        const correctAttr = isCor ? 'data-correct="1"' : '';
        const showCorrectNow = isCor && !REATTEMPT_MODE;
        const clickAttr = REATTEMPT_MODE ? `onclick="mmhSelectOption(event, ${isCor})"` : '';
        html += `
            <div class="opt ${showCorrectNow ? 'correct' : ''}" ${correctAttr} ${clickAttr}>
                <div class="custom-radio"></div>
                <div class="opt-text">${applyBoldHighlight(getLangText(q[`option_${i}`]))}${renderImg(q[`option_image_${i}`], item.quiz_id, q.id, i + 1, true)}</div>
            </div>`;
    }
    return html;
}

function mmhSelectOption(ev, isCorrect) {
    const optDiv = ev.currentTarget;
    const card = optDiv.closest('.q-card');
    if (!card || card.dataset.answered === '1') return;
    card.dataset.answered = '1';

    card.querySelectorAll('.opt').forEach(o => {
        if (o.getAttribute('data-correct') === '1') o.classList.add('correct');
    });
    if (!isCorrect) optDiv.classList.add('wrong-pick');

    const exp = card.querySelector('.explanation');
    if (exp) { exp.style.display = 'block'; renderMath(exp); }
    const hint = card.querySelector('.reattempt-hint');
    if (hint) hint.style.display = 'none';
}

// ------------------------------------------------------------
// Card header (q-bar): quiz id + qno on row 1, subject + Move/Remove on row 2
// (stacks to 2 rows automatically on small screens via CSS)
// ------------------------------------------------------------
function buildQBar(item, indexLabel) {
    const q = item.question_data;
    const qNoDisplay = String(q.id).slice(1).replace(/^0+/, '');
    return `
        <div class="q-bar">
            <div class="q-bar-row1">
                <span class="q-bar-quiz"><i class="fas fa-book"></i> ${item.quiz_id}</span>
                <span class="q-bar-no">${indexLabel || ('No: ' + qNoDisplay)}</span>
            </div>
            <div class="q-bar-row2">
                <div class="q-bar-actions">
                    <button class="q-bar-btn move" onclick="openMoveModal('${item.key}', '${item.subject}')"><i class="fas fa-arrows-alt"></i> Move to...</button>
                    <button class="q-bar-btn remove" onclick="confirmUnsave('${item.key}')"><i class="fas fa-trash"></i> Remove</button>
                </div>
            </div>
        </div>`;
}

function buildQuestionCardHTML(item, indexLabel) {
    const q = item.question_data;
    return `
        ${buildQBar(item, indexLabel)}
        <div class="qtext">${applyBoldHighlight(getLangText(q.question))}${renderImg(q.question_image, item.quiz_id, q.id, 1)}</div>
        <div class="options-engine">${renderOptions(item)}</div>
        <div class="explanation" style="${REATTEMPT_MODE ? 'display:none;' : ''}"><strong>SOLUTION:</strong><br><div class="sol-text">${applyBoldHighlight(getLangText(q.solution_text))}</div>${renderImg(q.solution_image, item.quiz_id, q.id, 6)}</div>
        ${REATTEMPT_MODE ? '<div class="reattempt-hint">Tap an option to check the answer</div>' : ''}
    `;
}

// ------------------------------------------------------------
// List Mode — full question loads directly, no preview/collapse
// ------------------------------------------------------------
function renderListView() {
    const list = FILTERED_LIST;
    const container = document.getElementById('listView');
    container.innerHTML = "";
    document.getElementById('emptyState').style.display = list.length === 0 ? 'block' : 'none';

    list.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'q-card';
        card.id = `card-${item.key}`;
        card.dataset.key = item.key;
        card.innerHTML = buildQuestionCardHTML(item);
        container.appendChild(card);
        observer.observe(card);
        normalizeMathForQuiz(card);
    });
}

function renderMath(target) {
    if (window.MathJax && MathJax.typesetPromise) {
        MathJax.typesetClear([target]);
        MathJax.typesetPromise([target]).catch(() => {});
    }
}

function normalizeMathForQuiz(container) {
    if (!container) return;
    container.innerHTML = container.innerHTML
        .replace(/(\S)\s*\$\$(.+?)\$\$\s*(\S)/g, '$1 \\($2\\) $3')
        .replace(/\$\$(.+?)\$\$/g, '\\($1\\)');
}

const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            renderMath(entry.target);
            observer.unobserve(entry.target);
        }
    });
});

// ------------------------------------------------------------
// Focus Mode — one question at a time, with optional Palette navigator
// ------------------------------------------------------------
function switchMode(m) {
    document.getElementById('listModeBtn').classList.toggle('active', m === 'list');
    document.getElementById('focusModeBtn').classList.toggle('active', m === 'focus');
    document.getElementById('listView').style.display = m === 'list' ? 'block' : 'none';
    document.getElementById('focusView').style.display = m === 'focus' ? 'block' : 'none';
    document.getElementById('focusNav').style.display = m === 'focus' ? 'flex' : 'none';
    updatePaletteVisibility();
    if (m === 'focus') {
        currentFocusIdx = 0;
        renderFocusMode();
    }
}

// Palette is only ever eligible to show when Focus mode is active AND the
// Palette toggle is on. On mobile that just makes the green FAB appear
// (tapping it opens the bottom-sheet panel). On desktop (see saved.css
// media query) it's shown automatically as an always-visible right sidebar,
// and the FAB is hidden entirely.
function updatePaletteVisibility() {
    const isFocus = document.getElementById('focusView').style.display === 'block';
    const enabled = isFocus && PALETTE_MODE;
    const wrap = document.getElementById('paletteWrap');
    const fab = document.getElementById('paletteFab');
    wrap.classList.toggle('enabled', enabled);
    fab.classList.toggle('enabled', enabled);
    if (!enabled) wrap.classList.remove('open');
}

function togglePaletteSheet() {
    document.getElementById('paletteWrap').classList.toggle('open');
}

function renderFocusMode() {
    const list = FILTERED_LIST;
    const focusContent = document.getElementById('focusContent');
    if (list.length === 0) {
        focusContent.innerHTML = "";
        document.getElementById('paletteGrid').innerHTML = "";
        return;
    }
    if (currentFocusIdx >= list.length) currentFocusIdx = list.length - 1;
    const item = list[currentFocusIdx];

    const card = document.createElement('div');
    card.className = 'q-card';
    card.dataset.key = item.key;
    card.innerHTML = buildQuestionCardHTML(item, `${currentFocusIdx + 1} of ${list.length}`);
    focusContent.innerHTML = "";
    focusContent.appendChild(card);

    normalizeMathForQuiz(focusContent);
    renderMath(focusContent);

    if (PALETTE_MODE) {
        document.getElementById('paletteGrid').innerHTML = list.map((it, idx) =>
            `<button class="palette-btn ${idx === currentFocusIdx ? 'current' : ''}" onclick="jumpFocus(${idx})">${idx + 1}</button>`
        ).join('');
    }
}

function jumpFocus(idx) {
    currentFocusIdx = idx;
    renderFocusMode();
}

function navFocus(d) {
    const list = FILTERED_LIST;
    if (list.length === 0) return;
    currentFocusIdx = (currentFocusIdx + d + list.length) % list.length;
    renderFocusMode();
}

// ------------------------------------------------------------
// Toggles: Reattempt Mode + Palette Navigation
// ------------------------------------------------------------
function onReattemptToggle(checked) {
    REATTEMPT_MODE = checked;
    localStorage.setItem('mmh_saved_reattempt', checked ? '1' : '0');
    applyFilters(); // re-render current view under the new mode
}

function onPaletteToggle(checked) {
    PALETTE_MODE = checked;
    localStorage.setItem('mmh_saved_palette', checked ? '1' : '0');
    updatePaletteVisibility();
    const isFocus = document.getElementById('focusView').style.display === 'block';
    if (isFocus) renderFocusMode();
}

// ------------------------------------------------------------
// Move to Section modal
// ------------------------------------------------------------
function openMoveModal(key, currentSubject) {
    MOVE_CONTEXT = { key, currentSubject };
    const wrap = document.getElementById('moveSubjectOptions');
    wrap.innerHTML = SUBJECTS.map(s =>
        `<button class="mmh-subject-option" onclick="moveToSection('${key}', '${s}')">${s}${s === currentSubject ? ' (current)' : ''}</button>`
    ).join('');
    document.getElementById('moveModalOverlay').classList.add('active');
}

function closeMoveModal() {
    document.getElementById('moveModalOverlay').classList.remove('active');
    MOVE_CONTEXT = null;
}

async function moveToSection(key, newSubject) {
    const item = QUESTION_LIST.find(i => i.key === key);
    if (!item) return closeMoveModal();
    if (item.subject === newSubject) return closeMoveModal();

    const payload = { quiz_id: item.quiz_id, question_data: item.question_data, saved_at: item.saved_at };
    const oldPath = item.legacy
        ? `saved_questions/${USER_EMAIL_KEY}/${key}`
        : `saved_questions/${USER_EMAIL_KEY}/${item.subject}/${key}`;
    const newPath = `saved_questions/${USER_EMAIL_KEY}/${newSubject}/${key}`;

    try {
        await savedDb.ref(newPath).set(payload);
        await savedDb.ref(oldPath).remove();
        item.subject = newSubject;
        item.legacy = false;
        showToast(`Moved to ${newSubject}`);
        closeMoveModal();
        renderSubjectChips();
        applyFilters();
    } catch (e) {
        alert("Move failed. Check internet connection.");
    }
}

// ------------------------------------------------------------
// Remove from saved
// ------------------------------------------------------------
async function confirmUnsave(key) {
    const item = QUESTION_LIST.find(i => i.key === key);
    if (!item) return;
    if (!confirm("Remove this question from your saved library?")) return;

    try {
        const refPath = item.legacy
            ? `saved_questions/${USER_EMAIL_KEY}/${key}`
            : `saved_questions/${USER_EMAIL_KEY}/${item.subject}/${key}`;
        await savedDb.ref(refPath).remove();

        QUESTION_LIST = QUESTION_LIST.filter(i => i.key !== key);
        showToast("Unsaved Successfully");

        renderSubjectChips();
        applyFilters();
    } catch (err) {
        alert("Action failed. Check internet connection.");
    }
}

function showToast(msg) {
    const toast = document.createElement("div");
    toast.className = "save-toast";
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

function changeGlobalLang(val) {
    currentLang = val;
    localStorage.setItem("quiz_lang", val);
    applyFilters();
}
