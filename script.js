const checkoutModal = document.querySelector("#checkout-modal");
const closeModalButtons = document.querySelectorAll(".modal-close");
const openCheckoutButtons = document.querySelectorAll(".open-checkout");
const ageGate = document.querySelector("#age-gate");
const ageConfirm = document.querySelector("#age-confirm");
const siteShell = document.querySelector("#site-shell");
const promoToggle = document.querySelector(".promo-toggle");
const planList = document.querySelector("#plan-list");
const bioText = document.querySelector("#bioText");
const bioToggle = document.querySelector("#bioToggle");
const previewVideos = document.querySelectorAll(".content-preview video");
const checkoutForm = document.querySelector("#checkout-form");
const paymentFeedback = document.querySelector("#payment-feedback");
const pixResult = document.querySelector("#pix-result");
const pixQrImage = document.querySelector("#pix-qr-image");
const pixQrEmpty = document.querySelector("#pix-qr-empty");
const pixCode = document.querySelector("#pix-code");
const copyPixButton = document.querySelector(".copy-pix-button");
const checkPaymentButton = document.querySelector(".check-payment-button");
const deliveryStatus = document.querySelector("#delivery-status");
const purchaseToast = document.querySelector("#purchase-toast");
const purchaseToastName = document.querySelector("#purchase-toast-name");
const purchaseToastClose = document.querySelector(".toast-close");
const selectedPlanIdInput = document.querySelector("#selected-plan-id");
const selectedPlanLabel = document.querySelector("#selected-plan-label");
const selectedPlanPrice = document.querySelector("#selected-plan-price");
const submitPaymentButton = document.querySelector(".submit-payment");

let currentOrderId = null;
let currentTransactionHash = null;
let pollTimer = null;
let checkoutTracked = false;
let addToCartTracked = false;
let leadTracked = false;
let purchaseTracked = false;
let latestCustomerData = null;
let selectedPlan = {
  id: "15d",
  label: "15 Dias",
  price: 9.9,
};

const activeOrderStorageKey = "active_order";
const externalIdCookieName = "site_external_id";
const trackingStorageKey = "checkout_tracking";
const purchaseToastMessages = [
  "Gabriel acabou de assinar o acesso premium",
  "Carlos Eduardo Oliveira acabou de assinar",
  "Rafael acabou de liberar o conteudo premium",
  "Lucas acabou de garantir o acesso premium",
  "Bruno acabou de assinar agora",
  "Thiago acabou de garantir o perfil premium",
  "Mateus acabou de liberar o conteudo premium",
  "Eduardo acabou de assinar o perfil",
  "Joao Pedro acabou de assinar",
  "Gustavo acabou de liberar o perfil",
  "Henrique acabou de garantir o acesso",
  "Felipe acabou de assinar agora",
  "Andre acabou de liberar o conteudo premium",
];
let purchaseToastIndex = 0;

