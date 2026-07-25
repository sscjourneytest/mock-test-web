// ── Exams Index Engine ──────────────────────────────────────────────────────
// Renders the category grid (SSC / Railway / State) and, on tap, the
// sub-category grid (CGL / CHSL / ...) entirely from
// /data/exam-categories.json. Nothing here is hardcoded — edit the JSON
// to add, remove, or reorder exams.

const EXAM_CATEGORIES_URL = '/data/exam-categories.json';

let CATEGORY_DATA = { categories: [] };
let currentView = 'categories';

function _skeletonExamBoxes(count) {
    return Array(count).fill(`
        <div class="skeleton-exam-box">
            <div class="skeleton-line skeleton-logo"></div>
            <div style="flex:1;">
                <div class="skeleton-line skeleton-title"></div>
                <div class="skeleton-line skeleton-sub"></div>
            </div>
        </div>`).join('');
}

function _logoOrIconHtml(item) {
    if (item.logo) {
        return `<img src="${item.logo}" class="exam-logo-img" alt="${item.title}">`;
    }
    const iconClass = item.icon || 'fas fa-file-lines';
    return `<div class="exam-logo-img d-flex align-items-center justify-content-center bg-light">
                <i class="${iconClass} fs-3 text-primary"></i>
            </div>`;
}

function _badgeHtml(item) {
    if (!item.badge) return '';
    return `<span class="badge-soon">${item.badge}</span>`;
}

async function initExamsIndex() {
    const catContainer = document.getElementById('view-categories').querySelector('.category-grid');
    if (catContainer) catContainer.innerHTML = _skeletonExamBoxes(3);

    try {
        const res = await fetch(EXAM_CATEGORIES_URL + '?v=' + Date.now());
        CATEGORY_DATA = await res.json();
        renderCategories();
    } catch (e) {
        console.error('Failed to load exam categories', e);
        if (catContainer) catContainer.innerHTML = `<div class="text-center p-5 text-muted">Failed to load exams. Please try again.</div>`;
    }
}

function renderCategories() {
    const container = document.getElementById('view-categories').querySelector('.category-grid');
    if (!container) return;

    container.innerHTML = (CATEGORY_DATA.categories || []).map(cat => `
        <a href="#" class="exam-box" onclick="showSubCategory('${cat.id}'); return false;">
            ${_logoOrIconHtml(cat)}
            <div class="exam-info">
                <h3>${cat.title} ${_badgeHtml(cat)}</h3>
                <p>${cat.subtitle || ''}</p>
            </div>
            <i class="fas fa-chevron-right chevron"></i>
        </a>`).join('');
}

function showSubCategory(catId) {
    const cat = (CATEGORY_DATA.categories || []).find(c => c.id === catId);
    if (!cat) return;

    if (cat.comingSoon || !cat.items || cat.items.length === 0) {
        alert(`${cat.title} are coming soon! Stay tuned.`);
        return;
    }

    const container = document.getElementById('subcategory-list');
    document.getElementById('pageTitle').innerText = cat.title;

    container.innerHTML = cat.items.map(item => `
        <a href="${item.url}" class="exam-box">
            ${_logoOrIconHtml(item)}
            <div class="exam-info">
                <h3>${item.title} ${_badgeHtml(item)}</h3>
                <p>${item.subtitle || ''}</p>
            </div>
            <i class="fas fa-chevron-right chevron"></i>
        </a>`).join('');

    document.getElementById('view-categories').classList.remove('active');
    document.getElementById('view-subcategories').classList.add('active');
    currentView = 'subcategories';
}

function handleBack() {
    if (currentView === 'subcategories') {
        document.getElementById('view-subcategories').classList.remove('active');
        document.getElementById('view-categories').classList.add('active');
        document.getElementById('pageTitle').innerText = "Exam Categories";
        currentView = 'categories';
    } else {
        window.location.href = '/';
    }
}

// Theme sync (unchanged from original inline script)
if (localStorage.getItem('mmh_theme') === 'dark') {
    document.body.classList.add('dark-mode');
}

document.addEventListener('DOMContentLoaded', initExamsIndex);
