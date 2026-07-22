// checkout.js — Razorpay checkout flow for Mock Matrix Hub Premium
// Requires: <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
// Requires: auth.js already loaded (provides _supabase client)

const WORKER_BASE = "https://mmh-vault-2.mockmatrixhub.workers.dev";
const PLAN_NAME = "Annual"; // must match pricing.plan_name in Supabase

let appliedCoupon = null;
let currentFinalAmount = null; // in rupees

// -----------------------------------------------------------
// 0. Load current price directly from Supabase on page load
//    (same direct-read pattern auth.js already uses)
// -----------------------------------------------------------
async function loadCurrentPrice() {
  try {
    const { data, error } = await _supabase
      .from("pricing")
      .select("original_price, offer_price")
      .eq("plan_name", PLAN_NAME)
      .eq("is_active", true)
      .single();

    if (error || !data) return; // fall back to whatever's in the HTML

    document.getElementById("originalPrice").textContent = data.original_price;
    document.getElementById("finalPrice").textContent = data.offer_price;
    currentFinalAmount = data.offer_price;
  } catch (err) {
    // silently keep hardcoded fallback price if this fails
  }
}

// -----------------------------------------------------------
// 1. Apply coupon — live price update, no payment yet
// -----------------------------------------------------------
async function applyCoupon() {
  const codeInput = document.getElementById("couponCode");
  const msgEl = document.getElementById("couponMsg");
  const code = codeInput.value.trim();

  if (!code) {
    msgEl.textContent = "";
    appliedCoupon = null;
    return;
  }

  msgEl.style.color = "#64748b";
  msgEl.textContent = "Checking coupon...";

  try {
    const res = await fetch(`${WORKER_BASE}/validate-coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_name: PLAN_NAME, coupon_code: code }),
    });
    const data = await res.json();

    if (!res.ok || !data.valid) {
      msgEl.style.color = "#dc2626";
      msgEl.textContent = data.error || "Invalid coupon code";
      appliedCoupon = null;
      return;
    }

    appliedCoupon = code;
    currentFinalAmount = data.final_amount;
    document.getElementById("finalPrice").textContent = data.final_amount;
    msgEl.style.color = "#16a34a";
    msgEl.textContent = `Coupon applied — ${data.discount_percent}% off`;
  } catch (err) {
    msgEl.style.color = "#dc2626";
    msgEl.textContent = "Could not check coupon, try again";
    appliedCoupon = null;
  }
}

// -----------------------------------------------------------
// 2. Start checkout — creates order, opens Razorpay modal
// -----------------------------------------------------------
async function startCheckout() {
  const btn = document.getElementById("payBtn");
  btn.disabled = true;
  btn.innerText = "Preparing checkout...";

  try {
    const { data: sessionData } = await _supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    if (!token) {
      alert("Please login to continue.");
      window.location.href = "/login.html?redirect=/buy-premium.html";
      return;
    }

    const res = await fetch(`${WORKER_BASE}/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        plan_name: PLAN_NAME,
        coupon_code: appliedCoupon || undefined,
      }),
    });

    const order = await res.json();

    if (!res.ok) {
      alert("Could not start checkout: " + (order.error || "unknown error"));
      btn.disabled = false;
      btn.innerText = "Pay Now";
      return;
    }

    const options = {
      key: order.key_id,
      amount: order.amount * 100,
      currency: order.currency,
      name: "Mock Matrix Hub",
      description: `${order.plan_name} Premium`,
      order_id: order.order_id,
      handler: function (response) {
        // This fires client-side on success — NOT the source of truth.
        // The webhook confirms the payment server-side; we just start polling.
        btn.innerText = "Confirming payment...";
        pollForAccess();
      },
      modal: {
        ondismiss: function () {
          btn.disabled = false;
          btn.innerText = "Pay Now";
        },
      },
      theme: { color: "#2563eb" },
    };

    const rzp = new Razorpay(options);

    rzp.on("payment.failed", function (response) {
      alert("Payment failed: " + response.error.description);
      btn.disabled = false;
      btn.innerText = "Pay Now";
    });

    rzp.open();
  } catch (err) {
    alert("Something went wrong: " + err.message);
    btn.disabled = false;
    btn.innerText = "Pay Now";
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
      btn.innerText = "Pay Now";
    }
  }, 3000);
}

// -----------------------------------------------------------
// Wire up events
// -----------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  loadCurrentPrice();
  const applyBtn = document.getElementById("applyCouponBtn");
  const payBtn = document.getElementById("payBtn");
  if (applyBtn) applyBtn.addEventListener("click", applyCoupon);
  if (payBtn) payBtn.addEventListener("click", startCheckout);
});