function playPreviewVideos() {
  if (!previewVideos.length) return;

  previewVideos.forEach((video) => {
    video.muted = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");

    const playPromise = video.play();

    if (playPromise?.catch) {
      playPromise.catch(() => {});
    }
  });
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function getPixelProductParams(plan = selectedPlan) {
  return {
    content_name: `Acesso Premium Nicolle - ${plan.label}`,
    content_type: "product",
    contents: [
      {
        id: `site-18-nicolle-premium-${plan.id}`,
        quantity: 1,
        item_price: plan.price,
      },
    ],
    content_ids: [`site-18-nicolle-premium-${plan.id}`],
    currency: "BRL",
    value: plan.price,
  };
}

function getPurchasePixelParams() {
  return {
    ...getPixelProductParams(),
    value: selectedPlan.price,
    currency: "BRL",
  };
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function setCookie(name, value, days = 90) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function captureFbclid() {
  const fbclid = new URLSearchParams(window.location.search).get("fbclid");
  if (!fbclid) return getCookie("_fbc");

  const existing = getCookie("_fbc");
  if (existing && existing.includes(fbclid)) return existing;

  const fbc = `fb.1.${Date.now()}.${fbclid}`;
  setCookie("_fbc", fbc);
  return fbc;
}

function getOrCreateFbp() {
  const existing = getCookie("_fbp");
  if (existing) return existing;

  const randomValue = Math.floor(Math.random() * 10 ** 16);
  const fbp = `fb.1.${Date.now()}.${randomValue}`;
  setCookie("_fbp", fbp);
  return fbp;
}

function getOrCreateExternalId() {
  const existing = getCookie(externalIdCookieName);
  if (existing) return existing;

  const externalId = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}.${Math.random().toString(16).slice(2)}`;
  setCookie(externalIdCookieName, externalId, 365);
  return externalId;
}

function getMetaUserData(extra = {}) {
  return {
    fbp: getOrCreateFbp(),
    fbc: captureFbclid(),
    external_id: extra.external_id || getOrCreateExternalId(),
    email: extra.email,
    phone: extra.phone,
  };
}

function getMetaAttributionData() {
  return {
    fbp: getOrCreateFbp(),
    fbc: captureFbclid(),
    external_id: getOrCreateExternalId(),
    event_source_url: window.location.href,
  };
}

function getTrackingData() {
  const params = new URLSearchParams(window.location.search);
  const keys = ["src", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  const tracking = {};

  keys.forEach((key) => {
    tracking[key] = params.get(key) || "";
  });

  try {
    const saved = JSON.parse(window.localStorage.getItem(trackingStorageKey) || "{}");
    keys.forEach((key) => {
      tracking[key] = tracking[key] || saved[key] || "";
    });
    window.localStorage.setItem(trackingStorageKey, JSON.stringify(tracking));
  } catch {
    // Tracking is helpful for attribution, but checkout must keep working without localStorage.
  }

  return tracking;
}

function createEventId(eventName) {
  if (window.crypto?.randomUUID) {
    return `${eventName}.${window.crypto.randomUUID()}`;
  }

  return `${eventName}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
}

function sendCapiEvent({ eventName, eventId, params = {}, customer = {} }) {
  return fetch("/api/meta/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_name: eventName,
      event_id: eventId,
      event_source_url: window.location.href,
      custom_data: params,
      user_data: getMetaUserData(customer),
    }),
  }).catch((error) => {
    console.warn("[Meta CAPI] Falha ao enviar evento", eventName, error);
  });
}

function trackMetaEvent(eventName, params = {}, options = {}) {
  const eventId = options.eventId || createEventId(eventName);
  const customer = options.customer || latestCustomerData || {};

  if (!options.skipBrowser && typeof window.fbq === "function") {
    window.fbq("track", eventName, params, { eventID: eventId });
  }

  if (!options.skipCapi) {
    sendCapiEvent({
      eventName,
      eventId,
      params,
      customer,
    });
  }

  return eventId;
}

function trackPixel(eventName, params = {}) {
  if (typeof window.fbq === "function") {
    window.fbq("track", eventName, params);
  }
}

function getPurchaseStorageKey(orderId) {
  return `purchase_tracked_${orderId}`;
}

function hasTrackedPurchase(orderId) {
  if (!orderId) return purchaseTracked;

  try {
    return window.localStorage.getItem(getPurchaseStorageKey(orderId)) === "1";
  } catch {
    return purchaseTracked;
  }
}

function markPurchaseTracked(orderId) {
  purchaseTracked = true;

  if (!orderId) return;

  try {
    window.localStorage.setItem(getPurchaseStorageKey(orderId), "1");
  } catch {
    // Ignore storage failures; the in-memory guard still prevents repeats in this session.
  }
}

function saveActiveOrder(order = {}) {
  try {
    window.localStorage.setItem(activeOrderStorageKey, JSON.stringify(order));
  } catch {
    // The checkout still works if the browser blocks localStorage.
  }
}

function restoreActiveOrder() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(activeOrderStorageKey) || "{}");
    if (!saved.orderId) return;

    currentOrderId = saved.orderId;
    currentTransactionHash = saved.transactionHash || null;
    latestCustomerData = saved.customer || null;
  } catch {
    // Ignore invalid persisted state.
  }
}

function clearActiveOrder() {
  try {
    window.localStorage.removeItem(activeOrderStorageKey);
  } catch {
    // Nothing to clear.
  }
}

function showPurchaseToast() {
  if (!purchaseToast || !purchaseToastName) return;

  const randomOffset = Math.floor(Math.random() * purchaseToastMessages.length);
  purchaseToastName.textContent = purchaseToastMessages[
    (purchaseToastIndex + randomOffset) % purchaseToastMessages.length
  ];
  purchaseToastIndex += 1;
  purchaseToast.classList.remove("is-visible");
  purchaseToast.setAttribute("aria-hidden", "false");

  window.requestAnimationFrame(() => {
    purchaseToast.classList.add("is-visible");
  });
}

