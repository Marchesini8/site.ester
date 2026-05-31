const checkoutForm = document.querySelector("#checkout-page-form");
const checkoutPlanLabel = document.querySelector("#checkout-plan-label");
const checkoutPlanPeriod = document.querySelector("#checkout-plan-period");
const checkoutPlanPrice = document.querySelector("#checkout-plan-price");
const checkoutTotal = document.querySelector("#checkout-total");
const addonInputs = document.querySelectorAll('input[name="addons"]');
const checkoutFeedback = document.querySelector("#checkout-feedback");
const generatePixButton = document.querySelector(".generate-pix");
const prePixSafeStrip = document.querySelector(".pre-pix-safe-strip");
const pixResultPage = document.querySelector("#pix-result-page");
const checkoutPixQr = document.querySelector("#checkout-pix-qr");
const checkoutPixEmpty = document.querySelector("#checkout-pix-empty");
const checkoutPixCode = document.querySelector("#checkout-pix-code");
const copyPixPageButton = document.querySelector(".copy-pix-page");
const checkoutDeliveryStatus = document.querySelector("#checkout-delivery-status");

const plans = {
  "15d": {
    label: "Privacy Nicolle Caroline",
    period: "15 Dias",
    originalPrice: 49.9,
    price: 19.9,
  },
  "30d": {
    label: "30 Dias",
    period: "30 Dias",
    price: 62.9,
  },
  "3m": {
    label: "3 Meses",
    period: "3 Meses",
    price: 75.9,
  },
  "6m": {
    label: "6 Meses",
    period: "6 Meses",
    price: 87.9,
  },
  "upsell-6m": {
    label: "6 Meses",
    period: "6 Meses",
    price: 19.9,
  },
};

let currentOrderId = null;
let currentTransactionHash = null;
let pollTimer = null;
let pixCopyToastTimer = null;
let selectedPlanId = new URLSearchParams(window.location.search).get("planId") || "15d";
let selectedPlan = plans[selectedPlanId] || plans["15d"];
if (!plans[selectedPlanId]) selectedPlanId = "15d";
let latestCustomerData = {};
let addToCartTracked = false;
const externalIdCookieName = "site18_external_id";

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function getSelectedAddons() {
  return Array.from(addonInputs)
    .filter((input) => input.checked)
    .map((input) => ({
      id: input.value,
      price: Number(input.dataset.price || 0),
    }));
}

function getTotal() {
  return getSelectedAddons().reduce((sum, addon) => sum + addon.price, selectedPlan.price);
}

function getPlanPriceHtml(plan) {
  const currentPrice = formatCurrency(plan.price);

  if (!plan.originalPrice || plan.originalPrice <= plan.price) {
    return currentPrice;
  }

  return `<span class="plan-price-old">${formatCurrency(plan.originalPrice)}</span> <span class="plan-price-prefix">Por</span> ${currentPrice}`;
}

function getPixelProductParams() {
  const contents = [
    {
      id: `site-18-nicolle-premium-${selectedPlanId}`,
      quantity: 1,
      item_price: selectedPlan.price,
    },
    ...getSelectedAddons().map((addon) => ({
      id: `site-18-nicolle-${addon.id}`,
      quantity: 1,
      item_price: addon.price,
    })),
  ];

  return {
    content_name: `Acesso Premium Nicolle - ${selectedPlan.period}`,
    content_type: "product",
    content_ids: contents.map((item) => item.id),
    contents,
    currency: "BRL",
    value: getTotal(),
    ...getAttributionEventParams(),
  };
}

function getAttributionEventParams() {
  const tracking = getTrackingData();
  return Object.fromEntries(
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_adset",
      "utm_content",
      "utm_term",
      "fbclid",
      "src",
    ]
      .map((key) => [key, tracking[key]])
      .filter(([, value]) => value)
  );
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
  const fbclid = window.SiteAttribution?.getTrackingData?.().fbclid || new URLSearchParams(window.location.search).get("fbclid");
  if (!fbclid) return getCookie("_fbc");

  const existing = getCookie("_fbc");
  if (existing && existing.includes(fbclid)) return existing;

  const fbc = `fb.1.${Date.now()}.${fbclid}`;
  setCookie("_fbc", fbc);
  return fbc;
}

function getOrCreateFbp() {
  if (window.SiteAttribution?.getOrCreateFbp) return window.SiteAttribution.getOrCreateFbp();

  const existing = getCookie("_fbp");
  if (existing) return existing;

  const randomValue = Math.floor(Math.random() * 10 ** 16);
  const fbp = `fb.1.${Date.now()}.${randomValue}`;
  setCookie("_fbp", fbp);
  return fbp;
}

