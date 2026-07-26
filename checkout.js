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
        alert("Payment confirmed! Your premium access is now active.");
        window.location.href = "/index.html";
        return;
      }
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
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
// Wire up events
// -----------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  loadPlans();

  const applyBtn = document.getElementById("applyCouponBtn");
  const payBtn = document.getElementById("payBtn");

  if (applyBtn) applyBtn.addEventListener("click", applyCoupon);
  if (payBtn) payBtn.addEventListener("click", startCheckout);
});
