const WORKER_BASE = "https://mmh-vault-2.mockmatrixhub.workers.dev";
let myRole = null;
let myToken = null;
let myUserId = null;
let myEmail = null;
let myUsername = null;

// -----------------------------------------------------------
// IST helpers
// All "day" boundaries and calendar-date groupings in this file
// are anchored to IST (UTC+5:30), not the browser's local zone
// and not raw UTC. created_at in Supabase is stored in UTC, so
// every comparison/grouping converts through these helpers.
// -----------------------------------------------------------
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Returns a Date representing the UTC instant equal to IST midnight
// for "today" (or for an arbitrary Date passed in).
function istMidnightUTC(baseDate = new Date()) {
  const istNow = new Date(baseDate.getTime() + IST_OFFSET_MS);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  return new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
}

// Parses a "YYYY-MM-DD" <input type="date"> value as IST midnight
// (not UTC midnight, which is what `new Date("YYYY-MM-DD")` gives).
function istDateInputToUTC(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

// Given an ISO timestamp string, returns its IST calendar date
// as "YYYY-MM-DD" for grouping purposes.
function toISTDateKey(isoString) {
  const istDate = new Date(new Date(isoString).getTime() + IST_OFFSET_MS);
  return istDate.toISOString().slice(0, 10);
}

// Formats an ISO timestamp as an IST time string, e.g. "8:49 AM".
function toISTTimeLabel(isoString) {
  return new Date(isoString).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Formats a "YYYY-MM-DD" IST date key as a readable date, e.g. "Fri Jul 24 2026".
function istDateKeyToLabel(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toDateString();
}

// -----------------------------------------------------------
// Role gate
// -----------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  const { data: sessionData } = await _supabase.auth.getSession();
  const session = sessionData?.session;

  if (!session) {
    window.location.href = "/login.html?redirect=/admin-vault.html";
    return;
  }
  myToken = session.access_token;
  myUserId = session.user.id;
  myEmail = session.user.email;

  const { data: profile } = await _supabase
    .from("profiles")
    .select("role, username")
    .eq("id", session.user.id)
    .maybeSingle();

  myRole = profile?.role;
  myUsername = profile?.username || myEmail;

  if (!["owner", "subowner", "admin"].includes(myRole)) {
    document.getElementById("deniedScreen").style.display = "block";
    return;
  }

  if (myRole === "owner") document.body.classList.add("role-owner");

  const ownerDisplay = document.getElementById("saleOwnerDisplay");
  if (ownerDisplay) ownerDisplay.value = `${myUsername} (${myEmail})`;

  document.getElementById("vaultApp").style.display = "block";
  initTabs();
  loadStats();
  loadRevenue("today");
  loadCoupons();
  loadPricing();
  loadPayouts();
  loadLegacyPayments();
  initClearanceTab();
  wireForms();
  initUserInfoTab();
});

// -----------------------------------------------------------
// Tabs
// -----------------------------------------------------------
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });
}

// -----------------------------------------------------------
// Stats
// -----------------------------------------------------------
async function loadStats() {
  const { count: totalUsers } = await _supabase.from("profiles").select("*", { count: "exact", head: true });
  const { count: paidUsers } = await _supabase.from("profiles").select("*", { count: "exact", head: true }).eq("is_paid", true);
  const { data: allPayments } = await _supabase.from("payments").select("amount_paid");

  const totalRevenue = (allPayments || []).reduce((sum, p) => sum + Number(p.amount_paid), 0);

  document.getElementById("statTotalUsers").textContent = totalUsers ?? "--";
  document.getElementById("statPaidUsers").textContent = paidUsers ?? "--";
  document.getElementById("statTotalRevenue").textContent = "₹" + totalRevenue.toLocaleString("en-IN");
}

// -----------------------------------------------------------
// Revenue tab
// -----------------------------------------------------------
// State for the flat, paginated transaction table.
const REVENUE_PAGE_SIZE = 10;
let revenueRows = [];      // all payments for the current filter, newest first
let revenueRowsShown = 0;  // how many rows are currently rendered

function initRevenueFilters() {
  document.querySelectorAll(".filter-btn[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn[data-range]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadRevenue(btn.dataset.range);
    });
  });
  document.getElementById("customApply").addEventListener("click", () => {
    const from = document.getElementById("customFrom").value;
    const to = document.getElementById("customTo").value;
    if (!from || !to) return alert("Pick both dates");
    document.querySelectorAll(".filter-btn[data-range]").forEach((b) => b.classList.remove("active"));
    loadRevenue("custom", from, to);
  });
  const viewMoreBtn = document.getElementById("revenueViewMoreBtn");
  if (viewMoreBtn) {
    viewMoreBtn.addEventListener("click", () => {
      revenueRowsShown += REVENUE_PAGE_SIZE;
      renderRevenueTable();
    });
  }
}
initRevenueFilters();

async function loadRevenue(range, customFrom, customTo) {
  let fromDate;

  if (range === "today") {
    fromDate = istMidnightUTC();
  } else if (range === "7") {
    fromDate = new Date(istMidnightUTC().getTime() - 6 * 86400000);
  } else if (range === "30") {
    fromDate = new Date(istMidnightUTC().getTime() - 29 * 86400000);
  } else if (range === "all") {
    fromDate = new Date("2000-01-01");
  } else if (range === "custom") {
    fromDate = istDateInputToUTC(customFrom);
  }

  let query = _supabase.from("payments").select("amount_paid, coupon_code, user_id, created_at").gte("created_at", fromDate.toISOString());
  if (range === "custom" && customTo) {
    const toStart = istDateInputToUTC(customTo);
    const toDate = new Date(toStart.getTime() + 86400000 - 1);
    query = query.lte("created_at", toDate.toISOString());
  }

  const { data: payments } = await query.order("created_at", { ascending: false });
  const rows = payments || [];

  const total = rows.reduce((s, p) => s + Number(p.amount_paid), 0);
  document.getElementById("periodRevenue").textContent = "₹" + total.toLocaleString("en-IN");
  document.getElementById("periodCount").textContent = rows.length;

  // Flat, newest-first list of every transaction in the selected range.
  revenueRows = rows;

  // Default: first page only.
  revenueRowsShown = Math.min(REVENUE_PAGE_SIZE, revenueRows.length);

  renderRevenueTable();
}