function getOrCreateExternalId() {
  if (window.SiteAttribution?.getOrCreateExternalId) return window.SiteAttribution.getOrCreateExternalId();

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

function createEventId(eventName) {
  if (window.crypto?.randomUUID) {
    return `${eventName}.${window.crypto.randomUUID()}`;
  }

  return `${eventName}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
}

function sendMetaApiEvent({ eventName, eventId, params = {}, customer = {} }) {
  return fetch("/api/meta/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_name: eventName,
      event_id: eventId,
      event_source_url: window.location.href,
      custom_data: {
        ...getAttributionEventParams(),
        ...params,
      },
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
    sendMetaApiEvent({
      eventName,
      eventId,
      params,
      customer,
    });
  }

  return eventId;
}

function trackAdEvent(eventName, params = {}, options = {}) {
  const eventId = options.eventId || createEventId(eventName);

  trackMetaEvent(eventName, params, {
    ...options,
    eventId,
  });

  return eventId;
}

function getPurchaseStorageKey(orderId) {
  return `purchase_tracked_${orderId}`;
}

function hasTrackedPurchase(orderId) {
  try {
    return window.localStorage.getItem(getPurchaseStorageKey(orderId)) === "1";
  } catch {
    return false;
  }
}

function markPurchaseTracked(orderId) {
  try {
    window.localStorage.setItem(getPurchaseStorageKey(orderId), "1");
  } catch {}
}

function updateTotal() {
  if (checkoutPlanLabel) checkoutPlanLabel.textContent = selectedPlan.label;
  if (checkoutPlanPeriod) {
    const showPeriod = selectedPlan.period && selectedPlan.period !== selectedPlan.label;
    checkoutPlanPeriod.textContent = showPeriod ? selectedPlan.period : "";
    checkoutPlanPeriod.hidden = !showPeriod;
  }
  if (checkoutPlanPrice) checkoutPlanPrice.innerHTML = getPlanPriceHtml(selectedPlan);
  if (checkoutTotal) checkoutTotal.textContent = formatCurrency(getTotal());
  if (generatePixButton) generatePixButton.textContent = `GERAR PIX - ${formatCurrency(getTotal())}`;
}

function blurCheckoutFieldOnOutsideTap(event) {
  const activeElement = document.activeElement;
  const isTextField =
    activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;

  if (!isTextField || !checkoutForm?.contains(activeElement)) return;

  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("input, textarea, select")) return;

  activeElement.blur();
}

function setFeedback(message = "", type = "info") {
  if (!checkoutFeedback) return;
  checkoutFeedback.textContent = message;
  checkoutFeedback.dataset.type = type;
}

function setDeliveryStatus(message = "", type = "info") {
  if (!checkoutDeliveryStatus) return;
  checkoutDeliveryStatus.textContent = message;
  checkoutDeliveryStatus.dataset.type = type;
}

async function copyPixCode() {
  const code = checkoutPixCode?.value || "";
  if (!code) return false;

  const fallbackField = document.createElement("textarea");
  fallbackField.value = code;
  fallbackField.setAttribute("readonly", "");
  fallbackField.style.position = "fixed";
  fallbackField.style.left = "-9999px";
  fallbackField.style.top = "0";
  fallbackField.style.opacity = "0";
  fallbackField.style.fontSize = "16px";
  document.body.appendChild(fallbackField);
  fallbackField.focus({ preventScroll: true });
  fallbackField.select();
  fallbackField.setSelectionRange(0, fallbackField.value.length);
  const copiedWithFallback = document.execCommand("copy");
  fallbackField.remove();

  let copiedWithClipboard = false;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
    copiedWithClipboard = Boolean(navigator.clipboard?.writeText);
  } catch {}

  checkoutPixCode.blur();
  return copiedWithFallback || copiedWithClipboard;
}

function showPixCopyToast() {
  const toastHost = pixResultPage || document.body;
  let toast = toastHost.querySelector(".pix-copy-toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.className = "pix-copy-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toastHost.appendChild(toast);
  }

  toast.textContent = "Copiado com sucesso";
  toast.classList.remove("is-leaving");
  toast.classList.add("is-visible");
  window.clearTimeout(pixCopyToastTimer);
  pixCopyToastTimer = window.setTimeout(() => {
    toast.classList.add("is-leaving");
    toast.classList.remove("is-visible");
  }, 1300);
}

function smoothScrollTo(targetY, duration = 900) {
  const startY = window.scrollY;
  const distance = Math.max(0, targetY) - startY;
  const startTime = performance.now();

  function easeInOutCubic(progress) {
    return progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  }

  function step(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    window.scrollTo(0, startY + distance * easeInOutCubic(progress));
    if (progress < 1) window.requestAnimationFrame(step);
  }

  window.requestAnimationFrame(step);
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

function showPixResult(data = {}) {
  if (!pixResultPage || !checkoutPixCode) return;

  checkoutPixCode.value = data.pix_code || "";
  const qrImageSource = normalizeQrImageSource(data.pix_base64, data.pix_code);

  if (checkoutPixQr && checkoutPixEmpty) {
    if (qrImageSource) {
      checkoutPixQr.src = qrImageSource;
      checkoutPixQr.classList.add("is-visible");
      checkoutPixEmpty.classList.add("is-hidden");
    } else {
      checkoutPixQr.classList.remove("is-visible");
      checkoutPixEmpty.classList.remove("is-hidden");
    }
  }

  pixResultPage.hidden = false;
  generatePixButton?.classList.add("is-hidden");
  prePixSafeStrip?.classList.add("is-hidden");
  window.requestAnimationFrame(() => {
    const pageTop = pixResultPage.getBoundingClientRect().top + window.scrollY;
    const targetTop = pageTop - window.innerHeight * 0.18;
    smoothScrollTo(targetTop, 950);
  });
}

function getTrackingData() {
  if (window.SiteAttribution?.getTrackingData) {
    return window.SiteAttribution.getTrackingData();
  }

  const params = new URLSearchParams(window.location.search);
  return {
    src: params.get("src") || "",
    utm_source: params.get("utm_source") || "",
    utm_medium: params.get("utm_medium") || "",
    utm_campaign: params.get("utm_campaign") || "",
    utm_adset: params.get("utm_adset") || "",
    utm_term: params.get("utm_term") || "",
    utm_content: params.get("utm_content") || "",
    fbclid: params.get("fbclid") || "",
  };
}

function getMetaAttributionData() {
  if (window.SiteAttribution?.getMetaAttributionData) {
    return window.SiteAttribution.getMetaAttributionData();
  }

  return {
    ...getMetaUserData(),
    event_source_url: window.location.href,
  };
}

async function checkOrderStatus() {
  if (!currentOrderId) return;

  const response = await fetch(`/api/orders/${currentOrderId}/status`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Não foi possível consultar o pedido.");
  }

  if (data.isPaid) {
    window.clearInterval(pollTimer);
    pollTimer = null;
    if (!hasTrackedPurchase(currentOrderId)) {
      trackAdEvent("Purchase", getPixelProductParams(), {
        eventId: `Purchase.${currentOrderId}`,
        skipCapi: true,
      });
      markPurchaseTracked(currentOrderId);
    }
    setDeliveryStatus("Pagamento confirmado. Seu acesso foi liberado.", "success");
    return;
  }

  setDeliveryStatus("");
}

function startPolling() {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    checkOrderStatus().catch((error) => {
      setDeliveryStatus(error.message, "error");
    });
  }, 5000);
}

addonInputs.forEach((input) => {
  input.addEventListener("change", () => {
    updateTotal();
    pixResultPage.hidden = true;
    generatePixButton?.classList.remove("is-hidden");
    prePixSafeStrip?.classList.remove("is-hidden");
    currentOrderId = null;
    currentTransactionHash = null;
    setFeedback("");
    setDeliveryStatus("");
  });
});

checkoutForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(checkoutForm);
  const payload = Object.fromEntries(formData.entries());
  const addons = getSelectedAddons().map((addon) => addon.id);
  latestCustomerData = {
    name: payload.name,
    email: payload.email,
  };
  trackAdEvent("InitiateCheckout", getPixelProductParams(), { customer: latestCustomerData });
  generatePixButton.disabled = true;
  generatePixButton.textContent = "GERANDO PIX...";
  setFeedback("");
  setDeliveryStatus("");

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
        deliveryPreference: "email",
        planId: selectedPlanId,
        addons,
        attribution: getMetaAttributionData(),
        tracking: getTrackingData(),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Não foi possível gerar o Pix.");
    }

    currentOrderId = data.order_id;
    currentTransactionHash = data.transaction_hash;
    showPixResult(data);
    if (!addToCartTracked) {
      trackAdEvent("AddToCart", getPixelProductParams(), { customer: latestCustomerData });
      addToCartTracked = true;
    }
    setFeedback("Pix gerado. Pague usando o QR Code ou o código copia e cola.", "success");
    setDeliveryStatus("");
    startPolling();
  } catch (error) {
    setFeedback(error.message, "error");
    generatePixButton?.classList.remove("is-hidden");
    prePixSafeStrip?.classList.remove("is-hidden");
  } finally {
    generatePixButton.disabled = false;
    updateTotal();
  }
});

copyPixPageButton?.addEventListener("click", async () => {
  const wasCopied = await copyPixCode();
  if (!wasCopied) return;

  copyPixPageButton.classList.add("is-copying");
  window.setTimeout(() => {
    copyPixPageButton.classList.remove("is-copying");
  }, 420);
  showPixCopyToast();
});

checkoutPixCode?.addEventListener("pointerdown", (event) => {
  event.preventDefault();
});

checkoutPixCode?.addEventListener("pointerup", async (event) => {
  event.preventDefault();
  const wasCopied = await copyPixCode();
  if (!wasCopied) return;

  showPixCopyToast();
});

document.addEventListener("pointerdown", blurCheckoutFieldOnOutsideTap);

trackMetaEvent("PageView", {}, { eventId: window.__metaPageViewEventId, skipBrowser: true });
trackAdEvent("ViewContent", getPixelProductParams());
updateTotal();
