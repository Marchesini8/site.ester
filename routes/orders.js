const express = require("express");
const orderStore = require("../services/orderStore");
const deliveryService = require("../services/deliveryService");
const paymentStatusStore = require("../services/paymentStatusStore");
const webhookService = require("../services/ironpayWebhookService");

const router = express.Router();

router.get("/:orderId/status", async (req, res) => {
  let order = orderStore.getOrder(req.params.orderId);

  if (!order) {
    return res.status(404).json({ error: "Pedido nao encontrado." });
  }

  const payment = paymentStatusStore.getPayment(order.transactionHash);
  if (!order.isPaid && payment?.isPaid) {
    order = orderStore.updateOrder(order.id, {
      status: payment.status,
      isPaid: true,
      paidAt: payment.paidAt || new Date().toISOString(),
    });
  }

  if (order.isPaid && (!order.metaPurchaseEventSent || !order.tiktokPurchaseEventSent)) {
    if (!order.deliveryAttempts?.length) {
      await deliveryService.deliverOrder(order);
    }
    order = orderStore.getOrder(order.id) || order;
    await webhookService.sendPurchaseEvent(req, order);
    order = orderStore.getOrder(order.id) || order;
  }

  return res.json({
    id: order.id,
    status: order.status,
    isPaid: order.isPaid,
    item: order.item,
    deliveryPreference: order.deliveryPreference,
    deliveryAttempts: order.deliveryAttempts,
  });
});

router.get("/:orderId/download", (req, res) => {
  return res.status(404).send("Download nao disponivel para este produto.");
});

module.exports = router;
