const crypto = require("crypto");

const TIKTOK_API_VERSION = process.env.TIKTOK_API_VERSION || "v1.3";
const TIKTOK_EVENTS_URL = `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}/event/track/`;
const DEFAULT_PIXEL_CODE = "D8D4H9JC77U91RGD302G";
const SUPPORTED_EVENTS = new Set([
  "PageView",
  "ViewContent",
  "AddToCart",
  "InitiateCheckout",
  "CompletePayment",
]);

function getPublicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
}

function normalizeString(value = "") {
  return String(value).trim().toLowerCase();
}

function normalizePhone(value = "") {
  return String(value).replace(/\D/g, "");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashEmail(email) {
  const normalized = normalizeString(email);
  return normalized ? sha256(normalized) : undefined;
}

function hashPhone(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? sha256(normalized) : undefined;
}

function hashExternalId(externalId) {
  const normalized = normalizeString(externalId);
  if (!normalized) return undefined;
  if (/^[a-f0-9]{64}$/.test(normalized)) return normalized;
  return sha256(normalized);
}

function createExternalId(customer = {}) {
  const email = normalizeString(customer.email);
  const phone = normalizePhone(customer.phone || customer.phone_number);
  const seed = [email, phone].filter(Boolean).join("|");
  return seed ? sha256(seed) : undefined;
}

function getIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || req.ip || "";
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function normalizeEventName(eventName = "") {
  if (eventName === "Purchase") return "CompletePayment";
  return eventName;
}

function buildUserContext(req, payload = {}) {
  const userData = payload.user_data || {};
  return compactObject({
    external_id: hashExternalId(userData.external_id),
    email: hashEmail(userData.email),
    phone_number: hashPhone(userData.phone),
    ip: userData.client_ip_address || getIp(req),
    user_agent: userData.client_user_agent || req.headers["user-agent"],
    ttp: userData.ttp,
  });
}

function buildEvent(req, payload = {}) {
  const event = normalizeEventName(payload.event_name);

  if (!SUPPORTED_EVENTS.has(event)) {
    const error = new Error("Evento TikTok nao suportado.");
    error.statusCode = 400;
    throw error;
  }

  if (!payload.event_id) {
    const error = new Error("event_id e obrigatorio para deduplicacao.");
    error.statusCode = 400;
    throw error;
  }

  const userData = payload.user_data || {};

  return compactObject({
    event,
    event_time: Math.floor(Date.now() / 1000),
    event_id: payload.event_id,
    page: compactObject({
      url: payload.event_source_url || getPublicBaseUrl(),
    }),
    user: compactObject({
      ...buildUserContext(req, payload),
      ttclid: userData.ttclid,
    }),
    properties: compactObject(payload.custom_data || {}),
  });
}

async function sendEvent(req, payload) {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;

  if (!accessToken) {
    const error = new Error("TIKTOK_ACCESS_TOKEN precisa estar configurado no .env/Railway.");
    error.statusCode = 500;
    throw error;
  }

  const event = buildEvent(req, payload);

  const pixelCode = process.env.TIKTOK_PIXEL_CODE || DEFAULT_PIXEL_CODE;
  const requestBody = {
    event_source: "web",
    event_source_id: pixelCode,
    data: [event],
  };

  console.info("[TikTok Events API] Enviando evento", {
    pixel_code: pixelCode,
    event: event.event,
    event_id: event.event_id,
    has_ttp: Boolean(event.user?.ttp),
    has_ttclid: Boolean(event.user?.ttclid),
    has_external_id: Boolean(event.user?.external_id),
    has_email: Boolean(event.user?.email),
    has_phone: Boolean(event.user?.phone_number),
    value: event.properties?.value,
    currency: event.properties?.currency,
  });

  const response = await fetch(TIKTOK_EVENTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Access-Token": accessToken,
    },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || (data.code && data.code !== 0)) {
    console.error("[TikTok Events API] Erro ao enviar evento", {
      pixel_code: pixelCode,
      event: event.event,
      event_id: event.event_id,
      status: response.status,
      response: data,
    });
    const error = new Error(data.message || data.error?.message || "Erro ao enviar evento para TikTok Events API.");
    error.statusCode = response.status || 502;
    throw error;
  }

  console.info("[TikTok Events API] Evento enviado", {
    pixel_code: pixelCode,
    event: event.event,
    event_id: event.event_id,
    request_id: data.request_id,
  });

  return {
    pixel_code: pixelCode,
    event: event.event,
    data,
  };
}

async function sendPurchaseFromOrder(req, order) {
  if (!order?.isPaid) return null;

  const value = Number(order.item?.price || process.env.PRODUCT_PRICE || 0);
  const eventId = `CompletePayment.${order.id}`;
  const productName = order.item?.title || process.env.PRODUCT_NAME || "Acesso Premium Nicolle";
  const productId = process.env.PRODUCT_ID || "site-18-nicolle-premium";
  const attribution = order.adAttribution || {};

  return sendEvent(req, {
    event_name: "CompletePayment",
    event_id: eventId,
    event_source_url: attribution.event_source_url || getPublicBaseUrl(),
    user_data: {
      email: order.customer?.email,
      phone: order.customer?.phone,
      ttp: attribution.ttp,
      ttclid: attribution.ttclid,
      external_id: attribution.external_id,
      client_ip_address: attribution.client_ip_address,
      client_user_agent: attribution.client_user_agent,
    },
    custom_data: {
      content_name: productName,
      content_type: "product",
      content_id: productId,
      contents: [
        {
          content_id: productId,
          quantity: 1,
          price: value,
        },
      ],
      currency: "BRL",
      value,
    },
  });
}

module.exports = {
  createExternalId,
  sendEvent,
  sendPurchaseFromOrder,
};