function renderRevenueTable() {
  const tbody = document.getElementById("revenueTable");
  const viewMoreBtn = document.getElementById("revenueViewMoreBtn");

  const rowsToShow = revenueRows.slice(0, revenueRowsShown);

  let html = "";
  let lastDateKey = null;
  rowsToShow.forEach((p) => {
    const dateKey = toISTDateKey(p.created_at);
    if (dateKey !== lastDateKey) {
      html += `<tr class="date-divider"><td colspan="4"><b>${istDateKeyToLabel(dateKey)}</b></td></tr>`;
      lastDateKey = dateKey;
    }
    html += `<tr>
      <td>${toISTTimeLabel(p.created_at)}</td>
      <td>₹${Number(p.amount_paid).toLocaleString("en-IN")}</td>
      <td>${p.coupon_code || "-"}</td>
      <td style="font-family:'IBM Plex Mono',monospace; font-size:11px;">${p.user_id}</td>
    </tr>`;
  });

  tbody.innerHTML = html || '<tr><td colspan="4">No payments in this period.</td></tr>';

  if (viewMoreBtn) {
    const hasMore = revenueRowsShown < revenueRows.length;
    viewMoreBtn.style.display = hasMore ? "inline-block" : "none";
  }
}

// -----------------------------------------------------------
// Coupons tab
// -----------------------------------------------------------
async function loadCoupons() {
  const { data: pending } = await _supabase.from("coupon_requests").select("*").eq("status", "pending");
  let pHtml = "";
  (pending || []).forEach((r) => {
    pHtml += `<tr>
      <td><b>${r.username}</b><br><small>${r.email}</small></td>
      <td>${r.requested_code}</td>
      <td style="max-width:180px; overflow-wrap:anywhere;">${
        r.channel_links
          ? `<a class="btn-sm edit" href="${r.channel_links}" target="_blank" rel="noopener noreferrer">Open Link</a>`
          : "-"
      }</td>
      <td>${r.upi_id || "-"}</td>
      <td><input type="number" class="inline-input" id="disc-${r.id}" value="20"></td>
      <td><input type="number" class="inline-input" id="pay-${r.id}" value="20"></td>
      <td>
        <button class="btn-sm approve" onclick="approveCouponRequest('${r.id}','${r.user_id}','${r.username}','${r.requested_code}','${r.upi_id || ""}','${r.email}')">Approve</button>
        <button class="btn-sm reject" onclick="rejectCouponRequest('${r.id}')">Reject</button>
      </td>
    </tr>`;
  });
  document.getElementById("pendingCouponTable").innerHTML = pHtml || '<tr><td colspan="7">No pending requests.</td></tr>';

  const { data: coupons } = await _supabase.from("coupons").select("*").order("code");
  const { data: payments } = await _supabase.from("payments").select("amount_paid, coupon_code");

  let cHtml = "";
  (coupons || []).forEach((c) => {
    const uses = (payments || []).filter((p) => p.coupon_code === c.code);
    const revenue = uses.reduce((s, p) => s + Number(p.amount_paid), 0);
    cHtml += `<tr>
      <td><b>${c.code}</b></td>
      <td>${c.owner_name || "-"}</td>
      <td><input type="number" class="inline-input" id="edit-disc-${c.id}" value="${c.discount_percent}"></td>
      <td><input type="number" class="inline-input" id="edit-pay-${c.id}" value="${c.payout_percent}"></td>
      <td>₹${revenue.toLocaleString("en-IN")}</td>
      <td>${uses.length}</td>
      <td><span class="badge ${c.is_active ? "on" : "off"}">${c.is_active ? "Active" : "Inactive"}</span></td>
      <td>
        <button class="btn-sm edit" onclick="saveCouponEdits('${c.id}')">Save</button>
        <button class="btn-sm toggle" onclick="toggleCoupon('${c.id}', ${c.is_active})">${c.is_active ? "Deactivate" : "Activate"}</button>
      </td>
    </tr>`;
  });
  document.getElementById("couponsTable").innerHTML = cHtml || '<tr><td colspan="8">No coupons yet.</td></tr>';
}

async function approveCouponRequest(reqId, userId, username, code, upiId, email) {
  const discount = Number(document.getElementById(`disc-${reqId}`).value) || 20;
  const payout = Number(document.getElementById(`pay-${reqId}`).value) || 20;
  if (!confirm(`Approve ${username} with code ${code}? Discount ${discount}%, Payout ${payout}%.`)) return;

  const { error: cErr } = await _supabase.from("coupons").insert([{
    code, owner_name: username, owner_user_id: userId, owner_email: email,
    discount_percent: discount, payout_percent: payout,
    upi_id: upiId, is_active: true,
  }]);
  if (cErr) return alert("Error creating coupon: " + cErr.message);

  await _supabase.from("coupon_requests").update({ status: "approved" }).eq("id", reqId);

  alert("Approved!");
  loadCoupons();
}

