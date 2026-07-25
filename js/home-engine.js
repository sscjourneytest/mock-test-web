// ── Home Page Engine ────────────────────────────────────────────────────────
// Renders every dynamic section of the home page (buttons, banners,
// recommendations, the free-user popup, and the What's New ticker) from
// /data/home-config.json + /whats-new.json. Nothing here is hardcoded —
// edit the JSON files to change what appears on the site.

const HOME_CONFIG_URL = '/data/home-config.json';

// isPaidUser mirrors the same check used elsewhere on the site (exam-engine.js,
// ssc-sub-engine.js): read the cached local profile that auth.js maintains.
function _isPaidUser() {
    try {
        const p = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
        return !!(p && p.is_paid);
    } catch (e) {
        return false;
    }
}

function _skeletonBoxes(count) {
    return Array(count).fill(`
        <div class="skeleton-box">
            <div class="skeleton-line skeleton-icon"></div>
            <div class="skeleton-line skeleton-title"></div>
        </div>`).join('');
}

async function initHomeEngine() {
    const actionRow = document.getElementById('actionRow');
    const recGrid   = document.getElementById('recGrid');
    if (actionRow) actionRow.innerHTML = _skeletonBoxes(4);
    if (recGrid)   recGrid.innerHTML   = _skeletonBoxes(2);

    try {
        const res = await fetch(HOME_CONFIG_URL + '?v=' + Date.now());
        const config = await res.json();
        window.HOME_CONFIG = config; // exposed so checkTelegramPopup() (auth.js flow) can reuse it

        renderButtons(config.buttons || []);
        renderBanners(config.banners || []);
        renderRecommendations(config.recommendations || []);
        renderSalePopup(config.salePopup);
        // NOTE: the Telegram popup is intentionally NOT auto-shown here. It's triggered by
        // checkTelegramPopup() at the existing point in updateUI() once the
        // user's auth/paid status is confirmed — see home-index.html.
    } catch (e) {
        console.error('Failed to load home config', e);
        if (actionRow) actionRow.innerHTML = '';
        if (recGrid)   recGrid.innerHTML   = '';
    }
}

// ── Buttons ───────────────────────────────────────────────────────────────
function renderButtons(buttons) {
    const container = document.getElementById('actionRow');
    if (!container) return;

    const html = buttons
        .filter(b => b.visible !== false)
        .map(b => {
            const badgeHtml = b.badge
                ? (b.badge.toUpperCase() === 'NEW'
                    ? `<span class="new-badge-blink">${b.badge}</span>`
                    : `<span class="free-badge-green">${b.badge}</span>`)
                : '';
            const clickAttr = b.comingSoonMessage
                ? ` onclick="alert('${b.comingSoonMessage.replace(/'/g, "\\'")}')"`
                : '';
            return `
                <a href="${b.url}" class="box-style" id="btn-${b.id}"${clickAttr}>
                    <div class="box-content">
                        <i class="${b.icon}"></i>
                        <h4>${b.title} ${badgeHtml}</h4>
                    </div>
                    <i class="fas fa-chevron-right box-arrow"></i>
                </a>`;
        }).join('');

    container.innerHTML = html;
}

// ── Recommendations ──────────────────────────────────────────────────────
function renderRecommendations(items) {
    const container = document.getElementById('recGrid');
    if (!container) return;

    container.innerHTML = items
        .filter(r => r.visible !== false)
        .map(r => `
            <a href="${r.url}" class="rec-card">
                <div class="rec-left">
                    <img src="${r.logo}" alt="${r.title}">
                    <div class="text-start">
                        <h4>${r.title}</h4>
                        <p>${r.subtitle || ''}</p>
                    </div>
                </div>
                <i class="fas fa-chevron-right box-arrow"></i>
            </a>`).join('');
}

// ── Banners ───────────────────────────────────────────────────────────────
let bannerSlides = [];
let currentSlide = 0;
let bannerTimer = null;

function renderBanners(banners) {
    const wrapper = document.getElementById('bannerWrapper');
    const navDots = document.getElementById('bannerDots');
    if (!wrapper) return;

    bannerSlides = banners.filter(b => {
        if (b.visible === false) return false;
        if (b.audience === 'free' && _isPaidUser()) return false;
        if (b.audience === 'paid' && !_isPaidUser()) return false;
        return true;
    });

    if (bannerSlides.length === 0) {
        const container = document.getElementById('bannerContainer');
        if (container) container.style.display = 'none';
        return;
    }

    const isDesktop = window.innerWidth >= 992;

    wrapper.innerHTML = bannerSlides.map((b, i) => `
        <div class="banner-slide${i === 0 ? ' active' : ''}" id="slide${i}">
            <div class="banner-loader"></div>
            <img src="${isDesktop ? b.imageDesktop : b.imageMobile}" style="display:none;"
                 id="imgDetector${i}" onload="this.parentElement.classList.add('loaded')">
            <a href="${b.link}" class="banner-btn">${b.buttonLabel}</a>
        </div>`).join('');

    if (navDots) {
        navDots.innerHTML = bannerSlides.map((_, i) =>
            `<div class="dot${i === 0 ? ' active' : ''}" id="dot${i}"></div>`).join('');
    }

    currentSlide = 0;
    if (bannerTimer) clearInterval(bannerTimer);
    if (bannerSlides.length > 1) {
        bannerTimer = setInterval(() => moveSlide(1), 5000);
    }
}