function onlyDigits(value = "") {
  return String(value).replace(/\D/g, "");
}

function formatPhone(value = "") {
  const digits = onlyDigits(value).slice(0, 11);

  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 6) return digits.replace(/(\d{2})(\d{0,4})/, "($1) $2");
  if (digits.length <= 10) return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3");

  return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
}

function updateSelectedPlan(plan = {}) {
  const price = Number(plan.price || plan.dataset?.planPrice || selectedPlan.price);
  const label = plan.label || plan.dataset?.planLabel || selectedPlan.label;
  const id = plan.id || plan.dataset?.planId || selectedPlan.id;

  selectedPlan = { id, label, price };

  if (selectedPlanIdInput) selectedPlanIdInput.value = selectedPlan.id;
  if (selectedPlanLabel) selectedPlanLabel.textContent = selectedPlan.label;
  if (selectedPlanPrice) selectedPlanPrice.textContent = formatCurrency(selectedPlan.price);
  resetSubmitButton(submitPaymentButton);
}

function openCheckout(sourceButton) {
  if (sourceButton?.dataset?.planId) {
    updateSelectedPlan(sourceButton);
  }

  checkoutModal?.classList.add("is-open");
  checkoutModal?.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  if (!checkoutTracked) {
    trackMetaEvent("InitiateCheckout", getPixelProductParams());
    checkoutTracked = true;
  }

  if (currentOrderId) {
    pixResult?.classList.add("is-open");
    pixResult?.setAttribute("aria-hidden", "false");
    deliveryStatus.textContent = "Consultando status do pagamento anterior...";
    checkOrderStatus().catch((error) => {
      deliveryStatus.textContent = error.message;
    });
  }
}

