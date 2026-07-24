const WORKER_BASE = "https://mmh-vault-2.mockmatrixhub.workers.dev";
let myRole = null;
let myToken = null;

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

  const { data: profile } = await _supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .maybeSingle();

  myRole = profile?.role;

  if (!["owner", "subowner", "admin"].includes(myRole)) {
    document.getElementById("deniedScreen").style.display = "block";
    return;
  }

  if (myRole === "owner") document.body.classList.add("role-owner");

  document.getElementById("vaultApp").style.display = "block";
  initTabs();
  loadStats();
  loadRevenue("today");
  loadCoupons();
  loadPricing();
  loadPayouts();
  loadLegacyPayments();
  wireForms();
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
      <td style="max-width:180px; overflow-wrap:anywhere;">${r.channel_links || ""}</td>
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
    const ownerName = document.getElementById("saleOwnerName").value.trim();
    const discount = Number(document.getElementById("saleDiscount").value) || 0;
    const payout = Number(document.getElementById("salePayout").value) || 0;
    const upi = document.getElementById("saleUpi").value.trim();
    const validUntil = document.getElementById("saleValidUntil").value;

    if (!code) return alert("Enter a coupon code");

    const { error } = await _supabase.from("coupons").insert([{
      code, owner_name: ownerName || "MMH Sale", discount_percent: discount, payout_percent: payout,
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

