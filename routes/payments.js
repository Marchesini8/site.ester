const express = require("express");
const paymentService = require("../services/paymentService");
const orderStore = require("../services/orderStore");
const metaCapiService = require("../services/metaCapiService");

const router = express.Router();
const pendingCheckoutRequests = new Map();

const SUBSCRIPTION_PLANS = {
  "15d": {
    label: "15 Dias",
    price: 19.9,
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

const CHECKOUT_ADDONS = {
  ofertao: {
    label: "Oferta exclusiva",
    price: 19.9,
  },
  vip: {
    label: "Vip Exclusivo",
    price: 7.9,
  },
  whatsapp: {
    label: "WhatsApp pessoal",
    price: 26.9,
  },
  ruivinha: {
    label: "Privacy MC MIERLA",
    price: 11.9,
  },
  mel: {
    label: "Privacy Mel Maia",
    price: 9.9,
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
    fbclid: value.fbclid || "",
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
    utm_adset: value.utm_adset || "",
    utm_term: value.utm_term || "",
    utm_content: value.utm_content || "",
    fbclid: value.fbclid || "",
    first_landing_page: value.first_landing_page || "",
    first_referrer: value.first_referrer || "",
    captured_at: value.captured_at || "",
  };
}

function getSelectedPlan(planId) {
  return SUBSCRIPTION_PLANS[planId] || SUBSCRIPTION_PLANS["15d"];
}

function getSelectedAddons(body = {}) {
  if (Array.isArray(body.addons)) {
    return body.addons
      .map((addonId) => String(addonId || "").trim())
      .filter((addonId, index, addonIds) => CHECKOUT_ADDONS[addonId] && addonIds.indexOf(addonId) === index)
      .map((addonId) => ({
        id: addonId,
        ...CHECKOUT_ADDONS[addonId],
      }));
  }

  const offerAccepted = body.offerAccepted === true || body.offerAccepted === "true";
  return offerAccepted
    ? [
        {
          id: "ofertao",
          ...CHECKOUT_ADDONS.ofertao,
        },
      ]
    : [];
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function getCheckoutRequestKey({ customer, planId }) {
  return [String(customer.email || "").trim().toLowerCase(), planId || "15d"].join("|");
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
    const normalizedPlanId = SUBSCRIPTION_PLANS[planId] ? planId : "15d";
    const selectedAddons = getSelectedAddons(req.body);
    const addonKey = selectedAddons.map((addon) => addon.id).sort().join(",");
    const selectedTotalInCents =
      toCents(selectedPlan.price) + selectedAddons.reduce((sum, addon) => sum + toCents(addon.price), 0);
    const selectedTotal = selectedTotalInCents / 100;
    const recentPendingOrder = orderStore.findRecentPendingOrder({
      email: normalizedCustomer.email,
      planId: normalizedPlanId,
    });

    const recentPendingOrderHasCurrentPrice =
      toCents(recentPendingOrder?.item?.price) === selectedTotalInCents &&
      String(recentPendingOrder?.item?.addonKey || "") === addonKey;

    if (recentPendingOrder?.pixCode && recentPendingOrderHasCurrentPrice) {
      return res.json({
        transaction_hash: recentPendingOrder.transactionHash,
        status: recentPendingOrder.status || "pending",
        pix_code: recentPendingOrder.pixCode,
        pix_base64: "",
        charged_total: recentPendingOrder.item?.price || selectedTotal,
        product_total: recentPendingOrder.item?.price || selectedTotal,
        shipping_total: 0,
        source: "ironpay",
        order_id: recentPendingOrder.id,
        delivery_preference: recentPendingOrder.deliveryPreference,
        reused: true,
      });
    }

    const productName = `${process.env.PRODUCT_NAME || "Acesso Premium Nicolle"} - ${selectedPlan.label}`;
    const paymentItem = {
      title: productName,
      price: selectedTotal,
      quantity: 1,
      planId: normalizedPlanId,
    };
    const item = {
      title: productName,
      price: selectedTotal,
      quantity: 1,
      planId: normalizedPlanId,
      addons: selectedAddons,
      addonKey,
      offerAccepted: selectedAddons.length > 0,
    };

    const checkoutKey = getCheckoutRequestKey({
      customer: normalizedCustomer,
      planId: `${normalizedPlanId}:${addonKey || "base"}`,
    });
    let checkoutPromise = pendingCheckoutRequests.get(checkoutKey);

    if (!checkoutPromise) {
      checkoutPromise = (async () => {
        const payment = await paymentService.createPixPayment({
          items: [paymentItem],
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
            fbp: attribution.fbp,
            fbc: attribution.fbc,
            fbclid: attribution.fbclid || tracking.fbclid,
            external_id: attribution.external_id || metaCapiService.createExternalId(normalizedCustomer),
            event_source_url: attribution.event_source_url,
            client_ip_address: getIp(req),
            client_user_agent: req.headers["user-agent"] || "",
          },
          tracking,
        });

        return { payment, order };
      })().finally(() => {
        pendingCheckoutRequests.delete(checkoutKey);
      });

      pendingCheckoutRequests.set(checkoutKey, checkoutPromise);
    }

    const { payment, order } = await checkoutPromise;

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
