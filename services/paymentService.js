const axios = require("axios");
const paymentStatusStore = require("./paymentStatusStore");

const FIXED_SHIPPING_AMOUNT = 0;
const DEFAULT_ITEM_TITLE = "Pagamento Taxa";

function normalizeItemPrice(item) {
  const unitPrice = Number(item?.unitPrice || 0);
  if (unitPrice > 0) return unitPrice;

  const directPrice = Number(item?.price || 0);
  if (directPrice > 0) return directPrice;

  return Number(item?.oldPrice || 0);
}

function requireEnv(name) {
  if (process.env[name]) return process.env[name];

  const error = new Error(`${name} não configurado no .env.`);
  error.statusCode = 500;
  throw error;
}

function extractPixCode(data) {
  return (
    data.pix_code ||
    data.pixCode ||
    data.pix?.pix_qr_code ||
    data.pix_qr_code ||
    null
  );
}

function extractTransactionHash(data) {
  return (
    data.transaction_hash ||
    data.transactionHash ||
    data.hash ||
    data.id ||
    data.pix?.transaction_hash ||
    data.pix?.transactionHash ||
    data.pix?.hash ||
    data.pix?.id ||
    data.transaction?.transaction_hash ||
    data.transaction?.transactionHash ||
    data.transaction?.hash ||
    data.transaction?.id ||
    data.payment?.transaction_hash ||
    data.payment?.transactionHash ||
    data.payment?.hash ||
    data.payment?.id ||
    null
  );
}

function extractPixQrImage(data) {
  return (
    data.qr_code ||
    data.qrCode ||
    data.qrcode ||
    data.qr_code_url ||
    data.qrCodeUrl ||
    data.pix_base64 ||
    data.pixBase64 ||
    data.pix?.qr_code ||
    data.pix?.qrCode ||
    data.pix?.qr_code_url ||
    data.pix?.qrCodeUrl ||
    data.pix?.qr_code_base64 ||
    data.pix?.qrCodeBase64 ||
    data.payment?.qr_code ||
    data.payment?.qrCode ||
    data.payment?.qr_code_url ||
    data.payment?.qrCodeUrl ||
    null
  );
}

function normalizePostbackUrl(value = "") {
  const configuredUrl = String(value || "").trim();
  if (!configuredUrl) return "";

  try {
    const url = new URL(configuredUrl);
    const normalizedPath = url.pathname.replace(/\/+/g, "/");

    if (normalizedPath === "/" || normalizedPath === "" || normalizedPath === "/ironpay") {
      url.pathname = "/api/webhooks/ironpay";
    }

    if (process.env.IRONPAY_WEBHOOK_SECRET && !url.searchParams.has("webhook_secret")) {
      url.searchParams.set("webhook_secret", process.env.IRONPAY_WEBHOOK_SECRET);
    }

    return url.toString();
  } catch {
    return configuredUrl;
  }

  return configuredUrl;
}

exports.createPixPayment = async ({ items, customer, delivery, tracking = {} }) => {
  const normalizedItems = Array.isArray(items) ? items : [];
  const productTotal = normalizedItems.reduce((sum, item) => {
    return sum + normalizeItemPrice(item) * Number(item?.qty || item?.quantity || 1);
  }, 0);
  const totalAmount = productTotal + FIXED_SHIPPING_AMOUNT;
  const totalInCents = Math.round(totalAmount * 100);

  if (!normalizedItems.length || totalInCents <= 0) {
    const error = new Error("Valor invalido para gerar pagamento Pix.");
    error.statusCode = 400;
    throw error;
  }

  const paymentApiUrl = requireEnv("PAYMENT_API_URL");
  const paymentApiKey = requireEnv("PAYMENT_API_KEY");
  const offerHash = requireEnv("IRONPAY_OFFER_HASH");
  const productHash = requireEnv("IRONPAY_PRODUCT_HASH");
  const pixEndpoint = process.env.PAYMENT_PIX_ENDPOINT || "/transactions";
  const expireInDays = Number(process.env.IRONPAY_EXPIRE_IN_DAYS || 1);

  const cart = normalizedItems.map((item) => ({
    product_hash: productHash,
    title: item.title || DEFAULT_ITEM_TITLE,
    cover: item.image || null,
    price: Math.round(normalizeItemPrice(item) * 100),
    quantity: Number(item?.qty || item?.quantity || 1),
    operation_type: 1,
    tangible: false,
  }));

  try {
    const response = await axios.post(
      `${paymentApiUrl}${pixEndpoint}`,
      {
        offer_hash: offerHash,
        amount: totalInCents,
        payment_method: "pix",
        installments: 1,
        expire_in_days: expireInDays,
        transaction_origin: "api",
        postback_url: normalizePostbackUrl(process.env.IRONPAY_POSTBACK_URL),
        cart,
        customer: {
          name: customer.name,
          email: customer.email,
          phone_number: customer.phone_number || customer.phone || process.env.DEFAULT_PHONE_NUMBER || "",
          document: customer.document || customer.cpf || process.env.DEFAULT_DOCUMENT || "",
          street_name: customer.street_name || delivery?.address || "",
          number: customer.number || delivery?.number || "",
          complement: customer.complement || delivery?.complement || "",
          neighborhood: customer.neighborhood || delivery?.neighborhood || process.env.DEFAULT_NEIGHBORHOOD || "",
          city: customer.city || delivery?.city || "",
          state: customer.state || delivery?.state || process.env.DEFAULT_STATE || "",
          zip_code: customer.zip_code || delivery?.zip_code || delivery?.cep || "",
        },
        tracking: {
          src: tracking.src || "",
          utm_source: tracking.utm_source || "",
          utm_medium: tracking.utm_medium || "",
          utm_campaign: tracking.utm_campaign || "",
          utm_adset: tracking.utm_adset || "",
          utm_term: tracking.utm_term || "",
          utm_content: tracking.utm_content || "",
          fbclid: tracking.fbclid || "",
        },
      },
      {
        params: {
          api_token: paymentApiKey,
        },
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        proxy: false,
      }
    );

    const pixCode = extractPixCode(response.data);
    const transactionHash = extractTransactionHash(response.data);

    if (!pixCode) {
      const error = new Error(`IronPay respondeu sem código Pix válido: ${JSON.stringify(response.data)}`);
      error.statusCode = 502;
      throw error;
    }

    if (transactionHash) {
      paymentStatusStore.savePayment(transactionHash, {
        status: response.data.status || "pending",
        amount: response.data.amount || totalInCents,
        paymentMethod: "pix",
        isPaid: response.data.status === "paid",
        pixCode,
      });
    }

    return {
      transaction_hash: transactionHash,
      status: response.data.status || "pending",
      pix_code: pixCode,
      pix_base64: extractPixQrImage(response.data),
      charged_total: totalAmount,
      product_total: productTotal,
      shipping_total: FIXED_SHIPPING_AMOUNT,
      source: "ironpay",
    };
  } catch (error) {
    const providerError = error.response?.data || error.message;
    const paymentError = new Error(
      `Falha ao gerar Pix na IronPay: ${
        typeof providerError === "string" ? providerError : JSON.stringify(providerError)
      }`
    );
    paymentError.statusCode = error.response?.status || error.statusCode || 502;
    throw paymentError;
  }
};

exports.FIXED_SHIPPING_AMOUNT = FIXED_SHIPPING_AMOUNT;
exports.getPaymentStatus = (transactionHash) => paymentStatusStore.getPayment(transactionHash);
