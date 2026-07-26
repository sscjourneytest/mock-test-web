// checkout.js — Razorpay checkout flow for Mock Matrix Hub Premium
// Requires: <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
// Requires: auth.js already loaded (provides _supabase client)

const WORKER_BASE = "https://mmh-vault-2.mockmatrixhub.workers.dev";

let plans = [];
let selectedPlan = null;
let appliedCoupon = null;

// -----------------------------------------------------------
// 0. Load all active plans from Supabase, pick / render selection
// -----------------------------------------------------------
async function loadPlans() {
  try {
    const { data, error } = await _supabase
      .from("pricing")
      .select("plan_name, original_price, offer_price, validity_days")
      .eq("is_active", true)
      .order("offer_price", { ascending: true });

    if (error || !data || data.length === 0) return; // keep hardcoded fallback in HTML

    plans = data;

    if (plans.length > 1) {
      renderPlanSelector();
    }

    selectPlan(plans[0].plan_name);
  } catch (err) {
    // silently keep hardcoded fallback price if this fails
  }
}

function renderPlanSelector() {
  const container = document.getElementById("planSelector");
  container.innerHTML = "";
  container.style.display = "flex";

  plans.forEach((plan) => {
    const el = document.createElement("div");
    el.className = "plan-option";
    el.dataset.plan = plan.plan_name;
    el.innerHTML = `
      <div class="po-name">${plan.plan_name}</div>
      <div class="po-price">₹${plan.offer_price} · ${plan.validity_days}d</div>
    `;
    el.addEventListener("click", () => selectPlan(plan.plan_name));
    container.appendChild(el);
  });
}

function selectPlan(planName) {
  const plan = plans.find((p) => p.plan_name === planName);
  if (!plan) return;

  selectedPlan = plan;
  appliedCoupon = null;

  document.getElementById("planNameLabel").textContent = plan.plan_name + " Premium";
  document.getElementById("validityBadge").textContent = `VALID ${plan.validity_days} DAYS`;
  document.getElementById("originalPrice").textContent = plan.original_price;
  document.getElementById("finalPrice").textContent = plan.offer_price;

  document.getElementById("couponCode").value = "";
  document.getElementById("couponMsg").textContent = "";

  document.querySelectorAll(".plan-option").forEach((el) => {
    el.classList.toggle("active", el.dataset.plan === planName);
  });
}