function closeCheckout() {
  checkoutModal?.classList.remove("is-open");
  checkoutModal?.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function setFeedback(message = "", type = "info") {
  if (!paymentFeedback) return;
  paymentFeedback.textContent = message;
  paymentFeedback.dataset.type = type;
}

function resetSubmitButton(button) {
  if (button) button.textContent = `Gerar Pix de ${formatCurrency(selectedPlan.price)}`;
}

function scrollToPixResult() {
  if (!pixResult) return;

  window.requestAnimationFrame(() => {
    pixResult.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

function buildQrCodeUrl(pixPayload = "") {
  if (!pixPayload) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=12&data=${encodeURIComponent(
    pixPayload
  )}`;
}

function normalizeQrImageSource(qrImage = "", pixPayload = "") {
  const value = String(qrImage || "").trim();

  if (value.startsWith("data:image/") || value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  if (value) {
    return `data:image/png;base64,${value.replace(/\s/g, "")}`;
  }

  return buildQrCodeUrl(pixPayload);
}

async function checkOrderStatus() {
  if (!currentOrderId) return;

  const response = await fetch(`/api/orders/${currentOrderId}/status`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Nao foi possivel consultar o pedido.");
  }

  if (data.isPaid) {
    window.clearInterval(pollTimer);
    pollTimer = null;

    deliveryStatus.innerHTML = `
      <div class="download-ready">
        <strong>Pagamento confirmado!</strong>
        <span>Seu acesso premium foi confirmado.</span>
      </div>
    `;
    if (!hasTrackedPurchase(currentOrderId)) {
      trackMetaEvent("Purchase", getPurchasePixelParams(), {
        eventId: `Purchase.${currentOrderId}`,
        skipCapi: true,
      });
      markPurchaseTracked(currentOrderId);
    }
    clearActiveOrder();
    setFeedback("Pagamento confirmado. Seu acesso foi liberado.", "success");
    return;
  }

  deliveryStatus.textContent =
    "Pagamento ainda pendente. Depois de pagar, a confirmacao pode levar alguns instantes.";
}

function startPolling() {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    checkOrderStatus().catch((error) => {
      deliveryStatus.textContent = error.message;
    });
  }, 5000);
}

function unlockAgeGate() {
  ageGate?.classList.add("is-hidden");
  siteShell?.classList.add("is-ready");
  siteShell?.setAttribute("aria-hidden", "false");
  document.body.classList.remove("age-locked");
  window.setTimeout(() => {
    if (ageGate) ageGate.style.display = "none";
  }, 420);
}

ageConfirm?.addEventListener("click", unlockAgeGate);

bioToggle?.addEventListener("click", () => {
  const isExpanded = bioText?.classList.toggle("expanded");
  bioToggle.textContent = isExpanded ? "Mostrar menos" : "Mostrar mais";
});

promoToggle?.addEventListener("click", () => {
  const isExpanded = promoToggle.getAttribute("aria-expanded") === "true";
  promoToggle.setAttribute("aria-expanded", String(!isExpanded));
  planList?.classList.toggle("is-collapsed", isExpanded);
});

trackMetaEvent("PageView", {}, { eventId: window.__metaPageViewEventId, skipBrowser: true });
trackMetaEvent("ViewContent", getPixelProductParams());
restoreActiveOrder();

if (previewVideos.length) {
  playPreviewVideos();
  window.addEventListener("load", playPreviewVideos, { once: true });
  document.addEventListener("pointerdown", playPreviewVideos, { once: true, capture: true });
  document.addEventListener("keydown", playPreviewVideos, { once: true, capture: true });
}

window.setTimeout(showPurchaseToast, 2600);
window.setInterval(showPurchaseToast, 14500);
purchaseToastClose?.addEventListener("click", () => {
  purchaseToast?.classList.remove("is-visible");
});

openCheckoutButtons.forEach((button) => button.addEventListener("click", () => openCheckout(button)));
closeModalButtons.forEach((button) => {
  button.addEventListener("click", () => {
    closeCheckout();
  });
});

checkoutModal?.addEventListener("click", (event) => {
  if (event.target === checkoutModal) closeCheckout();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCheckout();
  }
});

checkoutForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const submitButton = checkoutForm.querySelector(".submit-payment");
  const formData = new FormData(checkoutForm);
  const payload = Object.fromEntries(formData.entries());
  latestCustomerData = {
    email: payload.email,
  };

  submitButton.disabled = true;
  submitButton.textContent = "Gerando Pix...";
  setFeedback("");
  deliveryStatus.textContent = "";
  pixResult?.classList.remove("is-open");

  try {
    const response = await fetch("/api/payments/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer: {
          name: payload.name,
          email: payload.email,
        },
        deliveryPreference: payload.deliveryPreference,
        planId: payload.planId || selectedPlan.id,
        attribution: getMetaAttributionData(),
        tracking: getTrackingData(),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Nao foi possivel gerar o Pix.");
    }

    currentOrderId = data.order_id;
    currentTransactionHash = data.transaction_hash;
    saveActiveOrder({
      orderId: currentOrderId,
      transactionHash: currentTransactionHash,
      customer: latestCustomerData,
    });

    if (pixCode) pixCode.value = data.pix_code || "";

    if (pixQrImage && pixQrEmpty) {
      const qrImageSource = normalizeQrImageSource(data.pix_base64, data.pix_code);

      if (qrImageSource) {
        pixQrImage.src = qrImageSource;
        pixQrImage.classList.add("is-visible");
        pixQrEmpty.classList.add("is-hidden");
      } else {
        pixQrImage.classList.remove("is-visible");
        pixQrEmpty.classList.remove("is-hidden");
      }
    }

    pixResult?.classList.add("is-open");
    pixResult?.setAttribute("aria-hidden", "false");
    scrollToPixResult();
    if (!addToCartTracked) {
      trackMetaEvent("AddToCart", getPixelProductParams(), { customer: latestCustomerData });
      addToCartTracked = true;
    }
    if (!leadTracked) {
      trackMetaEvent("Lead", getPixelProductParams(), { customer: latestCustomerData });
      leadTracked = true;
    }
    setFeedback("Pix gerado. Pague usando o QR Code ou o copia e cola.", "success");
    deliveryStatus.textContent = currentTransactionHash
      ? "Aguardando confirmacao do pagamento."
      : "Pix gerado. Depois de pagar, clique em verificar pagamento.";
    startPolling();
  } catch (error) {
    setFeedback(error.message, "error");
  } finally {
    submitButton.disabled = false;
    resetSubmitButton(submitButton);
  }
});

copyPixButton?.addEventListener("click", async () => {
  const code = pixCode?.value || "";
  if (!code) return;

  try {
    await navigator.clipboard.writeText(code);
  } catch {
    pixCode.select();
    document.execCommand("copy");
  }

  copyPixButton.textContent = "Codigo copiado";
  window.setTimeout(() => {
    copyPixButton.textContent = "Copiar codigo Pix";
  }, 1600);
});

checkPaymentButton?.addEventListener("click", () => {
  checkOrderStatus().catch((error) => {
    deliveryStatus.textContent = error.message;
  });
});