function moveSlide(direction) {
    if (bannerSlides.length === 0) return;
    document.querySelectorAll('.banner-slide').forEach((s, i) => {
        s.classList.toggle('active', false);
    });
    document.querySelectorAll('.dot').forEach(d => d.classList.remove('active'));

    currentSlide = (currentSlide + direction + bannerSlides.length) % bannerSlides.length;

    document.getElementById(`slide${currentSlide}`)?.classList.add('active');
    document.getElementById(`dot${currentSlide}`)?.classList.add('active');
}

// ── Popup (content is config-driven; WHEN it shows is still controlled by
//    checkTelegramPopup() at its existing call site in home-index.html) ────
function renderPopup(popup) {
    if (!popup || !popup.enabled) return;

    const seenKey = `mmh_popup_seen_${popup.id}`;
    if (localStorage.getItem(seenKey)) return;

    const overlay = document.getElementById('tgPopupOverlay');
    if (!overlay) return;

    overlay.innerHTML = `
        <div class="bg-white rounded-4 p-4 text-center shadow-lg mx-3" style="max-width: 350px; border: 2px solid #0088cc;">
            <i class="${popup.icon} text-primary mb-3" style="font-size: 3rem;"></i>
            <h5 class="fw-bold mb-2">${popup.title}</h5>
            <p class="small text-muted mb-4">${popup.message}</p>
            <div class="d-grid gap-2">
                <a href="${popup.link}" target="_blank" onclick="closeHomePopup('${popup.id}')" class="btn btn-primary fw-bold py-2 rounded-3">${popup.buttonLabel}</a>
                <button onclick="closeHomePopup('${popup.id}')" class="btn btn-outline-secondary btn-sm fw-bold border-0">${popup.dismissLabel}</button>
            </div>
        </div>`;
    overlay.style.display = 'flex';
}

function closeHomePopup(id) {
    localStorage.setItem(`mmh_popup_seen_${id}`, 'true');
    document.getElementById('tgPopupOverlay').style.display = 'none';
}

// ── Sale Popup for free users (separate from the paid-user Telegram popup
//    above) — auto-triggers on load if enabled and the visitor isn't paid.
function renderSalePopup(popup) {
    if (!popup || !popup.enabled) return;
    if (_isPaidUser()) return;

    const seenKey = `mmh_popup_seen_${popup.id}`;
    if (localStorage.getItem(seenKey)) return;

    const overlay = document.getElementById('salePopupOverlay');
    if (!overlay) return;

    overlay.innerHTML = `
        <div class="bg-white rounded-4 p-4 text-center shadow-lg mx-3" style="max-width: 350px; border: 2px solid var(--primary, #2563eb);">
            <i class="${popup.icon} text-primary mb-3" style="font-size: 3rem;"></i>
            <h5 class="fw-bold mb-2">${popup.title}</h5>
            <p class="small text-muted mb-4">${popup.message}</p>
            <div class="d-grid gap-2">
                <a href="${popup.link}" onclick="closeSalePopup('${popup.id}')" class="btn btn-primary fw-bold py-2 rounded-3">${popup.buttonLabel}</a>
                <button onclick="closeSalePopup('${popup.id}')" class="btn btn-outline-secondary btn-sm fw-bold border-0">${popup.dismissLabel}</button>
            </div>
        </div>`;
    overlay.style.display = 'flex';
}

function closeSalePopup(id) {
    localStorage.setItem(`mmh_popup_seen_${id}`, 'true');
    document.getElementById('salePopupOverlay').style.display = 'none';
}

// ── What's New ticker (unchanged logic, now living in the split JS file) ───
const WHATS_NEW_MAX_ROWS = 3;
const WHATS_NEW_SPEED_PX_PER_SEC = 55;

async function loadWhatsNew() {
    try {
        const res = await fetch('/whats-new.json?v=' + Date.now());
        if (!res.ok) return;
        const items = await res.json();
        if (!Array.isArray(items) || items.length === 0) return;

        items.sort((a, b) => new Date(b.date) - new Date(a.date));

        const card = document.getElementById('whatsNewCard');
        const section = document.getElementById('whatsNewSection');
        if (!card || !section) return;

        const rows = items.slice(0, WHATS_NEW_MAX_ROWS);

        card.innerHTML = rows.map(item => `
            <div class="whats-new-row">
                <div class="whats-new-track">
                    <a href="${item.link}" class="whats-new-link">${item.title}</a>
                    ${item.badge ? `<span class="new-badge-blink">${item.badge}</span>` : ''}
                    <span class="whats-new-date">${formatWhatsNewDate(item.date)}</span>
                </div>
            </div>
        `).join('');

        section.style.display = 'block';

        requestAnimationFrame(() => {
            card.querySelectorAll('.whats-new-row').forEach(startMarqueeRow);
        });
    } catch (e) {
        console.error('Failed to load What\'s New:', e);
    }
}

function formatWhatsNewDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function startMarqueeRow(rowEl) {
    const track = rowEl.querySelector('.whats-new-track');
    if (!track) return;

    const rowWidth = rowEl.offsetWidth;
    const trackWidth = track.scrollWidth;
    const totalDistance = rowWidth + trackWidth;
    const duration = Math.max(totalDistance / WHATS_NEW_SPEED_PX_PER_SEC, 6);

    track.style.setProperty('--wn-start', rowWidth + 'px');
    track.style.setProperty('--wn-end', (-trackWidth) + 'px');
    track.style.animation = `whatsNewMarquee ${duration}s linear infinite`;
}

document.addEventListener('DOMContentLoaded', () => {
    initHomeEngine();
    loadWhatsNew();
});

window.addEventListener('resize', () => {
    // Re-pick desktop/mobile banner image on orientation/resize changes
    if (bannerSlides.length) renderBanners(bannerSlides);
});
