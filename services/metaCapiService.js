const crypto = require("crypto");

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v20.0";
const META_CAPI_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const DEFAULT_PRIMARY_PIXEL_ID = "1002260965659482";
const DEFAULT_SECOND_PIXEL_ID = "1499267518361019";
const SUPPORTED_EVENTS = new Set([
  "PageView",
  "ViewContent",
  "AddToCart",
  "InitiateCheckout",
  "AddPaymentInfo",
  "Purchase",
  "Lead",
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

function buildUserData(req, payload = {}) {
  const userData = payload.user_data || {};
  return compactObject({
    client_ip_address: userData.client_ip_address || getIp(req),
    client_user_agent: userData.client_user_agent || req.headers["user-agent"],
    fbp: userData.fbp,
    fbc: userData.fbc,
    external_id: hashExternalId(userData.external_id),
    em: hashEmail(userData.email),
    ph: hashPhone(userData.phone),
  });
}

function createExternalId(customer = {}) {
  const email = normalizeString(customer.email);
  const phone = normalizePhone(customer.phone || customer.phone_number);
  const seed = [email, phone].filter(Boolean).join("|");
  return seed ? sha256(seed) : undefined;
}

function buildEvent(req, payload = {}) {
  if (!SUPPORTED_EVENTS.has(payload.event_name)) {
    const error = new Error("Evento Meta nao suportado.");
    error.statusCode = 400;
    throw error;
  }

  if (!payload.event_id) {
    const error = new Error("event_id e obrigatorio para deduplicacao.");
    error.statusCode = 400;
    throw error;
  }

  return {
    event_name: payload.event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: payload.event_id,
    event_source_url: payload.event_source_url,
    action_source: "website",
    user_data: buildUserData(req, payload),
    custom_data: compactObject(payload.custom_data || {}),
  };
}

function getMetaDestinations() {
  const destinations = [
    {
      label: "primary",
      pixelId: process.env.META_PIXEL_ID || DEFAULT_PRIMARY_PIXEL_ID,
      accessToken: process.env.META_ACCESS_TOKEN,
    },
    {
      label: "second",
      pixelId: process.env.META_SECOND_PIXEL_ID || DEFAULT_SECOND_PIXEL_ID,
      accessToken: process.env.META_SECOND_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN,
    },
  ];
  const seenPixelIds = new Set();

  return destinations.filter(({ pixelId, accessToken }) => {
    if (!pixelId || !accessToken || seenPixelIds.has(pixelId)) return false;
    seenPixelIds.add(pixelId);
    return true;
  });
}

async function sendEventToDestination(destination, event) {
  const url = `${META_CAPI_URL}/${destination.pixelId}/events?access_token=${encodeURIComponent(
    destination.accessToken
  )}`;

  console.info("[Meta CAPI] Enviando evento", {
    destination: destination.label,
    pixel_id: destination.pixelId,
    event_name: event.event_name,
    event_id: event.event_id,
    has_fbp: Boolean(event.user_data.fbp),
    has_fbc: Boolean(event.user_data.fbc),
    has_external_id: Boolean(event.user_data.external_id),
    has_email: Boolean(event.user_data.em),
    has_phone: Boolean(event.user_data.ph),
    has_client_ip_address: Boolean(event.user_data.client_ip_address),
    has_client_user_agent: Boolean(event.user_data.client_user_agent),
    value: event.custom_data.value,
    currency: event.custom_data.currency,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: [event] }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("[Meta CAPI] Erro ao enviar evento", {
      destination: destination.label,
      pixel_id: destination.pixelId,
      event_name: event.event_name,
      event_id: event.event_id,
      status: response.status,
      response: data,
    });
    const error = new Error(data.error?.message || "Erro ao enviar evento para Meta CAPI.");
    error.statusCode = response.status;
    throw error;
  }

  console.info("[Meta CAPI] Evento enviado", {
    destination: destination.label,
    pixel_id: destination.pixelId,
    event_name: event.event_name,
    event_id: event.event_id,
    fbtrace_id: data.fbtrace_id,
    events_received: data.events_received,
  });

  return {
    destination: destination.label,
    pixel_id: destination.pixelId,
    data,
  };
}

async function sendEvent(req, payload) {
  const destinations = getMetaDestinations();

  if (!destinations.length) {
    const error = new Error("META_PIXEL_ID e META_ACCESS_TOKEN precisam estar configurados no .env.");
    error.statusCode = 500;
    throw error;
  }

  const event = buildEvent(req, payload);
  const results = await Promise.all(destinations.map((destination) => sendEventToDestination(destination, event)));

  return {
    events_received: results.reduce((sum, result) => sum + Number(result.data?.events_received || 0), 0),
    errors: [],
    results,
  };
}

async function sendPurchaseFromOrder(req, order) {
  if (!order?.isPaid) return null;

  const value = Number(order.item?.price || process.env.PRODUCT_PRICE || 0);
  const eventId = `Purchase.${order.id}`;
  const productName = order.item?.title || process.env.PRODUCT_NAME || "Acesso Premium Nicolle";
  const productId = process.env.PRODUCT_ID || "site-18-nicolle-premium";

  return sendEvent(req, {
    event_name: "Purchase",
    event_id: eventId,
    event_source_url: order.metaAttribution?.event_source_url || getPublicBaseUrl(),
    user_data: {
      email: order.customer?.email,
      phone: order.customer?.phone,
      fbp: order.metaAttribution?.fbp,
      fbc: order.metaAttribution?.fbc,
      external_id: order.metaAttribution?.external_id,
      client_ip_address: order.metaAttribution?.client_ip_address,
      client_user_agent: order.metaAttribution?.client_user_agent,
    },
    custom_data: {
      content_name: productName,
      content_type: "product",
      content_ids: [productId],
      contents: [
        {
          id: productId,
          quantity: 1,
          item_price: value,
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
