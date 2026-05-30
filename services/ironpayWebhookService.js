const paymentStatusStore = require("./paymentStatusStore");
const orderStore = require("./orderStore");
const deliveryService = require("./deliveryService");
const metaCapiService = require("./metaCapiService");
const tiktokEventsService = require("./tiktokEventsService");

const PAID_STATUSES = new Set([
  "paid",
  "approved",
  "authorized",
  "completed",
  "complete",
  "confirmed",
  "success",
  "succeeded",
]);

function validateWebhookKey(receivedKey) {
  const expectedKey = process.env.IRONPAY_WEBHOOK_SECRET || process.env.PAYMENT_API_KEY;

  if (!expectedKey) {
    const error = new Error("IRONPAY_WEBHOOK_SECRET não configurado no .env.");
    error.statusCode = 500;
    throw error;
  }

  if (!receivedKey || receivedKey !== expectedKey) {
    const error = new Error("Chave do webhook invalida.");
    error.statusCode = 401;
    throw error;
  }
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeStatus(value = "") {
  return String(value).trim().toLowerCase();
}

function isPaidStatus(status, paidAt) {
  return PAID_STATUSES.has(normalizeStatus(status)) || Boolean(paidAt);
}

function normalizeWebhookPayload(payload = {}) {
  const source = payload.data || payload.transaction || payload.payment || payload;
  const transactionHash = firstValue(
    source.transaction_hash,
    source.transactionHash,
    source.hash,
    source.id,
    source.pix?.transaction_hash,
    source.pix?.transactionHash,
    source.pix?.hash,
    source.pix?.id,
    source.transaction?.transaction_hash,
    source.transaction?.transactionHash,
    source.transaction?.hash,
    source.transaction?.id,
    source.payment?.transaction_hash,
    source.payment?.transactionHash,
    source.payment?.hash,
    source.payment?.id,
    payload.transaction_hash,
    payload.transactionHash,
    payload.hash,
    payload.id
  );
  const status = normalizeStatus(firstValue(source.status, source.payment_status, payload.status));
  const amountValue = firstValue(source.amount, source.total, source.value, payload.amount);
  const amount = Number(amountValue || 0);
  const paidAt = firstValue(source.paid_at, source.paidAt, source.approved_at, source.approvedAt, payload.paid_at);

  return {
    transactionHash,
    status,
    amount: Number.isFinite(amount) ? amount : 0,
    paymentMethod: firstValue(source.payment_method, source.paymentMethod, payload.payment_method) || null,
    paidAt: paidAt || null,
    isPaid: isPaidStatus(status, paidAt),
  };
}

async function sendMetaPurchaseEvent(req, order) {
  if (!order?.isPaid || order.metaPurchaseEventSent) return null;

  try {
    const result = await metaCapiService.sendPurchaseFromOrder(req, order);
    orderStore.updateOrder(order.id, {
      metaPurchaseEventSent: true,
      metaPurchaseEventSentAt: new Date().toISOString(),
      metaPurchaseEventId: `Purchase.${order.id}`,
    });
    return result;
  } catch (error) {
    console.error("[Meta CAPI] Falha ao enviar Purchase do webhook:", error.message);
    orderStore.updateOrder(order.id, {
      metaPurchaseEventError: error.message,
      metaPurchaseEventErrorAt: new Date().toISOString(),
    });
    return null;
  }
}

async function sendTikTokPurchaseEvent(req, order) {
  if (!order?.isPaid || order.tiktokPurchaseEventSent) return null;

  try {
    const result = await tiktokEventsService.sendPurchaseFromOrder(req, order);
    orderStore.updateOrder(order.id, {
      tiktokPurchaseEventSent: true,
      tiktokPurchaseEventSentAt: new Date().toISOString(),
      tiktokPurchaseEventId: `CompletePayment.${order.id}`,
    });
    return result;
  } catch (error) {
    console.error("[TikTok Events API] Falha ao enviar CompletePayment do webhook:", error.message);
    orderStore.updateOrder(order.id, {
      tiktokPurchaseEventError: error.message,
      tiktokPurchaseEventErrorAt: new Date().toISOString(),
    });
    return null;
  }
}

async function sendPurchaseEvent(req, order) {
  if (!order?.isPaid) return null;

  const [meta, tiktok] = await Promise.all([
    sendMetaPurchaseEvent(req, order),
    sendTikTokPurchaseEvent(req, order),
  ]);

  return { meta, tiktok };
}

async function processWebhook(payload, req) {
  const normalized = normalizeWebhookPayload(payload);

  if (!normalized.transactionHash || !normalized.status) {
    const error = new Error("Payload do webhook invalido.");
    error.statusCode = 400;
    throw error;
  }

  paymentStatusStore.savePayment(normalized.transactionHash, normalized);

  const order = orderStore.getOrderByTransaction(normalized.transactionHash);
  if (order) {
    const updated = orderStore.updateOrder(order.id, {
      status: normalized.status,
      isPaid: normalized.isPaid,
      paidAt: normalized.paidAt,
    });

    if (normalized.isPaid) {
      normalized.events = await sendPurchaseEvent(req, updated);
      normalized.delivery = await deliveryService.deliverOrder(updated);
    }
  }

  return normalized;
}

module.exports = {
  validateWebhookKey,
  processWebhook,
  sendPurchaseEvent,
};