// -----------------------------------------------------------
// 1. Apply coupon — live price update, no payment yet
// -----------------------------------------------------------
async function applyCoupon() {
  const codeInput = document.getElementById("couponCode");
  const msgEl = document.getElementById("couponMsg");
  const code = codeInput.value.trim();

  if (!selectedPlan) return;

  if (!code) {
    msgEl.textContent = "";
    appliedCoupon = null;
    document.getElementById("finalPrice").textContent = selectedPlan.offer_price;
    return;
  }

  msgEl.style.color = "#64748b";
  msgEl.textContent = "Checking coupon...";

  try {
    const res = await fetch(`${WORKER_BASE}/validate-coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_name: selectedPlan.plan_name, coupon_code: code }),
    });
    const data = await res.json();

    if (!res.ok || !data.valid) {
      msgEl.style.color = "#dc2626";
      msgEl.textContent = data.error || "Invalid coupon code";
      appliedCoupon = null;
      return;
    }

    appliedCoupon = code;
    document.getElementById("finalPrice").textContent = data.final_amount;
    msgEl.style.color = "#16a34a";
    msgEl.textContent = `Coupon applied — ${data.discount_percent}% off`;
  } catch (err) {
    msgEl.style.color = "#dc2626";
    msgEl.textContent = "Could not check coupon, try again";
    appliedCoupon = null;
  }
}

function showAlreadyPremium(expiresAt) {
  const btn = document.getElementById("payBtn");
  btn.disabled = true;
  btn.innerText = "Already Premium ✓";
  btn.style.background = "#16a34a";

  const msgEl = document.getElementById("couponMsg");
  const validText = expiresAt
    ? `You already have Premium, valid until ${new Date(expiresAt).toDateString()}.`
    : "You already have Premium access.";
  msgEl.style.color = "#16a34a";
  msgEl.textContent = validText;
}

async function checkAlreadyPremiumOnLoad() {
  const { data: sessionData } = await _supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return;

  const { data: profile } = await _supabase
    .from("profiles")
    .select("is_paid, expires_at")
    .eq("id", userId)
    .maybeSingle();

  const stillValid = profile && profile.is_paid &&
    (!profile.expires_at || new Date(profile.expires_at) > new Date());

  if (stillValid) {
    showAlreadyPremium(profile.expires_at);
  }
}

function showSuccessBanner() {
  const processing = document.getElementById("processingOverlay");
  if (processing) processing.classList.remove("active");

  const success = document.getElementById("successOverlay");
  if (success) success.classList.add("active");

  setTimeout(() => {
    window.location.href = "/index.html";
  }, 1800);
}

// -----------------------------------------------------------
// 1.5 Recover from a killed tab mid-payment — same job as the
// check in index.html, but this one runs on buy-premium.html
// itself, since Android usually relaunches a killed PWA back on
// the exact page it died on, not on index.html.
// -----------------------------------------------------------
async function recoverPendingPayment() {
  const raw = localStorage.getItem("mmh_payment_pending");
  if (!raw) return;

  let pending;
  try { pending = JSON.parse(raw); } catch (e) { localStorage.removeItem("mmh_payment_pending"); return; }

  const oneHour = 60 * 60 * 1000;
  if (!pending.ts || Date.now() - pending.ts > oneHour) {
    localStorage.removeItem("mmh_payment_pending");
    return;
  }

  // Show the same "confirming payment" overlay immediately — the user
  // just came back from a UPI app, this is exactly the moment they're
  // looking at the screen wondering what happened.
  const overlay = document.getElementById("processingOverlay");
  if (overlay) overlay.classList.add("active");

  const { data: userData } = await _supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) { if (overlay) overlay.classList.remove("active"); return; }

  const { data: profile } = await _supabase
    .from("profiles")
    .select("is_paid, expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (profile && profile.is_paid) {
    const cached = getLocalProfile() || {};
    saveLocalProfile({ ...cached, is_paid: true, expires_at: profile.expires_at });
    localStorage.removeItem("mmh_payment_pending");
    showSuccessBanner();
    return;
  }

  // Not confirmed yet — fall back to the normal polling loop instead
  // of leaving the user stuck on a silent overlay.
  if (overlay) overlay.classList.remove("active");
  pollForAccess();
}

// -----------------------------------------------------------
// 2. Start checkout — creates order, opens Razorpay modal
// -----------------------------------------------------------
async function startCheckout() {
  const btn = document.getElementById("payBtn");
  if (!selectedPlan) return;

  btn.disabled = true;
  btn.innerText = "Preparing checkout...";

  try {
    const { data: sessionData } = await _supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const userEmail = sessionData?.session?.user?.email || "";

    if (!token) {
      alert("Please login to continue.");
      window.location.href = "/login.html?redirect=/buy-premium.html";
      return;
    }

    // Check live is_paid + expires_at from profiles before creating an order —
    // don't let an already-premium user pay again.
    const { data: userData } = await _supabase.auth.getUser();
    const userId = userData?.user?.id;

    if (userId) {
      const { data: profile } = await _supabase
        .from("profiles")
        .select("is_paid, expires_at")
        .eq("id", userId)
        .maybeSingle();

      const stillValid = profile && profile.is_paid &&
        (!profile.expires_at || new Date(profile.expires_at) > new Date());

      if (stillValid) {
        showAlreadyPremium(profile.expires_at);
        return;
      }
    }

    const res = await fetch(`${WORKER_BASE}/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        plan_name: selectedPlan.plan_name,
        coupon_code: appliedCoupon || undefined,
      }),
    });

    const order = await res.json();

    if (!res.ok) {
      alert("Could not start checkout: " + (order.error || "unknown error") + "\n\nDetails: " + JSON.stringify(order.details || {}));
      btn.disabled = false;
      btn.innerText = "Continue";
      return;
    }

    // Mark a payment as pending BEFORE opening the modal — if the tab gets
    // killed while the user is in a UPI app and reloads later, index.html
    // will see this flag and force a fresh profile check on its own.
    localStorage.setItem("mmh_payment_pending", JSON.stringify({ ts: Date.now() }));

    const options = {
      key: order.key_id,
      amount: order.amount * 100,
      currency: order.currency,
      name: "Mock Matrix Hub",
      description: `${order.plan_name} Premium`,
      order_id: order.order_id,
      prefill: { email: userEmail },
      handler: function (response) {
        // This fires client-side on success — NOT the source of truth.
        // The webhook confirms the payment server-side; we just start polling.
        // Show the full-screen "don't close / wait for redirect" overlay right
        // now, since this is exactly the window where users tend to bail out.
        document.getElementById("processingOverlay").classList.add("active");
        btn.innerText = "Confirming payment...";
        pollForAccess();
      },
      modal: {
        ondismiss: function () {
          btn.disabled = false;
          btn.innerText = "Continue";
        },
      },
      theme: { color: "#2563eb" },
      config: {
        display: {
          blocks: {
            qr_block: {
              name: "Pay via UPI QR",
              instruments: [{ method: "upi", flows: ["qr"] }],
            },
          },
          sequence: ["block.qr_block"],
          preferences: { show_default_blocks: true },
        },
      },
    };

    const rzp = new Razorpay(options);

    rzp.on("payment.failed", function (response) {
      alert("Payment failed: " + response.error.description);
      btn.disabled = false;
      btn.innerText = "Continue";
    });

    rzp.open();
  } catch (err) {
    alert("Something went wrong: " + err.message);
    btn.disabled = false;
    btn.innerText = "Continue";
  }
}