async function rejectCouponRequest(reqId) {
  const reason = prompt("Reason for rejection:");
  if (reason === null || reason.trim() === "") return;
  await _supabase.from("coupon_requests").update({ status: "rejected", rejection_reason: reason }).eq("id", reqId);
  loadCoupons();
}

async function saveCouponEdits(couponId) {
  const discount = Number(document.getElementById(`edit-disc-${couponId}`).value);
  const payout = Number(document.getElementById(`edit-pay-${couponId}`).value);
  const { error } = await _supabase.from("coupons").update({ discount_percent: discount, payout_percent: payout }).eq("id", couponId);
  if (error) return alert("Error: " + error.message);
  alert("Saved.");
  loadCoupons();
}

async function toggleCoupon(couponId, currentlyActive) {
  await _supabase.from("coupons").update({ is_active: !currentlyActive }).eq("id", couponId);
  loadCoupons();
}

// -----------------------------------------------------------
// Pricing tab (owner only — enforced by RLS + UI)
// -----------------------------------------------------------
async function loadPricing() {
  const { data: plans } = await _supabase.from("pricing").select("*").order("offer_price");
  let html = "";
  (plans || []).forEach((p) => {
    html += `<tr>
      <td><input type="text" class="inline-input" style="width:100px" id="pn-${p.id}" value="${p.plan_name}"></td>
      <td><input type="number" class="inline-input" id="po-${p.id}" value="${p.original_price}"></td>
      <td><input type="number" class="inline-input" id="pf-${p.id}" value="${p.offer_price}"></td>
      <td><input type="number" class="inline-input" id="pv-${p.id}" value="${p.validity_days}"></td>
      <td><input type="checkbox" id="pa-${p.id}" ${p.is_active ? "checked" : ""}></td>
      <td><button class="btn-sm edit" onclick="savePlan('${p.id}')">Save</button></td>
    </tr>`;
  });
  document.getElementById("pricingTable").innerHTML = html || '<tr><td colspan="6">No plans yet.</td></tr>';
}

async function savePlan(planId) {
  const update = {
    plan_name: document.getElementById(`pn-${planId}`).value,
    original_price: Number(document.getElementById(`po-${planId}`).value),
    offer_price: Number(document.getElementById(`pf-${planId}`).value),
    validity_days: Number(document.getElementById(`pv-${planId}`).value),
    is_active: document.getElementById(`pa-${planId}`).checked,
  };
  const { error } = await _supabase.from("pricing").update(update).eq("id", planId);
  if (error) return alert("Error: " + error.message);
  alert("Plan updated.");
  loadPricing();
}

