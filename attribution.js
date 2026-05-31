(function () {
  const STORAGE_KEY = "site18_first_touch_attribution";
  const LEGACY_TRACKING_KEY = "checkout_tracking";
  const COOKIE_NAME = "site18_first_touch_attribution";
  const EXTERNAL_ID_COOKIE = "site18_external_id";
  const ATTRIBUTION_DAYS = 180;
  const PARAM_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_adset",
    "utm_content",
    "utm_term",
    "fbclid",
    "src",
  ];

  function getCookie(name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : "";
  }

  function setCookie(name, value, days = ATTRIBUTION_DAYS) {
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax${secure}`;
  }

  function parseJson(value) {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function readStorage() {
    try {
      return parseJson(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      return {};
    }
  }

  function writeStorage(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      window.localStorage.setItem(LEGACY_TRACKING_KEY, JSON.stringify(value));
    } catch {}
  }

  function readCookieAttribution() {
    return parseJson(getCookie(COOKIE_NAME));
  }

  function hasAttributionValues(value = {}) {
    return PARAM_KEYS.some((key) => Boolean(value[key]));
  }

  function getUrlAttribution() {
    const params = new URLSearchParams(window.location.search);
    return PARAM_KEYS.reduce((tracking, key) => {
      tracking[key] = params.get(key) || "";
      return tracking;
    }, {});
  }

  function getOrCreateExternalId() {
    const existing = getCookie(EXTERNAL_ID_COOKIE) || getCookie("site_external_id");
    if (existing) {
      setCookie(EXTERNAL_ID_COOKIE, existing, 365);
      return existing;
    }

    const externalId = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}.${Math.random().toString(16).slice(2)}`;
    setCookie(EXTERNAL_ID_COOKIE, externalId, 365);
    return externalId;
  }

  function captureFbc(fbclid) {
    const existing = getCookie("_fbc");
    if (!fbclid) return existing;
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

  function compactAttribution(value = {}) {
    const clean = {};
    PARAM_KEYS.forEach((key) => {
      clean[key] = value[key] || "";
    });
    clean.first_landing_page = value.first_landing_page || window.location.href;
    clean.first_referrer = value.first_referrer || document.referrer || "";
    clean.captured_at = value.captured_at || new Date().toISOString();
    return clean;
  }

  function persist(value) {
    const clean = compactAttribution(value);
    writeStorage(clean);
    setCookie(COOKIE_NAME, JSON.stringify(clean));
    return clean;
  }

  function captureFirstTouch() {
    const saved = readStorage();
    const cookieSaved = readCookieAttribution();
    const existing = hasAttributionValues(saved) || saved.captured_at ? saved : cookieSaved;

    if (hasAttributionValues(existing) || existing.captured_at) {
      return persist(existing);
    }

    const fromUrl = compactAttribution(getUrlAttribution());
    return persist(fromUrl);
  }

  function getTrackingData() {
    const current = captureFirstTouch();
    return compactAttribution(current);
  }

  function getMetaAttributionData(extra = {}) {
    const tracking = getTrackingData();
    return {
      fbp: getOrCreateFbp(),
      fbc: captureFbc(tracking.fbclid),
      fbclid: tracking.fbclid,
      external_id: extra.external_id || getOrCreateExternalId(),
      event_source_url: tracking.first_landing_page || window.location.href,
    };
  }

  window.SiteAttribution = {
    captureFirstTouch,
    getTrackingData,
    getMetaAttributionData,
    getOrCreateFbp,
    getOrCreateExternalId,
    getCookie,
    setCookie,
  };

  captureFirstTouch();
})();