// -----------------------------------------------------------
// 3. Poll profile.is_paid until the webhook has processed it
// -----------------------------------------------------------
async function pollForAccess() {
  const btn = document.getElementById("payBtn");
  const maxAttempts = 20; // ~60 seconds at 3s interval
  let attempts = 0;

  const interval = setInterval(async () => {
    attempts++;
    const { data: userData } = await _supabase.auth.getUser();
    const userId = userData?.user?.id;

    if (userId) {
      const { data: profile } = await _supabase
        .from("profiles")
        .select("is_paid, expires_at")
        .eq("id", userId)
        .maybeSingle();

      if (profile && profile.is_paid) {
        clearInterval(interval);
        const cached = getLocalProfile() || {};
        saveLocalProfile({ ...cached, is_paid: true, expires_at: profile.expires_at });
        localStorage.removeItem("mmh_payment_pending");
        showSuccessBanner();
        return;
      }
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      document.getElementById("processingOverlay").classList.remove("active");
      alert(
        "Payment received, but confirmation is taking longer than usual. " +
        "Please check back in a few minutes — your access will activate automatically."
      );
      btn.disabled = false;
      btn.innerText = "Continue";
    }
  }, 3000);
}

// -----------------------------------------------------------
// 4. Pre-payment instruction popup — must be acknowledged (checkbox)
// before Razorpay actually opens. The main "Continue" button on the
// page never calls startCheckout() directly anymore; it only opens
// this popup. startCheckout() only runs from the popup's own
// Continue button, once the checkbox is checked.
// -----------------------------------------------------------
function openInstructionPopup() {
  const overlay = document.getElementById("paymentInstructionOverlay");
  const checkbox = document.getElementById("popupAckCheckbox");
  const popupBtn = document.getElementById("popupContinueBtn");

  checkbox.checked = false;
  popupBtn.disabled = true;
  overlay.classList.add("active");
}

function closeInstructionPopup() {
  document.getElementById("paymentInstructionOverlay").classList.remove("active");
}

// -----------------------------------------------------------
// Wire up events
// -----------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  loadPlans();
  recoverPendingPayment();
  checkAlreadyPremiumOnLoad();

  const applyBtn = document.getElementById("applyCouponBtn");
  const payBtn = document.getElementById("payBtn");
  const popupCheckbox = document.getElementById("popupAckCheckbox");
  const popupBtn = document.getElementById("popupContinueBtn");

  if (applyBtn) applyBtn.addEventListener("click", applyCoupon);

  // Main "Continue" button -> open instructions popup (does NOT open Razorpay directly)
  // If the on-load check already disabled this button (already premium), this
  // handler simply never fires — disabled buttons don't dispatch click events.
  if (payBtn) payBtn.addEventListener("click", openInstructionPopup);

  // Checkbox enables/disables the popup's own Continue button
  if (popupCheckbox) {
    popupCheckbox.addEventListener("change", () => {
      popupBtn.disabled = !popupCheckbox.checked;
    });
  }

  // Popup's Continue -> close popup, THEN actually start Razorpay checkout
  if (popupBtn) {
    popupBtn.addEventListener("click", () => {
      if (popupCheckbox.checked) {
        closeInstructionPopup();
        startCheckout();
      }
    });
  }
});


