const express = require("express");
const paymentService = require("../services/paymentService");
const orderStore = require("../services/orderStore");
const metaCapiService = require("../services/metaCapiService");

const router = express.Router();

const SUBSCRIPTION_PLANS = {
  "15d": {
    label: "15 Dias",
    price: 17.99,
  },
  "30d": {
    label: "30 Dias",
    price: 62.9,
  },
  "3m": {
    label: "3 Meses",
    price: 75.9,
  },
  "6m": {
    label: "6 Meses",
    price: 87.9,
  },
  "upsell-6m": {
    label: "6 Meses",
    price: 19.9,
  },
};

function sanitizePreference(value) {
  return value === "email" ? "email" : "email";
}

function getIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || req.ip || "";
}

function sanitizeAttribution(value = {}) {
  return {
    fbp: value.fbp || "",
    fbc: value.fbc || "",
    external_id: value.external_id || "",
    event_source_url: value.event_source_url || "",
  };
}

function sanitizeTracking(value = {}) {
  return {
    src: value.src || "",
    utm_source: value.utm_source || "",
    utm_medium: value.utm_medium || "",
    utm_campaign: value.utm_campaign || "",
    utm_term: value.utm_term || "",
    utm_content: value.utm_content || "",
  };
}

function getSelectedPlan(planId) {
  return SUBSCRIPTION_PLANS[planId] || SUBSCRIPTION_PLANS["15d"];
}

router.post("/checkout", async (req, res) => {
  try {
    const { customer, deliveryPreference, planId } = req.body;
    const attribution = sanitizeAttribution(req.body.attribution);
    const tracking = sanitizeTracking(req.body.tracking);

    if (!customer?.name || !customer?.email) {
      return res.status(400).json({
        error: "Informe nome e e-mail para gerar o Pix.",
      });
    }

    const normalizedCustomer = {
      ...customer,
      phone: customer.phone || process.env.DEFAULT_PHONE_NUMBER || "21999999999",
    };

    const selectedPlan = getSelectedPlan(planId);
    const productName = `${process.env.PRODUCT_NAME || "Acesso Premium Nicolle"} - ${selectedPlan.label}`;
    const item = {
      title: productName,
      price: selectedPlan.price,
      quantity: 1,
      planId: planId || "15d",
    };

    const payment = await paymentService.createPixPayment({
      items: [item],
      customer: normalizedCustomer,
      delivery: {},
      tracking,
    });

    const order = orderStore.createOrder({
      customer: normalizedCustomer,
      deliveryPreference: sanitizePreference(deliveryPreference),
      item,
      transactionHash: payment.transaction_hash,
      pixCode: payment.pix_code,
      metaAttribution: {
        ...attribution,
        external_id: attribution.external_id || metaCapiService.createExternalId(normalizedCustomer),
        client_ip_address: getIp(req),
        client_user_agent: req.headers["user-agent"] || "",
      },
    });

    return res.json({
      ...payment,
      order_id: order.id,
      delivery_preference: order.deliveryPreference,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento:", error.message);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Erro ao criar pagamento.",
    });
  }
});

router.get("/status/:transactionHash", (req, res) => {
  try {
    const payment = paymentService.getPaymentStatus(req.params.transactionHash);

    if (!payment) {
      return res.json({
        transactionHash: req.params.transactionHash,
        status: "pending",
        isPaid: false,
      });
    }

    return res.json(payment);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Erro ao consultar pagamento.",
    });
  }
});

module.exports = router;