// -----------------------------------------------------------
// Form wiring: add plan, create sale coupon, direct grant
// -----------------------------------------------------------
function wireForms() {
  document.getElementById("addPlanBtn").addEventListener("click", async () => {
    const name = prompt("New plan name:");
    if (!name) return;
    const { error } = await _supabase.from("pricing").insert([{
      plan_name: name, original_price: 0, offer_price: 0, validity_days: 365, is_active: false,
    }]);
    if (error) return alert("Error: " + error.message);
    loadPricing();
  });

  document.getElementById("createSaleCouponBtn").addEventListener("click", async () => {
    const code = document.getElementById("saleCode").value.trim().toUpperCase();
    const discount = Number(document.getElementById("saleDiscount").value) || 0;
    const payout = Number(document.getElementById("salePayout").value) || 0;
    const upi = document.getElementById("saleUpi").value.trim();
    const validUntil = document.getElementById("saleValidUntil").value;

    if (!code) return alert("Enter a coupon code");

    const { error } = await _supabase.from("coupons").insert([{
      code, owner_name: myUsername, owner_user_id: myUserId, owner_email: myEmail,
      discount_percent: discount, payout_percent: payout,
      upi_id: upi || null, is_active: true,
      valid_until: validUntil ? istDateInputToUTC(validUntil).toISOString() : null,
    }]);
    if (error) return alert("Error: " + error.message);
    alert("Sale coupon created!");
    document.getElementById("saleCode").value = "";
    loadCoupons();
  });

  document.getElementById("grantBtn").addEventListener("click", async () => {
    const email = document.getElementById("grantEmail").value.trim();
    const days = document.getElementById("grantDays").value;
    const msgEl = document.getElementById("grantMsg");
    if (!email || !days) return alert("Enter email and validity days");

    msgEl.textContent = "Granting...";
    try {
      const res = await fetch(`${WORKER_BASE}/admin-grant-premium`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${myToken}` },
        body: JSON.stringify({ email, validity_days: Number(days) }),
      });
      const data = await res.json();
      if (!res.ok) {
        msgEl.style.color = "#dc2626";
        msgEl.textContent = data.error || "Failed";
        return;
      }
      msgEl.style.color = "#16a34a";
      msgEl.textContent = `Granted to ${data.username} until ${new Date(data.expires_at).toDateString()}`;
      loadStats();
    } catch (err) {
      msgEl.style.color = "#dc2626";
      msgEl.textContent = "Error: " + err.message;
    }
  });
}

// -----------------------------------------------------------
// Payouts tab
// -----------------------------------------------------------
async function loadPayouts() {
  const { data: pending } = await _supabase.from("payout_requests").select("*").eq("status", "pending");
  let pHtml = "";
  (pending || []).forEach((r) => {
    pHtml += `<tr>
      <td><b>${r.username}</b><br><small>${r.email}</small></td>
      <td>₹${r.amount}</td>
      <td>${new Date(r.payout_upto).toLocaleString()}</td>
      <td>
        <button class="btn-sm approve" onclick="approvePayoutReq('${r.id}')">Mark Paid</button>
        <button class="btn-sm reject" onclick="rejectPayoutReq('${r.id}')">Reject</button>
      </td>
    </tr>`;
  });
  document.getElementById("payoutTable").innerHTML = pHtml || '<tr><td colspan="4">No pending payouts.</td></tr>';

  const { data: history } = await _supabase.from("payout_requests").select("*").neq("status", "pending").order("requested_at", { ascending: false }).limit(20);
  let hHtml = "";
  (history || []).forEach((r) => {
    hHtml += `<tr><td>${r.username}</td><td>₹${r.amount}</td><td><span class="badge ${r.status === "successful" ? "on" : "off"}">${r.status}</span></td><td>${new Date(r.requested_at).toLocaleDateString()}</td></tr>`;
  });
  document.getElementById("payoutHistoryTable").innerHTML = hHtml || '<tr><td colspan="4">No history.</td></tr>';
}

async function approvePayoutReq(id) {
  if (!confirm("Confirm payout completion?")) return;
  await _supabase.from("payout_requests").update({ status: "successful" }).eq("id", id);
  loadPayouts();
}

async function rejectPayoutReq(id) {
  const reason = prompt("Reason for rejection:");
  if (reason === null || reason.trim() === "") return;
  await _supabase.from("payout_requests").update({ status: "rejected", rejection_reason: reason }).eq("id", id);
  loadPayouts();
}

// -----------------------------------------------------------
// Legacy manual payment requests tab
// -----------------------------------------------------------
async function loadLegacyPayments() {
  const { data: pending } = await _supabase.from("payment_requests").select("*").eq("status", "pending");
  let html = "";
  (pending || []).forEach((r) => {
    html += `<tr>
      <td><b>${r.username}</b><br><small>${r.email}</small></td>
      <td>${r.utr || "-"}</td>
      <td>₹${r.amount_paid}</td>
      <td>
        <button class="btn-sm approve" onclick="approveLegacy('${r.id}')">Approve</button>
        <button class="btn-sm reject" onclick="rejectLegacy('${r.id}')">Reject</button>
      </td>
    </tr>`;
  });
  document.getElementById("legacyPaymentTable").innerHTML = html || '<tr><td colspan="4">No pending manual requests.</td></tr>';
}

async function approveLegacy(id) {
  if (!confirm("Approve this manual payment?")) return;
  await _supabase.from("payment_requests").update({ status: "success" }).eq("id", id);
  loadLegacyPayments();
  loadStats();
}

async function rejectLegacy(id) {
  const reason = prompt("Reason for rejection:");
  if (reason === null || reason.trim() === "") return;
  await _supabase.from("payment_requests").update({ status: "rejected", rejection_reason: reason }).eq("id", id);
  loadLegacyPayments();
}


async function loadSummaryTable() {
  const { data: shares } = await _supabase.from("clearance_shares").select("user_id, username, amount_due, amount_paid");
  const byUser = {};
  (shares || []).forEach((s) => {
    if (!byUser[s.user_id]) byUser[s.user_id] = { username: s.username, due: 0, paid: 0 };
    byUser[s.user_id].due += Number(s.amount_due);
    byUser[s.user_id].paid += Number(s.amount_paid);
  });

  let html = "";
  Object.values(byUser).forEach((u) => {
    const pending = u.due - u.paid;
    const pendingLabel = pending === 0 ? "—" : (pending < 0 ? "-₹" + Math.abs(pending).toLocaleString("en-IN") : "₹" + pending.toLocaleString("en-IN"));
    html += `<tr>
      <td><b>${u.username}</b></td>
      <td>₹${u.due.toLocaleString("en-IN")}</td>
      <td>₹${u.paid.toLocaleString("en-IN")}</td>
      <td>${pendingLabel}</td>
    </tr>`;
  });
  document.getElementById("summaryTable").innerHTML = html || '<tr><td colspan="4">No clearances yet.</td></tr>';
}

// -----------------------------------------------------------
// Downloadable payment receipt (PDF) — every clearance batch,
// its date range, and to-be-paid/paid/due per partner, plus
// the all-time grand totals.
// -----------------------------------------------------------
function loadLogoAsDataURL() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Downscale to a small fixed size — this is only ever drawn as a
      // faint 110mm watermark, so the source resolution doesn't matter.
      // Embedding the logo at its native size (e.g. 2000x2000) was what
      // blew the PDF up to several MB for a single page of text.
      const MAX_DIM = 500;
      const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      // JPEG has no alpha channel, so fill white first (matches the
      // white PDF page it sits on) instead of letting transparency
      // render as black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL("image/jpeg", 0.8)); } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = "/logo.png";
  });
}

function fmtAmt(n) {
  const v = Number(n);
  return (v < 0 ? "-Rs " : "Rs ") + Math.abs(v).toLocaleString("en-IN");
}

// For aggregate "Total" figures only (batch total, all-time grand total).
// Individual partner amounts keep their exact paise via fmtAmt — this is
// only for the summary lines, which should read as clean whole rupees.
function fmtAmtInt(n) {
  const v = Math.round(Number(n));
  return (v < 0 ? "-Rs " : "Rs ") + Math.abs(v).toLocaleString("en-IN");
}

async function downloadPaymentReceipt() {
  const btn = document.getElementById("downloadReceiptBtn");
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = "Generating...";

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 14;

    let logoData = null;
    try { logoData = await loadLogoAsDataURL(); } catch (e) { /* logo optional */ }

    function drawWatermark() {
      if (!logoData) return;
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.06 }));
      const size = 110;
      doc.addImage(logoData, "JPEG", (pageW - size) / 2, (pageH - size) / 2, size, size);
      doc.restoreGraphicsState();
    }

    function drawHeader() {
      drawWatermark();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.setTextColor(20, 30, 60);
      doc.text("MOCK MATRIX PAYMENTS", pageW / 2, 18, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(90, 90, 90);
      doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, pageW / 2, 24, { align: "center" });
      doc.setTextColor(0, 0, 0);
    }

    let y = 34;
    function ensureSpace(rowHeight) {
      if (y + rowHeight > pageH - 16) {
        doc.addPage();
        drawHeader();
        y = 34;
      }
    }

    drawHeader();

    const { data: batches } = await _supabase.from("revenue_clearances").select("*").order("to_date", { ascending: true });
    const { data: allShares } = await _supabase.from("clearance_shares").select("*").order("username");

    let grandDue = 0, grandPaid = 0;
    const partnerTotals = {}; // username -> { due, paid }

    (batches || []).forEach((batch) => {
      ensureSpace(16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(`Clearance: ${batch.from_date}  to  ${batch.to_date}`, marginX, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Batch Total: ${fmtAmtInt(batch.total_amount)}`, pageW - marginX, y, { align: "right" });
      y += 6;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Partner", marginX, y);
      doc.text("To Be Paid", marginX + 70, y);
      doc.text("Paid", marginX + 110, y);
      doc.text("Due", marginX + 145, y);
      y += 4;
      doc.setDrawColor(210);
      doc.line(marginX, y, pageW - marginX, y);
      y += 5;

      doc.setFont("helvetica", "normal");
      const shares = (allShares || []).filter((s) => s.clearance_id === batch.id);
      let batchAssigned = 0;
      shares.forEach((s) => {
        ensureSpace(7);
        const due = Number(s.amount_due), paid = Number(s.amount_paid);
        doc.text(String(s.username), marginX, y);
        doc.text(fmtAmt(due), marginX + 70, y);
        doc.text(fmtAmt(paid), marginX + 110, y);
        doc.text(fmtAmt(due - paid), marginX + 145, y);
        y += 6;
        grandDue += due;
        grandPaid += paid;
        batchAssigned += due;
        if (!partnerTotals[s.username]) partnerTotals[s.username] = { due: 0, paid: 0 };
        partnerTotals[s.username].due += due;
        partnerTotals[s.username].paid += paid;
      });

      const batchLeftover = Math.round(Number(batch.total_amount) - batchAssigned);
      if (batchLeftover > 0) {
        ensureSpace(6);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8.5);
        doc.setTextColor(140, 100, 20);
        doc.text(`₹${batchLeftover} not evenly splittable — carried into next clearance`, marginX, y);
        doc.setTextColor(0, 0, 0);
        y += 6;
      }
      y += 5;
    });

    if (!batches || batches.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text("No clearance batches yet.", marginX, y);
      y += 8;
    }

    ensureSpace(30);
    doc.setDrawColor(20, 30, 60);
    doc.setLineWidth(0.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("All-Time Partner Summary", marginX, y);
    y += 7;

    doc.setFontSize(9);
    doc.text("Partner", marginX, y);
    doc.text("Total Due", marginX + 70, y);
    doc.text("Total Paid", marginX + 110, y);
    doc.text("Total Pending", marginX + 145, y);
    y += 4;
    doc.setDrawColor(210);
    doc.line(marginX, y, pageW - marginX, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    Object.keys(partnerTotals).forEach((username) => {
      ensureSpace(7);
      const t = partnerTotals[username];
      const pending = t.due - t.paid;
      doc.text(username, marginX, y);
      doc.text(fmtAmt(t.due), marginX + 70, y);
      doc.text(fmtAmt(t.paid), marginX + 110, y);
      doc.text(pending === 0 ? "-" : fmtAmt(pending), marginX + 145, y);
      y += 6;
    });
    y += 5;

    ensureSpace(30);
    doc.setDrawColor(20, 30, 60);
    doc.setLineWidth(0.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("All-Time Totals", marginX, y);
    y += 7;
    doc.setFontSize(11);
    doc.text(`Total To Be Paid: ${fmtAmtInt(grandDue)}`, marginX, y); y += 6;
    doc.text(`Total Paid: ${fmtAmtInt(grandPaid)}`, marginX, y); y += 6;
    doc.text(`Total Due: ${fmtAmtInt(grandDue - grandPaid)}`, marginX, y);

    doc.save(`MockMatrix-Payment-Receipt-${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (err) {
    alert("Could not generate receipt: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// -----------------------------------------------------------
// Payment Clearance tab
// -----------------------------------------------------------
let staffList = [];          // [{id, username}] for owner/subowner/admin
let lastClearedToDate = null; // "YYYY-MM-DD" or null if never cleared
let previewFromKey = null;
let previewToKey = null;

async function initClearanceTab() {
  await loadStaffList();
  await loadSplitEditor();
  await refreshClearanceFromDate();
  await updateNotClearedStat();
  await loadClearanceHistory();
  await loadSummaryTable();

  document.getElementById("saveSplitBtn").addEventListener("click", saveSplit);
  document.getElementById("previewClearanceBtn").addEventListener("click", previewClearance);
  document.getElementById("confirmClearanceBtn").addEventListener("click", openClearanceModal);
  document.getElementById("modalCancelBtn").addEventListener("click", closeClearanceModal);
  document.getElementById("modalConfirmBtn").addEventListener("click", confirmClearance);
  document.getElementById("downloadReceiptBtn").addEventListener("click", downloadPaymentReceipt);
}

async function loadStaffList() {
  const { data } = await _supabase.from("profiles").select("id, username").in("role", ["owner", "subowner", "admin"]);
  staffList = data || [];
}

async function loadSplitEditor() {
  const { data: splits } = await _supabase.from("staff_revenue_split").select("*");
  const container = document.getElementById("splitEditor");
  let html = "";
  staffList.forEach((s) => {
    const existing = (splits || []).find((sp) => sp.user_id === s.id);
    const pct = existing ? existing.percentage : (100 / staffList.length).toFixed(2);
    html += `<div class="split-row"><span>${s.username}</span><input type="number" step="0.01" class="inline-input split-input" id="split-${s.id}" value="${pct}"></div>`;
  });
  container.innerHTML = html;
}

async function saveSplit() {
  const rows = staffList.map((s) => ({
    user_id: s.id,
    percentage: Number(document.getElementById(`split-${s.id}`).value) || 0,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await _supabase.from("staff_revenue_split").upsert(rows, { onConflict: "user_id" });
  if (error) return alert("Error: " + error.message);
  alert("Split saved.");
}

async function getLastClearedToDate() {
  const { data } = await _supabase.from("revenue_clearances").select("to_date").order("to_date", { ascending: false }).limit(1);
  return data && data[0] ? data[0].to_date : null;
}

async function refreshClearanceFromDate() {
  lastClearedToDate = await getLastClearedToDate();
  const label = document.getElementById("clearanceFromLabel");
  if (lastClearedToDate) {
    const next = new Date(lastClearedToDate + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    label.textContent = "From: " + next.toISOString().slice(0, 10) + "  (cleared up to " + lastClearedToDate + ")";
  } else {
    label.textContent = "From: the very beginning (no clearance done yet)";
  }
}

async function updateNotClearedStat() {
  const fromKey = lastClearedToDate;
  let query = _supabase.from("payments").select("amount_paid");
  if (fromKey) {
    const fromUTC = istDateInputToUTC(fromKey);
    const fromEnd = new Date(fromUTC.getTime() + 86400000); // end of that IST day
    query = query.gte("created_at", fromEnd.toISOString());
  }
  const { data } = await query;
  const total = (data || []).reduce((s, p) => s + Number(p.amount_paid), 0);
  document.getElementById("statNotCleared").textContent = "₹" + total.toLocaleString("en-IN");
  document.getElementById("clearedUpToLabel").textContent = "Cleared up to: " + (lastClearedToDate || "Never");
}

async function previewClearance() {
  const toInput = document.getElementById("clearanceToDate").value;
  if (!toInput) return alert("Pick a 'to' date");

  const fromUTC = lastClearedToDate
    ? new Date(istDateInputToUTC(lastClearedToDate).getTime() + 86400000)
    : new Date("2000-01-01T00:00:00Z");
  const toStart = istDateInputToUTC(toInput);
  const toUTC = new Date(toStart.getTime() + 86400000 - 1);

  if (toUTC < fromUTC) return alert("'To' date must be after the last cleared date.");

  const { data } = await _supabase.from("payments").select("amount_paid")
    .gte("created_at", fromUTC.toISOString()).lte("created_at", toUTC.toISOString());

  const total = (data || []).reduce((s, p) => s + Number(p.amount_paid), 0);

  previewFromKey = lastClearedToDate
    ? new Date(fromUTC.getTime()).toISOString().slice(0, 10)
    : "2000-01-01";
  previewToKey = toInput;

  document.getElementById("previewAmount").textContent = "₹" + total.toLocaleString("en-IN");
  document.getElementById("previewCount").textContent = (data || []).length;
  document.getElementById("clearancePreview").dataset.total = total;
  document.getElementById("clearancePreview").style.display = "block";
}

async function getPriorLeftover() {
  // Whole-rupee splits can leave 1-2 rupees unassigned in a batch (e.g. a
  // total that isn't evenly divisible 3 ways). Rather than padding one
  // partner's share, that remainder is carried into the next batch's total
  // and re-split from there. This looks at the most recent batch and
  // returns (its total) minus (sum of what was actually assigned to
  // partners in it).
  const { data: lastBatchArr } = await _supabase.from("revenue_clearances").select("*").order("to_date", { ascending: false }).limit(1);
  const lastBatch = lastBatchArr && lastBatchArr[0];
  if (!lastBatch) return 0;
  const { data: shares } = await _supabase.from("clearance_shares").select("amount_due").eq("clearance_id", lastBatch.id);
  const assigned = (shares || []).reduce((s, r) => s + Number(r.amount_due), 0);
  const leftover = Math.round(Number(lastBatch.total_amount) - assigned);
  return leftover > 0 ? leftover : 0;
}

async function openClearanceModal() {
  const previewTotal = Number(document.getElementById("clearancePreview").dataset.total || 0);
  const priorLeftover = await getPriorLeftover();
  const total = previewTotal + priorLeftover;
  // Save the carried-forward total back so confirmClearance stores this
  // same number as the batch's total_amount — the batch total should
  // include whatever rolled in from the last one.
  document.getElementById("clearancePreview").dataset.total = total;

  const { data: splits } = await _supabase.from("staff_revenue_split").select("*");

  document.getElementById("modalRangeLabel").textContent =
    `${previewFromKey} → ${previewToKey}  ·  Total ₹${total.toLocaleString("en-IN")}` +
    (priorLeftover > 0 ? ` (incl. ₹${priorLeftover} carried forward)` : "");

  let html = "";
  const pctList = staffList.map((s) => {
    const split = (splits || []).find((sp) => sp.user_id === s.id);
    return split ? Number(split.percentage) : (100 / staffList.length);
  });
  // Normalize against the sum of everyone's stored % rather than a fixed
  // 100 — three partners saved at 33.33% each only add to 99.99%, but
  // 33.33/99.99 is exactly 1/3, so this splits the total evenly.
  const sumPct = pctList.reduce((a, b) => a + b, 0) || 100;

  let assignedTotal = 0;
  staffList.forEach((s, idx) => {
    const pct = pctList[idx];
    // Whole rupees only, always rounded down — nobody gets a decimal
    // padded on to make the split "come out even". If the total divides
    // evenly (e.g. divisible by 3 for an equal three-way split) everyone
    // already gets a clean integer; any 1-2 rupees left over stay
    // unassigned this batch and carry into the next one via
    // getPriorLeftover() above.
    const due = Math.floor(total * pct / sumPct);
    assignedTotal += due;
    html += `<div class="modal-share-row" data-user="${s.id}" data-username="${s.username}" data-pct="${pct}" data-due="${due}">
      <div class="msr-name">${s.username}</div>
      <div class="msr-due">To be paid (locked, ${pct}%): ₹${due.toLocaleString("en-IN")}</div>
      <label><input type="checkbox" class="msr-cleared" checked onchange="toggleClearedRow(this)"> Fully cleared now</label>
      <input type="number" class="msr-paid-input" value="${due}" disabled>
    </div>`;
  });

  const unassigned = total - assignedTotal;
  document.getElementById("modalShareRows").innerHTML = html +
    (unassigned > 0 ? `<p class="hint">₹${unassigned} isn't evenly splittable this batch — carries into the next clearance.</p>` : "");

  document.getElementById("clearanceModal").classList.add("active");
}

function toggleClearedRow(checkbox) {
  const row = checkbox.closest(".modal-share-row");
  const input = row.querySelector(".msr-paid-input");
  const due = Number(row.dataset.due);
  if (checkbox.checked) {
    input.value = due;
    input.disabled = true;
  } else {
    input.disabled = false;
    input.focus();
  }
}

function closeClearanceModal() {
  document.getElementById("clearanceModal").classList.remove("active");
}

async function confirmClearance() {
  const total = Number(document.getElementById("clearancePreview").dataset.total || 0);

  const rows = Array.from(document.querySelectorAll(".modal-share-row")).map((row) => {
    const due = Number(row.dataset.due);
    let paid = Number(row.querySelector(".msr-paid-input").value) || 0;
    return {
      user_id: row.dataset.user,
      username: row.dataset.username,
      percentage_at_time: Number(row.dataset.pct),
      amount_due: due,
      amount_paid: paid,
      status: paid >= due ? "done" : "pending",
    };
  });

  if (!confirm(`Create this clearance batch for ₹${total.toLocaleString("en-IN")}?`)) return;

  const { data: batch, error: batchErr } = await _supabase.from("revenue_clearances").insert([{
    from_date: previewFromKey, to_date: previewToKey, total_amount: total, created_by: myUserId,
  }]).select().single();

  if (batchErr) return alert("Error: " + batchErr.message);

  const shareRows = rows.map((r) => ({ ...r, clearance_id: batch.id }));
  const { error: shareErr } = await _supabase.from("clearance_shares").insert(shareRows);
  if (shareErr) return alert("Error creating shares: " + shareErr.message);

  alert("Cleared!");
  closeClearanceModal();
  document.getElementById("clearancePreview").style.display = "none";
  document.getElementById("clearanceToDate").value = "";
  await refreshClearanceFromDate();
  await updateNotClearedStat();
  await loadClearanceHistory();
  await loadSummaryTable();
}

async function loadClearanceHistory() {
  const { data: batches } = await _supabase.from("revenue_clearances").select("*").order("to_date", { ascending: false });
  const container = document.getElementById("clearanceHistory");

  if (!batches || batches.length === 0) {
    container.innerHTML = '<p class="hint">No clearances yet.</p>';
    return;
  }

  let html = "";
  for (const batch of batches) {
    const { data: shares } = await _supabase.from("clearance_shares").select("*").eq("clearance_id", batch.id).order("username");
    const batchAssigned = (shares || []).reduce((s, r) => s + Number(r.amount_due), 0);
    const batchLeftover = Math.round(Number(batch.total_amount) - batchAssigned);
    html += `<div class="clearance-batch">
      <div class="clearance-batch-head">
        <b>${batch.from_date} → ${batch.to_date}</b>
        <span>Total: ₹${Number(batch.total_amount).toLocaleString("en-IN")}</span>
      </div>${batchLeftover > 0 ? `<p class="hint" style="color:#a06414;">₹${batchLeftover} not evenly splittable — carried into next clearance</p>` : ""}`;
    (shares || []).forEach((sh) => {
      const remaining = Math.max(0, Number(sh.amount_due) - Number(sh.amount_paid));
      html += `<div class="share-row">
        <span class="share-name">${sh.username}</span>
        <span class="share-amounts">
          Due ₹<input type="number" class="pay-input" id="due-${sh.id}" value="${sh.amount_due}" style="width:80px;">
          · Paid ₹${Number(sh.amount_paid).toLocaleString("en-IN")}${remaining > 0 ? " · Pending ₹" + remaining.toLocaleString("en-IN") : ""}
        </span>
        <span class="badge ${sh.status === "done" ? "on" : "off"}">${sh.status}</span>
        <div class="share-actions">
          <button class="btn-sm edit" onclick="saveDueEdit('${sh.id}')">Save Due</button>
          <input type="number" class="pay-input" id="addpay-${sh.id}" placeholder="Add ₹">
          <button class="btn-sm edit" onclick="addSharePayment('${sh.id}')">Add</button>
          <button class="btn-sm approve" onclick="markShareDone('${sh.id}')">Mark Done</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }
  container.innerHTML = html;
}

async function saveDueEdit(shareId) {
  const newDue = Number(document.getElementById(`due-${shareId}`).value);
  if (isNaN(newDue) || newDue < 0) return alert("Enter a valid amount");
  if (!confirm(`Change amount due to ₹${newDue}? This is a manual correction.`)) return;

  const { data: share } = await _supabase.from("clearance_shares").select("*").eq("id", shareId).single();
  const newStatus = Number(share.amount_paid) >= newDue ? "done" : "pending";

  const { error } = await _supabase.from("clearance_shares").update({
    amount_due: newDue, status: newStatus, updated_at: new Date().toISOString(),
  }).eq("id", shareId);

  if (error) return alert("Error: " + error.message);
  loadClearanceHistory();
  loadSummaryTable();
}

async function addSharePayment(shareId) {
  const input = document.getElementById(`addpay-${shareId}`);
  const addAmount = Number(input.value);
  if (!addAmount || addAmount <= 0) return alert("Enter a valid amount");

  const { data: share } = await _supabase.from("clearance_shares").select("*").eq("id", shareId).single();
  if (!share) return;

  const newPaid = Number(share.amount_paid) + addAmount;
  const newStatus = newPaid >= Number(share.amount_due) ? "done" : "pending";

  const { error } = await _supabase.from("clearance_shares").update({
    amount_paid: newPaid, status: newStatus, updated_at: new Date().toISOString(),
  }).eq("id", shareId);

  if (error) return alert("Error: " + error.message);
  loadClearanceHistory();
  loadSummaryTable();
}

async function markShareDone(shareId) {
  const { data: share } = await _supabase.from("clearance_shares").select("*").eq("id", shareId).single();
  if (!share) return;
  if (!confirm(`Mark ₹${share.amount_due} as fully paid to ${share.username}?`)) return;

  const { error } = await _supabase.from("clearance_shares").update({
    amount_paid: share.amount_due, status: "done", updated_at: new Date().toISOString(),
  }).eq("id", shareId);

  if (error) return alert("Error: " + error.message);
  loadClearanceHistory();
  loadSummaryTable();
}



// -----------------------------------------------------------
// User Info tab — find any user's full profile row by email,
// username, or mobile, and edit it directly.
// -----------------------------------------------------------
const USER_INFO_READONLY = ["id", "created_at", "updated_at"];
let currentUserInfoRow = null;

function initUserInfoTab() {
  document.getElementById("userSearchBtn").addEventListener("click", searchUserInfo);
  document.getElementById("userSearchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchUserInfo();
  });
  document.getElementById("saveUserBtn").addEventListener("click", saveUserInfoEdits);
}

async function searchUserInfo() {
  const q = document.getElementById("userSearchInput").value.trim();
  const resultCard = document.getElementById("userResultCard");
  if (!q) return alert("Enter an email, username, or mobile number");

  const { data, error } = await _supabase
    .from("profiles")
    .select("*")
    .or(`email.eq.${q},username.eq.${q},mobile.eq.${q}`)
    .maybeSingle();

  if (error) return alert("Error: " + error.message);
  if (!data) {
    resultCard.style.display = "none";
    return alert("No user found with that email, username, or mobile.");
  }

  renderUserInfoRow(data);
  resultCard.style.display = "block";
}

function renderUserInfoRow(row) {
  currentUserInfoRow = row;
  let html = "";
  Object.keys(row).forEach((key) => {
    const val = row[key];
    const displayVal = val === null || val === undefined ? "" : val;
    if (USER_INFO_READONLY.includes(key)) {
      html += `<tr><td><b>${key}</b></td><td>${displayVal}</td></tr>`;
    } else if (typeof val === "boolean") {
      html += `<tr><td><b>${key}</b></td><td><input type="checkbox" id="uf-${key}" ${val ? "checked" : ""}></td></tr>`;
    } else {
      html += `<tr><td><b>${key}</b></td><td><input type="text" class="inline-input" id="uf-${key}" value="${displayVal}"></td></tr>`;
    }
  });
  document.getElementById("userInfoTable").innerHTML = html;
  document.getElementById("userSaveMsg").textContent = "";
}

async function saveUserInfoEdits() {
  if (!currentUserInfoRow) return;
  const update = {};
  Object.keys(currentUserInfoRow).forEach((key) => {
    if (USER_INFO_READONLY.includes(key)) return;
    const el = document.getElementById(`uf-${key}`);
    if (!el) return;
    if (el.type === "checkbox") {
      update[key] = el.checked;
    } else {
      const raw = el.value;
      update[key] = typeof currentUserInfoRow[key] === "number"
        ? (raw === "" ? null : Number(raw))
        : (raw === "" ? null : raw);
    }
  });

  if (!confirm("Save changes to this user's profile?")) return;

  const msgEl = document.getElementById("userSaveMsg");
  msgEl.style.color = "";
  msgEl.textContent = "Saving...";

  const { error } = await _supabase.from("profiles").update(update).eq("id", currentUserInfoRow.id);
  if (error) {
    msgEl.style.color = "#dc2626";
    msgEl.textContent = "Error: " + error.message;
    return;
  }
  msgEl.style.color = "#16a34a";
  msgEl.textContent = "Saved.";
}



