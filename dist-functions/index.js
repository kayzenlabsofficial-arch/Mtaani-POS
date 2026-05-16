var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// api/mpesa/callback/[[secret]].ts
var corsHeaders = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key"
};
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
var onRequest = /* @__PURE__ */ __name(async (context) => {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  try {
    const receivedSecret = Array.isArray(params.secret) ? params.secret[0] : params.secret;
    const expectedSecret = env.MPESA_CALLBACK_SECRET;
    if (!expectedSecret) {
      console.error("[Security] MPESA_CALLBACK_SECRET env var is not set. Refusing to process callbacks.");
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Server misconfigured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (!receivedSecret || !timingSafeEqual(String(receivedSecret), expectedSecret)) {
      console.warn(`[M-PESA SECURITY ALERT]: Unauthorized callback attempt.`);
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    const data = await request.json();
    const callbackData = data?.Body?.stkCallback;
    console.log(`[M-Pesa Callback] Received payload for CheckoutID: ${callbackData?.CheckoutRequestID}`);
    if (callbackData) {
      const merchantRequestId = callbackData.MerchantRequestID;
      const checkoutRequestId = callbackData.CheckoutRequestID;
      const resultCode = callbackData.ResultCode;
      const resultDesc = callbackData.ResultDesc;
      let amount = 0;
      let receiptNumber = "";
      let phoneNumber = "";
      if (resultCode === 0 && callbackData.CallbackMetadata) {
        const items = callbackData.CallbackMetadata.Item;
        for (const item of items) {
          if (item.Name === "Amount") amount = item.Value;
          if (item.Name === "MpesaReceiptNumber") receiptNumber = item.Value;
          if (item.Name === "PhoneNumber") phoneNumber = item.Value;
        }
      }
      for (const sql of [
        "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedTransactionId TEXT",
        "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerId TEXT",
        "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerName TEXT",
        "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedAt INTEGER",
        "CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, branchId, receiptNumber)"
      ]) {
        try {
          await env.DB.prepare(sql).run();
        } catch (e) {
        }
      }
      try {
        const existing = await env.DB.prepare(`
             SELECT resultCode, amount, receiptNumber, phoneNumber
             FROM mpesaCallbacks
             WHERE checkoutRequestId = ?
           `).bind(checkoutRequestId).first();
        if (existing && existing.resultCode !== 999) {
          console.log(`[M-PESA IDEMPOTENCY]: CheckoutID ${checkoutRequestId} already processed. Skipping.`);
          return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Duplicate Ignored" }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        const nextAmount = amount || Number(existing?.amount || 0);
        const nextReceiptNumber = receiptNumber || existing?.receiptNumber || "";
        const nextPhoneNumber = phoneNumber || existing?.phoneNumber || "";
        await env.DB.prepare(`
             UPDATE mpesaCallbacks 
             SET resultCode = ?, resultDesc = ?, amount = ?, receiptNumber = ?, phoneNumber = ?, timestamp = ?
             WHERE checkoutRequestId = ?
           `).bind(
          resultCode,
          resultDesc,
          nextAmount,
          nextReceiptNumber,
          nextPhoneNumber,
          Date.now(),
          checkoutRequestId
        ).run();
        console.log(`[M-PESA CALLBACK SUCCESS]: Updated ${checkoutRequestId} with ResultCode ${resultCode}`);
      } catch (dbErr) {
        console.error("Failed to update callback in DB:", dbErr);
      }
    }
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Success" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("[Callback Processing Error]:", err);
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Error processed" }), {
      headers: { "Content-Type": "application/json" }
    });
  }
}, "onRequest");

// api/_authUtils.ts
var TOKEN_VERSION = "v3";
var LEGACY_SALT = "mtaani-pos-v2-secure-2026";
var SESSION_COOKIE = "mtaani_session";
var SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var PASSWORD_VERSION = "pbkdf2";
var PASSWORD_ITERATIONS = 1e5;
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      ...extraHeaders
    }
  });
}
__name(json, "json");
function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(base64UrlEncode, "base64UrlEncode");
function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(base64UrlDecode, "base64UrlDecode");
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}
__name(hmac, "hmac");
function timingSafeEqual2(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(timingSafeEqual2, "timingSafeEqual");
async function createSessionToken(secret, principal) {
  const payload = {
    ...principal,
    exp: principal.exp || Date.now() + SESSION_TTL_MS
  };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(secret, `${TOKEN_VERSION}.${body}`);
  return `${TOKEN_VERSION}.${body}.${signature}`;
}
__name(createSessionToken, "createSessionToken");
function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    cookies[rawName] = decodeURIComponent(rawValue.join("=") || "");
  }
  return cookies;
}
__name(parseCookies, "parseCookies");
function cookieSecureSuffix(request) {
  try {
    return new URL(request.url).protocol === "https:" ? "; Secure" : "";
  } catch {
    return "; Secure";
  }
}
__name(cookieSecureSuffix, "cookieSecureSuffix");
function createSessionCookie(request, token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1e3)}; HttpOnly; SameSite=Strict${cookieSecureSuffix(request)}`;
}
__name(createSessionCookie, "createSessionCookie");
function clearSessionCookie(request) {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${cookieSecureSuffix(request)}`;
}
__name(clearSessionCookie, "clearSessionCookie");
function isTrustedBrowserOrigin(request) {
  const secFetchSite = request.headers.get("Sec-Fetch-Site");
  if (secFetchSite === "cross-site") return false;
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    const requestOrigin = new URL(request.url).origin;
    const originUrl = new URL(origin);
    if (origin === requestOrigin) return true;
    return originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1" || originUrl.hostname === "::1" || originUrl.hostname === "[::1]";
  } catch {
    return false;
  }
}
__name(isTrustedBrowserOrigin, "isTrustedBrowserOrigin");
function rejectUntrustedBrowserOrigin(request) {
  return isTrustedBrowserOrigin(request) ? null : json({ error: "Cross-site request blocked." }, 403);
}
__name(rejectUntrustedBrowserOrigin, "rejectUntrustedBrowserOrigin");
async function verifySessionToken(secret, token) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [version, body, signature] = parts;
  const expected = await hmac(secret, `${version}.${body}`);
  if (!timingSafeEqual2(signature, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
    if (!payload?.userId || !payload?.role || !payload?.exp) return null;
    if (Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}
__name(verifySessionToken, "verifySessionToken");
async function authorizeRequest(request, env) {
  const secret = env.API_SECRET;
  if (!secret) return { ok: false, response: json({ error: "Server is not configured." }, 500) };
  const originBlocked = rejectUntrustedBrowserOrigin(request);
  if (originBlocked) return { ok: false, response: originBlocked };
  const rawApiKey = request.headers.get("X-API-Key") || "";
  if (rawApiKey && rawApiKey === secret) {
    return {
      ok: true,
      service: true,
      principal: {
        userId: "service",
        userName: "Service",
        role: "ROOT",
        exp: Date.now() + 6e4
      }
    };
  }
  const authorization = request.headers.get("Authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const cookieToken = parseCookies(request.headers.get("Cookie") || "")[SESSION_COOKIE] || "";
  const token = bearer || rawApiKey || cookieToken;
  if (!token) return { ok: false, response: json({ error: "Sign in required." }, 401) };
  const principal = await verifySessionToken(secret, token);
  if (!principal) return { ok: false, response: json({ error: "Session expired. Please sign in again." }, 401) };
  return { ok: true, service: false, principal };
}
__name(authorizeRequest, "authorizeRequest");
function canAccessBusiness(principal, businessId) {
  if (principal.role === "ROOT") return true;
  return !!businessId && !!principal.businessId && principal.businessId === businessId;
}
__name(canAccessBusiness, "canAccessBusiness");
function canAccessBranch(principal, branchId) {
  if (principal.role === "ROOT" || !principal.branchId) return true;
  return !!branchId && principal.branchId === branchId;
}
__name(canAccessBranch, "canAccessBranch");
async function sha256Hex(value) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
async function pbkdf2Hash(plain, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(plain),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return base64UrlEncode(new Uint8Array(bits));
}
__name(pbkdf2Hash, "pbkdf2Hash");
function isPasswordHashCurrent(stored) {
  const [version, algorithm, iterations, salt, hash] = String(stored || "").split("$");
  return version === PASSWORD_VERSION && algorithm === "sha256" && Number(iterations) >= PASSWORD_ITERATIONS && !!salt && !!hash;
}
__name(isPasswordHashCurrent, "isPasswordHashCurrent");
async function verifyPassword(plain, stored) {
  if (!stored) return false;
  if (stored.startsWith(`${PASSWORD_VERSION}$`)) {
    const [version, algorithm, iterationsRaw, saltRaw, hash] = stored.split("$");
    if (version !== PASSWORD_VERSION || algorithm !== "sha256" || !saltRaw || !hash) return false;
    const iterations = Number(iterationsRaw);
    if (!Number.isFinite(iterations) || iterations < 1e5 || iterations > PASSWORD_ITERATIONS) return false;
    const derived = await pbkdf2Hash(plain, base64UrlDecode(saltRaw), iterations);
    return timingSafeEqual2(derived, hash);
  }
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    return await sha256Hex(`${plain}${LEGACY_SALT}`) === stored.toLowerCase();
  }
  if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
    return false;
  }
  return plain === stored;
}
__name(verifyPassword, "verifyPassword");
async function hashPassword(plain) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Hash(plain, salt, PASSWORD_ITERATIONS);
  return `${PASSWORD_VERSION}$sha256$${PASSWORD_ITERATIONS}$${base64UrlEncode(salt)}$${hash}`;
}
__name(hashPassword, "hashPassword");

// api/mpesa/status/[[id]].ts
var corsHeaders2 = {
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function jsonHeaders() {
  return { "Content-Type": "application/json", ...corsHeaders2 };
}
__name(jsonHeaders, "jsonHeaders");
var onRequest2 = /* @__PURE__ */ __name(async (context) => {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders2 });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders() });
  }
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const checkoutRequestId = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!checkoutRequestId) {
      return new Response(JSON.stringify({ error: "CheckoutRequestID required" }), { status: 400, headers: jsonHeaders() });
    }
    try {
      const result = await env.DB.prepare(`SELECT * FROM mpesaCallbacks WHERE checkoutRequestId = ?`).bind(checkoutRequestId).first();
      if (result) {
        if (!canAccessBusiness(auth.principal, result.businessId) || !canAccessBranch(auth.principal, result.branchId)) {
          return new Response(JSON.stringify({ error: "Access denied" }), { status: 403, headers: jsonHeaders() });
        }
        return new Response(JSON.stringify({
          found: true,
          resultCode: result.resultCode,
          resultDesc: result.resultDesc,
          amount: result.amount,
          receiptNumber: result.receiptNumber,
          phoneNumber: result.phoneNumber
        }), { headers: jsonHeaders() });
      } else {
        return new Response(JSON.stringify({ found: false, status: "PENDING" }), { headers: jsonHeaders() });
      }
    } catch (dbErr) {
      if (dbErr.message.includes("no such table")) {
        return new Response(JSON.stringify({ found: false, status: "PENDING" }), { headers: jsonHeaders() });
      }
      throw dbErr;
    }
  } catch (err) {
    console.error("[M-Pesa Status Error]:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders() });
  }
}, "onRequest");

// api/_salesSecurity.ts
var PolicyError = class extends Error {
  static {
    __name(this, "PolicyError");
  }
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var SALE_STATUSES = /* @__PURE__ */ new Set(["PAID", "UNPAID"]);
var CASHIER_ALLOWED_STATUSES = /* @__PURE__ */ new Set(["PAID", "UNPAID", "QUOTE", "PENDING_REFUND"]);
var STAFF_ALLOWED_METHODS = /* @__PURE__ */ new Set(["CASH", "MPESA", "PDQ", "CREDIT", "SPLIT"]);
function deserializeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}
__name(deserializeRow, "deserializeRow");
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
__name(asArray, "asArray");
function asNumber(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber, "asNumber");
function roundMoney(value) {
  return Math.round(value * 100) / 100;
}
__name(roundMoney, "roundMoney");
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
__name(clamp, "clamp");
function trimText(value, max = 160) {
  const text2 = String(value ?? "").trim();
  if (!text2) return void 0;
  return text2.slice(0, max);
}
__name(trimText, "trimText");
function isBundle(product) {
  return product.isBundle === 1 || product.isBundle === true || product.isBundle === "1";
}
__name(isBundle, "isBundle");
async function loadProducts(db, businessId, ids) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const products = /* @__PURE__ */ new Map();
  if (uniqueIds.length === 0) return products;
  const CHUNK_SIZE = 80;
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db.prepare(
      `SELECT id, name, branchId, category, sellingPrice, costPrice, taxCategory, unit, isBundle, components, stockQuantity
       FROM products
       WHERE businessId = ? AND id IN (${placeholders})`
    ).bind(businessId, ...chunk).all();
    results.forEach((row) => {
      const clean = deserializeRow(row);
      products.set(clean.id, clean);
    });
  }
  return products;
}
__name(loadProducts, "loadProducts");
async function loadExistingTransactions(db, businessId, branchId, ids) {
  const existing = /* @__PURE__ */ new Map();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return existing;
  const CHUNK_SIZE = 80;
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db.prepare(
      `SELECT *
       FROM transactions
       WHERE businessId = ? AND branchId = ? AND id IN (${placeholders})`
    ).bind(businessId, branchId, ...chunk).all();
    results.forEach((row) => {
      const clean = deserializeRow(row);
      existing.set(String(clean.id), clean);
    });
  }
  return existing;
}
__name(loadExistingTransactions, "loadExistingTransactions");
async function loadIngredients(db, businessId, bundleIds) {
  const ingredients = /* @__PURE__ */ new Map();
  const uniqueIds = Array.from(new Set(bundleIds.filter(Boolean)));
  if (uniqueIds.length === 0) return ingredients;
  const CHUNK_SIZE = 80;
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db.prepare(
      `SELECT productId, ingredientProductId, quantity
       FROM productIngredients
       WHERE businessId = ? AND productId IN (${placeholders})`
    ).bind(businessId, ...chunk).all();
    results.forEach((row) => {
      const rows = ingredients.get(row.productId) || [];
      rows.push({ productId: row.ingredientProductId, quantity: asNumber(row.quantity) });
      ingredients.set(row.productId, rows);
    });
  }
  return ingredients;
}
__name(loadIngredients, "loadIngredients");
function componentsFromProduct(product) {
  return asArray(product.components).map((component) => ({
    productId: String(component?.productId || component?.ingredientProductId || "").trim(),
    quantity: asNumber(component?.quantity)
  })).filter((component) => component.productId && component.quantity > 0);
}
__name(componentsFromProduct, "componentsFromProduct");
function statusNeedsStock(status) {
  return SALE_STATUSES.has(String(status || "").toUpperCase());
}
__name(statusNeedsStock, "statusNeedsStock");
function creditAmountFor(tx, total) {
  const method = String(tx.paymentMethod || "").toUpperCase();
  if (method === "CREDIT") return total;
  const splitPayments = typeof tx.splitPayments === "string" ? (() => {
    try {
      return JSON.parse(tx.splitPayments);
    } catch {
      return null;
    }
  })() : tx.splitPayments;
  if (method === "SPLIT" && String(splitPayments?.secondaryMethod || "").toUpperCase() === "CREDIT") {
    return roundMoney(clamp(asNumber(splitPayments?.secondaryAmount), 0, total));
  }
  return 0;
}
__name(creditAmountFor, "creditAmountFor");
function addDeduction(deductions, productId, quantity) {
  if (!productId || quantity <= 0) return;
  deductions.set(productId, (deductions.get(productId) || 0) + quantity);
}
__name(addDeduction, "addDeduction");
function assertProductBranch(product, branchId) {
  if (product.branchId && product.branchId !== branchId) {
    throw new PolicyError(`Product "${product.name}" belongs to another branch.`, 403);
  }
}
__name(assertProductBranch, "assertProductBranch");
async function hardenTransactionBatch(options, transactions) {
  const { db, businessId, branchId, principal, service, sourceLabel = "Sale" } = options;
  if (transactions.length > 100) throw new PolicyError("Too many sales in one request. Send fewer at a time.", 413);
  const now = Date.now();
  const transactionIds = transactions.map((tx) => String(tx?.id || "").trim()).filter(Boolean);
  const existing = await loadExistingTransactions(db, businessId, branchId, transactionIds);
  const saleProductIds = [];
  for (const tx of transactions) {
    const items = asArray(tx?.items);
    if (items.length > 100) throw new PolicyError("A sale has too many items.", 413);
    for (const item of items) {
      const productId = String(item?.productId || item?.id || "").trim();
      if (productId) saleProductIds.push(productId);
    }
  }
  const products = await loadProducts(db, businessId, saleProductIds);
  const bundleIds = Array.from(products.values()).filter(isBundle).map((product) => product.id);
  const ingredientRows = await loadIngredients(db, businessId, bundleIds);
  const componentProductIds = [];
  for (const bundleId of bundleIds) {
    const product = products.get(bundleId);
    if (!product) continue;
    const components = ingredientRows.get(bundleId) || componentsFromProduct(product);
    components.forEach((component) => componentProductIds.push(component.productId));
  }
  const componentProducts = await loadProducts(db, businessId, componentProductIds);
  componentProducts.forEach((product, productId) => products.set(productId, product));
  const plannedDeductions = /* @__PURE__ */ new Map();
  const sideEffects = [];
  for (const tx of transactions) {
    const txId = String(tx?.id || crypto.randomUUID()).trim();
    tx.id = txId;
    const previous = existing.get(txId);
    const desiredStatus = String(tx?.status || previous?.status || "PAID").toUpperCase();
    if (!service && principal.role === "CASHIER") {
      if (!CASHIER_ALLOWED_STATUSES.has(desiredStatus)) {
        throw new PolicyError("Cashier accounts cannot make that sale change.", 403);
      }
      if (previous && desiredStatus !== "PENDING_REFUND") {
        throw new PolicyError("Cashier accounts cannot edit completed sales.", 403);
      }
    }
    tx.businessId = businessId;
    tx.branchId = branchId;
    tx.status = desiredStatus;
    tx.timestamp = clamp(asNumber(tx.timestamp, now), 0, now + 5 * 60 * 1e3);
    tx.updated_at = now;
    if (!service && principal.role !== "ROOT") {
      tx.cashierId = principal.userId;
      tx.cashierName = principal.userName;
    } else {
      tx.cashierName = trimText(tx.cashierName, 120) || principal.userName || "System";
    }
    tx.customerId = trimText(tx.customerId, 120);
    tx.customerName = trimText(tx.customerName, 160);
    tx.mpesaReference = trimText(tx.mpesaReference, 80);
    tx.mpesaCode = trimText(tx.mpesaCode, 80);
    tx.mpesaCustomer = trimText(tx.mpesaCustomer, 160);
    tx.mpesaCheckoutRequestId = trimText(tx.mpesaCheckoutRequestId, 120);
    tx.discountReason = trimText(tx.discountReason, 200);
    if (desiredStatus === "PENDING_REFUND" && previous) {
      tx.items = previous.items;
      tx.subtotal = previous.subtotal;
      tx.tax = previous.tax;
      tx.discountAmount = previous.discountAmount;
      tx.total = previous.total;
      tx.paymentMethod = previous.paymentMethod;
      tx.amountTendered = previous.amountTendered;
      tx.changeGiven = previous.changeGiven;
      tx.pendingRefundItems = asArray(tx.pendingRefundItems).slice(0, 50).map((item) => ({
        productId: String(item?.productId || item?.id || "").trim(),
        quantity: clamp(asNumber(item?.quantity), 0, 1e6)
      })).filter((item) => item.productId && item.quantity > 0);
      continue;
    }
    const rawItems = asArray(tx.items);
    if (rawItems.length === 0) throw new PolicyError("A sale must include at least one item.");
    const normalizedItems = rawItems.map((item) => {
      const productId = String(item?.productId || item?.id || "").trim();
      const product = productId ? products.get(productId) : null;
      if (!product) throw new PolicyError("Sale includes an item that does not exist.", 400);
      assertProductBranch(product, branchId);
      const quantity = clamp(asNumber(item?.quantity ?? item?.cartQuantity), 0, 1e6);
      if (quantity <= 0) throw new PolicyError("Sale item quantity must be more than zero.");
      return {
        productId,
        name: product.name,
        quantity,
        snapshotPrice: roundMoney(asNumber(product.sellingPrice)),
        snapshotCost: roundMoney(asNumber(product.costPrice)),
        category: product.category || "General",
        taxCategory: product.taxCategory || "A",
        unit: product.unit || void 0
      };
    });
    let calculatedTax = 0;
    const subtotal = roundMoney(normalizedItems.reduce((sum, item) => {
      const lineTotal = item.snapshotPrice * item.quantity;
      if (item.taxCategory === "A") {
        calculatedTax += lineTotal * (16 / 116);
      }
      return sum + lineTotal;
    }, 0));
    const discountAmount = roundMoney(clamp(asNumber(tx.discountAmount ?? tx.discount), 0, subtotal));
    const discountRatio = subtotal > 0 ? discountAmount / subtotal : 0;
    const tax = roundMoney(calculatedTax * (1 - discountRatio));
    const total = roundMoney(Math.max(0, subtotal - discountAmount));
    const paymentMethod = String(tx.paymentMethod || "").toUpperCase();
    tx.items = normalizedItems;
    tx.subtotal = subtotal;
    tx.discountAmount = discountAmount;
    tx.discount = discountAmount;
    tx.tax = tax;
    tx.total = total;
    tx.paymentMethod = STAFF_ALLOWED_METHODS.has(paymentMethod) ? paymentMethod : null;
    tx.amountTendered = tx.amountTendered === void 0 ? null : roundMoney(Math.max(0, asNumber(tx.amountTendered)));
    tx.changeGiven = tx.changeGiven === void 0 ? null : roundMoney(Math.max(0, asNumber(tx.changeGiven)));
    if (tx.paymentMethod === "CASH" && tx.amountTendered !== null) {
      tx.changeGiven = roundMoney(Math.max(0, Number(tx.amountTendered) - total));
    }
    const alreadyCounted = previous && statusNeedsStock(previous.status);
    if (statusNeedsStock(desiredStatus) && !alreadyCounted) {
      if (tx.customerId) {
        sideEffects.push(
          db.prepare(
            `UPDATE customers
             SET totalSpent = COALESCE(totalSpent, 0) + ?,
                 balance = COALESCE(balance, 0) + ?,
                 updated_at = ?
             WHERE id = ? AND businessId = ?`
          ).bind(total, creditAmountFor(tx, total), now, tx.customerId, businessId)
        );
      }
      const txDeductions = /* @__PURE__ */ new Map();
      for (const item of normalizedItems) {
        const product = products.get(item.productId);
        if (!product) continue;
        if (isBundle(product)) {
          const components = ingredientRows.get(product.id) || componentsFromProduct(product);
          if (components.length === 0) throw new PolicyError(`${product.name} has no ingredients configured.`);
          for (const component of components) {
            addDeduction(txDeductions, component.productId, component.quantity * item.quantity);
          }
        } else {
          addDeduction(txDeductions, item.productId, item.quantity);
        }
      }
      for (const [productId, quantity] of txDeductions.entries()) {
        const product = products.get(productId);
        if (!product) throw new PolicyError("Sale refers to a stock item that does not exist.");
        assertProductBranch(product, branchId);
        const alreadyPlanned = plannedDeductions.get(productId) || 0;
        if (asNumber(product.stockQuantity) < alreadyPlanned + quantity) {
          throw new PolicyError(`Insufficient stock for ${product.name}.`, 409);
        }
        plannedDeductions.set(productId, alreadyPlanned + quantity);
        const txRef = txId.split("-")[0].toUpperCase();
        sideEffects.push(
          db.prepare(`UPDATE products SET stockQuantity = MAX(0, stockQuantity - ?), updated_at = ? WHERE id = ? AND businessId = ?`).bind(quantity, now, productId, businessId)
        );
        sideEffects.push(
          db.prepare(
            `INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            crypto.randomUUID(),
            productId,
            "OUT",
            quantity,
            // Positive value — type='OUT' already conveys the direction
            tx.timestamp,
            `${sourceLabel} #${txRef}`,
            branchId,
            businessId,
            tx.shiftId || null,
            now
          )
        );
      }
    }
  }
  return sideEffects;
}
__name(hardenTransactionBatch, "hardenTransactionBatch");

// api/admin/branch.ts
var ADMIN_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN"]);
var corsHeaders3 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json2(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders3 }
  });
}
__name(json2, "json");
function trimText2(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText2, "trimText");
function boolValue(value, fallback = true) {
  if (value === void 0 || value === null) return fallback;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value ? 1 : 0;
  return String(value).toLowerCase() === "true" || value === "1" ? 1 : 0;
}
__name(boolValue, "boolValue");
async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
}
__name(ensureSchema, "ensureSchema");
var onRequestOptions = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders3 }), "onRequestOptions");
var onRequestPost = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json2({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !ADMIN_ROLES.has(auth.principal.role)) return json2({ error: "Admin access required." }, 403);
    const body = await request.json().catch(() => null);
    const action = String(body?.action || "SAVE").trim().toUpperCase();
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || auth.principal.businessId || "").trim();
    const branchId = trimText2(body?.branchId || body?.branch?.id || request.headers.get("X-Branch-ID"), 160);
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json2({ error: "Access denied." }, 403);
    await ensureSchema(env.DB);
    const now = Date.now();
    if (action === "SAVE") {
      const branch2 = body?.branch || body || {};
      const name = trimText2(branch2.name, 120);
      const location = trimText2(branch2.location, 160);
      if (!name || !location) return json2({ error: "Branch name and location are required." }, 400);
      const id = trimText2(branch2.id || body?.branchId, 160) || `branch_${crypto.randomUUID().split("-")[0]}`;
      const existing = await env.DB.prepare(`SELECT id FROM branches WHERE id = ? AND businessId = ? LIMIT 1`).bind(id, businessId).first();
      const savedBranch = {
        id,
        name,
        location,
        phone: trimText2(branch2.phone, 40) || null,
        tillNumber: trimText2(branch2.tillNumber, 80) || null,
        kraPin: trimText2(branch2.kraPin, 40) || null,
        isActive: existing ? boolValue(branch2.isActive, true) : 1,
        businessId,
        updated_at: now
      };
      await env.DB.batch([
        env.DB.prepare(`
          INSERT OR REPLACE INTO branches (id, name, location, phone, tillNumber, kraPin, isActive, businessId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(savedBranch.id, savedBranch.name, savedBranch.location, savedBranch.phone, savedBranch.tillNumber, savedBranch.kraPin, savedBranch.isActive, businessId, now),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, existing ? "branch.update" : "branch.create", "branch", id, "INFO", `${existing ? "Updated" : "Created"} branch ${name}.`, businessId, id, now)
      ]);
      return json2({ success: true, branch: savedBranch });
    }
    if (!branchId) return json2({ error: "Branch is required." }, 400);
    if (!canAccessBranch(auth.principal, branchId)) return json2({ error: "Access denied." }, 403);
    const branch = await env.DB.prepare(`SELECT * FROM branches WHERE id = ? AND businessId = ? LIMIT 1`).bind(branchId, businessId).first();
    if (!branch) throw new PolicyError("Branch was not found.", 404);
    if (action === "SET_ACTIVE") {
      const isActive = boolValue(body?.isActive, true);
      if (!isActive) {
        const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM branches WHERE businessId = ? AND isActive = 1`).bind(businessId).first();
        if (Number(row?.count || 0) <= 1) throw new PolicyError("At least one branch must remain active.", 409);
      }
      await env.DB.prepare(`UPDATE branches SET isActive = ?, updated_at = ? WHERE id = ? AND businessId = ?`).bind(isActive, now, branchId, businessId).run();
      return json2({ success: true, branchId, isActive });
    }
    if (action === "DELETE") {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM branches WHERE businessId = ?`).bind(businessId).first();
      if (Number(row?.count || 0) <= 1) throw new PolicyError("Cannot delete the only remaining branch.", 409);
      const linked = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM transactions WHERE businessId = ? AND branchId = ?) +
          (SELECT COUNT(*) FROM products WHERE businessId = ? AND branchId = ?) +
          (SELECT COUNT(*) FROM expenses WHERE businessId = ? AND branchId = ?) +
          (SELECT COUNT(*) FROM purchaseOrders WHERE businessId = ? AND branchId = ?) +
          (SELECT COUNT(*) FROM salesInvoices WHERE businessId = ? AND branchId = ?) AS count
      `).bind(businessId, branchId, businessId, branchId, businessId, branchId, businessId, branchId, businessId, branchId).first();
      if (Number(linked?.count || 0) > 0) throw new PolicyError("Branches with records cannot be deleted. Deactivate it instead.", 409);
      await env.DB.prepare(`DELETE FROM branches WHERE id = ? AND businessId = ?`).bind(branchId, businessId).run();
      return json2({ success: true, branchId });
    }
    return json2({ error: "Unsupported branch action." }, 400);
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json2({ error: err?.message || "Could not update branch." }, status);
  }
}, "onRequestPost");

// api/admin/business.ts
var corsHeaders4 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json3(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders4 }
  });
}
__name(json3, "json");
function temporaryPassword() {
  return `MT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}
__name(temporaryPassword, "temporaryPassword");
async function ensureSchema2(db) {
  const userColumns = [
    "branchId TEXT",
    "pin TEXT",
    "updated_at INTEGER"
  ];
  for (const column of userColumns) {
    try {
      await db.prepare(`ALTER TABLE users ADD COLUMN ${column}`).run();
    } catch {
    }
  }
}
__name(ensureSchema2, "ensureSchema");
var onRequestOptions2 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders4 }), "onRequestOptions");
var onRequestPost2 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json3({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && auth.principal.role !== "ROOT") return json3({ error: "Root access required." }, 403);
    const body = await request.json().catch(() => null);
    const name = String(body?.name || "").trim();
    const code = String(body?.code || "").trim().toUpperCase();
    if (!name || !/^[A-Z0-9]{3,20}$/.test(code)) return json3({ error: "Valid business name and code are required." }, 400);
    const exists = await env.DB.prepare(`SELECT id FROM businesses WHERE code = ? LIMIT 1`).bind(code).first();
    if (exists) return json3({ error: "Business code is already in use." }, 409);
    await ensureSchema2(env.DB);
    const now = Date.now();
    const businessId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const adminPassword = temporaryPassword();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO businesses (id, name, code, isActive, updated_at) VALUES (?, ?, ?, ?, ?)`).bind(businessId, name, code, 1, now),
      env.DB.prepare(`INSERT INTO users (id, name, password, role, businessId, branchId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(userId, "admin", await hashPassword(adminPassword), "ADMIN", businessId, null, now),
      env.DB.prepare(`INSERT INTO branches (id, name, location, phone, tillNumber, kraPin, isActive, businessId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(branchId, "Main Branch", "Default", null, null, null, 1, businessId, now)
    ]);
    return json3({ success: true, businessId, branchId, adminPassword });
  } catch (err) {
    return json3({ error: err?.message || "Could not create business." }, 500);
  }
}, "onRequestPost");

// api/admin/staff.ts
var ADMIN_ROLES2 = /* @__PURE__ */ new Set(["ROOT", "ADMIN"]);
var STAFF_ROLES = /* @__PURE__ */ new Set(["ADMIN", "MANAGER", "CASHIER"]);
var corsHeaders5 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json4(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders5 }
  });
}
__name(json4, "json");
function trimText3(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText3, "trimText");
function temporaryPassword2() {
  return `MT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}
__name(temporaryPassword2, "temporaryPassword");
async function ensureSchema3(db) {
  const userColumns = [
    "branchId TEXT",
    "pin TEXT",
    "updated_at INTEGER"
  ];
  for (const column of userColumns) {
    try {
      await db.prepare(`ALTER TABLE users ADD COLUMN ${column}`).run();
    } catch {
    }
  }
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
}
__name(ensureSchema3, "ensureSchema");
async function adminCount(db, businessId) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM users WHERE businessId = ? AND role = 'ADMIN'`).bind(businessId).first();
  return Number(row?.count || 0);
}
__name(adminCount, "adminCount");
async function branchExists(db, businessId, branchId) {
  const row = await db.prepare(`
    SELECT id
    FROM branches
    WHERE id = ? AND businessId = ? AND COALESCE(isActive, 1) != 0
    LIMIT 1
  `).bind(branchId, businessId).first();
  return !!row;
}
__name(branchExists, "branchExists");
var onRequestOptions3 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders5 }), "onRequestOptions");
var onRequestPost3 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json4({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !ADMIN_ROLES2.has(auth.principal.role)) {
      return json4({ error: "Admin access required." }, 403);
    }
    const body = await request.json().catch(() => null);
    const action = String(body?.action || "SAVE").trim().toUpperCase();
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || auth.principal.businessId || "").trim();
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json4({ error: "Access denied." }, 403);
    await ensureSchema3(env.DB);
    const now = Date.now();
    if (action === "SAVE") {
      const staff = body?.user || body?.staff || body || {};
      const name = trimText3(staff.name, 120);
      const role = String(staff.role || "CASHIER").toUpperCase();
      if (!name) return json4({ error: "Staff name is required." }, 400);
      if (!STAFF_ROLES.has(role)) return json4({ error: "Staff role is not allowed." }, 400);
      const id = trimText3(staff.id || body?.userId, 160) || crypto.randomUUID();
      const existing = await env.DB.prepare(`SELECT * FROM users WHERE id = ? AND businessId = ? LIMIT 1`).bind(id, businessId).first();
      const duplicate = await env.DB.prepare(`
        SELECT id
        FROM users
        WHERE businessId = ? AND lower(trim(name)) = lower(trim(?)) AND id != ?
        LIMIT 1
      `).bind(businessId, name, id).first();
      if (duplicate) throw new PolicyError("A staff member with this login name already exists.", 409);
      if (existing?.role === "ADMIN" && role !== "ADMIN" && await adminCount(env.DB, businessId) <= 1) {
        throw new PolicyError("The last administrator cannot be changed.", 403);
      }
      const password = String(staff.password || "");
      const passwordHash = password ? await hashPassword(password) : existing?.password;
      if (!passwordHash) throw new PolicyError("Password is required for new staff accounts.", 400);
      const requestedBranchId = trimText3(staff.branchId, 160) || existing?.branchId || null;
      if (role !== "ADMIN" && !requestedBranchId) {
        throw new PolicyError("Assign this staff member to a branch.", 400);
      }
      if (requestedBranchId && !await branchExists(env.DB, businessId, requestedBranchId)) {
        throw new PolicyError("Select an active branch for this staff member.", 400);
      }
      const savedUser = {
        id,
        name,
        password: passwordHash,
        role,
        businessId,
        branchId: role === "ADMIN" ? requestedBranchId || null : requestedBranchId,
        updated_at: now
      };
      await env.DB.batch([
        env.DB.prepare(`INSERT OR REPLACE INTO users (id, name, password, role, businessId, branchId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(savedUser.id, savedUser.name, savedUser.password, savedUser.role, businessId, savedUser.branchId, now),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, existing ? "admin.user.update" : "admin.user.create", "user", id, "INFO", `${existing ? "Updated" : "Created"} ${role} account for ${name}.`, businessId, savedUser.branchId, now)
      ]);
      const { password: _password, ...safeUser2 } = savedUser;
      return json4({ success: true, user: safeUser2 });
    }
    const userId = trimText3(body?.userId || body?.id, 160);
    if (!userId) return json4({ error: "Staff user is required." }, 400);
    const user = await env.DB.prepare(`SELECT id, name, role, businessId, branchId FROM users WHERE id = ? AND businessId = ? LIMIT 1`).bind(userId, businessId).first();
    if (!user) throw new PolicyError("Staff user was not found.", 404);
    if (action === "DELETE") {
      if (user.id === auth.principal.userId) throw new PolicyError("You cannot delete your own signed-in account.", 403);
      if (user.role === "ADMIN" && await adminCount(env.DB, businessId) <= 1) {
        throw new PolicyError("The last administrator cannot be deleted.", 403);
      }
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM users WHERE id = ? AND businessId = ?`).bind(userId, businessId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, "admin.user.delete", "user", userId, "WARN", `Deleted user ${user.name} (${user.role}).`, businessId, user.branchId || null, now)
      ]);
      return json4({ success: true, userId });
    }
    if (action === "RESET_PASSWORD") {
      const requested = String(body?.newPassword || "");
      const newPassword = requested.length >= 4 ? requested : temporaryPassword2();
      await env.DB.batch([
        env.DB.prepare(`UPDATE users SET password = ?, updated_at = ? WHERE id = ? AND businessId = ?`).bind(await hashPassword(newPassword), now, userId, businessId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, "admin.user_password_reset", "user", userId, "WARN", `Reset password for ${user.name}.`, businessId, user.branchId || null, now)
      ]);
      return json4({ success: true, userId, temporaryPassword: requested ? void 0 : newPassword });
    }
    return json4({ error: "Unsupported staff action." }, 400);
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json4({ error: err?.message || "Could not update staff." }, status);
  }
}, "onRequestPost");

// api/admin/verify.ts
var MAX_ATTEMPTS = 5;
var LOCKOUT_MS = 15 * 60 * 1e3;
var corsHeaders6 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json5(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders6
    }
  });
}
__name(json5, "json");
async function ensureAttemptTable(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)").run();
}
__name(ensureAttemptTable, "ensureAttemptTable");
async function recordFailedAttempt(db, id) {
  const row = await db.prepare("SELECT count FROM loginAttempts WHERE id = ?").bind(id).first();
  const count = Number(row?.count || 0) + 1;
  const lockedUntil = count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : null;
  await db.prepare("INSERT OR REPLACE INTO loginAttempts (id, count, lockedUntil, updated_at) VALUES (?, ?, ?, ?)").bind(id, count, lockedUntil, Date.now()).run();
}
__name(recordFailedAttempt, "recordFailedAttempt");
var onRequestOptions4 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders6 }), "onRequestOptions");
var onRequestPost4 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json5({ error: "Database is not configured." }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    const businessId = String(body?.businessId || request.headers.get("X-Business-ID") || auth.principal.businessId || "").trim();
    const pin = String(body?.pin || "").trim();
    if (!businessId || !pin) return json5({ error: "Business and supervisor PIN are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) return json5({ error: "Access denied." }, 403);
    await ensureAttemptTable(env.DB);
    const attemptId = `ADMIN_VERIFY:${businessId}:${auth.principal.userId}`;
    const attempt = await env.DB.prepare("SELECT lockedUntil FROM loginAttempts WHERE id = ?").bind(attemptId).first();
    if (attempt?.lockedUntil && Date.now() < Number(attempt.lockedUntil)) {
      const minutes = Math.ceil((Number(attempt.lockedUntil) - Date.now()) / 6e4);
      return json5({ error: `Supervisor check is locked. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }, 423);
    }
    const { results } = await env.DB.prepare("SELECT * FROM users WHERE businessId = ? AND role = ?").bind(businessId, "ADMIN").all();
    for (const admin of results || []) {
      const rawPin = typeof admin.pin === "string" ? admin.pin : "";
      const pinOk = rawPin ? rawPin === pin : false;
      const passwordOk = await verifyPassword(pin, String(admin.password || ""));
      if (pinOk || passwordOk) {
        await env.DB.prepare("DELETE FROM loginAttempts WHERE id = ?").bind(attemptId).run();
        return json5({ success: true, admin: { id: admin.id, name: admin.name } });
      }
    }
    await recordFailedAttempt(env.DB, attemptId);
    return json5({ error: "Invalid supervisor PIN." }, 401);
  } catch (err) {
    console.error("[Admin Verify API]", err);
    return json5({ error: err?.message || "Could not verify supervisor." }, 500);
  }
}, "onRequestPost");

// api/ai/ask.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
var DEFAULT_DAILY_LIMIT = 20;
var MAX_DAILY_LIMIT = 200;
var MODEL_FALLBACK = "@cf/meta/llama-3.1-8b-instruct";
var corsHeaders7 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID, X-User-ID, X-User-Name"
};
function json6(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      ...corsHeaders7
    }
  });
}
__name(json6, "json");
function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  if (!value.startsWith("{") && !value.startsWith("[")) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
__name(parseMaybeJson, "parseMaybeJson");
function normaliseRows(rows = []) {
  return rows.map((row) => {
    const out = {};
    for (const [key, value] of Object.entries(row)) out[key] = parseMaybeJson(value);
    return out;
  });
}
__name(normaliseRows, "normaliseRows");
async function all(db, sql, ...bindings) {
  const result = await db.prepare(sql).bind(...bindings).all();
  return normaliseRows(result.results || []);
}
__name(all, "all");
async function first(db, sql, ...bindings) {
  const row = await db.prepare(sql).bind(...bindings).first();
  return row ? normaliseRows([row])[0] : null;
}
__name(first, "first");
function asNumber2(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber2, "asNumber");
function ksh(value) {
  return `Ksh ${Math.round(asNumber2(value)).toLocaleString("en-US")}`;
}
__name(ksh, "ksh");
function nairobiDay(now = Date.now()) {
  return new Date(now + 3 * 60 * 60 * 1e3).toISOString().slice(0, 10);
}
__name(nairobiDay, "nairobiDay");
function daysSince(timestamp, now = Date.now()) {
  const ts = asNumber2(timestamp, 0);
  if (!ts) return null;
  return Math.max(0, Math.floor((now - ts) / DAY_MS));
}
__name(daysSince, "daysSince");
function truncateText(text2, max = 900) {
  return String(text2 || "").trim().slice(0, max);
}
__name(truncateText, "truncateText");
async function ensureAiSchema(db) {
  const migrations = [
    "ALTER TABLE settings ADD COLUMN aiAssistantEnabled INTEGER DEFAULT 1",
    "ALTER TABLE settings ADD COLUMN aiDailyRequestLimit INTEGER DEFAULT 20",
    `CREATE TABLE IF NOT EXISTS aiUsage (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      userId TEXT NOT NULL,
      userName TEXT,
      branchId TEXT,
      day TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      updated_at INTEGER
    )`,
    "CREATE INDEX IF NOT EXISTS idx_aiUsage_scope ON aiUsage(businessId, userId, day)"
  ];
  for (const sql of migrations) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureAiSchema, "ensureAiSchema");
async function getAiSettings(db, businessId) {
  const settings = await first(
    db,
    `SELECT aiAssistantEnabled, aiDailyRequestLimit
     FROM settings
     WHERE businessId = ?
     ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    businessId,
    `core_${businessId}`
  );
  const enabled = asNumber2(settings?.aiAssistantEnabled, 1) !== 0;
  const rawLimit = asNumber2(settings?.aiDailyRequestLimit, DEFAULT_DAILY_LIMIT);
  const dailyLimit = Math.min(MAX_DAILY_LIMIT, Math.max(1, Math.floor(rawLimit || DEFAULT_DAILY_LIMIT)));
  return { enabled, dailyLimit };
}
__name(getAiSettings, "getAiSettings");
async function getUsage(db, businessId, userId, userName, branchId) {
  const day = nairobiDay();
  const id = `${businessId}|BUSINESS|${day}`;
  const row = await first(db, "SELECT count FROM aiUsage WHERE id = ?", id);
  return {
    id,
    day,
    count: asNumber2(row?.count, 0),
    async increment() {
      const next = asNumber2(row?.count, 0) + 1;
      await db.prepare(
        `INSERT OR REPLACE INTO aiUsage (id, businessId, userId, userName, branchId, day, count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, businessId, "BUSINESS", `Last used by ${userName || userId}`, branchId, day, next, Date.now()).run();
      return next;
    }
  };
}
__name(getUsage, "getUsage");
function productName(productsById, productId) {
  return productsById.get(productId)?.name || productId;
}
__name(productName, "productName");
async function buildBusinessSnapshot(db, businessId, branchId) {
  const now = Date.now();
  const since7 = now - 7 * DAY_MS;
  const since30 = now - 30 * DAY_MS;
  const since60 = now - 60 * DAY_MS;
  const since90 = now - 90 * DAY_MS;
  const [
    business,
    activeBranch,
    branches,
    products,
    stockRows,
    sales30,
    branchSales,
    expenseRows,
    customersOwing,
    suppliersOwing,
    purchaseOrderRows,
    pendingExpenses,
    pendingAdjustments,
    pendingPOs,
    pendingCashPicks,
    pendingRefunds,
    recentTransactions
  ] = await Promise.all([
    first(db, "SELECT id, name, code FROM businesses WHERE id = ?", businessId),
    branchId ? first(db, "SELECT id, name, location FROM branches WHERE businessId = ? AND id = ?", businessId, branchId) : Promise.resolve(null),
    all(db, "SELECT id, name, location FROM branches WHERE businessId = ? ORDER BY name", businessId),
    all(
      db,
      `SELECT id, name, category, sellingPrice, costPrice, stockQuantity, reorderPoint, taxCategory, isBundle
       FROM products WHERE businessId = ? ORDER BY name`,
      businessId
    ),
    all(
      db,
      `SELECT productId,
              MAX(timestamp) AS lastOut,
              SUM(CASE WHEN timestamp >= ? THEN quantity ELSE 0 END) AS sold30,
              SUM(CASE WHEN timestamp >= ? THEN quantity ELSE 0 END) AS sold60
       FROM stockMovements
       WHERE businessId = ? AND type = 'OUT'
       GROUP BY productId`,
      since30,
      since60,
      businessId
    ),
    all(
      db,
      `SELECT
          COUNT(*) AS count,
          SUM(total) AS totalSales,
          SUM(CASE WHEN timestamp >= ? THEN total ELSE 0 END) AS sales7,
          SUM(CASE WHEN paymentMethod = 'CASH' THEN total ELSE 0 END) AS cashSales,
          SUM(CASE WHEN paymentMethod = 'MPESA' THEN total ELSE 0 END) AS mpesaSales,
          SUM(CASE WHEN paymentMethod = 'CREDIT' OR status = 'UNPAID' THEN total ELSE 0 END) AS creditSales,
          SUM(tax) AS taxTotal
       FROM transactions
       WHERE businessId = ? AND timestamp >= ?`,
      since7,
      businessId,
      since30
    ),
    all(
      db,
      `SELECT b.name AS branchName, b.id AS branchId, COUNT(t.id) AS count, COALESCE(SUM(t.total), 0) AS sales
       FROM branches b
       LEFT JOIN transactions t ON t.businessId = b.businessId AND t.branchId = b.id AND t.timestamp >= ?
       WHERE b.businessId = ?
       GROUP BY b.id, b.name
       ORDER BY sales DESC`,
      since30,
      businessId
    ),
    all(
      db,
      `SELECT category, COUNT(*) AS count, SUM(amount) AS amount
       FROM expenses
       WHERE businessId = ? AND timestamp >= ? AND status != 'REJECTED'
       GROUP BY category
       ORDER BY amount DESC
       LIMIT 12`,
      businessId,
      since30
    ),
    all(
      db,
      `SELECT name, phone, balance, totalSpent
       FROM customers
       WHERE businessId = ? AND balance > 0
       ORDER BY balance DESC
       LIMIT 12`,
      businessId
    ),
    all(
      db,
      `SELECT name, company, balance
       FROM suppliers
       WHERE businessId = ? AND balance > 0
       ORDER BY balance DESC
       LIMIT 12`,
      businessId
    ),
    all(
      db,
      `SELECT id, poNumber, supplierId, totalAmount, paidAmount, paymentStatus, status, approvalStatus, orderDate
       FROM purchaseOrders
       WHERE businessId = ? AND status = 'RECEIVED' AND COALESCE(paymentStatus, 'UNPAID') != 'PAID'
       ORDER BY orderDate DESC
       LIMIT 12`,
      businessId
    ),
    first(db, "SELECT COUNT(*) AS count FROM expenses WHERE businessId = ? AND status = 'PENDING'", businessId),
    first(db, "SELECT COUNT(*) AS count FROM stockAdjustmentRequests WHERE businessId = ? AND status = 'PENDING'", businessId),
    first(db, "SELECT COUNT(*) AS count FROM purchaseOrders WHERE businessId = ? AND approvalStatus = 'PENDING'", businessId),
    first(db, "SELECT COUNT(*) AS count FROM cashPicks WHERE businessId = ? AND status = 'PENDING'", businessId),
    first(db, "SELECT COUNT(*) AS count FROM transactions WHERE businessId = ? AND status = 'PENDING_REFUND'", businessId),
    all(
      db,
      `SELECT id, total, timestamp, status, paymentMethod, customerName, cashierName, branchId
       FROM transactions
       WHERE businessId = ? AND timestamp >= ?
       ORDER BY timestamp DESC
       LIMIT 20`,
      businessId,
      since90
    )
  ]);
  const productsById = new Map(products.map((product) => [product.id, product]));
  const stockByProduct = new Map(stockRows.map((row) => [row.productId, row]));
  const inventoryRows = products.map((product) => {
    const stock = asNumber2(product.stockQuantity);
    const cost = asNumber2(product.costPrice);
    const metrics = stockByProduct.get(product.id) || {};
    const sold30 = asNumber2(metrics.sold30);
    const sold60 = asNumber2(metrics.sold60);
    const lastOut = asNumber2(metrics.lastOut);
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      stock,
      reorderPoint: asNumber2(product.reorderPoint),
      costPrice: cost,
      sellingPrice: asNumber2(product.sellingPrice),
      stockValue: Math.round(stock * cost),
      sold30,
      sold60,
      lastSold: lastOut ? new Date(lastOut).toISOString().slice(0, 10) : null,
      daysSinceSale: daysSince(lastOut, now)
    };
  });
  const deadStock = inventoryRows.filter((item) => item.stock > 0 && item.category !== "Services" && (item.sold60 <= 0 || !item.lastSold)).sort((a, b) => b.stockValue - a.stockValue).slice(0, 8);
  const lowStock = inventoryRows.filter((item) => item.reorderPoint > 0 && item.stock <= item.reorderPoint).sort((a, b) => a.stock / Math.max(1, a.reorderPoint) - b.stock / Math.max(1, b.reorderPoint)).slice(0, 15);
  const topSellers = inventoryRows.filter((item) => item.sold30 > 0).sort((a, b) => b.sold30 - a.sold30).slice(0, 15);
  const branchNameById = new Map(branches.map((branch) => [branch.id, branch.name]));
  const formatInventoryItem = /* @__PURE__ */ __name((item) => ({
    name: item.name,
    category: item.category,
    stockOnHand: item.stock,
    reorderPoint: item.reorderPoint,
    stockValue: ksh(item.stockValue),
    sellingPrice: ksh(item.sellingPrice),
    soldLast30Days: item.sold30,
    soldLast60Days: item.sold60,
    lastSold: item.lastSold || "No recorded sale or stock-out in POS",
    daysSinceSale: item.daysSinceSale ?? "No recorded sale history",
    signal: item.sold60 <= 0 ? "No stock-out movement in the last 60 days" : "Slow movement"
  }), "formatInventoryItem");
  return {
    generatedAt: new Date(now).toISOString(),
    period: {
      salesWindow: "last 30 days",
      deadStockWindow: "no stock movement OUT in the last 60 days",
      lowStockRule: "stockQuantity <= reorderPoint"
    },
    business: {
      id: businessId,
      name: business?.name || "Business",
      code: business?.code,
      activeBranch: activeBranch ? { id: activeBranch.id, name: activeBranch.name, location: activeBranch.location } : null,
      branchCount: branches.length,
      branches: branches.map((branch) => ({ id: branch.id, name: branch.name, location: branch.location }))
    },
    sales: {
      last30Days: {
        count: asNumber2(sales30[0]?.count),
        totalSales: ksh(sales30[0]?.totalSales),
        last7DaysSales: ksh(sales30[0]?.sales7),
        cashSales: ksh(sales30[0]?.cashSales),
        mpesaSales: ksh(sales30[0]?.mpesaSales),
        creditSales: ksh(sales30[0]?.creditSales),
        taxTotal: ksh(sales30[0]?.taxTotal)
      },
      byBranch: branchSales.map((row) => ({
        branch: row.branchName,
        sales: ksh(row.sales),
        transactions: asNumber2(row.count)
      })),
      recent: recentTransactions.slice(0, 10).map((tx) => ({
        date: new Date(asNumber2(tx.timestamp)).toISOString().slice(0, 10),
        branch: branchNameById.get(tx.branchId) || tx.branchId,
        total: ksh(tx.total),
        status: tx.status,
        paymentMethod: tx.paymentMethod,
        customer: tx.customerName
      }))
    },
    inventory: {
      productCount: products.length,
      totalStockValue: ksh(inventoryRows.reduce((sum, item) => sum + item.stockValue, 0)),
      deadStockValue: ksh(deadStock.reduce((sum, item) => sum + item.stockValue, 0)),
      deadStock: deadStock.map(formatInventoryItem),
      lowStock: lowStock.map(formatInventoryItem),
      topSellers: topSellers.map(formatInventoryItem)
    },
    receivables: {
      totalCustomersOwing: ksh(customersOwing.reduce((sum, row) => sum + asNumber2(row.balance), 0)),
      customersOwing: customersOwing.map((row) => ({
        name: row.name,
        phone: row.phone,
        balance: ksh(row.balance),
        totalSpent: ksh(row.totalSpent)
      }))
    },
    payables: {
      totalSuppliersOwing: ksh(suppliersOwing.reduce((sum, row) => sum + asNumber2(row.balance), 0)),
      suppliersOwing: suppliersOwing.map((row) => ({
        name: row.name,
        company: row.company,
        balance: ksh(row.balance)
      })),
      unpaidPurchaseOrders: purchaseOrderRows.map((row) => ({
        poNumber: row.poNumber || row.id,
        total: ksh(row.totalAmount),
        paid: ksh(row.paidAmount),
        due: ksh(asNumber2(row.totalAmount) - asNumber2(row.paidAmount)),
        paymentStatus: row.paymentStatus || "UNPAID",
        status: row.status
      }))
    },
    expenses: {
      last30DaysByCategory: expenseRows.map((row) => ({
        category: row.category,
        amount: ksh(row.amount),
        count: asNumber2(row.count)
      }))
    },
    approvals: {
      pendingExpenses: asNumber2(pendingExpenses?.count),
      pendingStockAdjustments: asNumber2(pendingAdjustments?.count),
      pendingPurchaseOrders: asNumber2(pendingPOs?.count),
      pendingCashPicks: asNumber2(pendingCashPicks?.count),
      pendingRefunds: asNumber2(pendingRefunds?.count)
    },
    lookupNotes: {
      productNameExample: productName(productsById, deadStock[0]?.id || topSellers[0]?.id || "")
    }
  };
}
__name(buildBusinessSnapshot, "buildBusinessSnapshot");
function buildPrompt(question, snapshot) {
  return [
    "You are the Mtaani POS AI analyst inside a Kenyan point-of-sale system.",
    "Answer only from the provided business data. Do not invent records, totals, or dates.",
    "Give practical advice the shop owner can act on. Be direct and concise. Use at most five bullets unless the user asks for a full list.",
    "Use Ksh for money. When warning about dead stock, name the product, stock on hand, stock value, and how long it has not moved when available.",
    'Do not mention JSON keys, null values, or implementation details. If sale history is missing, say "no recorded sales in POS".',
    "Do not recommend buying more of dead stock. Do not treat service items as physical stock buying advice.",
    "End with one clear action recommendation.",
    "If the question asks for something outside the provided data, say what data is missing and suggest a POS report to check.",
    "",
    `Business data JSON:
${JSON.stringify(snapshot)}`,
    "",
    `User question: ${question}`,
    "",
    "Answer:"
  ].join("\n");
}
__name(buildPrompt, "buildPrompt");
function maybeAnswerFromSnapshot(question, snapshot) {
  const q = question.toLowerCase();
  const wantsDeadStock = q.includes("dead stock") || q.includes("not moved") || q.includes("slow stock") || q.includes("avoid buying") || q.includes("stock") && q.includes("dead");
  if (wantsDeadStock) {
    const items = (snapshot?.inventory?.deadStock || []).slice(0, 5);
    if (!items.length) {
      return "I do not see any stocked physical products with no movement in the last 60 days. Keep buying based on the top sellers and reorder-point alerts.";
    }
    const lines = items.map((item, index) => `${index + 1}. ${item.name}: ${item.stockOnHand} on hand, ${item.stockValue} tied up, ${item.signal.toLowerCase()}.`);
    return [
      "Avoid buying more of these slow/dead stock items until they start moving:",
      ...lines,
      `Action: pause reorders for these items, discount or bundle them, and move buying money toward top sellers like ${(snapshot?.inventory?.topSellers || []).slice(0, 3).map((item) => item.name).join(", ") || "your fastest-moving products"}.`
    ].join("\n");
  }
  if (q.includes("customer") && (q.includes("owe") || q.includes("debt") || q.includes("balance") || q.includes("credit"))) {
    const customers = (snapshot?.receivables?.customersOwing || []).slice(0, 5);
    if (!customers.length) return "No customer balances are currently outstanding in the provided POS data.";
    return [
      `Customer credit outstanding is ${snapshot.receivables.totalCustomersOwing}. Biggest balances:`,
      ...customers.map((customer, index) => `${index + 1}. ${customer.name}: ${customer.balance}${customer.phone ? ` (${customer.phone})` : ""}.`),
      "Action: collect or send M-Pesa prompts to the top balances first."
    ].join("\n");
  }
  if (q.includes("supplier") && (q.includes("owe") || q.includes("debt") || q.includes("payable") || q.includes("balance"))) {
    const suppliers = (snapshot?.payables?.suppliersOwing || []).slice(0, 5);
    if (!suppliers.length) return "No supplier balances are currently outstanding in the provided POS data.";
    return [
      `Supplier payables total ${snapshot.payables.totalSuppliersOwing}. Biggest balances:`,
      ...suppliers.map((supplier, index) => `${index + 1}. ${supplier.name}: ${supplier.balance}.`),
      "Action: clear the oldest/unpaid purchase orders first to keep supplier credit healthy."
    ].join("\n");
  }
  if (q.includes("approval") || q.includes("pending")) {
    const approvals = snapshot?.approvals || {};
    return [
      "Pending work needing admin attention:",
      `- Expenses: ${approvals.pendingExpenses || 0}`,
      `- Stock adjustments: ${approvals.pendingStockAdjustments || 0}`,
      `- Purchase orders: ${approvals.pendingPurchaseOrders || 0}`,
      `- Cash picks: ${approvals.pendingCashPicks || 0}`,
      `- Refunds: ${approvals.pendingRefunds || 0}`,
      "Action: approve stock and cash items first because they affect drawer and inventory accuracy."
    ].join("\n");
  }
  return null;
}
__name(maybeAnswerFromSnapshot, "maybeAnswerFromSnapshot");
function extractAiText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (typeof result.result?.response === "string") return result.result.response;
  if (Array.isArray(result.choices) && result.choices[0]?.message?.content) return result.choices[0].message.content;
  return JSON.stringify(result);
}
__name(extractAiText, "extractAiText");
async function runAi(env, prompt) {
  const model = env.CLOUDFLARE_AI_MODEL || MODEL_FALLBACK;
  const input = {
    prompt,
    max_tokens: 450
  };
  if (env.AI?.run) {
    return extractAiText(await env.AI.run(model, input));
  }
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_AI_API_TOKEN) {
    throw new Error("AI is not configured. Add a Workers AI binding or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_API_TOKEN.");
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.CLOUDFLARE_AI_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || payload?.success === false) {
    const message = payload?.errors?.[0]?.message || payload?.error || `Cloudflare AI request failed (${res.status})`;
    throw new Error(message);
  }
  return extractAiText(payload);
}
__name(runAi, "runAi");
var onRequestOptions5 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders7 }), "onRequestOptions");
var onRequestPost5 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json6({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const businessId = request.headers.get("X-Business-ID")?.trim();
    const branchId = request.headers.get("X-Branch-ID")?.trim() || null;
    const userId = truncateText(auth.principal.userId || "anonymous", 120);
    const headerUserName = truncateText(auth.principal.userName || "Unknown user", 120);
    if (!businessId) return json6({ error: "X-Business-ID header required" }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || branchId && !canAccessBranch(auth.principal, branchId)) return json6({ error: "Access denied" }, 403);
    if (auth.principal.role !== "ADMIN" && auth.principal.role !== "ROOT") return json6({ error: "AI assistant is only available to admin accounts." }, 403);
    const body = await request.json().catch(() => null);
    const question = truncateText(body?.question, 900);
    if (!question) return json6({ error: "Ask a question first." }, 400);
    await ensureAiSchema(env.DB);
    const user = await first(
      env.DB,
      "SELECT id, name, role FROM users WHERE businessId = ? AND id = ? LIMIT 1",
      businessId,
      userId
    );
    if (!user || String(user.role || "").toUpperCase() !== "ADMIN") {
      return json6({ error: "AI assistant is only available to admin accounts." }, 403);
    }
    const userName = truncateText(user.name || headerUserName || "Admin", 120);
    const settings = await getAiSettings(env.DB, businessId);
    if (!settings.enabled) return json6({ error: "AI assistant is disabled for this business." }, 403);
    const usage = await getUsage(env.DB, businessId, userId, userName, branchId);
    if (usage.count >= settings.dailyLimit) {
      return json6({
        error: `Daily business AI limit reached (${settings.dailyLimit}). Ask the Super Admin to raise the limit or try again tomorrow.`,
        usage: { used: usage.count, limit: settings.dailyLimit, remaining: 0, day: usage.day }
      }, 429);
    }
    const snapshot = await buildBusinessSnapshot(env.DB, businessId, branchId);
    const answer = maybeAnswerFromSnapshot(question, snapshot) || await runAi(env, buildPrompt(question, snapshot));
    const used = await usage.increment();
    return json6({
      answer: answer.trim(),
      usage: {
        used,
        limit: settings.dailyLimit,
        remaining: Math.max(0, settings.dailyLimit - used),
        day: usage.day
      }
    });
  } catch (err) {
    console.error("[AI Assistant]", err);
    return json6({ error: err?.message || "AI request failed." }, 500);
  }
}, "onRequestPost");

// api/audit/log.ts
var corsHeaders8 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json7(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders8 } });
}
__name(json7, "json");
function trimText4(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText4, "trimText");
var onRequestOptions6 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders8 }), "onRequestOptions");
var onRequestPost6 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json7({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || auth.principal.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim() || null;
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json7({ error: "Access denied." }, 403);
    if (branchId && !canAccessBranch(auth.principal, branchId)) return json7({ error: "Access denied." }, 403);
    const severity = ["INFO", "WARN", "CRITICAL"].includes(String(body?.severity || "").toUpperCase()) ? String(body.severity).toUpperCase() : "INFO";
    const now = Date.now();
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      now,
      trimText4(body?.userId || auth.principal.userId, 160) || null,
      trimText4(body?.userName || auth.principal.userName, 160) || null,
      trimText4(body?.action, 160) || "audit.event",
      trimText4(body?.entity, 120) || null,
      trimText4(body?.entityId, 160) || null,
      severity,
      trimText4(body?.details, 500) || null,
      businessId,
      branchId,
      now
    ).run();
    return json7({ success: true, id });
  } catch (err) {
    return json7({ error: err?.message || "Could not record audit event." }, 500);
  }
}, "onRequestPost");

// api/cash/pick.ts
var STAFF_ROLES2 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER", "CASHIER"]);
var APPROVER_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders9 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json8(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders9 } });
}
__name(json8, "json");
function asNumber3(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber3, "asNumber");
function trimText5(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText5, "trimText");
async function ensureSchema4(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
}
__name(ensureSchema4, "ensureSchema");
var onRequestOptions7 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders9 }), "onRequestOptions");
var onRequestPost7 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json8({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    const action = String(body?.action || "CREATE").trim().toUpperCase();
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    if (!businessId || !branchId) return json8({ error: "Business and branch are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json8({ error: "Access denied." }, 403);
    await ensureSchema4(env.DB);
    const now = Date.now();
    if (action === "CREATE") {
      if (!auth.service && !STAFF_ROLES2.has(auth.principal.role)) return json8({ error: "You are not allowed to record cash picks." }, 403);
      const amount = asNumber3(body?.amount);
      if (amount <= 0) throw new PolicyError("Cash pick amount must be more than zero.", 400);
      const status = String(body?.status || "PENDING").toUpperCase() === "APPROVED" && (auth.service || APPROVER_ROLES.has(auth.principal.role)) ? "APPROVED" : "PENDING";
      const id = trimText5(body?.cashPickId, 160) || crypto.randomUUID();
      const cashPick = { id, amount, timestamp: now, status, userName: trimText5(body?.userName || auth.principal.userName, 120), branchId, businessId, shiftId: body?.shiftId || null, updated_at: now };
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO cashPicks (id, amount, timestamp, status, userName, shiftId, branchId, businessId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(cashPick.id, amount, now, status, cashPick.userName, cashPick.shiftId, branchId, businessId, now),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, status === "APPROVED" ? "cash.pick.owner_sweep" : "cash.pick.request", "cashPick", id, "INFO", `Recorded cash pick of Ksh ${amount.toLocaleString()}.`, businessId, branchId, now)
      ]);
      return json8({ success: true, cashPick });
    }
    if (action === "APPROVE") {
      if (!auth.service && !APPROVER_ROLES.has(auth.principal.role)) return json8({ error: "You are not allowed to approve cash picks." }, 403);
      const cashPickId = trimText5(body?.cashPickId || body?.id, 160);
      if (!cashPickId) return json8({ error: "Cash pick is required." }, 400);
      const pick = await env.DB.prepare(`SELECT id, amount, status FROM cashPicks WHERE id = ? AND businessId = ? AND branchId = ? LIMIT 1`).bind(cashPickId, businessId, branchId).first();
      if (!pick) throw new PolicyError("Cash pick was not found.", 404);
      await env.DB.batch([
        env.DB.prepare(`UPDATE cashPicks SET status = 'APPROVED', updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?`).bind(now, cashPickId, businessId, branchId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, "cash.pick.approve", "cashPick", cashPickId, "INFO", `Approved cash pick of Ksh ${Number(pick.amount || 0).toLocaleString()}.`, businessId, branchId, now)
      ]);
      return json8({ success: true, cashPickId });
    }
    return json8({ error: "Unsupported cash pick action." }, 400);
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json8({ error: err?.message || "Could not update cash pick." }, status);
  }
}, "onRequestPost");

// api/catalog/category.ts
var MANAGER_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders10 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json9(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders10 } });
}
__name(json9, "json");
function trimText6(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText6, "trimText");
var onRequestOptions8 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders10 }), "onRequestOptions");
var onRequestPost8 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json9({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !MANAGER_ROLES.has(auth.principal.role)) return json9({ error: "You are not allowed to manage categories." }, 403);
    const body = await request.json().catch(() => null);
    const action = String(body?.action || "SAVE").toUpperCase();
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || auth.principal.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim() || null;
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json9({ error: "Access denied." }, 403);
    const now = Date.now();
    if (action === "DELETE") {
      const categoryId = trimText6(body?.categoryId || body?.id, 160);
      if (!categoryId) return json9({ error: "Category is required." }, 400);
      const category2 = await env.DB.prepare(`SELECT id, name FROM categories WHERE id = ? AND businessId = ? LIMIT 1`).bind(categoryId, businessId).first();
      if (!category2) throw new PolicyError("Category was not found.", 404);
      await env.DB.prepare(`DELETE FROM categories WHERE id = ? AND businessId = ?`).bind(categoryId, businessId).run();
      return json9({ success: true, categoryId });
    }
    const category = body?.category || body || {};
    const name = trimText6(category.name, 120);
    if (!name) return json9({ error: "Category name is required." }, 400);
    const id = trimText6(category.id || body?.categoryId, 160) || crypto.randomUUID();
    const saved = { id, name, iconName: trimText6(category.iconName, 80) || "Package", color: trimText6(category.color, 40) || "slate", businessId, branchId, updated_at: now };
    await env.DB.prepare(`INSERT OR REPLACE INTO categories (id, name, iconName, color, businessId, branchId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(saved.id, saved.name, saved.iconName, saved.color, businessId, branchId, now).run();
    return json9({ success: true, category: saved });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json9({ error: err?.message || "Could not update category." }, status);
  }
}, "onRequestPost");

// api/catalog/expense-account.ts
var MANAGER_ROLES2 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders11 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json10(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders11 } });
}
__name(json10, "json");
function trimText7(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText7, "trimText");
var onRequestOptions9 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders11 }), "onRequestOptions");
var onRequestPost9 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json10({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !MANAGER_ROLES2.has(auth.principal.role)) return json10({ error: "You are not allowed to manage expense accounts." }, 403);
    const body = await request.json().catch(() => null);
    const action = String(body?.action || "SAVE").toUpperCase();
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || auth.principal.businessId || "").trim();
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json10({ error: "Access denied." }, 403);
    if (action === "DELETE") {
      const accountId = trimText7(body?.accountId || body?.id, 160);
      if (!accountId) return json10({ error: "Expense account is required." }, 400);
      const refs = await env.DB.prepare(`SELECT COUNT(*) AS count FROM expenses WHERE businessId = ? AND category = (SELECT name FROM expenseAccounts WHERE id = ? AND businessId = ? LIMIT 1)`).bind(businessId, accountId, businessId).first();
      if (Number(refs?.count || 0) > 0) throw new PolicyError("Expense accounts with expense history cannot be deleted.", 409);
      await env.DB.prepare(`DELETE FROM expenseAccounts WHERE id = ? AND businessId = ?`).bind(accountId, businessId).run();
      return json10({ success: true, accountId });
    }
    const account = body?.account || body || {};
    const name = trimText7(account.name, 120);
    if (!name) return json10({ error: "Expense account name is required." }, 400);
    const now = Date.now();
    const id = trimText7(account.id || body?.accountId, 160) || crypto.randomUUID();
    const saved = { id, name, description: trimText7(account.description, 240), businessId, updated_at: now };
    await env.DB.prepare(`INSERT OR REPLACE INTO expenseAccounts (id, name, description, businessId, updated_at) VALUES (?, ?, ?, ?, ?)`).bind(saved.id, saved.name, saved.description, businessId, now).run();
    return json10({ success: true, account: saved });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json10({ error: err?.message || "Could not update expense account." }, status);
  }
}, "onRequestPost");

// api/catalog/service-item.ts
var MANAGER_ROLES3 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders12 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json11(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders12 } });
}
__name(json11, "json");
function trimText8(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText8, "trimText");
function isActiveValue(value) {
  return value === false || value === 0 || value === "0" ? 0 : 1;
}
__name(isActiveValue, "isActiveValue");
function asNumber4(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber4, "asNumber");
async function ensureSchema5(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS serviceItems (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      price REAL NOT NULL,
      taxCategory TEXT DEFAULT 'A',
      isActive INTEGER DEFAULT 1,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    "ALTER TABLE serviceItems ADD COLUMN category TEXT",
    "ALTER TABLE serviceItems ADD COLUMN description TEXT",
    "ALTER TABLE serviceItems ADD COLUMN price REAL DEFAULT 0",
    "ALTER TABLE serviceItems ADD COLUMN taxCategory TEXT DEFAULT 'A'",
    "ALTER TABLE serviceItems ADD COLUMN isActive INTEGER DEFAULT 1",
    "ALTER TABLE serviceItems ADD COLUMN businessId TEXT",
    "ALTER TABLE serviceItems ADD COLUMN updated_at INTEGER"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureSchema5, "ensureSchema");
var onRequestOptions10 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders12 }), "onRequestOptions");
var onRequestPost10 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json11({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !MANAGER_ROLES3.has(auth.principal.role)) return json11({ error: "You are not allowed to manage services." }, 403);
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || auth.principal.businessId || "").trim();
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json11({ error: "Access denied." }, 403);
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || auth.principal.branchId || "").trim();
    if (branchId && !canAccessBranch(auth.principal, branchId)) return json11({ error: "Branch access denied." }, 403);
    const service = body?.service || body || {};
    const name = trimText8(service.name, 120);
    if (!name) return json11({ error: "Service name is required." }, 400);
    const price = Math.max(0, asNumber4(service.price));
    const now = Date.now();
    const id = trimText8(service.id || body?.serviceId, 160) || `service_${businessId}_${crypto.randomUUID()}`;
    await ensureSchema5(env.DB);
    const existing = await env.DB.prepare(`
      SELECT id
      FROM serviceItems
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(id, businessId).first();
    const saved = {
      id,
      name,
      category: trimText8(service.category, 120) || "General",
      description: trimText8(service.description, 500) || null,
      price,
      taxCategory: service.taxCategory === "A" ? "A" : "E",
      isActive: isActiveValue(service.isActive),
      businessId,
      updated_at: now
    };
    await env.DB.batch([
      env.DB.prepare(`INSERT OR REPLACE INTO serviceItems (id, name, category, description, price, taxCategory, isActive, businessId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(saved.id, saved.name, saved.category, saved.description, saved.price, saved.taxCategory, saved.isActive, businessId, now),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        existing ? "catalog.service.update" : "catalog.service.create",
        "serviceItem",
        id,
        "INFO",
        `${existing ? "Updated" : "Created"} service ${name}.`,
        businessId,
        branchId || null,
        now
      )
    ]);
    return json11({ success: true, service: saved });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json11({ error: err?.message || "Could not update service." }, status);
  }
}, "onRequestPost");

// api/close/day.ts
var CLOSE_DAY_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders13 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json12(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders13 } });
}
__name(json12, "json");
function n(value, fallback = 0) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}
__name(n, "n");
function nonNegative(value) {
  return Math.max(0, n(value));
}
__name(nonNegative, "nonNegative");
function dayStartMs(value = Date.now()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
__name(dayStartMs, "dayStartMs");
async function ensureCloseDaySchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS dailySummaries (
      id TEXT PRIMARY KEY,
      date INTEGER NOT NULL,
      shiftIds TEXT NOT NULL,
      totalSales REAL NOT NULL DEFAULT 0,
      grossSales REAL NOT NULL DEFAULT 0,
      taxTotal REAL NOT NULL DEFAULT 0,
      totalExpenses REAL NOT NULL DEFAULT 0,
      totalPicks REAL NOT NULL DEFAULT 0,
      totalVariance REAL NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    "ALTER TABLE dailySummaries ADD COLUMN grossSales REAL",
    "ALTER TABLE dailySummaries ADD COLUMN taxTotal REAL",
    "ALTER TABLE dailySummaries ADD COLUMN totalExpenses REAL",
    "ALTER TABLE dailySummaries ADD COLUMN totalPicks REAL",
    "ALTER TABLE dailySummaries ADD COLUMN totalVariance REAL",
    "ALTER TABLE dailySummaries ADD COLUMN branchId TEXT",
    "ALTER TABLE dailySummaries ADD COLUMN businessId TEXT",
    "ALTER TABLE dailySummaries ADD COLUMN updated_at INTEGER"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureCloseDaySchema, "ensureCloseDaySchema");
var onRequestOptions11 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders13 }), "onRequestOptions");
var onRequestPost11 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json12({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !CLOSE_DAY_ROLES.has(auth.principal.role)) throw new PolicyError("You are not allowed to close the business day.", 403);
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    if (!businessId || !branchId || !canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json12({ error: "Access denied." }, 403);
    await ensureCloseDaySchema(env.DB);
    const now = Date.now();
    const summary = body?.summary || {};
    const summaryDate = dayStartMs(n(summary.date, now) || now);
    const existing = await env.DB.prepare(`
      SELECT id
      FROM dailySummaries
      WHERE businessId = ? AND branchId = ? AND date = ?
      LIMIT 1
    `).bind(businessId, branchId, summaryDate).first();
    if (existing) return json12({ success: true, summaryId: existing.id, idempotent: true });
    const id = String(body?.summaryId || `day_${businessId}_${branchId}_${new Date(summaryDate).toISOString().slice(0, 10)}`).trim();
    const totalSales = nonNegative(summary.totalSales);
    const grossSales = nonNegative(summary.grossSales);
    const taxTotal = nonNegative(summary.taxTotal);
    const totalExpenses = nonNegative(summary.totalExpenses);
    const totalPicks = nonNegative(summary.totalPicks);
    const totalVariance = n(summary.totalVariance);
    await env.DB.prepare(`
      INSERT INTO dailySummaries (id, date, shiftIds, totalSales, grossSales, taxTotal, totalExpenses, totalPicks, totalVariance, timestamp, branchId, businessId, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, summaryDate, JSON.stringify(Array.isArray(summary.shiftIds) ? summary.shiftIds : []), totalSales, grossSales, taxTotal, totalExpenses, totalPicks, totalVariance, now, branchId, businessId, now).run();
    await env.DB.prepare(`
      INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      now,
      auth.principal.userId || null,
      auth.principal.userName || null,
      "report.day.close",
      "dailySummary",
      id,
      totalVariance === 0 ? "INFO" : "WARN",
      `Closed business day ${new Date(summaryDate).toISOString().slice(0, 10)} with sales Ksh ${totalSales.toLocaleString()} and variance Ksh ${totalVariance.toLocaleString()}.`,
      businessId,
      branchId,
      now
    ).run();
    return json12({ success: true, summaryId: id, idempotent: false });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json12({ error: err?.message || "Could not close day." }, status);
  }
}, "onRequestPost");

// api/close/shift.ts
var CLOSE_SHIFT_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER", "CASHIER"]);
var corsHeaders14 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json13(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders14 } });
}
__name(json13, "json");
function n2(value, fallback = 0) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}
__name(n2, "n");
function s(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(s, "s");
function nonNegative2(value) {
  return Math.max(0, n2(value));
}
__name(nonNegative2, "nonNegative");
async function ensureCloseShiftSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS endOfDayReports (
      id TEXT PRIMARY KEY,
      shiftId TEXT,
      timestamp INTEGER NOT NULL,
      openingFloat REAL,
      totalSales REAL NOT NULL DEFAULT 0,
      grossSales REAL NOT NULL DEFAULT 0,
      taxTotal REAL NOT NULL DEFAULT 0,
      cashSales REAL NOT NULL DEFAULT 0,
      mpesaSales REAL NOT NULL DEFAULT 0,
      totalExpenses REAL NOT NULL DEFAULT 0,
      totalPicks REAL NOT NULL DEFAULT 0,
      totalRefunds REAL,
      expectedCash REAL NOT NULL DEFAULT 0,
      reportedCash REAL NOT NULL DEFAULT 0,
      difference REAL NOT NULL DEFAULT 0,
      cashierName TEXT NOT NULL,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      startTime INTEGER NOT NULL,
      endTime INTEGER,
      openingFloat REAL,
      cashierName TEXT NOT NULL,
      status TEXT NOT NULL,
      branchId TEXT,
      lastSyncAt INTEGER,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    "ALTER TABLE endOfDayReports ADD COLUMN shiftId TEXT",
    "ALTER TABLE endOfDayReports ADD COLUMN openingFloat REAL",
    "ALTER TABLE endOfDayReports ADD COLUMN totalRefunds REAL",
    "ALTER TABLE endOfDayReports ADD COLUMN branchId TEXT",
    "ALTER TABLE endOfDayReports ADD COLUMN businessId TEXT",
    "ALTER TABLE endOfDayReports ADD COLUMN updated_at INTEGER",
    "ALTER TABLE shifts ADD COLUMN openingFloat REAL",
    "ALTER TABLE shifts ADD COLUMN lastSyncAt INTEGER",
    "ALTER TABLE shifts ADD COLUMN branchId TEXT",
    "ALTER TABLE shifts ADD COLUMN businessId TEXT",
    "ALTER TABLE shifts ADD COLUMN updated_at INTEGER"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureCloseShiftSchema, "ensureCloseShiftSchema");
var onRequestOptions12 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders14 }), "onRequestOptions");
var onRequestPost12 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json13({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !CLOSE_SHIFT_ROLES.has(auth.principal.role)) throw new PolicyError("You are not allowed to close shifts.", 403);
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    if (!businessId || !branchId || !canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json13({ error: "Access denied." }, 403);
    await ensureCloseShiftSchema(env.DB);
    const now = Date.now();
    const report = body?.report || {};
    const shiftId = s(body?.shiftId || report.shiftId, 160) || `shift_${branchId}_${new Date(now).toISOString().slice(0, 10)}_${auth.principal.userId || "staff"}`;
    const existing = await env.DB.prepare(`
      SELECT id, shiftId
      FROM endOfDayReports
      WHERE businessId = ? AND branchId = ? AND shiftId = ?
      LIMIT 1
    `).bind(businessId, branchId, shiftId).first();
    if (existing) return json13({ success: true, reportId: existing.id, shiftId: existing.shiftId || shiftId, idempotent: true });
    const reportId = s(body?.reportId, 160) || `eod_${businessId}_${branchId}_${shiftId}`;
    const cashierName = s(report.cashierName || body?.cashierName || auth.principal.userName, 120) || "Staff";
    const totalSales = nonNegative2(report.totalSales);
    const grossSales = nonNegative2(report.grossSales);
    const taxTotal = nonNegative2(report.taxTotal);
    const cashSales = nonNegative2(report.cashSales);
    const mpesaSales = nonNegative2(report.mpesaSales);
    const totalExpenses = nonNegative2(report.totalExpenses);
    const totalPicks = nonNegative2(report.totalPicks);
    const totalRefunds = nonNegative2(report.totalRefunds);
    const expectedCash = nonNegative2(report.expectedCash);
    const reportedCash = nonNegative2(report.reportedCash);
    const difference = n2(report.difference, reportedCash - expectedCash);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO endOfDayReports (id, shiftId, timestamp, totalSales, grossSales, taxTotal, cashSales, mpesaSales, totalExpenses, totalPicks, totalRefunds, expectedCash, reportedCash, difference, cashierName, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(reportId, shiftId, now, totalSales, grossSales, taxTotal, cashSales, mpesaSales, totalExpenses, totalPicks, totalRefunds, expectedCash, reportedCash, difference, cashierName, branchId, businessId, now),
      env.DB.prepare(`
        INSERT INTO shifts (id, startTime, endTime, cashierName, status, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          endTime = excluded.endTime,
          cashierName = excluded.cashierName,
          status = excluded.status,
          branchId = excluded.branchId,
          businessId = excluded.businessId,
          updated_at = excluded.updated_at
      `).bind(shiftId, n2(body?.startTime || report.startTime || now), now, cashierName, "CLOSED", branchId, businessId, now),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "report.shift.close",
        "endOfDayReport",
        reportId,
        difference === 0 ? "INFO" : "WARN",
        `Closed shift ${shiftId} with reported cash Ksh ${reportedCash.toLocaleString()} and variance Ksh ${difference.toLocaleString()}.`,
        businessId,
        branchId,
        now
      )
    ]);
    return json13({ success: true, reportId, shiftId, idempotent: false });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json13({ error: err?.message || "Could not close shift." }, status);
  }
}, "onRequestPost");

// api/customers/payment.ts
var PAYMENT_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER", "CASHIER"]);
var PAYMENT_METHODS = /* @__PURE__ */ new Set(["CASH", "MPESA", "BANK", "PDQ", "CHEQUE"]);
var corsHeaders15 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json14(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders15 }
  });
}
__name(json14, "json");
function asNumber5(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber5, "asNumber");
function roundMoney2(value) {
  return Math.round(value * 100) / 100;
}
__name(roundMoney2, "roundMoney");
function trimText9(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText9, "trimText");
function parseAllocations(value) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? (() => {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })() : [];
  return raw.map((row) => {
    const sourceType = String(row?.sourceType || "").toUpperCase();
    const sourceId = trimText9(row?.sourceId, 160);
    const amount = roundMoney2(asNumber5(row?.amount));
    if (sourceType !== "SALE" && sourceType !== "INVOICE" || !sourceId || amount <= 0) return null;
    return { sourceType, sourceId, amount };
  }).filter(Boolean).slice(0, 100);
}
__name(parseAllocations, "parseAllocations");
function parseMaybeJson2(value) {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
__name(parseMaybeJson2, "parseMaybeJson");
function creditAmountForSale(row) {
  const total = asNumber5(row.total);
  const method = String(row.paymentMethod || "").toUpperCase();
  if (method === "CREDIT") return total;
  const splitPayments = parseMaybeJson2(row.splitPayments);
  if (method === "SPLIT" && String(splitPayments?.secondaryMethod || "").toUpperCase() === "CREDIT") {
    return roundMoney2(Math.min(Math.max(0, asNumber5(splitPayments?.secondaryAmount)), total));
  }
  return 0;
}
__name(creditAmountForSale, "creditAmountForSale");
async function ensureSchema6(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS customerPayments (
      id TEXT PRIMARY KEY,
      customerId TEXT NOT NULL,
      amount REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      transactionCode TEXT,
      reference TEXT,
      allocations TEXT,
      timestamp INTEGER NOT NULL,
      preparedBy TEXT,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    "ALTER TABLE customerPayments ADD COLUMN transactionCode TEXT",
    "ALTER TABLE customerPayments ADD COLUMN reference TEXT",
    "ALTER TABLE customerPayments ADD COLUMN allocations TEXT",
    "ALTER TABLE customerPayments ADD COLUMN preparedBy TEXT",
    "ALTER TABLE customerPayments ADD COLUMN branchId TEXT",
    "ALTER TABLE customerPayments ADD COLUMN businessId TEXT",
    "ALTER TABLE customerPayments ADD COLUMN updated_at INTEGER"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureSchema6, "ensureSchema");
var onRequestOptions13 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders15 }), "onRequestOptions");
var onRequestPost13 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json14({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !PAYMENT_ROLES.has(auth.principal.role)) {
      return json14({ error: "You are not allowed to record customer payments." }, 403);
    }
    const body = await request.json().catch(() => null);
    const payment = body?.payment || body || {};
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || payment.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || payment.branchId || "").trim();
    const customerId = String(payment.customerId || body?.customerId || "").trim();
    if (!businessId || !branchId || !customerId) return json14({ error: "Business, branch and customer are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json14({ error: "Access denied." }, 403);
    }
    await ensureSchema6(env.DB);
    const customer = await env.DB.prepare(`
      SELECT id, name, balance, branchId
      FROM customers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(customerId, businessId).first();
    if (!customer) throw new PolicyError("Customer was not found.", 404);
    if (customer.branchId && customer.branchId !== branchId) throw new PolicyError("Customer belongs to another branch.", 403);
    const paymentId = trimText9(payment.id, 160) || crypto.randomUUID();
    const existingPayment = await env.DB.prepare(`
      SELECT id, customerId, amount
      FROM customerPayments
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(paymentId, businessId, branchId).first();
    if (existingPayment) {
      if (existingPayment.customerId !== customerId) throw new PolicyError("Payment ID is already used for another customer.", 409);
      return json14({
        success: true,
        paymentId,
        customerId,
        amount: roundMoney2(asNumber5(existingPayment.amount)),
        customerBalance: roundMoney2(asNumber5(customer.balance)),
        allocationCount: 0,
        idempotent: true
      });
    }
    const amount = roundMoney2(asNumber5(payment.amount));
    if (amount <= 0) throw new PolicyError("Enter a valid payment amount.", 400);
    if (amount > asNumber5(customer.balance) + 0.01) throw new PolicyError("Payment cannot exceed the customer balance.", 409);
    const method = String(payment.paymentMethod || payment.method || "CASH").toUpperCase();
    const paymentMethod = PAYMENT_METHODS.has(method) ? method : "CASH";
    const allocations = parseAllocations(payment.allocations);
    const allocationTotal = roundMoney2(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
    if (allocationTotal > amount + 0.01) throw new PolicyError("Payment allocations exceed the payment amount.", 400);
    const requestedBySource = /* @__PURE__ */ new Map();
    for (const allocation of allocations) {
      const key = `${allocation.sourceType}:${allocation.sourceId}`;
      const existing = requestedBySource.get(key);
      requestedBySource.set(key, {
        ...allocation,
        amount: roundMoney2((existing?.amount || 0) + allocation.amount)
      });
    }
    const paidBySource = /* @__PURE__ */ new Map();
    if (requestedBySource.size > 0) {
      const { results } = await env.DB.prepare(`
        SELECT allocations
        FROM customerPayments
        WHERE customerId = ? AND businessId = ? AND branchId = ?
      `).bind(customerId, businessId, branchId).all();
      for (const row of results || []) {
        for (const allocation of parseAllocations(row.allocations)) {
          const key = `${allocation.sourceType}:${allocation.sourceId}`;
          paidBySource.set(key, roundMoney2((paidBySource.get(key) || 0) + allocation.amount));
        }
      }
    }
    for (const allocation of requestedBySource.values()) {
      if (allocation.sourceType === "INVOICE") {
        const invoice = await env.DB.prepare(`
          SELECT id, customerId, balance, status
          FROM salesInvoices
          WHERE id = ? AND businessId = ? AND branchId = ?
          LIMIT 1
        `).bind(allocation.sourceId, businessId, branchId).first();
        if (!invoice || invoice.customerId !== customerId) throw new PolicyError("Payment allocation refers to an invoice that was not found.", 404);
        if (invoice.status === "CANCELLED") throw new PolicyError("Cannot allocate payment to a cancelled invoice.", 409);
        if (allocation.amount > asNumber5(invoice.balance) + 0.01) throw new PolicyError("Payment allocation exceeds an invoice balance.", 409);
        continue;
      }
      const sale = await env.DB.prepare(`
        SELECT id, customerId, total, paymentMethod, splitPayments, status
        FROM transactions
        WHERE id = ? AND businessId = ? AND branchId = ?
        LIMIT 1
      `).bind(allocation.sourceId, businessId, branchId).first();
      if (!sale || sale.customerId !== customerId) throw new PolicyError("Payment allocation refers to a sale that was not found.", 404);
      if (sale.status === "VOIDED" || sale.status === "QUOTE") throw new PolicyError("Cannot allocate payment to a non-credit sale.", 409);
      const creditTotal = creditAmountForSale(sale);
      if (creditTotal <= 0) throw new PolicyError("Payment allocation refers to a sale without customer credit.", 409);
      const alreadyPaid = paidBySource.get(`SALE:${allocation.sourceId}`) || 0;
      if (allocation.amount > Math.max(0, creditTotal - alreadyPaid) + 0.01) {
        throw new PolicyError("Payment allocation exceeds a sale credit balance.", 409);
      }
    }
    const now = Date.now();
    const statements = [
      env.DB.prepare(`
        INSERT INTO customerPayments (id, customerId, amount, paymentMethod, transactionCode, reference, allocations, timestamp, preparedBy, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        paymentId,
        customerId,
        amount,
        paymentMethod,
        trimText9(payment.transactionCode || payment.referenceCode, 80) || null,
        trimText9(payment.reference, 180) || `${paymentMethod} payment from ${customer.name}`,
        allocations.length ? JSON.stringify(allocations) : null,
        asNumber5(payment.timestamp, now),
        trimText9(payment.preparedBy || body?.preparedBy || auth.principal.userName, 120) || "Staff",
        branchId,
        businessId,
        now
      ),
      env.DB.prepare(`UPDATE customers SET balance = MAX(0, COALESCE(balance, 0) - ?), updated_at = ? WHERE id = ? AND businessId = ?`).bind(amount, now, customerId, businessId)
    ];
    for (const allocation of allocations) {
      if (allocation.sourceType !== "INVOICE") continue;
      statements.push(
        env.DB.prepare(`
          UPDATE salesInvoices
          SET paidAmount = MIN(COALESCE(total, 0), COALESCE(paidAmount, 0) + ?),
              balance = MAX(0, COALESCE(balance, total, 0) - ?),
              status = CASE WHEN MAX(0, COALESCE(balance, total, 0) - ?) <= 0 THEN 'PAID' ELSE 'PARTIAL' END,
              updated_at = ?
          WHERE id = ? AND customerId = ? AND businessId = ? AND branchId = ?
        `).bind(allocation.amount, allocation.amount, allocation.amount, now, allocation.sourceId, customerId, businessId, branchId)
      );
    }
    statements.push(
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "customer.payment.record",
        "customerPayment",
        paymentId,
        "INFO",
        `Recorded Ksh ${amount.toLocaleString()} payment for ${customer.name}.`,
        businessId,
        branchId,
        now
      )
    );
    await env.DB.batch(statements);
    return json14({
      success: true,
      paymentId,
      customerId,
      amount,
      customerBalance: Math.max(0, roundMoney2(asNumber5(customer.balance) - amount)),
      allocationCount: allocations.length
    });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json14({ error: err?.message || "Could not record customer payment." }, status);
  }
}, "onRequestPost");

// api/customers/profile.ts
var SAVE_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER", "CASHIER"]);
var DELETE_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders16 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json15(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders16 }
  });
}
__name(json15, "json");
function trimText10(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText10, "trimText");
async function ensureSchema7(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      totalSpent REAL,
      balance REAL,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    "ALTER TABLE customers ADD COLUMN phone TEXT",
    "ALTER TABLE customers ADD COLUMN email TEXT",
    "ALTER TABLE customers ADD COLUMN totalSpent REAL",
    "ALTER TABLE customers ADD COLUMN balance REAL",
    "ALTER TABLE customers ADD COLUMN branchId TEXT",
    "ALTER TABLE customers ADD COLUMN businessId TEXT",
    "ALTER TABLE customers ADD COLUMN updated_at INTEGER"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureSchema7, "ensureSchema");
var onRequestOptions14 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders16 }), "onRequestOptions");
var onRequestPost14 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json15({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    const action = String(body?.action || "SAVE").trim().toUpperCase();
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const customerId = trimText10(body?.customerId || body?.customer?.id, 160);
    if (!businessId || !branchId) return json15({ error: "Business and branch are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json15({ error: "Access denied." }, 403);
    }
    await ensureSchema7(env.DB);
    const now = Date.now();
    if (action === "DELETE") {
      if (!auth.service && !DELETE_ROLES.has(auth.principal.role)) {
        return json15({ error: "You are not allowed to delete customers." }, 403);
      }
      if (!customerId) return json15({ error: "Customer is required." }, 400);
      const customer2 = await env.DB.prepare(`
        SELECT id, name, balance, branchId
        FROM customers
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(customerId, businessId).first();
      if (!customer2) throw new PolicyError("Customer was not found.", 404);
      if (customer2.branchId && customer2.branchId !== branchId) throw new PolicyError("Customer belongs to another branch.", 403);
      if (Number(customer2.balance || 0) > 0.01) throw new PolicyError("Customers with an outstanding balance cannot be deleted.", 409);
      const refs = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM transactions WHERE customerId = ? AND businessId = ?) +
          (SELECT COUNT(*) FROM salesInvoices WHERE customerId = ? AND businessId = ?) +
          (SELECT COUNT(*) FROM customerPayments WHERE customerId = ? AND businessId = ?) AS count
      `).bind(customerId, businessId, customerId, businessId, customerId, businessId).first();
      if (Number(refs?.count || 0) > 0) throw new PolicyError("Customers with history should be kept for audit records.", 409);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM customers WHERE id = ? AND businessId = ?`).bind(customerId, businessId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, "customer.delete", "customer", customerId, "WARN", `Deleted customer ${customer2.name}.`, businessId, branchId, now)
      ]);
      return json15({ success: true, customerId });
    }
    if (!auth.service && !SAVE_ROLES.has(auth.principal.role)) {
      return json15({ error: "You are not allowed to save customers." }, 403);
    }
    const customer = body?.customer || body || {};
    const name = trimText10(customer.name, 120);
    if (!name) return json15({ error: "Customer name is required." }, 400);
    const id = customerId || crypto.randomUUID();
    const existing = await env.DB.prepare(`
      SELECT *
      FROM customers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(id, businessId).first();
    if (existing?.branchId && existing.branchId !== branchId) throw new PolicyError("Customer belongs to another branch.", 403);
    const savedCustomer = {
      id,
      name,
      phone: trimText10(customer.phone, 40),
      email: trimText10(customer.email, 120),
      totalSpent: Number(existing?.totalSpent || 0),
      balance: Number(existing?.balance || 0),
      branchId: existing?.branchId || branchId,
      businessId,
      updated_at: now
    };
    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR REPLACE INTO customers (id, name, phone, email, totalSpent, balance, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(savedCustomer.id, savedCustomer.name, savedCustomer.phone, savedCustomer.email, savedCustomer.totalSpent, savedCustomer.balance, savedCustomer.branchId, savedCustomer.businessId, now),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, existing ? "customer.update" : "customer.create", "customer", id, "INFO", `${existing ? "Updated" : "Created"} customer ${name}.`, businessId, branchId, now)
    ]);
    return json15({ success: true, customer: savedCustomer });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json15({ error: err?.message || "Could not save customer." }, status);
  }
}, "onRequestPost");

// api/expenses/_expenseOps.ts
var APPROVER_ROLES2 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var STAFF_ROLES3 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER", "CASHIER"]);
function asNumber6(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber6, "asNumber");
function trimText11(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText11, "trimText");
function deserializeRow2(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}
__name(deserializeRow2, "deserializeRow");
async function insertStatement(db, table, item) {
  const { results: pragma } = await db.prepare(`PRAGMA table_info('${table}')`).all();
  const validCols = new Set(pragma.map((r) => r.name));
  const cols = Object.keys(item).filter((k) => validCols.has(k));
  if (cols.length === 0) throw new PolicyError(`No valid ${table} columns to save.`, 400);
  const sql = `INSERT INTO ${table} (${cols.map((c) => '"' + c + '"').join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  return db.prepare(sql).bind(...cols.map((col) => {
    const value = item[col];
    if (value === null || value === void 0) return null;
    return typeof value === "object" ? JSON.stringify(value) : value;
  }));
}
__name(insertStatement, "insertStatement");
async function ensureExpenseActionSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      amount REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'General',
      description TEXT,
      timestamp INTEGER NOT NULL,
      userName TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      source TEXT,
      accountId TEXT,
      productId TEXT,
      quantity REAL,
      preparedBy TEXT,
      approvedBy TEXT,
      shiftId TEXT,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS financialAccounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      businessId TEXT,
      branchId TEXT,
      accountNumber TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      sellingPrice REAL NOT NULL DEFAULT 0,
      costPrice REAL,
      taxCategory TEXT NOT NULL DEFAULT 'A',
      stockQuantity REAL NOT NULL DEFAULT 0,
      unit TEXT,
      barcode TEXT NOT NULL DEFAULT '',
      imageUrl TEXT,
      reorderPoint REAL,
      isBundle INTEGER DEFAULT 0,
      components TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    "ALTER TABLE expenses ADD COLUMN source TEXT",
    "ALTER TABLE expenses ADD COLUMN accountId TEXT",
    "ALTER TABLE expenses ADD COLUMN productId TEXT",
    "ALTER TABLE expenses ADD COLUMN quantity REAL",
    "ALTER TABLE expenses ADD COLUMN preparedBy TEXT",
    "ALTER TABLE expenses ADD COLUMN approvedBy TEXT",
    "ALTER TABLE expenses ADD COLUMN shiftId TEXT",
    "ALTER TABLE expenses ADD COLUMN branchId TEXT",
    "ALTER TABLE expenses ADD COLUMN businessId TEXT",
    "ALTER TABLE expenses ADD COLUMN updated_at INTEGER",
    "ALTER TABLE financialAccounts ADD COLUMN branchId TEXT",
    "ALTER TABLE financialAccounts ADD COLUMN accountNumber TEXT",
    "ALTER TABLE financialAccounts ADD COLUMN updated_at INTEGER",
    "ALTER TABLE products ADD COLUMN businessId TEXT",
    "ALTER TABLE products ADD COLUMN branchId TEXT",
    "ALTER TABLE products ADD COLUMN updated_at INTEGER",
    "ALTER TABLE stockMovements ADD COLUMN branchId TEXT",
    "ALTER TABLE stockMovements ADD COLUMN businessId TEXT",
    "ALTER TABLE stockMovements ADD COLUMN shiftId TEXT",
    "ALTER TABLE stockMovements ADD COLUMN updated_at INTEGER"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureExpenseActionSchema, "ensureExpenseActionSchema");
function sameExpenseIdentity(existing, next) {
  return asNumber6(existing.amount) === asNumber6(next.amount) && String(existing.source || "TILL").toUpperCase() === String(next.source || "TILL").toUpperCase() && trimText11(existing.accountId || "", 120) === trimText11(next.accountId || "", 120) && trimText11(existing.productId || "", 120) === trimText11(next.productId || "", 120) && asNumber6(existing.quantity, 0) === asNumber6(next.quantity, 0);
}
__name(sameExpenseIdentity, "sameExpenseIdentity");
function auditStatement(db, args) {
  const now = Date.now();
  return db.prepare(`
    INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    now,
    args.principal.userId || null,
    args.principal.userName || null,
    args.action,
    "expense",
    args.expenseId,
    args.severity,
    args.details,
    args.businessId,
    args.branchId,
    now
  );
}
__name(auditStatement, "auditStatement");
async function effectStatementsForApprovedExpense(db, businessId, branchId, expense) {
  const source = String(expense.source || "TILL").toUpperCase();
  const amount = asNumber6(expense.amount);
  const now = Date.now();
  if (source === "ACCOUNT") {
    const accountId = trimText11(expense.accountId, 120);
    if (!accountId) throw new PolicyError("Select the account paying this expense.", 400);
    const account = await db.prepare(`
      SELECT id, name, balance, branchId
      FROM financialAccounts
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(accountId, businessId).first();
    if (!account) throw new PolicyError("Selected payment account was not found.", 404);
    if (account.branchId && account.branchId !== branchId) throw new PolicyError("Selected account belongs to another branch.", 403);
    if (asNumber6(account.balance) < amount) {
      throw new PolicyError(`Insufficient funds in ${account.name}.`, 409);
    }
    return [
      db.prepare(`UPDATE financialAccounts SET balance = balance - ?, updated_at = ? WHERE id = ? AND businessId = ?`).bind(amount, now, accountId, businessId)
    ];
  }
  if (source === "SHOP") {
    const productId = trimText11(expense.productId, 120);
    const quantity = Math.max(0, asNumber6(expense.quantity, 1));
    if (!productId || quantity <= 0) throw new PolicyError("Select the stock item and quantity being expensed.", 400);
    const product = await db.prepare(`
      SELECT id, name, stockQuantity, branchId
      FROM products
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(productId, businessId).first();
    if (!product) throw new PolicyError("Selected shop item was not found.", 404);
    if (product.branchId && product.branchId !== branchId) throw new PolicyError("Selected stock item belongs to another branch.", 403);
    if (asNumber6(product.stockQuantity) < quantity) throw new PolicyError(`Insufficient stock for ${product.name}.`, 409);
    return [
      db.prepare(`UPDATE products SET stockQuantity = stockQuantity - ?, updated_at = ? WHERE id = ? AND businessId = ?`).bind(quantity, now, productId, businessId),
      db.prepare(`
        INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        productId,
        "OUT",
        quantity,
        now,
        `Expense: ${trimText11(expense.description || "Shop Use", 120)}`,
        branchId,
        businessId,
        expense.shiftId || null,
        now
      )
    ];
  }
  return [];
}
__name(effectStatementsForApprovedExpense, "effectStatementsForApprovedExpense");
async function prepareExpenseSubmit(db, args) {
  const { businessId, branchId, principal, service } = args;
  if (!service && !STAFF_ROLES3.has(principal.role)) throw new PolicyError("Staff access required.", 403);
  const now = Date.now();
  const expense = { ...args.expense || {} };
  expense.id = trimText11(expense.id || crypto.randomUUID(), 120);
  expense.amount = Math.round(asNumber6(expense.amount) * 100) / 100;
  if (expense.amount <= 0) throw new PolicyError("Expense amount must be more than zero.", 400);
  expense.category = trimText11(expense.category || "General", 120);
  expense.description = trimText11(expense.description, 240);
  expense.source = String(expense.source || "TILL").toUpperCase();
  expense.timestamp = Math.min(asNumber6(expense.timestamp, now), now + 5 * 60 * 1e3);
  expense.userName = trimText11(expense.userName || principal.userName, 120);
  expense.preparedBy = trimText11(expense.preparedBy || principal.userName, 120);
  expense.businessId = businessId;
  expense.branchId = branchId;
  expense.updated_at = now;
  const requestedApproved = String(expense.status || "").toUpperCase() === "APPROVED";
  const approved = requestedApproved && (service || APPROVER_ROLES2.has(principal.role));
  if (requestedApproved && !approved) throw new PolicyError("You are not allowed to approve expenses.", 403);
  expense.status = approved ? "APPROVED" : "PENDING";
  expense.approvedBy = approved ? trimText11(expense.approvedBy || principal.userName, 120) : null;
  const existing = await db.prepare(`
    SELECT *
    FROM expenses
    WHERE id = ? AND businessId = ? AND branchId = ?
    LIMIT 1
  `).bind(expense.id, businessId, branchId).first();
  if (existing) {
    const clean = deserializeRow2(existing);
    if (!sameExpenseIdentity(clean, expense)) {
      throw new PolicyError("Expense id is already used by a different expense.", 409);
    }
    return { expense: clean, statements: [], idempotent: true };
  }
  const statements = [await insertStatement(db, "expenses", expense)];
  if (approved) statements.push(...await effectStatementsForApprovedExpense(db, businessId, branchId, expense));
  statements.push(auditStatement(db, {
    principal,
    businessId,
    branchId,
    expenseId: expense.id,
    action: approved ? "expense.create.approved" : "expense.create.pending",
    severity: approved ? "INFO" : "WARN",
    details: `${approved ? "Approved" : "Created pending"} expense for Ksh ${expense.amount.toLocaleString()} (${expense.category}).`
  }));
  return { expense, statements, idempotent: false };
}
__name(prepareExpenseSubmit, "prepareExpenseSubmit");
async function prepareExpenseApproval(db, args) {
  const { businessId, branchId, principal, service } = args;
  if (!service && !APPROVER_ROLES2.has(principal.role)) throw new PolicyError("You are not allowed to approve expenses.", 403);
  const expense = await db.prepare(`
    SELECT *
    FROM expenses
    WHERE id = ? AND businessId = ? AND branchId = ?
    LIMIT 1
  `).bind(args.expenseId, businessId, branchId).first();
  if (!expense) throw new PolicyError("Expense was not found.", 404);
  const clean = deserializeRow2(expense);
  if (clean.status === "APPROVED") return { expense: clean, statements: [], idempotent: true };
  if (clean.status !== "PENDING") throw new PolicyError("This expense has already been processed.", 409);
  clean.status = "APPROVED";
  clean.approvedBy = trimText11(args.approvedBy || principal.userName, 120);
  clean.updated_at = Date.now();
  const statements = [
    db.prepare(`UPDATE expenses SET status = 'APPROVED', approvedBy = ?, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?`).bind(clean.approvedBy, clean.updated_at, clean.id, businessId, branchId),
    ...await effectStatementsForApprovedExpense(db, businessId, branchId, clean),
    auditStatement(db, {
      principal,
      businessId,
      branchId,
      expenseId: clean.id,
      action: "expense.approve",
      severity: "INFO",
      details: `Approved expense for Ksh ${asNumber6(clean.amount).toLocaleString()} (${clean.category || "General"}).`
    })
  ];
  return { expense: clean, statements, idempotent: false };
}
__name(prepareExpenseApproval, "prepareExpenseApproval");

// api/expenses/approve.ts
var corsHeaders17 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json16(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders17 }
  });
}
__name(json16, "json");
var onRequestOptions15 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders17 }), "onRequestOptions");
var onRequestPost15 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json16({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const expenseId = String(body?.expenseId || body?.id || "").trim();
    if (!businessId || !branchId || !expenseId) return json16({ error: "Business, branch and expense are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json16({ error: "Access denied." }, 403);
    }
    await ensureExpenseActionSchema(env.DB);
    const prepared = await prepareExpenseApproval(env.DB, {
      businessId,
      branchId,
      principal: auth.principal,
      service: auth.service,
      expenseId,
      approvedBy: body?.approvedBy
    });
    if (prepared.statements.length) await env.DB.batch(prepared.statements);
    return json16({ success: true, expense: prepared.expense, idempotent: prepared.idempotent });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json16({ error: err?.message || "Could not approve expense." }, status);
  }
}, "onRequestPost");

// api/expenses/delete.ts
var DELETE_ROLES2 = /* @__PURE__ */ new Set(["ROOT", "ADMIN"]);
var corsHeaders18 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json17(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders18 }
  });
}
__name(json17, "json");
async function ensureSchema8(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
}
__name(ensureSchema8, "ensureSchema");
var onRequestOptions16 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders18 }), "onRequestOptions");
var onRequestPost16 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json17({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !DELETE_ROLES2.has(auth.principal.role)) {
      return json17({ error: "You are not allowed to delete expenses." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const expenseId = String(body?.expenseId || body?.id || "").trim();
    if (!businessId || !branchId || !expenseId) return json17({ error: "Business, branch and expense are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json17({ error: "Access denied." }, 403);
    }
    await ensureSchema8(env.DB);
    const expense = await env.DB.prepare(`
      SELECT id, amount, status
      FROM expenses
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(expenseId, businessId, branchId).first();
    if (!expense) throw new PolicyError("Expense was not found.", 404);
    if (expense.status === "APPROVED") {
      throw new PolicyError("Approved expenses cannot be deleted because they already affected cash, account, or stock history.", 409);
    }
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM expenses WHERE id = ? AND businessId = ? AND branchId = ?`).bind(expenseId, businessId, branchId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "expense.delete",
        "expense",
        expenseId,
        "CRITICAL",
        `Deleted unapproved expense request of Ksh ${Number(expense.amount || 0).toLocaleString()}.`,
        businessId,
        branchId,
        now
      )
    ]);
    return json17({ success: true, expenseId });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json17({ error: err?.message || "Could not delete expense." }, status);
  }
}, "onRequestPost");

// api/expenses/reject.ts
var APPROVER_ROLES3 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders19 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json18(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders19 }
  });
}
__name(json18, "json");
async function ensureSchema9(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
}
__name(ensureSchema9, "ensureSchema");
var onRequestOptions17 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders19 }), "onRequestOptions");
var onRequestPost17 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json18({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !APPROVER_ROLES3.has(auth.principal.role)) {
      return json18({ error: "You are not allowed to reject expenses." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const expenseId = String(body?.expenseId || body?.id || "").trim();
    if (!businessId || !branchId || !expenseId) return json18({ error: "Business, branch and expense are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json18({ error: "Access denied." }, 403);
    }
    await ensureSchema9(env.DB);
    const expense = await env.DB.prepare(`
      SELECT id, amount, status
      FROM expenses
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(expenseId, businessId, branchId).first();
    if (!expense) throw new PolicyError("Expense was not found.", 404);
    if (expense.status === "REJECTED") return json18({ success: true, expenseId, idempotent: true });
    if (expense.status !== "PENDING") throw new PolicyError("This expense has already been processed.", 409);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE expenses SET status = 'REJECTED', updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?`).bind(now, expenseId, businessId, branchId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "expense.reject",
        "expense",
        expenseId,
        "WARN",
        `Rejected expense request of Ksh ${Number(expense.amount || 0).toLocaleString()}.`,
        businessId,
        branchId,
        now
      )
    ]);
    return json18({ success: true, expenseId, idempotent: false });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json18({ error: err?.message || "Could not reject expense." }, status);
  }
}, "onRequestPost");

// api/expenses/submit.ts
var corsHeaders20 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json19(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders20 }
  });
}
__name(json19, "json");
var onRequestOptions18 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders20 }), "onRequestOptions");
var onRequestPost18 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json19({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    const expense = body?.expense || body;
    const businessId = String(request.headers.get("X-Business-ID") || expense?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || expense?.branchId || "").trim();
    if (!businessId || !branchId) return json19({ error: "Business and branch are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json19({ error: "Access denied." }, 403);
    }
    await ensureExpenseActionSchema(env.DB);
    const prepared = await prepareExpenseSubmit(env.DB, {
      businessId,
      branchId,
      principal: auth.principal,
      service: auth.service,
      expense
    });
    if (prepared.statements.length) await env.DB.batch(prepared.statements);
    return json19({ success: true, expense: prepared.expense, idempotent: prepared.idempotent });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json19({ error: err?.message || "Could not save expense." }, status);
  }
}, "onRequestPost");

// api/finance/account.ts
var FINANCE_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN"]);
var corsHeaders21 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json20(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders21 }
  });
}
__name(json20, "json");
function asNumber7(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber7, "asNumber");
function roundMoney3(value) {
  return Math.round(value * 100) / 100;
}
__name(roundMoney3, "roundMoney");
function trimText12(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText12, "trimText");
async function ensureSchema10(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
}
__name(ensureSchema10, "ensureSchema");
var onRequestOptions19 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders21 }), "onRequestOptions");
var onRequestPost19 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json20({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !FINANCE_ROLES.has(auth.principal.role)) {
      return json20({ error: "You are not allowed to manage financial accounts." }, 403);
    }
    const body = await request.json().catch(() => null);
    const action = String(body?.action || "SAVE").trim().toUpperCase();
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    if (!businessId) return json20({ error: "Business is required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) return json20({ error: "Access denied." }, 403);
    if (branchId && !canAccessBranch(auth.principal, branchId)) return json20({ error: "Access denied." }, 403);
    await ensureSchema10(env.DB);
    const now = Date.now();
    if (action === "SAVE") {
      const account2 = body?.account || body || {};
      const name = trimText12(account2.name, 120);
      if (!name) return json20({ error: "Account name is required." }, 400);
      const id = trimText12(account2.id || body?.accountId, 160) || crypto.randomUUID();
      const existing = await env.DB.prepare(`
        SELECT *
        FROM financialAccounts
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(id, businessId).first();
      const accountBranchId = trimText12(account2.branchId, 160) || null;
      if (accountBranchId && !canAccessBranch(auth.principal, accountBranchId)) return json20({ error: "Access denied." }, 403);
      const type = ["BANK", "MPESA", "CASH"].includes(String(account2.type || "").toUpperCase()) ? String(account2.type).toUpperCase() : "BANK";
      const savedAccount = {
        id,
        name,
        type,
        accountNumber: trimText12(account2.accountNumber, 80) || null,
        balance: existing ? asNumber7(existing.balance) : roundMoney3(Math.max(0, asNumber7(account2.balance))),
        branchId: existing?.branchId || accountBranchId,
        businessId,
        updated_at: now
      };
      await env.DB.batch([
        env.DB.prepare(`
          INSERT OR REPLACE INTO financialAccounts (id, name, type, balance, businessId, branchId, accountNumber, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(savedAccount.id, savedAccount.name, savedAccount.type, savedAccount.balance, businessId, savedAccount.branchId, savedAccount.accountNumber, now),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, existing ? "finance.account.update" : "finance.account.create", "financialAccount", id, "INFO", `${existing ? "Updated" : "Created"} financial account ${name}.`, businessId, savedAccount.branchId, now)
      ]);
      return json20({ success: true, account: savedAccount });
    }
    const accountId = trimText12(body?.accountId || body?.id, 160);
    if (!accountId) return json20({ error: "Account is required." }, 400);
    const account = await env.DB.prepare(`
      SELECT *
      FROM financialAccounts
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(accountId, businessId).first();
    if (!account) throw new PolicyError("Account was not found.", 404);
    if (account.branchId && !canAccessBranch(auth.principal, account.branchId)) return json20({ error: "Access denied." }, 403);
    if (action === "DELETE") {
      if (Math.abs(asNumber7(account.balance)) > 0.01) throw new PolicyError("Only zero-balance accounts can be deleted.", 409);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM financialAccounts WHERE id = ? AND businessId = ?`).bind(accountId, businessId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, "finance.account.delete", "financialAccount", accountId, "WARN", `Deleted financial account ${account.name}.`, businessId, account.branchId || null, now)
      ]);
      return json20({ success: true, accountId });
    }
    if (action !== "DEPOSIT" && action !== "WITHDRAW") return json20({ error: "Unsupported finance action." }, 400);
    const amount = roundMoney3(asNumber7(body?.amount));
    if (amount <= 0) throw new PolicyError("Enter a valid amount.", 400);
    if (action === "WITHDRAW" && asNumber7(account.balance) < amount) throw new PolicyError(`Insufficient balance in ${account.name}.`, 409);
    const nextBalance = action === "DEPOSIT" ? roundMoney3(asNumber7(account.balance) + amount) : roundMoney3(asNumber7(account.balance) - amount);
    await env.DB.batch([
      env.DB.prepare(`UPDATE financialAccounts SET balance = ?, updated_at = ? WHERE id = ? AND businessId = ?`).bind(nextBalance, now, accountId, businessId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, action === "DEPOSIT" ? "finance.account.deposit" : "finance.account.withdraw", "financialAccount", accountId, action === "WITHDRAW" ? "WARN" : "INFO", `${action === "DEPOSIT" ? "Deposited" : "Withdrew"} Ksh ${amount.toLocaleString()} ${action === "DEPOSIT" ? "to" : "from"} ${account.name}.`, businessId, account.branchId || null, now)
    ]);
    return json20({ success: true, accountId, balance: nextBalance });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json20({ error: err?.message || "Could not update financial account." }, status);
  }
}, "onRequestPost");

// api/mpesa/transactions.ts
var corsHeaders22 = {
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json21(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders22 }
  });
}
__name(json21, "json");
async function ensureMpesaLedgerSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS mpesaCallbacks (
      checkoutRequestId TEXT PRIMARY KEY,
      merchantRequestId TEXT,
      resultCode INTEGER,
      resultDesc TEXT,
      amount REAL,
      receiptNumber TEXT,
      phoneNumber TEXT,
      businessId TEXT,
      branchId TEXT,
      timestamp INTEGER,
      utilizedTransactionId TEXT,
      utilizedCustomerId TEXT,
      utilizedCustomerName TEXT,
      utilizedAt INTEGER
    )
  `).run();
  for (const sql of [
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedTransactionId TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerId TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerName TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedAt INTEGER",
    "ALTER TABLE transactions ADD COLUMN mpesaCustomer TEXT",
    "ALTER TABLE transactions ADD COLUMN mpesaCheckoutRequestId TEXT",
    "CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, branchId, receiptNumber)",
    "CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_timestamp ON mpesaCallbacks(businessId, branchId, timestamp)"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureMpesaLedgerSchema, "ensureMpesaLedgerSchema");
var onRequestOptions20 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders22 }), "onRequestOptions");
var onRequestGet = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json21({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const url = new URL(request.url);
    const businessId = String(url.searchParams.get("businessId") || request.headers.get("X-Business-ID") || "").trim();
    const branchId = String(url.searchParams.get("branchId") || request.headers.get("X-Branch-ID") || "").trim();
    const from = Number(url.searchParams.get("from") || 0) || 0;
    const to = Number(url.searchParams.get("to") || 0) || 0;
    const search = String(url.searchParams.get("search") || "").trim().toUpperCase();
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200) || 200));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);
    if (!businessId || !branchId) return json21({ error: "Business and branch are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json21({ error: "Access denied" }, 403);
    await ensureMpesaLedgerSchema(env.DB);
    const clauses = ["m.businessId = ?", "m.branchId = ?", "COALESCE(m.resultCode, -1) = 0"];
    const bindings = [businessId, branchId];
    if (from) {
      clauses.push("m.timestamp >= ?");
      bindings.push(from);
    }
    if (to) {
      clauses.push("m.timestamp <= ?");
      bindings.push(to);
    }
    if (search) {
      clauses.push(`(
        UPPER(COALESCE(m.receiptNumber, '')) LIKE ?
        OR UPPER(COALESCE(m.checkoutRequestId, '')) LIKE ?
        OR UPPER(COALESCE(m.merchantRequestId, '')) LIKE ?
        OR UPPER(COALESCE(m.phoneNumber, '')) LIKE ?
        OR UPPER(COALESCE(m.resultDesc, '')) LIKE ?
        OR CAST(COALESCE(m.amount, 0) AS TEXT) LIKE ?
      )`);
      bindings.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const where = clauses.join(" AND ");
    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM mpesaCallbacks m WHERE ${where}`).bind(...bindings).first();
    const { results } = await env.DB.prepare(`
      SELECT
        m.*,
        COALESCE(m.utilizedTransactionId, (
          SELECT t.id
          FROM transactions t
          WHERE t.businessId = m.businessId
            AND t.branchId = m.branchId
            AND (
              (
                COALESCE(m.receiptNumber, '') != ''
                AND (
                  UPPER(COALESCE(t.mpesaCode, '')) = UPPER(m.receiptNumber)
                  OR UPPER(COALESCE(t.mpesaReference, '')) = UPPER(m.receiptNumber)
                )
              )
              OR (
                COALESCE(m.checkoutRequestId, '') != ''
                AND UPPER(COALESCE(t.mpesaCheckoutRequestId, '')) = UPPER(m.checkoutRequestId)
              )
            )
          LIMIT 1
        )) AS linkedTransactionId,
        COALESCE(m.utilizedCustomerName, (
          SELECT t.customerName
          FROM transactions t
          WHERE t.businessId = m.businessId
            AND t.branchId = m.branchId
            AND (
              (
                COALESCE(m.receiptNumber, '') != ''
                AND (
                  UPPER(COALESCE(t.mpesaCode, '')) = UPPER(m.receiptNumber)
                  OR UPPER(COALESCE(t.mpesaReference, '')) = UPPER(m.receiptNumber)
                )
              )
              OR (
                COALESCE(m.checkoutRequestId, '') != ''
                AND UPPER(COALESCE(t.mpesaCheckoutRequestId, '')) = UPPER(m.checkoutRequestId)
              )
            )
          LIMIT 1
        )) AS linkedCustomerName
      FROM mpesaCallbacks m
      WHERE ${where}
      ORDER BY m.timestamp DESC
      LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all();
    return json21({
      rows: (results || []).map((row) => {
        const linkedTransactionId = row.linkedTransactionId || null;
        return {
          checkoutRequestId: row.checkoutRequestId,
          merchantRequestId: row.merchantRequestId,
          receiptNumber: row.receiptNumber,
          amount: Number(row.amount || 0),
          phoneNumber: row.phoneNumber,
          resultCode: Number(row.resultCode),
          resultDesc: row.resultDesc,
          paymentStatus: "PAID",
          utilizationStatus: linkedTransactionId ? "UTILIZED" : "UNUTILIZED",
          linkedTransactionId,
          linkedReceiptNumber: linkedTransactionId ? String(linkedTransactionId).split("-")[0].toUpperCase() : null,
          linkedCustomerName: row.linkedCustomerName || null,
          utilizedAt: row.utilizedAt || null,
          timestamp: row.timestamp
        };
      }),
      total: Number(count?.count || 0),
      limit,
      offset
    });
  } catch (err) {
    console.error("[M-Pesa Transactions Error]", err);
    return json21({ error: err?.message || "Could not load M-Pesa transactions." }, 500);
  }
}, "onRequestGet");

// api/mpesa/utilize.ts
var corsHeaders23 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json22(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders23 }
  });
}
__name(json22, "json");
function normaliseCode(value) {
  return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
}
__name(normaliseCode, "normaliseCode");
function asNumber8(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber8, "asNumber");
function parseMaybeJson3(value) {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
__name(parseMaybeJson3, "parseMaybeJson");
async function ensureMpesaLedgerSchema2(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS mpesaCallbacks (
      checkoutRequestId TEXT PRIMARY KEY,
      merchantRequestId TEXT,
      resultCode INTEGER,
      resultDesc TEXT,
      amount REAL,
      receiptNumber TEXT,
      phoneNumber TEXT,
      businessId TEXT,
      branchId TEXT,
      timestamp INTEGER,
      utilizedTransactionId TEXT,
      utilizedCustomerId TEXT,
      utilizedCustomerName TEXT,
      utilizedAt INTEGER
    )
  `).run();
  for (const sql of [
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedTransactionId TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerId TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerName TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedAt INTEGER",
    "ALTER TABLE transactions ADD COLUMN mpesaCustomer TEXT",
    "ALTER TABLE transactions ADD COLUMN mpesaCheckoutRequestId TEXT",
    "CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, branchId, receiptNumber)",
    "CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_utilized ON mpesaCallbacks(businessId, branchId, utilizedTransactionId)"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureMpesaLedgerSchema2, "ensureMpesaLedgerSchema");
var onRequestOptions21 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders23 }), "onRequestOptions");
var onRequestPost20 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json22({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    const businessId = String(body?.businessId || request.headers.get("X-Business-ID") || "").trim();
    const branchId = String(body?.branchId || request.headers.get("X-Branch-ID") || "").trim();
    const transactionId = String(body?.transactionId || "").trim();
    const code = normaliseCode(body?.code);
    const customerId = String(body?.customerId || "").trim() || null;
    const customerName = String(body?.customerName || "").trim() || null;
    if (!businessId || !branchId || !transactionId || !code) {
      return json22({ error: "Business, branch, transaction and M-Pesa code are required." }, 400);
    }
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json22({ error: "Access denied" }, 403);
    await ensureMpesaLedgerSchema2(env.DB);
    const transaction = await env.DB.prepare(`
      SELECT id, customerId, customerName, total, paymentMethod, splitPayments
      FROM transactions
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(transactionId, businessId, branchId).first();
    if (!transaction) return json22({ error: "POS receipt not found for this M-Pesa utilization." }, 404);
    const payment = await env.DB.prepare(`
      SELECT *
      FROM mpesaCallbacks
      WHERE businessId = ?
        AND branchId = ?
        AND (
          UPPER(COALESCE(receiptNumber, '')) = ?
          OR UPPER(COALESCE(checkoutRequestId, '')) = ?
          OR UPPER(COALESCE(merchantRequestId, '')) = ?
        )
      ORDER BY CASE WHEN resultCode = 0 THEN 0 ELSE 1 END, timestamp DESC
      LIMIT 1
    `).bind(businessId, branchId, code, code, code).first();
    if (!payment) return json22({ error: "M-Pesa payment not found." }, 404);
    if (Number(payment.resultCode) !== 0) return json22({ error: payment.resultDesc || "M-Pesa payment is not paid." }, 409);
    const splitPayments = parseMaybeJson3(transaction.splitPayments);
    const expectedMpesaAmount2 = String(transaction.paymentMethod || "").toUpperCase() === "SPLIT" && String(splitPayments?.secondaryMethod || "").toUpperCase() === "MPESA" ? asNumber8(splitPayments?.secondaryAmount, 0) : asNumber8(transaction.total, 0);
    if (expectedMpesaAmount2 > 0 && asNumber8(payment.amount, 0) + 0.01 < expectedMpesaAmount2) {
      return json22({ error: `M-Pesa paid amount is below the receipt amount.` }, 409);
    }
    const existingLink = payment.utilizedTransactionId ? { id: payment.utilizedTransactionId } : await env.DB.prepare(`
          SELECT id
          FROM transactions
          WHERE businessId = ?
            AND branchId = ?
            AND id != ?
            AND (
              UPPER(COALESCE(mpesaCode, '')) = ?
              OR UPPER(COALESCE(mpesaReference, '')) = ?
              OR UPPER(COALESCE(mpesaCheckoutRequestId, '')) = ?
            )
          LIMIT 1
        `).bind(businessId, branchId, transactionId, code, code, code).first();
    if (existingLink?.id && existingLink.id !== transactionId) {
      return json22({ error: "This M-Pesa payment is already tied to another POS receipt." }, 409);
    }
    await env.DB.prepare(`
      UPDATE mpesaCallbacks
      SET utilizedTransactionId = ?,
          utilizedCustomerId = ?,
          utilizedCustomerName = ?,
          utilizedAt = ?
      WHERE checkoutRequestId = ?
    `).bind(
      transactionId,
      customerId || transaction.customerId || null,
      customerName || transaction.customerName || null,
      Date.now(),
      payment.checkoutRequestId
    ).run();
    return json22({ success: true, utilizationStatus: "UTILIZED" });
  } catch (err) {
    console.error("[M-Pesa Utilize Error]", err);
    return json22({ error: err?.message || "Could not mark M-Pesa payment as utilized." }, 500);
  }
}, "onRequestPost");

// api/mpesa/verify.ts
var corsHeaders24 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json23(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders24 }
  });
}
__name(json23, "json");
function normaliseCode2(value) {
  return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
}
__name(normaliseCode2, "normaliseCode");
function asNumber9(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber9, "asNumber");
async function ensureMpesaLedgerSchema3(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS mpesaCallbacks (
      checkoutRequestId TEXT PRIMARY KEY,
      merchantRequestId TEXT,
      resultCode INTEGER,
      resultDesc TEXT,
      amount REAL,
      receiptNumber TEXT,
      phoneNumber TEXT,
      businessId TEXT,
      branchId TEXT,
      timestamp INTEGER,
      utilizedTransactionId TEXT,
      utilizedCustomerId TEXT,
      utilizedCustomerName TEXT,
      utilizedAt INTEGER
    )
  `).run();
  for (const sql of [
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedTransactionId TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerId TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerName TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedAt INTEGER",
    "ALTER TABLE transactions ADD COLUMN mpesaCustomer TEXT",
    "ALTER TABLE transactions ADD COLUMN mpesaCheckoutRequestId TEXT",
    "CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, branchId, receiptNumber)",
    "CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_utilized ON mpesaCallbacks(businessId, branchId, utilizedTransactionId)"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureMpesaLedgerSchema3, "ensureMpesaLedgerSchema");
async function findPayment(db, businessId, branchId, code) {
  return db.prepare(`
    SELECT
      m.*,
      COALESCE(m.utilizedTransactionId, (
        SELECT t.id
        FROM transactions t
        WHERE t.businessId = m.businessId
          AND t.branchId = m.branchId
          AND (
            UPPER(COALESCE(t.mpesaCode, '')) = ?
            OR UPPER(COALESCE(t.mpesaReference, '')) = ?
            OR UPPER(COALESCE(t.mpesaCheckoutRequestId, '')) = ?
          )
        LIMIT 1
      )) AS linkedTransactionId,
      COALESCE(m.utilizedCustomerId, (
        SELECT t.customerId
        FROM transactions t
        WHERE t.businessId = m.businessId
          AND t.branchId = m.branchId
          AND (
            UPPER(COALESCE(t.mpesaCode, '')) = ?
            OR UPPER(COALESCE(t.mpesaReference, '')) = ?
            OR UPPER(COALESCE(t.mpesaCheckoutRequestId, '')) = ?
          )
        LIMIT 1
      )) AS linkedCustomerId,
      COALESCE(m.utilizedCustomerName, (
        SELECT t.customerName
        FROM transactions t
        WHERE t.businessId = m.businessId
          AND t.branchId = m.branchId
          AND (
            UPPER(COALESCE(t.mpesaCode, '')) = ?
            OR UPPER(COALESCE(t.mpesaReference, '')) = ?
            OR UPPER(COALESCE(t.mpesaCheckoutRequestId, '')) = ?
          )
        LIMIT 1
      )) AS linkedCustomerName
    FROM mpesaCallbacks m
    WHERE m.businessId = ?
      AND m.branchId = ?
      AND (
        UPPER(COALESCE(m.receiptNumber, '')) = ?
        OR UPPER(COALESCE(m.checkoutRequestId, '')) = ?
        OR UPPER(COALESCE(m.merchantRequestId, '')) = ?
      )
    ORDER BY CASE WHEN m.resultCode = 0 THEN 0 ELSE 1 END, m.timestamp DESC
    LIMIT 1
  `).bind(
    code,
    code,
    code,
    code,
    code,
    code,
    code,
    code,
    code,
    businessId,
    branchId,
    code,
    code,
    code
  ).first();
}
__name(findPayment, "findPayment");
var onRequestOptions22 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders24 }), "onRequestOptions");
var onRequestPost21 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json23({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    const businessId = String(body?.businessId || request.headers.get("X-Business-ID") || "").trim();
    const branchId = String(body?.branchId || request.headers.get("X-Branch-ID") || "").trim();
    const code = normaliseCode2(body?.code);
    const expectedAmount = asNumber9(body?.amount, 0);
    if (!businessId || !branchId) return json23({ error: "Business and branch are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json23({ error: "Access denied" }, 403);
    if (!code) return json23({ error: "Enter an M-Pesa receipt code." }, 400);
    await ensureMpesaLedgerSchema3(env.DB);
    const payment = await findPayment(env.DB, businessId, branchId, code);
    if (!payment) {
      return json23({
        found: false,
        paid: false,
        usable: false,
        utilizationStatus: "UNUTILIZED",
        message: "No matching M-Pesa payment has reached this branch yet. Check the code or wait for the Daraja callback."
      });
    }
    const paid = asNumber9(payment.resultCode, -1) === 0;
    const amount = asNumber9(payment.amount, 0);
    const amountOk = !expectedAmount || amount >= expectedAmount;
    const utilized = !!payment.linkedTransactionId;
    return json23({
      found: true,
      paid,
      usable: paid && amountOk && !utilized,
      utilizationStatus: utilized ? "UTILIZED" : "UNUTILIZED",
      paymentStatus: paid ? "PAID" : asNumber9(payment.resultCode, 999) === 999 ? "PENDING" : "FAILED",
      receiptNumber: payment.receiptNumber,
      checkoutRequestId: payment.checkoutRequestId,
      amount,
      expectedAmount,
      amountOk,
      phoneNumber: payment.phoneNumber,
      resultCode: payment.resultCode,
      resultDesc: payment.resultDesc,
      linkedTransactionId: payment.linkedTransactionId,
      linkedCustomerId: payment.linkedCustomerId,
      linkedCustomerName: payment.linkedCustomerName,
      message: !paid ? payment.resultDesc || "This M-Pesa request is not paid yet." : !amountOk ? `Paid amount is Ksh ${amount.toLocaleString()} but this sale needs Ksh ${expectedAmount.toLocaleString()}.` : utilized ? "This M-Pesa payment has already been used on a POS receipt." : "M-Pesa payment verified and ready to use."
    });
  } catch (err) {
    console.error("[M-Pesa Verify Error]", err);
    return json23({ error: err?.message || "M-Pesa verification failed." }, 500);
  }
}, "onRequestPost");

// api/products/save.ts
var PRODUCT_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders25 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json24(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders25 }
  });
}
__name(json24, "json");
function asNumber10(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber10, "asNumber");
function roundMoney4(value) {
  return Math.round(value * 100) / 100;
}
__name(roundMoney4, "roundMoney");
function trimText13(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText13, "trimText");
function isTruthy(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}
__name(isTruthy, "isTruthy");
async function ensureSchema11(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      sellingPrice REAL NOT NULL,
      costPrice REAL,
      taxCategory TEXT NOT NULL,
      stockQuantity REAL NOT NULL,
      unit TEXT,
      barcode TEXT NOT NULL,
      imageUrl TEXT,
      reorderPoint REAL,
      isBundle INTEGER DEFAULT 0,
      components TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS productIngredients (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      ingredientProductId TEXT NOT NULL,
      quantity REAL NOT NULL,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  const productColumns = [
    "costPrice REAL",
    "taxCategory TEXT DEFAULT 'A'",
    "unit TEXT",
    "imageUrl TEXT",
    "reorderPoint REAL",
    "isBundle INTEGER DEFAULT 0",
    "components TEXT",
    "businessId TEXT",
    "branchId TEXT",
    "updated_at INTEGER"
  ];
  for (const column of productColumns) {
    try {
      await db.prepare(`ALTER TABLE products ADD COLUMN ${column}`).run();
    } catch {
    }
  }
  try {
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId)").run();
  } catch {
  }
  try {
    await db.prepare("ALTER TABLE stockMovements ADD COLUMN shiftId TEXT").run();
  } catch {
  }
}
__name(ensureSchema11, "ensureSchema");
var onRequestOptions23 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders25 }), "onRequestOptions");
var onRequestPost22 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json24({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !PRODUCT_ROLES.has(auth.principal.role)) {
      return json24({ error: "You are not allowed to manage products." }, 403);
    }
    const body = await request.json().catch(() => null);
    const productInput = body?.product || body || {};
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || productInput.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || productInput.branchId || "").trim();
    if (!businessId || !branchId) return json24({ error: "Business and branch are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json24({ error: "Access denied." }, 403);
    }
    const name = trimText13(productInput.name, 160);
    if (!name) return json24({ error: "Product name is required." }, 400);
    await ensureSchema11(env.DB);
    const productId = trimText13(productInput.id || body?.productId, 160) || crypto.randomUUID();
    const existing = await env.DB.prepare(`
      SELECT *
      FROM products
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(productId, businessId).first();
    if (existing?.branchId && existing.branchId !== branchId) throw new PolicyError("Product belongs to another branch.", 403);
    const isBundle3 = isTruthy(productInput.isBundle);
    const ingredients = Array.isArray(body?.ingredients) ? body.ingredients : Array.isArray(productInput.ingredients) ? productInput.ingredients : [];
    const cleanIngredients = ingredients.map((row) => ({
      ingredientProductId: trimText13(row?.ingredientProductId || row?.productId, 160),
      quantity: asNumber10(row?.quantity)
    })).filter((row) => row.ingredientProductId && row.quantity > 0).slice(0, 100);
    if (isBundle3 && cleanIngredients.length === 0) throw new PolicyError("Add at least one ingredient for this bulk item.", 400);
    if (isBundle3 && cleanIngredients.some((row) => row.ingredientProductId === productId)) {
      throw new PolicyError("A bulk item cannot use itself as an ingredient.", 400);
    }
    for (const ingredient of cleanIngredients) {
      const ingredientProduct = await env.DB.prepare(`
        SELECT id, branchId
        FROM products
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(ingredient.ingredientProductId, businessId).first();
      if (!ingredientProduct) throw new PolicyError("A selected ingredient was not found.", 404);
      if (ingredientProduct.branchId && ingredientProduct.branchId !== branchId) throw new PolicyError("A selected ingredient belongs to another branch.", 403);
    }
    const now = Date.now();
    const product = {
      id: productId,
      name,
      category: trimText13(productInput.category, 120) || "General",
      sellingPrice: roundMoney4(Math.max(0, asNumber10(productInput.sellingPrice))),
      costPrice: roundMoney4(Math.max(0, asNumber10(productInput.costPrice))),
      taxCategory: ["A", "C", "E"].includes(String(productInput.taxCategory || "").toUpperCase()) ? String(productInput.taxCategory).toUpperCase() : "A",
      stockQuantity: isBundle3 ? 0 : existing ? asNumber10(existing.stockQuantity) : Math.max(0, asNumber10(productInput.stockQuantity)),
      unit: trimText13(productInput.unit, 24) || "pcs",
      barcode: trimText13(productInput.barcode, 80) || `SKU-${Date.now()}`,
      reorderPoint: Math.max(0, asNumber10(productInput.reorderPoint, 5)),
      isBundle: isBundle3 ? 1 : 0,
      components: isBundle3 ? cleanIngredients.map((row) => ({ productId: row.ingredientProductId, quantity: row.quantity })) : [],
      branchId: existing?.branchId || branchId,
      businessId,
      updated_at: now
    };
    const statements = [
      env.DB.prepare(`
        INSERT OR REPLACE INTO products (id, name, category, sellingPrice, costPrice, taxCategory, stockQuantity, unit, barcode, reorderPoint, isBundle, components, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        product.id,
        product.name,
        product.category,
        product.sellingPrice,
        product.costPrice,
        product.taxCategory,
        product.stockQuantity,
        product.unit,
        product.barcode,
        product.reorderPoint,
        product.isBundle,
        JSON.stringify(product.components),
        businessId,
        product.branchId,
        now
      ),
      env.DB.prepare(`DELETE FROM productIngredients WHERE productId = ? AND businessId = ?`).bind(product.id, businessId)
    ];
    if (isBundle3) {
      for (const ingredient of cleanIngredients) {
        statements.push(
          env.DB.prepare(`
            INSERT INTO productIngredients (id, productId, ingredientProductId, quantity, businessId, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(`${product.id}_${ingredient.ingredientProductId}`, product.id, ingredient.ingredientProductId, ingredient.quantity, businessId, now)
        );
      }
    }
    if (!existing && !isBundle3 && product.stockQuantity > 0) {
      statements.push(
        env.DB.prepare(`
          INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          product.id,
          "IN",
          product.stockQuantity,
          now,
          "Opening stock",
          product.branchId,
          businessId,
          null,
          now
        )
      );
    }
    statements.push(
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        existing ? "product.update" : "product.create",
        "product",
        product.id,
        "INFO",
        `${existing ? "Updated" : "Created"} product ${product.name}.`,
        businessId,
        branchId,
        now
      )
    );
    await env.DB.batch(statements);
    return json24({ success: true, product });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json24({ error: err?.message || "Could not save product." }, status);
  }
}, "onRequestPost");

// api/purchases/approval.ts
var APPROVER_ROLES4 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders26 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json25(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders26 }
  });
}
__name(json25, "json");
function trimText14(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText14, "trimText");
async function ensureSchema12(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
}
__name(ensureSchema12, "ensureSchema");
var onRequestOptions24 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders26 }), "onRequestOptions");
var onRequestPost23 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json25({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !APPROVER_ROLES4.has(auth.principal.role)) {
      return json25({ error: "You are not allowed to approve purchase orders." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const purchaseOrderId = String(body?.purchaseOrderId || body?.id || "").trim();
    const action = String(body?.action || "").trim().toUpperCase();
    if (!businessId || !branchId || !purchaseOrderId) return json25({ error: "Business, branch and purchase order are required." }, 400);
    if (action !== "APPROVE" && action !== "REJECT") return json25({ error: "Approval action is required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json25({ error: "Access denied." }, 403);
    }
    await ensureSchema12(env.DB);
    const po = await env.DB.prepare(`
      SELECT id, poNumber, approvalStatus, status
      FROM purchaseOrders
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(purchaseOrderId, businessId, branchId).first();
    if (!po) throw new PolicyError("Purchase order was not found.", 404);
    if (po.status === "RECEIVED") throw new PolicyError("Received purchase orders cannot be changed.", 409);
    if (po.approvalStatus !== "PENDING" && po.approvalStatus !== (action === "APPROVE" ? "APPROVED" : "REJECTED")) {
      throw new PolicyError("This purchase order has already been processed.", 409);
    }
    const now = Date.now();
    const nextStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
    const approvedBy = trimText14(body?.approvedBy || auth.principal.userName || "Administrator", 120) || "Administrator";
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE purchaseOrders
        SET approvalStatus = ?,
            approvedBy = CASE WHEN ? = 'APPROVED' THEN ? ELSE approvedBy END,
            updated_at = ?
        WHERE id = ? AND businessId = ? AND branchId = ?
      `).bind(nextStatus, nextStatus, approvedBy, now, purchaseOrderId, businessId, branchId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        action === "APPROVE" ? "purchase.approve" : "purchase.reject",
        "purchaseOrder",
        purchaseOrderId,
        action === "APPROVE" ? "INFO" : "WARN",
        `${action === "APPROVE" ? "Approved" : "Rejected"} ${po.poNumber || purchaseOrderId}.`,
        businessId,
        branchId,
        now
      )
    ]);
    return json25({ success: true, purchaseOrderId, approvalStatus: nextStatus });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json25({ error: err?.message || "Could not update purchase approval." }, status);
  }
}, "onRequestPost");

// api/purchases/receive.ts
var RECEIVER_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders27 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json26(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders27 }
  });
}
__name(json26, "json");
function asNumber11(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber11, "asNumber");
function roundMoney5(value) {
  return Math.round(value * 100) / 100;
}
__name(roundMoney5, "roundMoney");
function trimText15(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText15, "trimText");
function parseItems(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
__name(parseItems, "parseItems");
async function ensureSchema13(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  try {
    await db.prepare("ALTER TABLE purchaseOrders ADD COLUMN receivedBy TEXT").run();
  } catch {
  }
}
__name(ensureSchema13, "ensureSchema");
var onRequestOptions25 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders27 }), "onRequestOptions");
var onRequestPost24 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json26({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !RECEIVER_ROLES.has(auth.principal.role)) {
      return json26({ error: "You are not allowed to receive purchase orders." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const purchaseOrderId = String(body?.purchaseOrderId || body?.id || "").trim();
    const invoiceNumber = trimText15(body?.invoiceNumber, 80);
    const receivedBy = trimText15(body?.receivedBy || auth.principal.userName || "Staff", 120) || "Staff";
    if (!businessId || !branchId || !purchaseOrderId) return json26({ error: "Business, branch and purchase order are required." }, 400);
    if (!invoiceNumber) return json26({ error: "Supplier invoice number is required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json26({ error: "Access denied." }, 403);
    }
    await ensureSchema13(env.DB);
    const po = await env.DB.prepare(`
      SELECT *
      FROM purchaseOrders
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(purchaseOrderId, businessId, branchId).first();
    if (!po) throw new PolicyError("Purchase order was not found.", 404);
    if (po.approvalStatus !== "APPROVED") throw new PolicyError("Purchase order must be approved before receiving.", 409);
    if (po.status === "RECEIVED") throw new PolicyError("Purchase order has already been received.", 409);
    const supplier = await env.DB.prepare(`
      SELECT id, name, company, balance, branchId
      FROM suppliers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(po.supplierId, businessId).first();
    if (!supplier) throw new PolicyError("Supplier was not found.", 404);
    if (supplier.branchId && supplier.branchId !== branchId) throw new PolicyError("Supplier belongs to another branch.", 403);
    const savedItems = parseItems(po.items);
    if (!savedItems.length) throw new PolicyError("Purchase order has no line items.", 400);
    const submittedLines = /* @__PURE__ */ new Map();
    if (!Array.isArray(body?.items)) throw new PolicyError("Received line items are required.", 400);
    for (const raw of body.items) {
      const productId = String(raw?.productId || "").trim();
      if (!productId) continue;
      const receivedQuantity = asNumber11(raw?.receivedQuantity);
      const unitCost = roundMoney5(asNumber11(raw?.unitCost));
      const sellingPrice = raw?.sellingPrice === "" || raw?.sellingPrice === null || raw?.sellingPrice === void 0 ? void 0 : roundMoney5(asNumber11(raw?.sellingPrice));
      if (receivedQuantity < 0 || unitCost < 0 || sellingPrice !== void 0 && sellingPrice < 0) {
        throw new PolicyError("Received quantities and prices cannot be negative.", 400);
      }
      submittedLines.set(productId, { productId, receivedQuantity, unitCost, sellingPrice });
    }
    const updatedItems = savedItems.map((item) => {
      const productId = String(item?.productId || "").trim();
      const submitted = submittedLines.get(productId);
      return {
        ...item,
        receivedQuantity: submitted ? submitted.receivedQuantity : asNumber11(item?.receivedQuantity),
        unitCost: submitted ? submitted.unitCost : roundMoney5(asNumber11(item?.unitCost))
      };
    });
    const totalReceivedCost = roundMoney5(
      updatedItems.reduce((sum, item) => sum + asNumber11(item.receivedQuantity) * asNumber11(item.unitCost), 0)
    );
    if (totalReceivedCost <= 0) throw new PolicyError("Receive at least one item before confirming arrival.", 400);
    const now = Date.now();
    const statements = [];
    for (const item of updatedItems) {
      const quantity = asNumber11(item.receivedQuantity);
      if (quantity <= 0) continue;
      const productId = String(item.productId || "").trim();
      const product = await env.DB.prepare(`
        SELECT id, name, stockQuantity, sellingPrice, branchId
        FROM products
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(productId, businessId).first();
      if (!product) throw new PolicyError(`Product "${item.name || productId}" was not found.`, 404);
      if (product.branchId && product.branchId !== branchId) throw new PolicyError(`Product "${product.name}" belongs to another branch.`, 403);
      const submitted = submittedLines.get(productId);
      const nextSellingPrice = submitted?.sellingPrice && submitted.sellingPrice > 0 ? submitted.sellingPrice : asNumber11(product.sellingPrice);
      statements.push(
        env.DB.prepare(`
          UPDATE products
          SET stockQuantity = COALESCE(stockQuantity, 0) + ?,
              costPrice = ?,
              sellingPrice = ?,
              updated_at = ?
          WHERE id = ? AND businessId = ?
        `).bind(quantity, roundMoney5(asNumber11(item.unitCost)), nextSellingPrice, now, productId, businessId),
        env.DB.prepare(`
          INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          productId,
          "IN",
          quantity,
          now,
          `${po.poNumber || po.id} Inv:${invoiceNumber}`,
          branchId,
          businessId,
          body?.shiftId || null,
          now
        )
      );
    }
    statements.unshift(
      env.DB.prepare(`
        UPDATE purchaseOrders
        SET status = 'RECEIVED',
            paymentStatus = 'UNPAID',
            paidAmount = 0,
            items = ?,
            totalAmount = ?,
            receivedDate = ?,
            invoiceNumber = ?,
            receivedBy = ?,
            updated_at = ?
        WHERE id = ? AND businessId = ? AND branchId = ?
      `).bind(
        JSON.stringify(updatedItems),
        totalReceivedCost,
        now,
        invoiceNumber,
        receivedBy,
        now,
        purchaseOrderId,
        businessId,
        branchId
      )
    );
    statements.push(
      env.DB.prepare(`UPDATE suppliers SET balance = COALESCE(balance, 0) + ?, updated_at = ? WHERE id = ? AND businessId = ?`).bind(totalReceivedCost, now, po.supplierId, businessId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "purchase.receive",
        "purchaseOrder",
        purchaseOrderId,
        "INFO",
        `Received ${po.poNumber || purchaseOrderId} for Ksh ${totalReceivedCost.toLocaleString()}.`,
        businessId,
        branchId,
        now
      )
    );
    await env.DB.batch(statements);
    return json26({
      success: true,
      purchaseOrderId,
      totalReceivedCost,
      receivedItemCount: updatedItems.filter((item) => asNumber11(item.receivedQuantity) > 0).length
    });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json26({ error: err?.message || "Could not receive purchase order." }, status);
  }
}, "onRequestPost");

// api/purchases/save.ts
var PURCHASE_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders28 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json27(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders28 }
  });
}
__name(json27, "json");
function asNumber12(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber12, "asNumber");
function roundMoney6(value) {
  return Math.round(value * 100) / 100;
}
__name(roundMoney6, "roundMoney");
function trimText16(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText16, "trimText");
function settingFlag(value, fallback = false) {
  if (value === void 0 || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return fallback;
}
__name(settingFlag, "settingFlag");
async function ensureSchema14(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS purchaseOrders (
      id TEXT PRIMARY KEY,
      supplierId TEXT NOT NULL,
      items TEXT NOT NULL,
      totalAmount REAL NOT NULL,
      status TEXT NOT NULL,
      approvalStatus TEXT NOT NULL,
      paymentStatus TEXT,
      paidAmount REAL,
      orderDate INTEGER NOT NULL,
      expectedDate INTEGER,
      receivedDate INTEGER,
      invoiceNumber TEXT,
      poNumber TEXT,
      preparedBy TEXT,
      approvedBy TEXT,
      receivedBy TEXT,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  const purchaseColumns = [
    "paymentStatus TEXT",
    "paidAmount REAL",
    "expectedDate INTEGER",
    "receivedDate INTEGER",
    "invoiceNumber TEXT",
    "poNumber TEXT",
    "preparedBy TEXT",
    "approvedBy TEXT",
    "receivedBy TEXT",
    "branchId TEXT",
    "businessId TEXT",
    "updated_at INTEGER"
  ];
  for (const column of purchaseColumns) {
    try {
      await db.prepare(`ALTER TABLE purchaseOrders ADD COLUMN ${column}`).run();
    } catch {
    }
  }
}
__name(ensureSchema14, "ensureSchema");
async function nextPoNumber(db, businessId, branchId) {
  const { results } = await db.prepare(`
    SELECT poNumber
    FROM purchaseOrders
    WHERE businessId = ? AND branchId = ? AND poNumber LIKE 'PO-%'
    ORDER BY orderDate DESC
    LIMIT 500
  `).bind(businessId, branchId).all();
  const max = (results || []).reduce((highest, row) => {
    const match2 = String(row.poNumber || "").match(/PO-(\d+)/i);
    const num = match2 ? Number(match2[1]) : 0;
    return Number.isFinite(num) && num > highest ? num : highest;
  }, 0);
  return `PO-${String(max + 1).padStart(4, "0")}`;
}
__name(nextPoNumber, "nextPoNumber");
var onRequestOptions26 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders28 }), "onRequestOptions");
var onRequestPost25 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json27({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !PURCHASE_ROLES.has(auth.principal.role)) {
      return json27({ error: "You are not allowed to save purchase orders." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const supplierId = String(body?.supplierId || "").trim();
    if (!businessId || !branchId || !supplierId) return json27({ error: "Business, branch and supplier are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json27({ error: "Access denied." }, 403);
    }
    await ensureSchema14(env.DB);
    const supplier = await env.DB.prepare(`
      SELECT id, branchId
      FROM suppliers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(supplierId, businessId).first();
    if (!supplier) throw new PolicyError("Supplier was not found.", 404);
    if (supplier.branchId && supplier.branchId !== branchId) throw new PolicyError("Supplier belongs to another branch.", 403);
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    if (rawItems.length === 0) throw new PolicyError("Add at least one item to the purchase order.", 400);
    const items = [];
    for (const raw of rawItems.slice(0, 100)) {
      const productId = trimText16(raw?.productId, 160);
      const expectedQuantity = asNumber12(raw?.expectedQuantity);
      const unitCost = roundMoney6(asNumber12(raw?.unitCost));
      if (!productId || expectedQuantity <= 0 || unitCost < 0) throw new PolicyError("Purchase order line items are invalid.", 400);
      const product = await env.DB.prepare(`
        SELECT id, name, branchId
        FROM products
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(productId, businessId).first();
      if (!product) throw new PolicyError("Purchase order includes a product that was not found.", 404);
      if (product.branchId && product.branchId !== branchId) throw new PolicyError(`Product "${product.name}" belongs to another branch.`, 403);
      items.push({
        productId,
        name: product.name,
        expectedQuantity,
        receivedQuantity: 0,
        unitCost
      });
    }
    const purchaseOrderId = trimText16(body?.purchaseOrderId || body?.id, 160);
    const existing = purchaseOrderId ? await env.DB.prepare(`
          SELECT *
          FROM purchaseOrders
          WHERE id = ? AND businessId = ? AND branchId = ?
          LIMIT 1
        `).bind(purchaseOrderId, businessId, branchId).first() : null;
    if (purchaseOrderId && !existing) throw new PolicyError("Purchase order was not found.", 404);
    if (existing?.status === "RECEIVED") throw new PolicyError("Received purchase orders cannot be edited.", 409);
    const settings = await env.DB.prepare(`SELECT ownerModeEnabled, autoApproveOwnerActions FROM settings WHERE businessId = ? LIMIT 1`).bind(businessId).first();
    const canUseOwnerMode = auth.principal.role === "ADMIN" || auth.principal.role === "MANAGER" || auth.principal.role === "ROOT";
    const autoApprove = canUseOwnerMode && settingFlag(settings?.ownerModeEnabled, false) && settingFlag(settings?.autoApproveOwnerActions, true);
    const now = Date.now();
    const id = purchaseOrderId || `po_${businessId}_${branchId}_${crypto.randomUUID()}`;
    const poNumber = existing?.poNumber || await nextPoNumber(env.DB, businessId, branchId);
    const totalAmount = roundMoney6(items.reduce((sum, item) => sum + item.expectedQuantity * item.unitCost, 0));
    const approvalStatus = autoApprove ? "APPROVED" : "PENDING";
    const preparedBy = trimText16(existing?.preparedBy || body?.preparedBy || auth.principal.userName, 120) || "Staff";
    const purchaseOrder = {
      id,
      poNumber,
      supplierId,
      items,
      totalAmount,
      status: existing?.status || "PENDING",
      approvalStatus,
      paymentStatus: existing?.paymentStatus || null,
      paidAmount: existing?.paidAmount || 0,
      orderDate: existing?.orderDate || now,
      expectedDate: existing?.expectedDate || null,
      receivedDate: existing?.receivedDate || null,
      invoiceNumber: existing?.invoiceNumber || null,
      preparedBy,
      approvedBy: autoApprove ? auth.principal.userName || preparedBy : existing?.approvedBy || null,
      receivedBy: existing?.receivedBy || null,
      branchId,
      businessId,
      updated_at: now
    };
    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR REPLACE INTO purchaseOrders (id, supplierId, items, totalAmount, status, approvalStatus, paymentStatus, paidAmount, orderDate, expectedDate, receivedDate, invoiceNumber, poNumber, preparedBy, approvedBy, receivedBy, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        purchaseOrder.id,
        supplierId,
        JSON.stringify(items),
        totalAmount,
        purchaseOrder.status,
        approvalStatus,
        purchaseOrder.paymentStatus,
        purchaseOrder.paidAmount,
        purchaseOrder.orderDate,
        purchaseOrder.expectedDate,
        purchaseOrder.receivedDate,
        purchaseOrder.invoiceNumber,
        poNumber,
        preparedBy,
        purchaseOrder.approvedBy,
        purchaseOrder.receivedBy,
        branchId,
        businessId,
        now
      ),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        existing ? "purchase.update" : "purchase.create",
        "purchaseOrder",
        id,
        autoApprove ? "INFO" : "WARN",
        `${existing ? "Updated" : "Created"} ${poNumber}.`,
        businessId,
        branchId,
        now
      )
    ]);
    return json27({ success: true, purchaseOrder, autoApproved: autoApprove });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json27({ error: err?.message || "Could not save purchase order." }, status);
  }
}, "onRequestPost");

// api/sales/checkout.ts
var corsHeaders29 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json28(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders29
    }
  });
}
__name(json28, "json");
function serializeValue(v) {
  if (v === null || v === void 0) return null;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}
__name(serializeValue, "serializeValue");
function deserializeRow3(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}
__name(deserializeRow3, "deserializeRow");
function asNumber13(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber13, "asNumber");
function normaliseCode3(value) {
  return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
}
__name(normaliseCode3, "normaliseCode");
function parseMaybeJson4(value) {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
__name(parseMaybeJson4, "parseMaybeJson");
function expectedMpesaAmount(tx) {
  const splitPayments = parseMaybeJson4(tx.splitPayments);
  if (String(tx.paymentMethod || "").toUpperCase() === "SPLIT" && String(splitPayments?.secondaryMethod || "").toUpperCase() === "MPESA") {
    return asNumber13(splitPayments?.secondaryAmount, 0);
  }
  return asNumber13(tx.total, 0);
}
__name(expectedMpesaAmount, "expectedMpesaAmount");
function mpesaReferenceFor(tx) {
  const method = String(tx.paymentMethod || "").toUpperCase();
  const splitPayments = parseMaybeJson4(tx.splitPayments);
  const usesMpesa = method === "MPESA" || method === "SPLIT" && String(splitPayments?.secondaryMethod || "").toUpperCase() === "MPESA";
  if (!usesMpesa) return "";
  return normaliseCode3(tx.mpesaCode || tx.mpesaReference || tx.mpesaCheckoutRequestId);
}
__name(mpesaReferenceFor, "mpesaReferenceFor");
async function ensureCheckoutSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS idempotencyKeys (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      idempotencyKey TEXT NOT NULL,
      operation TEXT NOT NULL,
      deviceId TEXT,
      cashierName TEXT,
      transactionId TEXT,
      createdAt INTEGER NOT NULL
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_lookup ON idempotencyKeys(businessId, branchId, idempotencyKey)").run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS mpesaCallbacks (
      checkoutRequestId TEXT PRIMARY KEY,
      merchantRequestId TEXT,
      resultCode INTEGER,
      resultDesc TEXT,
      amount REAL,
      receiptNumber TEXT,
      phoneNumber TEXT,
      businessId TEXT,
      branchId TEXT,
      timestamp INTEGER,
      utilizedTransactionId TEXT,
      utilizedCustomerId TEXT,
      utilizedCustomerName TEXT,
      utilizedAt INTEGER
    )
  `).run();
  for (const sql of [
    "ALTER TABLE idempotencyKeys ADD COLUMN transactionId TEXT",
    "CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_transaction ON idempotencyKeys(businessId, branchId, transactionId)",
    "CREATE TABLE IF NOT EXISTS stockMovements (id TEXT PRIMARY KEY, productId TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, timestamp INTEGER NOT NULL, reference TEXT, branchId TEXT, businessId TEXT, shiftId TEXT, updated_at INTEGER)",
    "ALTER TABLE stockMovements ADD COLUMN shiftId TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedTransactionId TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerId TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerName TEXT",
    "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedAt INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, branchId, receiptNumber)",
    "CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_utilized ON mpesaCallbacks(businessId, branchId, utilizedTransactionId)"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureCheckoutSchema, "ensureCheckoutSchema");
async function getIdempotentTransaction(db, businessId, branchId, idempotencyId, idempotencyKey) {
  const keyRow = await db.prepare(`
    SELECT transactionId
    FROM idempotencyKeys
    WHERE id = ? AND businessId = ? AND branchId = ?
    LIMIT 1
  `).bind(idempotencyId, businessId, branchId).first();
  if (!keyRow) return null;
  const candidateIds = Array.from(new Set([
    String(keyRow.transactionId || "").trim(),
    String(idempotencyKey || "").trim()
  ].filter(Boolean)));
  for (const candidateId of candidateIds) {
    const existing = await getExistingTransaction(db, businessId, branchId, candidateId);
    if (existing) return existing;
  }
  throw new PolicyError("Checkout retry key is already used.", 409);
}
__name(getIdempotentTransaction, "getIdempotentTransaction");
async function getExistingTransaction(db, businessId, branchId, transactionId) {
  const row = await db.prepare(`
    SELECT *
    FROM transactions
    WHERE id = ? AND businessId = ? AND branchId = ?
    LIMIT 1
  `).bind(transactionId, businessId, branchId).first();
  return row ? deserializeRow3(row) : null;
}
__name(getExistingTransaction, "getExistingTransaction");
async function verifyMpesaPayment(db, businessId, branchId, tx) {
  const code = mpesaReferenceFor(tx);
  if (!code) return [];
  const payment = await db.prepare(`
    SELECT *
    FROM mpesaCallbacks
    WHERE businessId = ?
      AND branchId = ?
      AND (
        UPPER(COALESCE(receiptNumber, '')) = ?
        OR UPPER(COALESCE(checkoutRequestId, '')) = ?
        OR UPPER(COALESCE(merchantRequestId, '')) = ?
      )
    ORDER BY CASE WHEN resultCode = 0 THEN 0 ELSE 1 END, timestamp DESC
    LIMIT 1
  `).bind(businessId, branchId, code, code, code).first();
  if (!payment) throw new PolicyError("M-Pesa payment not found.", 404);
  if (asNumber13(payment.resultCode, -1) !== 0) {
    throw new PolicyError(payment.resultDesc || "M-Pesa payment is not paid.", 409);
  }
  if (payment.utilizedTransactionId && payment.utilizedTransactionId !== tx.id) {
    throw new PolicyError("This M-Pesa payment is already tied to another POS receipt.", 409);
  }
  const amount = expectedMpesaAmount(tx);
  if (amount > 0 && asNumber13(payment.amount, 0) + 0.01 < amount) {
    throw new PolicyError("M-Pesa paid amount is below the receipt amount.", 409);
  }
  return [
    db.prepare(`
      UPDATE mpesaCallbacks
      SET utilizedTransactionId = ?,
          utilizedCustomerId = ?,
          utilizedCustomerName = ?,
          utilizedAt = ?
      WHERE checkoutRequestId = ?
    `).bind(
      tx.id,
      tx.customerId || null,
      tx.customerName || null,
      Date.now(),
      payment.checkoutRequestId
    )
  ];
}
__name(verifyMpesaPayment, "verifyMpesaPayment");
async function transactionInsert(db, tx) {
  const { results: pragma } = await db.prepare(`PRAGMA table_info('transactions')`).all();
  const validCols = new Set(pragma.map((r) => r.name));
  const cols = Object.keys(tx).filter((k) => validCols.has(k));
  if (cols.length === 0) throw new PolicyError("No valid transaction columns to insert.", 400);
  const sql = `INSERT OR REPLACE INTO transactions (${cols.map((c) => '"' + c + '"').join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  return db.prepare(sql).bind(...cols.map((col) => serializeValue(tx[col])));
}
__name(transactionInsert, "transactionInsert");
function auditInsert(db, tx, businessId, branchId, principal) {
  const subtotal = asNumber13(tx.subtotal, 0);
  const discount = asNumber13(tx.discountAmount || tx.discount, 0);
  const severity = discount > subtotal * 0.1 ? "WARN" : "INFO";
  const details = discount > 0 ? `Completed Ksh ${asNumber13(tx.total, 0).toLocaleString()} sale with Ksh ${discount.toLocaleString()} discount.` : `Completed Ksh ${asNumber13(tx.total, 0).toLocaleString()} sale.`;
  const now = Date.now();
  return db.prepare(`
    INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    now,
    principal.userId || null,
    principal.userName || null,
    "sale.checkout",
    "transaction",
    tx.id,
    severity,
    details,
    businessId,
    branchId,
    now
  );
}
__name(auditInsert, "auditInsert");
var onRequestOptions27 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders29 }), "onRequestOptions");
var onRequestPost26 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json28({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    const tx = body?.transaction || body;
    if (!tx || typeof tx !== "object") return json28({ error: "Transaction payload is required." }, 400);
    const businessId = String(request.headers.get("X-Business-ID") || tx.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || tx.branchId || "").trim();
    if (!businessId || !branchId) return json28({ error: "Business and branch are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json28({ error: "Access denied." }, 403);
    }
    await ensureCheckoutSchema(env.DB);
    const transactionId = String(tx.id || crypto.randomUUID()).trim();
    tx.id = transactionId;
    const existing = await getExistingTransaction(env.DB, businessId, branchId, transactionId);
    if (existing) {
      return json28({ success: true, transaction: existing, idempotent: true });
    }
    const idempotencyKey = String(body?.idempotencyKey || tx.id).trim() || transactionId;
    const idempotencyId = `${businessId}|${branchId}|${idempotencyKey}`;
    try {
      const existingByKey = await getIdempotentTransaction(env.DB, businessId, branchId, idempotencyId, idempotencyKey);
      if (existingByKey) return json28({ success: true, transaction: existingByKey, idempotent: true });
    } catch (err) {
      const status = err instanceof PolicyError ? err.status : 409;
      return json28({ error: err?.message || "Checkout retry key is already used." }, status);
    }
    let sideEffects = [];
    try {
      sideEffects = await hardenTransactionBatch({
        db: env.DB,
        businessId,
        branchId,
        principal: auth.principal,
        service: auth.service
      }, [tx]);
    } catch (err) {
      const status = err instanceof PolicyError ? err.status : 400;
      return json28({ error: err?.message || "Checkout was rejected." }, status);
    }
    tx.isSynced = 1;
    tx.businessId = businessId;
    tx.branchId = branchId;
    let mpesaStatements = [];
    try {
      mpesaStatements = await verifyMpesaPayment(env.DB, businessId, branchId, tx);
    } catch (err) {
      const status = err instanceof PolicyError ? err.status : 400;
      return json28({ error: err?.message || "M-Pesa payment could not be verified." }, status);
    }
    const batch = [
      await transactionInsert(env.DB, tx),
      ...sideEffects,
      ...mpesaStatements,
      auditInsert(env.DB, tx, businessId, branchId, auth.principal),
      env.DB.prepare(`
        INSERT OR IGNORE INTO idempotencyKeys (id, businessId, branchId, idempotencyKey, operation, deviceId, cashierName, transactionId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        idempotencyId,
        businessId,
        branchId,
        idempotencyKey,
        "sales.checkout",
        null,
        auth.principal.userName || null,
        tx.id,
        Date.now()
      )
    ];
    await env.DB.batch(batch);
    return json28({ success: true, transaction: tx });
  } catch (err) {
    console.error("[Checkout Error]", err);
    return json28({ error: err?.message || "Checkout failed." }, 500);
  }
}, "onRequestPost");

// api/sales/invoice-cancel.ts
var INVOICE_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders30 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json29(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders30 }
  });
}
__name(json29, "json");
function asNumber14(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber14, "asNumber");
function parseItems2(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
__name(parseItems2, "parseItems");
async function ensureSchema15(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
}
__name(ensureSchema15, "ensureSchema");
var onRequestOptions28 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders30 }), "onRequestOptions");
var onRequestPost27 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json29({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !INVOICE_ROLES.has(auth.principal.role)) {
      return json29({ error: "You are not allowed to cancel sales invoices." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const invoiceId = String(body?.invoiceId || body?.id || "").trim();
    if (!businessId || !branchId || !invoiceId) return json29({ error: "Business, branch and invoice are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json29({ error: "Access denied." }, 403);
    }
    await ensureSchema15(env.DB);
    const invoice = await env.DB.prepare(`
      SELECT *
      FROM salesInvoices
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(invoiceId, businessId, branchId).first();
    if (!invoice) throw new PolicyError("Sales invoice was not found.", 404);
    if (invoice.status === "CANCELLED") return json29({ success: true, invoice: { ...invoice, items: parseItems2(invoice.items) }, idempotent: true });
    if (invoice.status === "PAID" || asNumber14(invoice.paidAmount) > 0) {
      throw new PolicyError("This invoice already has an amount cleared. Record an adjustment instead.", 409);
    }
    const now = Date.now();
    const items = parseItems2(invoice.items);
    const statements = [
      env.DB.prepare(`UPDATE salesInvoices SET status = 'CANCELLED', balance = 0, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?`).bind(now, invoiceId, businessId, branchId),
      env.DB.prepare(`
        UPDATE customers
        SET totalSpent = MAX(0, COALESCE(totalSpent, 0) - ?),
            balance = MAX(0, COALESCE(balance, 0) - ?),
            updated_at = ?
        WHERE id = ? AND businessId = ?
      `).bind(asNumber14(invoice.total), asNumber14(invoice.balance), now, invoice.customerId, businessId)
    ];
    for (const line of items) {
      if (line?.itemType !== "PRODUCT" || !line?.itemId) continue;
      const quantity = asNumber14(line.quantity);
      if (quantity <= 0) continue;
      statements.push(
        env.DB.prepare(`UPDATE products SET stockQuantity = COALESCE(stockQuantity, 0) + ?, updated_at = ? WHERE id = ? AND businessId = ?`).bind(quantity, now, line.itemId, businessId),
        env.DB.prepare(`
          INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          line.itemId,
          "RETURN",
          quantity,
          now,
          `Cancelled invoice ${invoice.invoiceNumber}`,
          branchId,
          businessId,
          body?.shiftId || null,
          now
        )
      );
    }
    statements.push(
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "sales.invoice.cancel",
        "salesInvoice",
        invoiceId,
        "WARN",
        `Cancelled ${invoice.invoiceNumber}.`,
        businessId,
        branchId,
        now
      )
    );
    await env.DB.batch(statements);
    return json29({
      success: true,
      invoice: {
        ...invoice,
        items,
        status: "CANCELLED",
        balance: 0,
        updated_at: now
      }
    });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json29({ error: err?.message || "Could not cancel sales invoice." }, status);
  }
}, "onRequestPost");

// api/sales/invoice-create.ts
var INVOICE_ROLES2 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders31 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json30(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders31 }
  });
}
__name(json30, "json");
function asNumber15(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber15, "asNumber");
function roundMoney7(value) {
  return Math.round(value * 100) / 100;
}
__name(roundMoney7, "roundMoney");
function trimText17(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText17, "trimText");
function lineAmount(line) {
  return roundMoney7(line.quantity * line.unitPrice);
}
__name(lineAmount, "lineAmount");
function lineVat(line) {
  return line.taxCategory === "A" ? roundMoney7(lineAmount(line) * 0.16) : 0;
}
__name(lineVat, "lineVat");
function parseMaybeJson5(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
__name(parseMaybeJson5, "parseMaybeJson");
async function ensureSchema16(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS serviceItems (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      price REAL NOT NULL,
      taxCategory TEXT DEFAULT 'A',
      isActive INTEGER DEFAULT 1,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    "ALTER TABLE stockMovements ADD COLUMN shiftId TEXT",
    "ALTER TABLE serviceItems ADD COLUMN isActive INTEGER DEFAULT 1",
    "ALTER TABLE serviceItems ADD COLUMN taxCategory TEXT DEFAULT 'A'",
    "ALTER TABLE serviceItems ADD COLUMN updated_at INTEGER"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureSchema16, "ensureSchema");
async function nextInvoiceNumber(db, businessId, branchId) {
  const { results } = await db.prepare(`
    SELECT invoiceNumber
    FROM salesInvoices
    WHERE businessId = ? AND branchId = ? AND invoiceNumber LIKE 'INV-%'
    ORDER BY issueDate DESC
    LIMIT 500
  `).bind(businessId, branchId).all();
  const max = (results || []).reduce((highest, row) => {
    const match2 = String(row.invoiceNumber || "").match(/INV-(\d+)/i);
    const num = match2 ? Number(match2[1]) : 0;
    return Number.isFinite(num) && num > highest ? num : highest;
  }, 0);
  return `INV-${String(max + 1).padStart(4, "0")}`;
}
__name(nextInvoiceNumber, "nextInvoiceNumber");
var onRequestOptions29 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders31 }), "onRequestOptions");
var onRequestPost28 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json30({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !INVOICE_ROLES2.has(auth.principal.role)) {
      return json30({ error: "You are not allowed to create sales invoices." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const customerId = String(body?.customerId || "").trim();
    if (!businessId || !branchId || !customerId) return json30({ error: "Business, branch and customer are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json30({ error: "Access denied." }, 403);
    }
    const rawItems = parseMaybeJson5(body?.items);
    if (rawItems.length === 0) throw new PolicyError("Add at least one item or service.", 400);
    if (rawItems.length > 100) throw new PolicyError("Invoice has too many line items.", 413);
    await ensureSchema16(env.DB);
    const customer = await env.DB.prepare(`
      SELECT id, name, phone, email, totalSpent, balance, branchId
      FROM customers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(customerId, businessId).first();
    if (!customer) throw new PolicyError("Customer was not found.", 404);
    if (customer.branchId && customer.branchId !== branchId) throw new PolicyError("Customer belongs to another branch.", 403);
    const normalizedItems = [];
    const stockDeductions = /* @__PURE__ */ new Map();
    for (const raw of rawItems) {
      const itemType = String(raw?.itemType || "CUSTOM").toUpperCase();
      const quantity = asNumber15(raw?.quantity);
      const unitPrice = roundMoney7(asNumber15(raw?.unitPrice));
      if (quantity <= 0) throw new PolicyError("Invoice quantity must be more than zero.", 400);
      if (unitPrice < 0) throw new PolicyError("Invoice amount cannot be negative.", 400);
      if (itemType === "PRODUCT") {
        const itemId = String(raw?.itemId || "").trim();
        if (!itemId) throw new PolicyError("Product line is missing the product ID.", 400);
        const product = await env.DB.prepare(`
          SELECT id, name, sellingPrice, taxCategory, stockQuantity, branchId
          FROM products
          WHERE id = ? AND businessId = ?
          LIMIT 1
        `).bind(itemId, businessId).first();
        if (!product) throw new PolicyError("Invoice includes a product that was not found.", 404);
        if (product.branchId && product.branchId !== branchId) throw new PolicyError(`Product "${product.name}" belongs to another branch.`, 403);
        const planned = stockDeductions.get(product.id)?.quantity || 0;
        if (asNumber15(product.stockQuantity) < planned + quantity) throw new PolicyError(`Insufficient stock for ${product.name}.`, 409);
        stockDeductions.set(product.id, { name: product.name, quantity: planned + quantity });
        normalizedItems.push({
          itemType: "PRODUCT",
          itemId: product.id,
          name: product.name,
          quantity,
          unitPrice,
          taxCategory: product.taxCategory === "A" ? "A" : "E"
        });
        continue;
      }
      if (itemType === "SERVICE") {
        const itemId = String(raw?.itemId || "").trim();
        const service = itemId ? await env.DB.prepare(`
              SELECT id, name, taxCategory, isActive
              FROM serviceItems
              WHERE id = ? AND businessId = ?
              LIMIT 1
            `).bind(itemId, businessId).first() : null;
        if (itemId && !service) throw new PolicyError("Invoice includes a service that was not found.", 404);
        if (service && Number(service.isActive ?? 1) === 0) throw new PolicyError(`Service "${service.name}" is inactive.`, 409);
        normalizedItems.push({
          itemType: "SERVICE",
          itemId: service?.id || itemId || void 0,
          name: trimText17(raw?.name || service?.name, 160) || "Service",
          quantity,
          unitPrice,
          taxCategory: (service?.taxCategory || raw?.taxCategory) === "A" ? "A" : "E"
        });
        continue;
      }
      normalizedItems.push({
        itemType: "CUSTOM",
        name: trimText17(raw?.name, 160) || "Custom item",
        quantity,
        unitPrice,
        taxCategory: raw?.taxCategory === "A" ? "A" : "E"
      });
    }
    const subtotal = roundMoney7(normalizedItems.reduce((sum, item) => sum + lineAmount(item), 0));
    const tax = roundMoney7(normalizedItems.reduce((sum, item) => sum + lineVat(item), 0));
    const total = roundMoney7(subtotal + tax);
    const now = Date.now();
    const invoiceId = trimText17(body?.invoiceId, 160) || `sales_invoice_${businessId}_${branchId}_${crypto.randomUUID()}`;
    const invoiceNumber = trimText17(body?.invoiceNumber, 80) || await nextInvoiceNumber(env.DB, businessId, branchId);
    const existing = await env.DB.prepare(`
      SELECT *
      FROM salesInvoices
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(invoiceId, businessId, branchId).first();
    if (existing) {
      return json30({ success: true, invoice: { ...existing, items: parseMaybeJson5(existing.items) }, idempotent: true });
    }
    const duplicateNumber = await env.DB.prepare(`
      SELECT id
      FROM salesInvoices
      WHERE invoiceNumber = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(invoiceNumber, businessId, branchId).first();
    if (duplicateNumber) throw new PolicyError("Invoice number already exists for this branch.", 409);
    const invoice = {
      id: invoiceId,
      invoiceNumber,
      customerId,
      customerName: customer.name,
      customerPhone: customer.phone || void 0,
      customerEmail: customer.email || void 0,
      items: normalizedItems,
      subtotal,
      tax,
      total,
      paidAmount: 0,
      balance: total,
      status: "SENT",
      issueDate: now,
      dueDate: body?.dueDate ? asNumber15(body.dueDate) : null,
      notes: trimText17(body?.notes, 500) || null,
      preparedBy: trimText17(body?.preparedBy || auth.principal.userName, 120) || "Staff",
      branchId,
      businessId,
      updated_at: now
    };
    const statements = [
      env.DB.prepare(`
        INSERT INTO salesInvoices (id, invoiceNumber, customerId, customerName, customerPhone, customerEmail, items, subtotal, tax, total, paidAmount, balance, status, issueDate, dueDate, notes, preparedBy, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        invoice.id,
        invoice.invoiceNumber,
        invoice.customerId,
        invoice.customerName,
        invoice.customerPhone || null,
        invoice.customerEmail || null,
        JSON.stringify(invoice.items),
        invoice.subtotal,
        invoice.tax,
        invoice.total,
        invoice.paidAmount,
        invoice.balance,
        invoice.status,
        invoice.issueDate,
        invoice.dueDate,
        invoice.notes,
        invoice.preparedBy,
        branchId,
        businessId,
        now
      ),
      env.DB.prepare(`
        UPDATE customers
        SET totalSpent = COALESCE(totalSpent, 0) + ?,
            balance = COALESCE(balance, 0) + ?,
            updated_at = ?
        WHERE id = ? AND businessId = ?
      `).bind(total, total, now, customerId, businessId)
    ];
    for (const [productId, deduction] of stockDeductions.entries()) {
      statements.push(
        env.DB.prepare(`UPDATE products SET stockQuantity = MAX(0, COALESCE(stockQuantity, 0) - ?), updated_at = ? WHERE id = ? AND businessId = ?`).bind(deduction.quantity, now, productId, businessId),
        env.DB.prepare(`
          INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          productId,
          "OUT",
          deduction.quantity,
          now,
          `Invoice ${invoiceNumber}`,
          branchId,
          businessId,
          body?.shiftId || null,
          now
        )
      );
    }
    statements.push(
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "sales.invoice.create",
        "salesInvoice",
        invoice.id,
        "INFO",
        `Created ${invoiceNumber} for Ksh ${total.toLocaleString()}.`,
        businessId,
        branchId,
        now
      )
    );
    await env.DB.batch(statements);
    return json30({ success: true, invoice });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json30({ error: err?.message || "Could not create sales invoice." }, status);
  }
}, "onRequestPost");

// api/sales/_refundOps.ts
var APPROVER_ROLES5 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
function asNumber16(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber16, "asNumber");
function roundMoney8(value) {
  return Math.round(value * 100) / 100;
}
__name(roundMoney8, "roundMoney");
function roundQuantity(value) {
  return Math.round(value * 1e6) / 1e6;
}
__name(roundQuantity, "roundQuantity");
function trimText18(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText18, "trimText");
function asArray2(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
__name(asArray2, "asArray");
function deserializeRow4(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}
__name(deserializeRow4, "deserializeRow");
async function ensureRefundSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      total REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      discountAmount REAL,
      discountReason TEXT,
      items TEXT NOT NULL DEFAULT '[]',
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      paymentMethod TEXT,
      amountTendered REAL,
      changeGiven REAL,
      mpesaReference TEXT,
      mpesaCode TEXT,
      mpesaCustomer TEXT,
      mpesaCheckoutRequestId TEXT,
      cashierId TEXT,
      cashierName TEXT,
      customerId TEXT,
      customerName TEXT,
      discount REAL,
      discountType TEXT,
      splitPayments TEXT,
      splitData TEXT,
      isSynced INTEGER,
      approvedBy TEXT,
      pendingRefundItems TEXT,
      shiftId TEXT,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      sellingPrice REAL NOT NULL DEFAULT 0,
      costPrice REAL,
      taxCategory TEXT NOT NULL DEFAULT 'A',
      stockQuantity REAL NOT NULL DEFAULT 0,
      unit TEXT,
      barcode TEXT NOT NULL DEFAULT '',
      imageUrl TEXT,
      reorderPoint REAL,
      isBundle INTEGER DEFAULT 0,
      components TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS productIngredients (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      ingredientProductId TEXT NOT NULL,
      quantity REAL NOT NULL,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS financialAccounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      businessId TEXT,
      branchId TEXT,
      accountNumber TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS idempotencyKeys (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      idempotencyKey TEXT NOT NULL,
      operation TEXT NOT NULL,
      deviceId TEXT,
      cashierName TEXT,
      transactionId TEXT,
      createdAt INTEGER NOT NULL
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    "ALTER TABLE transactions ADD COLUMN approvedBy TEXT",
    "ALTER TABLE transactions ADD COLUMN pendingRefundItems TEXT",
    "ALTER TABLE transactions ADD COLUMN branchId TEXT",
    "ALTER TABLE transactions ADD COLUMN businessId TEXT",
    "ALTER TABLE transactions ADD COLUMN shiftId TEXT",
    "ALTER TABLE transactions ADD COLUMN updated_at INTEGER",
    "ALTER TABLE products ADD COLUMN businessId TEXT",
    "ALTER TABLE products ADD COLUMN branchId TEXT",
    "ALTER TABLE products ADD COLUMN isBundle INTEGER DEFAULT 0",
    "ALTER TABLE products ADD COLUMN components TEXT",
    "ALTER TABLE products ADD COLUMN updated_at INTEGER",
    "ALTER TABLE productIngredients ADD COLUMN businessId TEXT",
    "ALTER TABLE stockMovements ADD COLUMN reference TEXT",
    "ALTER TABLE stockMovements ADD COLUMN branchId TEXT",
    "ALTER TABLE stockMovements ADD COLUMN businessId TEXT",
    "ALTER TABLE stockMovements ADD COLUMN shiftId TEXT",
    "ALTER TABLE stockMovements ADD COLUMN updated_at INTEGER",
    "ALTER TABLE financialAccounts ADD COLUMN branchId TEXT",
    "ALTER TABLE financialAccounts ADD COLUMN updated_at INTEGER",
    "ALTER TABLE idempotencyKeys ADD COLUMN transactionId TEXT",
    "CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_lookup ON idempotencyKeys(businessId, branchId, idempotencyKey)",
    "CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_transaction ON idempotencyKeys(businessId, branchId, transactionId)"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureRefundSchema, "ensureRefundSchema");
async function loadTransaction(db, businessId, branchId, transactionId) {
  const row = await db.prepare(`
    SELECT *
    FROM transactions
    WHERE id = ? AND businessId = ? AND branchId = ?
    LIMIT 1
  `).bind(transactionId, businessId, branchId).first();
  if (!row) throw new PolicyError("Receipt was not found.", 404);
  return deserializeRow4(row);
}
__name(loadTransaction, "loadTransaction");
function refundLinesFor(transaction, itemsToReturn) {
  const txItems = asArray2(transaction.items);
  const sourceLines = itemsToReturn?.length ? itemsToReturn : asArray2(transaction.pendingRefundItems).length ? asArray2(transaction.pendingRefundItems) : txItems.map((item) => ({
    productId: item.productId,
    quantity: Math.max(0, asNumber16(item.quantity) - asNumber16(item.returnedQuantity))
  }));
  const lines = sourceLines.map((line) => ({
    productId: trimText18(line.productId, 120),
    quantity: Math.max(0, asNumber16(line.quantity))
  })).filter((line) => line.productId && line.quantity > 0);
  for (const line of lines) {
    const item = txItems.find((row) => row.productId === line.productId);
    if (!item) throw new PolicyError("Refund includes an item that is not on the receipt.", 400);
    const remaining = Math.max(0, asNumber16(item.quantity) - asNumber16(item.returnedQuantity));
    if (line.quantity > remaining + 1e-4) throw new PolicyError("Refund quantity exceeds the remaining receipt quantity.", 409);
  }
  return lines;
}
__name(refundLinesFor, "refundLinesFor");
function refundAmountFor(transaction, lines) {
  const txItems = asArray2(transaction.items);
  const amount = lines.reduce((sum, line) => {
    const item = txItems.find((row) => row.productId === line.productId);
    return sum + asNumber16(item?.snapshotPrice) * line.quantity;
  }, 0);
  return roundMoney8(Math.min(asNumber16(transaction.total), amount || asNumber16(transaction.total)));
}
__name(refundAmountFor, "refundAmountFor");
function normalizeRefundLines(lines) {
  const merged = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const productId = trimText18(line.productId, 120);
    const quantity = Math.max(0, asNumber16(line.quantity));
    if (!productId || quantity <= 0) continue;
    merged.set(productId, roundQuantity((merged.get(productId) || 0) + quantity));
  }
  return Array.from(merged.entries()).map(([productId, quantity]) => ({ productId, quantity })).sort((a, b) => a.productId.localeCompare(b.productId));
}
__name(normalizeRefundLines, "normalizeRefundLines");
function refundLineKey(lines) {
  return normalizeRefundLines(lines).map((line) => `${line.productId}:${line.quantity}`).join("|");
}
__name(refundLineKey, "refundLineKey");
function sameRefundLines(left, right) {
  return refundLineKey(left) === refundLineKey(right);
}
__name(sameRefundLines, "sameRefundLines");
async function loadIdempotentRefundTransaction(db, businessId, branchId, idempotencyKey) {
  const cleanKey = trimText18(idempotencyKey, 240);
  if (!cleanKey) return null;
  const rowId = `${businessId}|${branchId}|${cleanKey}`;
  const row = await db.prepare(`
    SELECT operation, transactionId
    FROM idempotencyKeys
    WHERE id = ? AND businessId = ? AND branchId = ?
    LIMIT 1
  `).bind(rowId, businessId, branchId).first();
  if (!row) return null;
  if (row.operation !== "sales.refund.approve") {
    throw new PolicyError("Refund retry key is already used for another operation.", 409);
  }
  const transactionId = trimText18(row.transactionId, 120);
  if (!transactionId) throw new PolicyError("Refund retry key is already used.", 409);
  return loadTransaction(db, businessId, branchId, transactionId);
}
__name(loadIdempotentRefundTransaction, "loadIdempotentRefundTransaction");
function idempotencyStatement(db, args) {
  const cleanKey = trimText18(args.idempotencyKey, 240);
  if (!cleanKey) return null;
  const rowId = `${args.businessId}|${args.branchId}|${cleanKey}`;
  return db.prepare(`
    INSERT INTO idempotencyKeys (id, businessId, branchId, idempotencyKey, operation, deviceId, cashierName, transactionId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    rowId,
    args.businessId,
    args.branchId,
    cleanKey,
    "sales.refund.approve",
    null,
    args.cashierName || null,
    args.transactionId,
    Date.now()
  );
}
__name(idempotencyStatement, "idempotencyStatement");
function isBundle2(product) {
  return product?.isBundle === 1 || product?.isBundle === true || product?.isBundle === "1";
}
__name(isBundle2, "isBundle");
async function productById(db, businessId, productId) {
  const row = await db.prepare(`
    SELECT id, name, branchId, stockQuantity, isBundle, components
    FROM products
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(productId, businessId).first();
  return row ? deserializeRow4(row) : null;
}
__name(productById, "productById");
function componentsFromProduct2(product) {
  return asArray2(product.components).map((component) => ({
    productId: trimText18(component?.productId || component?.ingredientProductId, 120),
    quantity: asNumber16(component?.quantity)
  })).filter((component) => component.productId && component.quantity > 0);
}
__name(componentsFromProduct2, "componentsFromProduct");
async function loadBundleComponents(db, businessId, product) {
  const { results } = await db.prepare(`
    SELECT ingredientProductId, quantity
    FROM productIngredients
    WHERE businessId = ? AND productId = ?
  `).bind(businessId, product.id).all();
  const rows = (results || []).map((row) => ({
    productId: trimText18(row.ingredientProductId, 120),
    quantity: asNumber16(row.quantity)
  })).filter((row) => row.productId && row.quantity > 0);
  return rows.length ? rows : componentsFromProduct2(product);
}
__name(loadBundleComponents, "loadBundleComponents");
function auditStatement2(db, args) {
  const now = Date.now();
  return db.prepare(`
    INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    now,
    args.principal.userId || null,
    args.principal.userName || null,
    args.action,
    "transaction",
    args.transactionId,
    args.severity,
    args.details,
    args.businessId,
    args.branchId,
    now
  );
}
__name(auditStatement2, "auditStatement");
async function prepareRefundRequest(db, args) {
  const tx = await loadTransaction(db, args.businessId, args.branchId, args.transactionId);
  if (tx.status === "PENDING_REFUND") {
    const pendingLines = normalizeRefundLines(asArray2(tx.pendingRefundItems));
    const requestedLines = args.itemsToReturn?.length ? refundLinesFor(tx, args.itemsToReturn) : pendingLines;
    if (pendingLines.length > 0 && sameRefundLines(pendingLines, requestedLines)) {
      tx.pendingRefundItems = pendingLines;
      return { transaction: tx, statements: [], idempotent: true };
    }
    throw new PolicyError("A different refund request is already pending for this receipt.", 409);
  }
  if (tx.status !== "PAID" && tx.status !== "PARTIAL_REFUND") {
    throw new PolicyError("Only paid receipts can be refunded.", 409);
  }
  const lines = refundLinesFor(tx, args.itemsToReturn);
  if (lines.length === 0) throw new PolicyError("No refundable items selected.", 400);
  const now = Date.now();
  tx.status = "PENDING_REFUND";
  tx.pendingRefundItems = lines;
  tx.updated_at = now;
  const statements = [
    db.prepare(`
      UPDATE transactions
      SET status = 'PENDING_REFUND', pendingRefundItems = ?, updated_at = ?
      WHERE id = ? AND businessId = ? AND branchId = ?
    `).bind(JSON.stringify(lines), now, tx.id, args.businessId, args.branchId),
    auditStatement2(db, {
      principal: args.principal,
      businessId: args.businessId,
      branchId: args.branchId,
      transactionId: tx.id,
      action: "sale.refund.request",
      severity: "WARN",
      details: `Refund request submitted for Ksh ${refundAmountFor(tx, lines).toLocaleString()}.`
    })
  ];
  return { transaction: tx, statements, idempotent: false };
}
__name(prepareRefundRequest, "prepareRefundRequest");
async function prepareRefundApproval(db, args) {
  if (!args.service && !APPROVER_ROLES5.has(args.principal.role)) {
    throw new PolicyError("You are not allowed to approve refunds.", 403);
  }
  if (!trimText18(args.idempotencyKey, 240)) {
    throw new PolicyError("Refund approval retry key is required.", 400);
  }
  const idempotentTransaction = await loadIdempotentRefundTransaction(
    db,
    args.businessId,
    args.branchId,
    args.idempotencyKey
  );
  if (idempotentTransaction) {
    return { transaction: idempotentTransaction, statements: [], idempotent: true };
  }
  const tx = await loadTransaction(db, args.businessId, args.branchId, args.transactionId);
  if (tx.status !== "PENDING_REFUND" && tx.status !== "PAID" && tx.status !== "PARTIAL_REFUND") {
    throw new PolicyError("This receipt is not waiting for refund approval.", 409);
  }
  if (tx.status !== "PENDING_REFUND" && !args.itemsToReturn?.length) {
    throw new PolicyError("Select the items to refund.", 400);
  }
  const lines = refundLinesFor(tx, args.itemsToReturn);
  if (lines.length === 0) throw new PolicyError("No refundable items selected.", 400);
  const refundAmount = refundAmountFor(tx, lines);
  const statements = [];
  const now = Date.now();
  const idemStatement = idempotencyStatement(db, {
    businessId: args.businessId,
    branchId: args.branchId,
    transactionId: tx.id,
    idempotencyKey: args.idempotencyKey,
    cashierName: args.principal.userName || null
  });
  if (idemStatement) statements.push(idemStatement);
  if (String(tx.paymentMethod || "").toUpperCase() === "CASH") {
    const cashAccount = await db.prepare(`
      SELECT id, balance
      FROM financialAccounts
      WHERE businessId = ? AND branchId = ? AND type = 'CASH'
      LIMIT 1
    `).bind(args.businessId, args.branchId).first();
    if (cashAccount) {
      if (asNumber16(cashAccount.balance) < refundAmount) throw new PolicyError("Insufficient cash account balance for this refund.", 409);
      statements.push(
        db.prepare(`UPDATE financialAccounts SET balance = balance - ?, updated_at = ? WHERE id = ? AND businessId = ?`).bind(refundAmount, now, cashAccount.id, args.businessId)
      );
    }
  }
  const movementDedupe = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const product = await productById(db, args.businessId, line.productId);
    if (!product) continue;
    if (product.branchId && product.branchId !== args.branchId) throw new PolicyError("Refund item belongs to another branch.", 403);
    if (isBundle2(product)) {
      const components = await loadBundleComponents(db, args.businessId, product);
      if (components.length === 0) throw new PolicyError(`${product.name} has no ingredients configured.`, 400);
      for (const component of components) {
        movementDedupe.set(component.productId, (movementDedupe.get(component.productId) || 0) + component.quantity * line.quantity);
      }
    } else {
      movementDedupe.set(line.productId, (movementDedupe.get(line.productId) || 0) + line.quantity);
    }
  }
  const txRef = String(tx.id).split("-")[0].toUpperCase();
  for (const [productId, quantity] of movementDedupe.entries()) {
    statements.push(
      db.prepare(`UPDATE products SET stockQuantity = stockQuantity + ?, updated_at = ? WHERE id = ? AND businessId = ?`).bind(quantity, now, productId, args.businessId)
    );
    statements.push(
      db.prepare(`
        INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        productId,
        "RETURN",
        quantity,
        now,
        `Return #${txRef}`,
        args.branchId,
        args.businessId,
        tx.shiftId || null,
        now
      )
    );
  }
  const updatedItems = asArray2(tx.items).map((item) => ({ ...item }));
  for (const line of lines) {
    const item = updatedItems.find((row) => row.productId === line.productId);
    if (item) item.returnedQuantity = asNumber16(item.returnedQuantity) + line.quantity;
  }
  const allReturned = updatedItems.every((item) => asNumber16(item.returnedQuantity) >= asNumber16(item.quantity));
  tx.items = updatedItems;
  tx.status = allReturned ? "REFUNDED" : "PARTIAL_REFUND";
  tx.pendingRefundItems = void 0;
  tx.approvedBy = trimText18(args.approvedBy || args.principal.userName, 120);
  tx.updated_at = now;
  statements.push(
    db.prepare(`
      UPDATE transactions
      SET status = ?, items = ?, pendingRefundItems = NULL, approvedBy = ?, updated_at = ?
      WHERE id = ? AND businessId = ? AND branchId = ?
    `).bind(tx.status, JSON.stringify(updatedItems), tx.approvedBy, now, tx.id, args.businessId, args.branchId)
  );
  statements.push(auditStatement2(db, {
    principal: args.principal,
    businessId: args.businessId,
    branchId: args.branchId,
    transactionId: tx.id,
    action: "sale.refund.approve",
    severity: "INFO",
    details: `Refund approved for Ksh ${refundAmount.toLocaleString()}.`
  }));
  return { transaction: tx, statements, idempotent: false };
}
__name(prepareRefundApproval, "prepareRefundApproval");

// api/sales/refund-approve.ts
var corsHeaders32 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json31(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders32 }
  });
}
__name(json31, "json");
var onRequestOptions30 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders32 }), "onRequestOptions");
var onRequestPost29 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json31({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const transactionId = String(body?.transactionId || body?.id || "").trim();
    if (!businessId || !branchId || !transactionId) return json31({ error: "Business, branch and receipt are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json31({ error: "Access denied." }, 403);
    await ensureRefundSchema(env.DB);
    const prepared = await prepareRefundApproval(env.DB, {
      businessId,
      branchId,
      principal: auth.principal,
      service: auth.service,
      transactionId,
      itemsToReturn: body?.itemsToReturn,
      approvedBy: body?.approvedBy,
      idempotencyKey: body?.idempotencyKey
    });
    if (prepared.statements.length) await env.DB.batch(prepared.statements);
    return json31({ success: true, transaction: prepared.transaction, idempotent: prepared.idempotent });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json31({ error: err?.message || "Could not approve refund." }, status);
  }
}, "onRequestPost");

// api/sales/refund-reject.ts
var APPROVER_ROLES6 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders33 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json32(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders33 }
  });
}
__name(json32, "json");
function asArray3(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
__name(asArray3, "asArray");
var onRequestOptions31 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders33 }), "onRequestOptions");
var onRequestPost30 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json32({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !APPROVER_ROLES6.has(auth.principal.role)) {
      return json32({ error: "You are not allowed to reject refunds." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const transactionId = String(body?.transactionId || body?.id || "").trim();
    if (!businessId || !branchId || !transactionId) return json32({ error: "Business, branch and sale are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json32({ error: "Access denied." }, 403);
    }
    await ensureRefundSchema(env.DB);
    const tx = await env.DB.prepare(`
      SELECT id, status, total, items, pendingRefundItems
      FROM transactions
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(transactionId, businessId, branchId).first();
    if (!tx) throw new PolicyError("Sale was not found.", 404);
    if (tx.status !== "PENDING_REFUND") throw new PolicyError("This receipt is not waiting for refund approval.", 409);
    const clean = deserializeRow4(tx);
    const restoredStatus = asArray3(clean.items).some((item) => Number(item?.returnedQuantity || 0) > 0) ? "PARTIAL_REFUND" : "PAID";
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE transactions SET status = ?, pendingRefundItems = NULL, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?`).bind(restoredStatus, now, transactionId, businessId, branchId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "sale.refund.reject",
        "transaction",
        transactionId,
        "WARN",
        `Rejected refund request for sale of Ksh ${Number(tx.total || 0).toLocaleString()}.`,
        businessId,
        branchId,
        now
      )
    ]);
    return json32({ success: true, transactionId });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json32({ error: err?.message || "Could not reject refund." }, status);
  }
}, "onRequestPost");

// api/sales/refund-request.ts
var corsHeaders34 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json33(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders34 }
  });
}
__name(json33, "json");
var onRequestOptions32 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders34 }), "onRequestOptions");
var onRequestPost31 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json33({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const transactionId = String(body?.transactionId || body?.id || "").trim();
    if (!businessId || !branchId || !transactionId) return json33({ error: "Business, branch and receipt are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json33({ error: "Access denied." }, 403);
    await ensureRefundSchema(env.DB);
    const prepared = await prepareRefundRequest(env.DB, {
      businessId,
      branchId,
      principal: auth.principal,
      transactionId,
      itemsToReturn: body?.itemsToReturn
    });
    if (prepared.statements.length) await env.DB.batch(prepared.statements);
    return json33({ success: true, transaction: prepared.transaction, idempotent: prepared.idempotent });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json33({ error: err?.message || "Could not request refund." }, status);
  }
}, "onRequestPost");

// api/settings/business.ts
var ADMIN_ROLES3 = /* @__PURE__ */ new Set(["ROOT", "ADMIN"]);
var corsHeaders35 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json34(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders35 }
  });
}
__name(json34, "json");
function text(value, fallback = "", max = 500) {
  const normalized = String(value ?? fallback).trim();
  return normalized.slice(0, max);
}
__name(text, "text");
function numberValue(value, fallback) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(numberValue, "numberValue");
function flag(value, fallback) {
  if (value === void 0 || value === null) return fallback;
  if (value === true || value === 1 || value === "1" || value === "true") return 1;
  if (value === false || value === 0 || value === "0" || value === "false") return 0;
  return fallback;
}
__name(flag, "flag");
async function ensureSchema17(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      storeName TEXT NOT NULL,
      location TEXT,
      tillNumber TEXT,
      kraPin TEXT,
      receiptFooter TEXT,
      ownerModeEnabled INTEGER DEFAULT 0,
      autoApproveOwnerActions INTEGER DEFAULT 1,
      cashSweepEnabled INTEGER DEFAULT 1,
      cashDrawerLimit REAL DEFAULT 5000,
      cashFloatTarget REAL DEFAULT 1000,
      aiAssistantEnabled INTEGER DEFAULT 1,
      aiDailyRequestLimit INTEGER DEFAULT 20,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  const columns = [
    ["location", "TEXT"],
    ["ownerModeEnabled", "INTEGER DEFAULT 0"],
    ["autoApproveOwnerActions", "INTEGER DEFAULT 1"],
    ["cashSweepEnabled", "INTEGER DEFAULT 1"],
    ["cashDrawerLimit", "REAL DEFAULT 5000"],
    ["cashFloatTarget", "REAL DEFAULT 1000"],
    ["aiAssistantEnabled", "INTEGER DEFAULT 1"],
    ["aiDailyRequestLimit", "INTEGER DEFAULT 20"],
    ["businessId", "TEXT"],
    ["updated_at", "INTEGER"]
  ];
  for (const [name, type] of columns) {
    try {
      await db.prepare(`ALTER TABLE settings ADD COLUMN ${name} ${type}`).run();
    } catch (err) {
    }
  }
}
__name(ensureSchema17, "ensureSchema");
var onRequestOptions33 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders35 }), "onRequestOptions");
var onRequestPost32 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json34({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !ADMIN_ROLES3.has(auth.principal.role)) return json34({ error: "Admin access required." }, 403);
    const body = await request.json().catch(() => null);
    const settings = body?.settings || body || {};
    const businessId = String(request.headers.get("X-Business-ID") || settings.businessId || auth.principal.businessId || "").trim();
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json34({ error: "Access denied." }, 403);
    await ensureSchema17(env.DB);
    const existing = await env.DB.prepare(`SELECT * FROM settings WHERE businessId = ? AND id = ? LIMIT 1`).bind(businessId, text(settings.id, `core_${businessId}`, 160)).first();
    const fallback = existing || {};
    const now = Date.now();
    const id = text(settings.id, fallback.id || `core_${businessId}`, 160);
    const canEditAi = auth.service || auth.principal.role === "ROOT";
    const saved = {
      id,
      storeName: text(settings.storeName, fallback.storeName || "Mtaani Shop", 160) || "Mtaani Shop",
      location: text(settings.location, fallback.location || "Nairobi, Kenya", 160),
      tillNumber: text(settings.tillNumber, fallback.tillNumber || "", 80),
      kraPin: text(settings.kraPin, fallback.kraPin || "", 80),
      receiptFooter: text(settings.receiptFooter, fallback.receiptFooter || "Thank you for shopping!", 500),
      ownerModeEnabled: flag(settings.ownerModeEnabled, numberValue(fallback.ownerModeEnabled, 0)),
      autoApproveOwnerActions: flag(settings.autoApproveOwnerActions, numberValue(fallback.autoApproveOwnerActions, 1)),
      cashSweepEnabled: flag(settings.cashSweepEnabled, numberValue(fallback.cashSweepEnabled, 1)),
      cashDrawerLimit: Math.max(0, numberValue(settings.cashDrawerLimit, numberValue(fallback.cashDrawerLimit, 5e3))),
      cashFloatTarget: Math.max(0, numberValue(settings.cashFloatTarget, numberValue(fallback.cashFloatTarget, 1e3))),
      aiAssistantEnabled: canEditAi ? flag(settings.aiAssistantEnabled, numberValue(fallback.aiAssistantEnabled, 1)) : numberValue(fallback.aiAssistantEnabled, 1),
      aiDailyRequestLimit: canEditAi ? Math.max(0, Math.floor(numberValue(settings.aiDailyRequestLimit, numberValue(fallback.aiDailyRequestLimit, 20)))) : numberValue(fallback.aiDailyRequestLimit, 20),
      businessId,
      updated_at: now
    };
    await env.DB.prepare(`
      INSERT OR REPLACE INTO settings (
        id, storeName, location, tillNumber, kraPin, receiptFooter,
        ownerModeEnabled, autoApproveOwnerActions, cashSweepEnabled, cashDrawerLimit, cashFloatTarget,
        aiAssistantEnabled, aiDailyRequestLimit, businessId, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      saved.id,
      saved.storeName,
      saved.location,
      saved.tillNumber,
      saved.kraPin,
      saved.receiptFooter,
      saved.ownerModeEnabled,
      saved.autoApproveOwnerActions,
      saved.cashSweepEnabled,
      saved.cashDrawerLimit,
      saved.cashFloatTarget,
      saved.aiAssistantEnabled,
      saved.aiDailyRequestLimit,
      businessId,
      now
    ).run();
    return json34({ success: true, settings: saved });
  } catch (err) {
    return json34({ error: err?.message || "Could not save business settings." }, 500);
  }
}, "onRequestPost");

// api/stock/adjustment-approve.ts
var APPROVER_ROLES7 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders36 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json35(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders36 }
  });
}
__name(json35, "json");
function asNumber17(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber17, "asNumber");
async function ensureSchema18(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockAdjustmentRequests (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      productName TEXT,
      oldQty REAL,
      newQty REAL,
      requestedQuantity REAL,
      reason TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      preparedBy TEXT,
      approvedBy TEXT,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  const adjustmentColumns = [
    "productName TEXT",
    "oldQty REAL",
    "newQty REAL",
    "requestedQuantity REAL",
    "preparedBy TEXT",
    "approvedBy TEXT",
    "branchId TEXT",
    "businessId TEXT",
    "updated_at INTEGER"
  ];
  for (const column of adjustmentColumns) {
    try {
      await db.prepare(`ALTER TABLE stockAdjustmentRequests ADD COLUMN ${column}`).run();
    } catch {
    }
  }
  try {
    await db.prepare("ALTER TABLE stockMovements ADD COLUMN shiftId TEXT").run();
  } catch {
  }
}
__name(ensureSchema18, "ensureSchema");
var onRequestOptions34 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders36 }), "onRequestOptions");
var onRequestPost33 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json35({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !APPROVER_ROLES7.has(auth.principal.role)) {
      return json35({ error: "You are not allowed to approve stock adjustments." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const requestId = String(body?.requestId || body?.id || "").trim();
    if (!businessId || !branchId || !requestId) return json35({ error: "Business, branch and request are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json35({ error: "Access denied." }, 403);
    }
    await ensureSchema18(env.DB);
    const req = await env.DB.prepare(`
      SELECT *
      FROM stockAdjustmentRequests
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(requestId, businessId, branchId).first();
    if (!req) throw new PolicyError("Stock adjustment request was not found.", 404);
    if (req.status !== "PENDING") throw new PolicyError("This stock adjustment has already been processed.", 409);
    const product = await env.DB.prepare(`
      SELECT id, name, stockQuantity, branchId
      FROM products
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(req.productId, businessId).first();
    if (!product) throw new PolicyError("Product was not found.", 404);
    if (product.branchId && product.branchId !== branchId) throw new PolicyError("Product belongs to another branch.", 403);
    const delta = asNumber17(req.newQty) - asNumber17(req.oldQty);
    const adjustedQty = Math.max(0, asNumber17(product.stockQuantity) + delta);
    const now = Date.now();
    const approvedBy = String(body?.approvedBy || auth.principal.userName || "Administrator").slice(0, 120);
    await env.DB.batch([
      env.DB.prepare(`UPDATE products SET stockQuantity = ?, updated_at = ? WHERE id = ? AND businessId = ?`).bind(adjustedQty, now, req.productId, businessId),
      env.DB.prepare(`
        INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        req.productId,
        "ADJUST",
        delta,
        now,
        `Approved Adj: ${String(req.reason || "").slice(0, 120)}`,
        branchId,
        businessId,
        req.shiftId || null,
        now
      ),
      env.DB.prepare(`UPDATE stockAdjustmentRequests SET status = 'APPROVED', approvedBy = ?, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?`).bind(approvedBy, now, requestId, businessId, branchId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "stock.adjust.approve",
        "stockAdjustmentRequest",
        requestId,
        "INFO",
        `Adjusted ${product.name} by ${delta}.`,
        businessId,
        branchId,
        now
      )
    ]);
    return json35({ success: true, productId: req.productId, stockQuantity: adjustedQty });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json35({ error: err?.message || "Could not approve stock adjustment." }, status);
  }
}, "onRequestPost");

// api/stock/adjustment-reject.ts
var APPROVER_ROLES8 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders37 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json36(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders37 }
  });
}
__name(json36, "json");
async function ensureSchema19(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockAdjustmentRequests (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      productName TEXT,
      oldQty REAL,
      newQty REAL,
      requestedQuantity REAL,
      reason TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      preparedBy TEXT,
      approvedBy TEXT,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  try {
    await db.prepare("ALTER TABLE stockAdjustmentRequests ADD COLUMN preparedBy TEXT").run();
  } catch {
  }
  try {
    await db.prepare("ALTER TABLE stockAdjustmentRequests ADD COLUMN approvedBy TEXT").run();
  } catch {
  }
  try {
    await db.prepare("ALTER TABLE stockAdjustmentRequests ADD COLUMN requestedQuantity REAL").run();
  } catch {
  }
  try {
    await db.prepare("ALTER TABLE stockAdjustmentRequests ADD COLUMN businessId TEXT").run();
  } catch {
  }
  try {
    await db.prepare("ALTER TABLE stockAdjustmentRequests ADD COLUMN branchId TEXT").run();
  } catch {
  }
  try {
    await db.prepare("ALTER TABLE stockAdjustmentRequests ADD COLUMN updated_at INTEGER").run();
  } catch {
  }
}
__name(ensureSchema19, "ensureSchema");
var onRequestOptions35 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders37 }), "onRequestOptions");
var onRequestPost34 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json36({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !APPROVER_ROLES8.has(auth.principal.role)) {
      return json36({ error: "You are not allowed to reject stock adjustments." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const requestId = String(body?.requestId || body?.id || "").trim();
    if (!businessId || !branchId || !requestId) return json36({ error: "Business, branch and request are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json36({ error: "Access denied." }, 403);
    }
    await ensureSchema19(env.DB);
    const req = await env.DB.prepare(`
      SELECT *
      FROM stockAdjustmentRequests
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(requestId, businessId, branchId).first();
    if (!req) throw new PolicyError("Stock adjustment request was not found.", 404);
    if (req.status !== "PENDING") throw new PolicyError("This stock adjustment has already been processed.", 409);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE stockAdjustmentRequests
        SET status = 'REJECTED', approvedBy = ?, updated_at = ?
        WHERE id = ? AND businessId = ? AND branchId = ? AND status = 'PENDING'
      `).bind(auth.principal.userName || "Administrator", now, requestId, businessId, branchId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "stock.adjust.reject",
        "stockAdjustmentRequest",
        requestId,
        "WARN",
        `Rejected stock adjustment for ${req.productName || req.productId}.`,
        businessId,
        branchId,
        now
      )
    ]);
    return json36({ success: true });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json36({ error: err?.message || "Could not reject stock adjustment." }, status);
  }
}, "onRequestPost");

// api/stock/adjustment-request.ts
var REQUEST_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER", "CASHIER"]);
var corsHeaders38 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json37(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders38 }
  });
}
__name(json37, "json");
function asNumber18(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber18, "asNumber");
function trimText19(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText19, "trimText");
async function ensureSchema20(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockAdjustmentRequests (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      productName TEXT,
      oldQty REAL,
      newQty REAL,
      requestedQuantity REAL,
      reason TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      preparedBy TEXT,
      approvedBy TEXT,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  const adjustmentColumns = [
    "productName TEXT",
    "oldQty REAL",
    "newQty REAL",
    "requestedQuantity REAL",
    "preparedBy TEXT",
    "approvedBy TEXT",
    "branchId TEXT",
    "businessId TEXT",
    "updated_at INTEGER"
  ];
  for (const column of adjustmentColumns) {
    try {
      await db.prepare(`ALTER TABLE stockAdjustmentRequests ADD COLUMN ${column}`).run();
    } catch {
    }
  }
}
__name(ensureSchema20, "ensureSchema");
var onRequestOptions36 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders38 }), "onRequestOptions");
var onRequestPost35 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json37({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !REQUEST_ROLES.has(auth.principal.role)) {
      return json37({ error: "You are not allowed to request stock adjustments." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const productId = trimText19(body?.productId, 160);
    if (!businessId || !branchId || !productId) return json37({ error: "Business, branch and product are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json37({ error: "Access denied." }, 403);
    }
    await ensureSchema20(env.DB);
    const product = await env.DB.prepare(`
      SELECT id, name, stockQuantity, branchId
      FROM products
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(productId, businessId).first();
    if (!product) throw new PolicyError("Product was not found.", 404);
    if (product.branchId && product.branchId !== branchId) throw new PolicyError("Product belongs to another branch.", 403);
    const newQty = asNumber18(body?.newQty);
    if (newQty < 0) throw new PolicyError("New stock quantity cannot be negative.", 400);
    const reason = trimText19(body?.reason, 240);
    if (!reason) throw new PolicyError("Adjustment reason is required.", 400);
    const now = Date.now();
    const oldQty = asNumber18(product.stockQuantity);
    const requestId = trimText19(body?.requestId || body?.id, 160) || crypto.randomUUID();
    const adjustment = {
      id: requestId,
      productId,
      productName: product.name,
      oldQty,
      newQty,
      requestedQuantity: newQty - oldQty,
      reason,
      timestamp: now,
      status: "PENDING",
      preparedBy: trimText19(body?.preparedBy || auth.principal.userName || "Staff", 120),
      branchId,
      businessId,
      updated_at: now
    };
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO stockAdjustmentRequests (id, productId, productName, oldQty, newQty, requestedQuantity, reason, timestamp, status, preparedBy, approvedBy, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        adjustment.id,
        adjustment.productId,
        adjustment.productName,
        adjustment.oldQty,
        adjustment.newQty,
        adjustment.requestedQuantity,
        adjustment.reason,
        adjustment.timestamp,
        adjustment.status,
        adjustment.preparedBy,
        null,
        branchId,
        businessId,
        now
      ),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "stock.adjust.request",
        "stockAdjustmentRequest",
        adjustment.id,
        "WARN",
        `Requested stock adjustment for ${product.name} from ${oldQty} to ${newQty}.`,
        businessId,
        branchId,
        now
      )
    ]);
    return json37({ success: true, adjustment });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json37({ error: err?.message || "Could not request stock adjustment." }, status);
  }
}, "onRequestPost");

// api/stock/restock.ts
var STOCK_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders39 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json38(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders39 }
  });
}
__name(json38, "json");
function asNumber19(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber19, "asNumber");
function roundMoney9(value) {
  return Math.round(value * 100) / 100;
}
__name(roundMoney9, "roundMoney");
function trimText20(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText20, "trimText");
async function ensureSchema21(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  try {
    await db.prepare("ALTER TABLE stockMovements ADD COLUMN shiftId TEXT").run();
  } catch {
  }
}
__name(ensureSchema21, "ensureSchema");
var onRequestOptions37 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders39 }), "onRequestOptions");
var onRequestPost36 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json38({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !STOCK_ROLES.has(auth.principal.role)) {
      return json38({ error: "You are not allowed to restock inventory." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const productId = String(body?.productId || "").trim();
    if (!businessId || !branchId || !productId) return json38({ error: "Business, branch and product are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json38({ error: "Access denied." }, 403);
    }
    const quantity = asNumber19(body?.quantity);
    if (quantity <= 0) throw new PolicyError("Enter a valid restock quantity.", 400);
    const hasCost = body?.costPrice !== void 0 && body?.costPrice !== null && body?.costPrice !== "";
    const costPrice = hasCost ? roundMoney9(asNumber19(body.costPrice)) : null;
    if (costPrice !== null && costPrice < 0) throw new PolicyError("Cost price cannot be negative.", 400);
    await ensureSchema21(env.DB);
    const product = await env.DB.prepare(`
      SELECT id, name, stockQuantity, costPrice, branchId
      FROM products
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(productId, businessId).first();
    if (!product) throw new PolicyError("Product was not found.", 404);
    if (product.branchId && product.branchId !== branchId) throw new PolicyError("Product belongs to another branch.", 403);
    const now = Date.now();
    const updateSql = costPrice !== null ? `UPDATE products SET stockQuantity = COALESCE(stockQuantity, 0) + ?, costPrice = ?, updated_at = ? WHERE id = ? AND businessId = ?` : `UPDATE products SET stockQuantity = COALESCE(stockQuantity, 0) + ?, updated_at = ? WHERE id = ? AND businessId = ?`;
    const updateProduct = costPrice !== null ? env.DB.prepare(updateSql).bind(quantity, costPrice, now, productId, businessId) : env.DB.prepare(updateSql).bind(quantity, now, productId, businessId);
    const nextStockQuantity = asNumber19(product.stockQuantity) + quantity;
    await env.DB.batch([
      updateProduct,
      env.DB.prepare(`
        INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        productId,
        "IN",
        quantity,
        now,
        trimText20(body?.reference, 160) || "Manual restock",
        branchId,
        businessId,
        body?.shiftId || null,
        now
      ),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "stock.restock",
        "product",
        productId,
        "INFO",
        `Restocked ${product.name} by ${quantity}.`,
        businessId,
        branchId,
        now
      )
    ]);
    return json38({
      success: true,
      productId,
      stockQuantity: nextStockQuantity,
      costPrice: costPrice ?? asNumber19(product.costPrice)
    });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json38({ error: err?.message || "Could not restock inventory." }, status);
  }
}, "onRequestPost");

// api/suppliers/credit-note.ts
var SUPPLIER_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders40 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json39(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders40 }
  });
}
__name(json39, "json");
function asNumber20(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber20, "asNumber");
function roundMoney10(value) {
  return Math.round(value * 100) / 100;
}
__name(roundMoney10, "roundMoney");
function trimText21(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText21, "trimText");
async function ensureSchema22(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
}
__name(ensureSchema22, "ensureSchema");
var onRequestOptions38 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders40 }), "onRequestOptions");
var onRequestPost37 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json39({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !SUPPLIER_ROLES.has(auth.principal.role)) {
      return json39({ error: "You are not allowed to record supplier credit notes." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const supplierId = String(body?.supplierId || "").trim();
    if (!businessId || !branchId || !supplierId) return json39({ error: "Business, branch and supplier are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json39({ error: "Access denied." }, 403);
    }
    await ensureSchema22(env.DB);
    const supplier = await env.DB.prepare(`
      SELECT id, name, company, branchId
      FROM suppliers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(supplierId, businessId).first();
    if (!supplier) throw new PolicyError("Supplier was not found.", 404);
    if (supplier.branchId && supplier.branchId !== branchId) throw new PolicyError("Supplier belongs to another branch.", 403);
    const amount = roundMoney10(asNumber20(body?.amount));
    if (amount <= 0) throw new PolicyError("Credit note amount must be more than zero.", 400);
    const productId = trimText21(body?.productId, 160);
    const quantity = asNumber20(body?.quantity);
    let product = null;
    if (productId) {
      if (quantity <= 0) throw new PolicyError("Return quantity must be greater than zero.", 400);
      product = await env.DB.prepare(`
        SELECT id, name, stockQuantity, branchId
        FROM products
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(productId, businessId).first();
      if (!product) throw new PolicyError("Selected product was not found.", 404);
      if (product.branchId && product.branchId !== branchId) throw new PolicyError("Selected product belongs to another branch.", 403);
      if (quantity > asNumber20(product.stockQuantity) + 1e-4) {
        throw new PolicyError(`Cannot return more than available stock (${asNumber20(product.stockQuantity)}).`, 409);
      }
    }
    const now = Date.now();
    const creditNoteId = trimText21(body?.creditNoteId, 160) || crypto.randomUUID();
    const reference = trimText21(body?.reference, 160) || creditNoteId.split("-")[0].toUpperCase();
    const creditNote = {
      id: creditNoteId,
      supplierId,
      amount,
      reference,
      reason: trimText21(body?.reason, 240) || null,
      status: "PENDING",
      timestamp: now,
      productId: product?.id || null,
      quantity: product ? quantity : null,
      shiftId: body?.shiftId || null,
      branchId,
      businessId,
      updated_at: now
    };
    const statements = [
      env.DB.prepare(`
        INSERT INTO creditNotes (id, supplierId, amount, reference, timestamp, reason, status, allocatedTo, productId, quantity, branchId, businessId, shiftId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        creditNote.id,
        creditNote.supplierId,
        creditNote.amount,
        creditNote.reference,
        creditNote.timestamp,
        creditNote.reason,
        creditNote.status,
        null,
        creditNote.productId,
        creditNote.quantity,
        branchId,
        businessId,
        creditNote.shiftId,
        now
      )
    ];
    if (product) {
      statements.push(
        env.DB.prepare(`UPDATE products SET stockQuantity = MAX(0, COALESCE(stockQuantity, 0) - ?), updated_at = ? WHERE id = ? AND businessId = ?`).bind(quantity, now, product.id, businessId),
        env.DB.prepare(`
          INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          product.id,
          "OUT",
          quantity,
          now,
          `Supplier Return: ${reference}`,
          branchId,
          businessId,
          body?.shiftId || null,
          now
        )
      );
    }
    statements.push(
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "supplier.creditNote.record",
        "creditNote",
        creditNote.id,
        "INFO",
        `Recorded supplier credit note of Ksh ${amount.toLocaleString()} for ${supplier.company || supplier.name}.`,
        businessId,
        branchId,
        now
      )
    );
    await env.DB.batch(statements);
    return json39({ success: true, creditNote });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json39({ error: err?.message || "Could not record supplier credit note." }, status);
  }
}, "onRequestPost");

// api/suppliers/payment.ts
var ALLOWED_ROLES = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders41 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json40(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders41 }
  });
}
__name(json40, "json");
function asNumber21(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber21, "asNumber");
function roundMoney11(value) {
  return Math.round(value * 100) / 100;
}
__name(roundMoney11, "roundMoney");
function asStringArray(value) {
  return Array.isArray(value) ? Array.from(new Set(value.map((v) => String(v || "").trim()).filter(Boolean))).slice(0, 100) : [];
}
__name(asStringArray, "asStringArray");
function trimText22(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText22, "trimText");
async function ensureSchema23(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS supplierPayments (
      id TEXT PRIMARY KEY,
      supplierId TEXT NOT NULL,
      purchaseOrderId TEXT,
      purchaseOrderIds TEXT,
      creditNoteIds TEXT,
      amount REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      transactionCode TEXT,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      source TEXT,
      accountId TEXT,
      shiftId TEXT,
      preparedBy TEXT,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  const paymentColumns = [
    "purchaseOrderId TEXT",
    "purchaseOrderIds TEXT",
    "creditNoteIds TEXT",
    "reference TEXT",
    "source TEXT",
    "accountId TEXT",
    "shiftId TEXT",
    "preparedBy TEXT",
    "branchId TEXT",
    "businessId TEXT",
    "updated_at INTEGER"
  ];
  for (const column of paymentColumns) {
    try {
      await db.prepare(`ALTER TABLE supplierPayments ADD COLUMN ${column}`).run();
    } catch {
    }
  }
}
__name(ensureSchema23, "ensureSchema");
var onRequestOptions39 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders41 }), "onRequestOptions");
var onRequestPost38 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json40({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !ALLOWED_ROLES.has(auth.principal.role)) {
      return json40({ error: "You are not allowed to settle supplier payments." }, 403);
    }
    const body = await request.json().catch(() => null);
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const supplierId = String(body?.supplierId || body?.supplier?.id || "").trim();
    const payment = body?.payment || {};
    if (!businessId || !branchId || !supplierId) return json40({ error: "Business, branch and supplier are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json40({ error: "Access denied." }, 403);
    }
    await ensureSchema23(env.DB);
    const supplier = await env.DB.prepare(`
      SELECT id, name, company, balance, branchId
      FROM suppliers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(supplierId, businessId).first();
    if (!supplier) throw new PolicyError("Supplier was not found.", 404);
    if (supplier.branchId && supplier.branchId !== branchId) throw new PolicyError("Supplier belongs to another branch.", 403);
    const cashAmount = roundMoney11(Math.max(0, asNumber21(payment.amount)));
    const source = String(payment.source || "TILL").toUpperCase() === "ACCOUNT" ? "ACCOUNT" : "TILL";
    const method = String(payment.method || "CASH").toUpperCase();
    const purchaseOrderIds = asStringArray(payment.purchaseOrderIds);
    const creditNoteIds = asStringArray(payment.creditNoteIds);
    let account = null;
    if (source === "ACCOUNT" && cashAmount > 0) {
      const accountId = trimText22(payment.accountId, 120);
      if (!accountId) throw new PolicyError("Select the funding account.", 400);
      account = await env.DB.prepare(`
        SELECT id, name, balance, branchId
        FROM financialAccounts
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(accountId, businessId).first();
      if (!account) throw new PolicyError("Selected account was not found.", 404);
      if (account.branchId && account.branchId !== branchId) throw new PolicyError("Selected account belongs to another branch.", 403);
      if (asNumber21(account.balance) < cashAmount) throw new PolicyError(`Insufficient funds in "${account.name}".`, 409);
    }
    const creditNotes = [];
    for (const creditNoteId of creditNoteIds) {
      const cn = await env.DB.prepare(`
        SELECT id, amount, supplierId, status
        FROM creditNotes
        WHERE id = ? AND businessId = ? AND (branchId IS NULL OR branchId = ?)
        LIMIT 1
      `).bind(creditNoteId, businessId, branchId).first();
      if (cn && cn.supplierId === supplierId && (!cn.status || cn.status === "PENDING")) creditNotes.push(cn);
    }
    const creditTotal = roundMoney11(creditNotes.reduce((sum, cn) => sum + asNumber21(cn.amount), 0));
    const totalDeduction = roundMoney11(cashAmount + creditTotal);
    if (totalDeduction <= 0) throw new PolicyError("Select an invoice, credit note, or enter an amount.", 400);
    if (totalDeduction > asNumber21(supplier.balance) + 0.01) {
      throw new PolicyError(`Payment exceeds supplier balance by Ksh ${roundMoney11(totalDeduction - asNumber21(supplier.balance)).toLocaleString()}.`, 409);
    }
    let invoicesToAllocate = [];
    if (purchaseOrderIds.length) {
      for (const poId of purchaseOrderIds) {
        const po = await env.DB.prepare(`
          SELECT id, supplierId, status, paymentStatus, totalAmount, paidAmount, orderDate, receivedDate
          FROM purchaseOrders
          WHERE id = ? AND businessId = ? AND branchId = ?
          LIMIT 1
        `).bind(poId, businessId, branchId).first();
        if (po && po.supplierId === supplierId && po.status === "RECEIVED" && po.paymentStatus !== "PAID") invoicesToAllocate.push(po);
      }
    } else {
      const { results } = await env.DB.prepare(`
        SELECT id, supplierId, status, paymentStatus, totalAmount, paidAmount, orderDate, receivedDate
        FROM purchaseOrders
        WHERE supplierId = ? AND businessId = ? AND branchId = ? AND status = 'RECEIVED' AND COALESCE(paymentStatus, 'UNPAID') != 'PAID'
      `).bind(supplierId, businessId, branchId).all();
      invoicesToAllocate = (results || []).sort((a, b) => asNumber21(a.receivedDate || a.orderDate) - asNumber21(b.receivedDate || b.orderDate));
    }
    const paymentId = crypto.randomUUID();
    const now = Date.now();
    const statements = [
      env.DB.prepare(`
        INSERT INTO supplierPayments (id, supplierId, purchaseOrderIds, creditNoteIds, amount, paymentMethod, transactionCode, timestamp, reference, source, accountId, branchId, businessId, shiftId, preparedBy, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        paymentId,
        supplierId,
        purchaseOrderIds.length ? JSON.stringify(purchaseOrderIds) : null,
        creditNoteIds.length ? JSON.stringify(creditNoteIds) : null,
        cashAmount,
        method,
        trimText22(payment.transactionCode, 80) || null,
        now,
        trimText22(payment.reference || "Supplier payment", 160),
        source,
        source === "ACCOUNT" ? trimText22(payment.accountId, 120) : null,
        branchId,
        businessId,
        body?.shiftId || null,
        trimText22(body?.preparedBy || auth.principal.userName, 120),
        now
      )
    ];
    for (const cn of creditNotes) {
      statements.push(
        env.DB.prepare(`UPDATE creditNotes SET status = 'ALLOCATED', allocatedTo = ?, updated_at = ? WHERE id = ? AND businessId = ?`).bind(paymentId, now, cn.id, businessId)
      );
    }
    let remainingPool = totalDeduction;
    let allocatedInvoiceCount = 0;
    for (const inv of invoicesToAllocate) {
      if (remainingPool <= 0) break;
      const due = Math.max(0, asNumber21(inv.totalAmount) - asNumber21(inv.paidAmount));
      const paymentForThisInv = Math.min(due, remainingPool);
      if (paymentForThisInv <= 0) continue;
      const newPaidAmount = roundMoney11(asNumber21(inv.paidAmount) + paymentForThisInv);
      statements.push(
        env.DB.prepare(`UPDATE purchaseOrders SET paidAmount = ?, paymentStatus = ?, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?`).bind(
          newPaidAmount,
          newPaidAmount >= asNumber21(inv.totalAmount) - 0.01 ? "PAID" : "PARTIAL",
          now,
          inv.id,
          businessId,
          branchId
        )
      );
      remainingPool = roundMoney11(remainingPool - paymentForThisInv);
      allocatedInvoiceCount += 1;
    }
    statements.push(
      env.DB.prepare(`UPDATE suppliers SET balance = MAX(0, COALESCE(balance, 0) - ?), updated_at = ? WHERE id = ? AND businessId = ?`).bind(totalDeduction, now, supplierId, businessId)
    );
    if (source === "ACCOUNT" && account && cashAmount > 0) {
      statements.push(
        env.DB.prepare(`UPDATE financialAccounts SET balance = balance - ?, updated_at = ? WHERE id = ? AND businessId = ?`).bind(cashAmount, now, account.id, businessId)
      );
    }
    statements.push(
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        "supplier.payment.settle",
        "supplierPayment",
        paymentId,
        "INFO",
        `Settled supplier payment of Ksh ${totalDeduction.toLocaleString()} for ${supplier.company || supplier.name}.`,
        businessId,
        branchId,
        now
      )
    );
    await env.DB.batch(statements);
    return json40({
      success: true,
      paymentId,
      cashAmount,
      creditTotal,
      totalDeduction,
      allocatedInvoiceCount
    });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json40({ error: err?.message || "Could not settle supplier payment." }, status);
  }
}, "onRequestPost");

// api/suppliers/profile.ts
var SUPPLIER_ROLES2 = /* @__PURE__ */ new Set(["ROOT", "ADMIN", "MANAGER"]);
var corsHeaders42 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json41(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders42 }
  });
}
__name(json41, "json");
function trimText23(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
__name(trimText23, "trimText");
async function ensureSchema24(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      kraPin TEXT,
      balance REAL DEFAULT 0,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  const supplierColumns = [
    "address TEXT",
    "kraPin TEXT",
    "balance REAL DEFAULT 0",
    "branchId TEXT",
    "businessId TEXT",
    "updated_at INTEGER"
  ];
  for (const column of supplierColumns) {
    try {
      await db.prepare(`ALTER TABLE suppliers ADD COLUMN ${column}`).run();
    } catch {
    }
  }
}
__name(ensureSchema24, "ensureSchema");
var onRequestOptions40 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders42 }), "onRequestOptions");
var onRequestPost39 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json41({ error: "DB binding missing" }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !SUPPLIER_ROLES2.has(auth.principal.role)) {
      return json41({ error: "You are not allowed to manage suppliers." }, 403);
    }
    const body = await request.json().catch(() => null);
    const action = String(body?.action || "SAVE").trim().toUpperCase();
    const businessId = String(request.headers.get("X-Business-ID") || body?.businessId || "").trim();
    const branchId = String(request.headers.get("X-Branch-ID") || body?.branchId || "").trim();
    const supplierId = trimText23(body?.supplierId || body?.supplier?.id, 160);
    if (!businessId || !branchId) return json41({ error: "Business and branch are required." }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json41({ error: "Access denied." }, 403);
    }
    await ensureSchema24(env.DB);
    const now = Date.now();
    if (action === "DELETE") {
      if (!supplierId) return json41({ error: "Supplier is required." }, 400);
      const supplier2 = await env.DB.prepare(`
        SELECT id, company, balance, branchId
        FROM suppliers
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(supplierId, businessId).first();
      if (!supplier2) throw new PolicyError("Supplier was not found.", 404);
      if (supplier2.branchId && supplier2.branchId !== branchId) throw new PolicyError("Supplier belongs to another branch.", 403);
      if (Number(supplier2.balance || 0) > 0.01) throw new PolicyError("Suppliers with an outstanding balance cannot be deleted.", 409);
      const refs = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM purchaseOrders WHERE supplierId = ? AND businessId = ?) +
          (SELECT COUNT(*) FROM supplierPayments WHERE supplierId = ? AND businessId = ?) +
          (SELECT COUNT(*) FROM creditNotes WHERE supplierId = ? AND businessId = ?) AS count
      `).bind(supplierId, businessId, supplierId, businessId, supplierId, businessId).first();
      if (Number(refs?.count || 0) > 0) throw new PolicyError("Suppliers with history should be kept for audit records.", 409);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM suppliers WHERE id = ? AND businessId = ?`).bind(supplierId, businessId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, "supplier.delete", "supplier", supplierId, "WARN", `Deleted supplier ${supplier2.company}.`, businessId, branchId, now)
      ]);
      return json41({ success: true, supplierId });
    }
    const supplier = body?.supplier || body || {};
    const company = trimText23(supplier.company, 120);
    if (!company) return json41({ error: "Supplier company is required." }, 400);
    const id = supplierId || crypto.randomUUID();
    const existing = await env.DB.prepare(`
      SELECT *
      FROM suppliers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(id, businessId).first();
    if (existing?.branchId && existing.branchId !== branchId) throw new PolicyError("Supplier belongs to another branch.", 403);
    const savedSupplier = {
      id,
      name: trimText23(supplier.name, 120) || company,
      company,
      phone: trimText23(supplier.phone, 40),
      email: trimText23(supplier.email, 120),
      address: trimText23(supplier.address, 240),
      kraPin: trimText23(supplier.kraPin, 40),
      balance: Number(existing?.balance || 0),
      branchId: existing?.branchId || branchId,
      businessId,
      updated_at: now
    };
    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR REPLACE INTO suppliers (id, name, company, phone, email, address, kraPin, balance, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(savedSupplier.id, savedSupplier.name, savedSupplier.company, savedSupplier.phone, savedSupplier.email, savedSupplier.address, savedSupplier.kraPin, savedSupplier.balance, savedSupplier.branchId, savedSupplier.businessId, now),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, existing ? "supplier.update" : "supplier.create", "supplier", id, "INFO", `${existing ? "Updated" : "Created"} supplier ${company}.`, businessId, branchId, now)
    ]);
    return json41({ success: true, supplier: savedSupplier });
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json41({ error: err?.message || "Could not save supplier." }, status);
  }
}, "onRequestPost");

// api/user/password.ts
var corsHeaders43 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json42(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders43
    }
  });
}
__name(json42, "json");
var onRequestOptions41 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders43 }), "onRequestOptions");
var onRequestPost40 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    if (!env.DB) return json42({ error: "Database is not configured." }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (auth.service || auth.principal.role === "ROOT") {
      return json42({ error: "Use the staff screen to reset business user passwords." }, 403);
    }
    const body = await request.json().catch(() => null);
    const currentPassword = String(body?.currentPassword || "");
    const newPassword = String(body?.newPassword || "");
    if (!currentPassword || !newPassword) return json42({ error: "Current and new password are required." }, 400);
    if (newPassword.length < 4) return json42({ error: "New password must be at least 4 characters." }, 400);
    const user = await env.DB.prepare("SELECT id, businessId, password FROM users WHERE id = ? AND businessId = ? LIMIT 1").bind(auth.principal.userId, auth.principal.businessId).first();
    if (!user) return json42({ error: "User not found. Please sign in again." }, 404);
    if (!await verifyPassword(currentPassword, String(user.password || ""))) {
      return json42({ error: "Incorrect current password." }, 401);
    }
    await env.DB.prepare("UPDATE users SET password = ?, updated_at = ? WHERE id = ? AND businessId = ?").bind(await hashPassword(newPassword), Date.now(), auth.principal.userId, auth.principal.businessId).run();
    return json42({ success: true });
  } catch (err) {
    console.error("[Password API]", err);
    return json42({ error: err?.message || "Could not update password." }, 500);
  }
}, "onRequestPost");

// api/mpesa/_secureCredentials.ts
var ENCRYPTED_PREFIX = "enc:v1:";
function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
__name(bytesToBase64, "bytesToBase64");
function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(base64ToBytes, "base64ToBytes");
async function importAesKey(keyMaterial) {
  const encoded = new TextEncoder().encode(keyMaterial);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
__name(importAesKey, "importAesKey");
function isEncryptedSecret(value) {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}
__name(isEncryptedSecret, "isEncryptedSecret");
async function encryptSecret(value, keyMaterial) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const key = await importAesKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(trimmed));
  return `${ENCRYPTED_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`;
}
__name(encryptSecret, "encryptSecret");
async function decryptSecret(value, keyMaterial) {
  if (!value) return void 0;
  if (!isEncryptedSecret(value)) return value;
  if (!keyMaterial) {
    throw new Error("M-Pesa safe storage key is missing. Add MPESA_CREDENTIAL_ENCRYPTION_KEY as a Pages secret.");
  }
  const [, , ivPart, cipherPart] = value.split(":");
  if (!ivPart || !cipherPart) throw new Error("Saved M-Pesa secret is damaged.");
  const key = await importAesKey(keyMaterial);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivPart) },
    key,
    base64ToBytes(cipherPart)
  );
  return new TextDecoder().decode(plain);
}
__name(decryptSecret, "decryptSecret");

// api/mpesa/settings.ts
var CONFIRM_PHRASE = "UPDATE MPESA";
var MAX_ATTEMPTS2 = 5;
var LOCKOUT_MS2 = 30 * 60 * 1e3;
var corsHeaders44 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json43(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders44,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
__name(json43, "json");
async function ensureAttemptTable2(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)").run();
}
__name(ensureAttemptTable2, "ensureAttemptTable");
async function rejectIfLocked(db, id) {
  const row = await db.prepare("SELECT count, lockedUntil FROM loginAttempts WHERE id = ?").bind(id).first();
  if (row?.lockedUntil && Date.now() < Number(row.lockedUntil)) {
    const minutes = Math.ceil((Number(row.lockedUntil) - Date.now()) / 6e4);
    return json43({ error: `M-Pesa settings are locked. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }, 423);
  }
  return null;
}
__name(rejectIfLocked, "rejectIfLocked");
async function recordFailedAttempt2(db, id) {
  const row = await db.prepare("SELECT count, lockedUntil FROM loginAttempts WHERE id = ?").bind(id).first();
  const count = Number(row?.count || 0) + 1;
  const lockedUntil = count >= MAX_ATTEMPTS2 ? Date.now() + LOCKOUT_MS2 : null;
  await db.prepare("INSERT OR REPLACE INTO loginAttempts (id, count, lockedUntil, updated_at) VALUES (?, ?, ?, ?)").bind(id, count, lockedUntil, Date.now()).run();
}
__name(recordFailedAttempt2, "recordFailedAttempt");
async function clearAttempts(db, id) {
  await db.prepare("DELETE FROM loginAttempts WHERE id = ?").bind(id).run();
}
__name(clearAttempts, "clearAttempts");
function statusFromBranch(branch) {
  const savedSecrets = [branch?.mpesaConsumerKey, branch?.mpesaConsumerSecret, branch?.mpesaPasskey].filter(Boolean);
  return {
    mpesaConfigured: !!(branch?.mpesaConsumerKey && branch?.mpesaConsumerSecret && branch?.mpesaPasskey),
    mpesaConsumerKeySet: !!branch?.mpesaConsumerKey,
    mpesaConsumerSecretSet: !!branch?.mpesaConsumerSecret,
    mpesaPasskeySet: !!branch?.mpesaPasskey,
    mpesaEnv: branch?.mpesaEnv || "sandbox",
    mpesaType: branch?.mpesaType || "paybill",
    mpesaStoreNumberSet: !!branch?.mpesaStoreNumber,
    credentialsEncrypted: savedSecrets.length > 0 && savedSecrets.every((value) => isEncryptedSecret(String(value)))
  };
}
__name(statusFromBranch, "statusFromBranch");
var onRequest3 = /* @__PURE__ */ __name(async ({ request, env }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders44 });
  if (request.method !== "POST") return json43({ error: "Method not allowed" }, 405);
  if (!env.DB) return json43({ error: "Database is not configured." }, 500);
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  const businessId = String(body?.businessId || request.headers.get("X-Business-ID") || "").trim();
  const branchId = String(body?.branchId || request.headers.get("X-Branch-ID") || "").trim();
  const userId = String(body?.userId || "").trim();
  const adminPassword = String(body?.adminPassword || "");
  const confirmationText = String(body?.confirmationText || "").trim().toUpperCase();
  if (!businessId || !branchId || !userId) return json43({ error: "Business, branch, and admin are required." }, 400);
  if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
    return json43({ error: "Access denied." }, 403);
  }
  if (!auth.service && auth.principal.role !== "ADMIN" && auth.principal.role !== "ROOT") {
    return json43({ error: "Only an administrator can change M-Pesa settings." }, 403);
  }
  if (!auth.service && auth.principal.role !== "ROOT" && auth.principal.userId !== userId) {
    return json43({ error: "Please sign in as the administrator making this change." }, 403);
  }
  await ensureAttemptTable2(env.DB);
  const attemptId = `MPESA_SETTINGS:${businessId}:${userId}`;
  const locked = await rejectIfLocked(env.DB, attemptId);
  if (locked) return locked;
  const user = await env.DB.prepare("SELECT id, name, role, password FROM users WHERE id = ? AND businessId = ? LIMIT 1").bind(userId, businessId).first();
  if (!user || user.role !== "ADMIN") return json43({ error: "Only an administrator can change M-Pesa settings." }, 403);
  const passwordOk = await verifyPassword(adminPassword, String(user.password || ""));
  const phraseOk = confirmationText === CONFIRM_PHRASE;
  if (!passwordOk || !phraseOk) {
    await recordFailedAttempt2(env.DB, attemptId);
    return json43({ error: `Security check failed. Enter the admin password and type ${CONFIRM_PHRASE}.` }, 401);
  }
  await clearAttempts(env.DB, attemptId);
  const branch = await env.DB.prepare("SELECT * FROM branches WHERE id = ? AND businessId = ? LIMIT 1").bind(branchId, businessId).first();
  if (!branch) return json43({ error: "Branch not found." }, 404);
  const credentials = body?.credentials || {};
  const secretUpdates = {};
  const consumerKey = String(credentials.consumerKey || "").trim();
  const consumerSecret = String(credentials.consumerSecret || "").trim();
  const passkey = String(credentials.passkey || "").trim();
  if (consumerKey || consumerSecret || passkey) {
    if (!env.MPESA_CREDENTIAL_ENCRYPTION_KEY) {
      return json43({ error: "M-Pesa safe storage key is missing. Add MPESA_CREDENTIAL_ENCRYPTION_KEY as a Pages secret before saving credentials." }, 500);
    }
    if (consumerKey) secretUpdates.mpesaConsumerKey = await encryptSecret(consumerKey, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
    if (consumerSecret) secretUpdates.mpesaConsumerSecret = await encryptSecret(consumerSecret, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
    if (passkey) secretUpdates.mpesaPasskey = await encryptSecret(passkey, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
  }
  if (env.MPESA_CREDENTIAL_ENCRYPTION_KEY) {
    for (const field of ["mpesaConsumerKey", "mpesaConsumerSecret", "mpesaPasskey"]) {
      const savedValue = branch[field];
      if (!secretUpdates[field] && savedValue && !isEncryptedSecret(String(savedValue))) {
        secretUpdates[field] = await encryptSecret(String(savedValue), env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
      }
    }
  }
  const updates = {
    mpesaEnv: credentials.env === "production" ? "production" : "sandbox",
    mpesaType: credentials.type === "buygoods" ? "buygoods" : "paybill",
    updated_at: Date.now(),
    ...secretUpdates
  };
  if (credentials.type === "buygoods") {
    updates.mpesaStoreNumber = String(credentials.storeNumber || "").trim() || branch.mpesaStoreNumber || null;
  } else if (Object.prototype.hasOwnProperty.call(credentials, "storeNumber")) {
    updates.mpesaStoreNumber = String(credentials.storeNumber || "").trim() || null;
  }
  const cols = Object.keys(updates);
  await env.DB.prepare(`UPDATE branches SET ${cols.map((col) => `${col} = ?`).join(", ")} WHERE id = ? AND businessId = ?`).bind(...cols.map((col) => updates[col]), branchId, businessId).run();
  const saved = await env.DB.prepare("SELECT * FROM branches WHERE id = ? AND businessId = ? LIMIT 1").bind(branchId, businessId).first();
  return json43({ success: true, status: statusFromBranch(saved) });
}, "onRequest");

// api/mpesa/stkpush.ts
var corsHeaders45 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function jsonHeaders2() {
  return { "Content-Type": "application/json", ...corsHeaders45 };
}
__name(jsonHeaders2, "jsonHeaders");
function formatPhone(phone) {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = "254" + cleaned.substring(1);
  if (cleaned.startsWith("7") || cleaned.startsWith("1")) cleaned = "254" + cleaned;
  if (cleaned.startsWith("+")) cleaned = cleaned.substring(1);
  return cleaned;
}
__name(formatPhone, "formatPhone");
var onRequest4 = /* @__PURE__ */ __name(async (context) => {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders45 });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders2() });
  }
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json();
    if (!body.amount || !body.phone || !body.businessId || !body.branchId) {
      return new Response(JSON.stringify({ error: "Amount, phone, businessId, and branchId are required" }), { status: 400, headers: jsonHeaders2() });
    }
    if (!canAccessBusiness(auth.principal, body.businessId) || !canAccessBranch(auth.principal, body.branchId)) {
      return new Response(JSON.stringify({ error: "Access denied" }), { status: 403, headers: jsonHeaders2() });
    }
    const phone = formatPhone(body.phone);
    const amount = Math.ceil(body.amount);
    const reference = body.reference || "POS_PAYMENT";
    const description = "Payment for items";
    let consumerKey, consumerSecret, passkey, shortcode, isProd, mpesaType, storeNumber;
    try {
      const branch = await env.DB.prepare(`
        SELECT mpesaConsumerKey, mpesaConsumerSecret, mpesaPasskey, mpesaEnv, tillNumber, mpesaType, mpesaStoreNumber 
        FROM branches 
        WHERE id = ? AND businessId = ?
      `).bind(body.branchId, body.businessId).first();
      if (branch && branch.mpesaConsumerKey && branch.mpesaConsumerSecret) {
        consumerKey = await decryptSecret(branch.mpesaConsumerKey, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
        consumerSecret = await decryptSecret(branch.mpesaConsumerSecret, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
        passkey = await decryptSecret(branch.mpesaPasskey, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
        isProd = branch.mpesaEnv === "production";
        mpesaType = branch.mpesaType || "paybill";
        if (mpesaType === "buygoods") {
          shortcode = branch.mpesaStoreNumber;
          storeNumber = branch.mpesaStoreNumber;
        } else {
          shortcode = branch.tillNumber;
        }
      } else {
        consumerKey = env.MPESA_CONSUMER_KEY;
        consumerSecret = env.MPESA_CONSUMER_SECRET;
        passkey = env.MPESA_PASSKEY;
        isProd = env.MPESA_ENV === "production";
        mpesaType = env.MPESA_TYPE || "paybill";
        if (mpesaType === "buygoods") {
          shortcode = env.MPESA_STORE_NUMBER;
          storeNumber = env.MPESA_STORE_NUMBER;
        } else {
          shortcode = env.MPESA_SHORTCODE;
        }
      }
    } catch (dbErr) {
      console.error("[DB Error fetching credentials]:", dbErr);
      isProd = false;
    }
    if (isProd && (!consumerKey || !consumerSecret || !shortcode || !passkey)) {
      throw new Error("M-Pesa configuration is incomplete for this branch in PRODUCTION mode.");
    }
    if (!consumerKey || !consumerSecret || !passkey || !shortcode) {
      throw new Error("M-Pesa configuration is missing (consumer key/secret/passkey/shortcode). Configure it per-branch or via environment variables.");
    }
    const baseUrl = isProd ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
    console.log(`[M-Pesa] Sending phone request (${mpesaType}) for branch=${body.branchId} env=${isProd ? "PRODUCTION" : "SANDBOX"}`);
    const authString = btoa(`${consumerKey}:${consumerSecret}`);
    const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { "Authorization": `Basic ${authString}` }
    });
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Failed to generate M-Pesa token: ${err}`);
    }
    const { access_token } = await tokenRes.json();
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const password = btoa(`${shortcode}${passkey}${timestamp}`);
    const callbackSecret = env.MPESA_CALLBACK_SECRET;
    if (!callbackSecret) {
      throw new Error("MPESA_CALLBACK_SECRET is not set. Refusing to initiate STK push without a protected callback path.");
    }
    const urlObj = new URL(request.url);
    const callbackUrl = `${urlObj.protocol}//${urlObj.host}/api/mpesa/callback/${callbackSecret}`;
    const isBuyGoods = mpesaType === "buygoods";
    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: isBuyGoods ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: isBuyGoods ? body.phone.replace(/\D/g, "").replace(/^0/, "254") : shortcode,
      // For Till, PartyB is the Till Number (handled via tillNumber in DB usually, but wait...)
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: reference,
      TransactionDesc: description
    };
    if (isBuyGoods) {
      const branchAgain = await env.DB.prepare(`SELECT tillNumber FROM branches WHERE id = ?`).bind(body.branchId).first();
      stkPayload.PartyB = branchAgain?.tillNumber || shortcode;
    }
    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(stkPayload)
    });
    const stkData = await stkRes.json();
    if (!stkRes.ok || stkData.errorCode) {
      throw new Error(`M-Pesa request failed: ${JSON.stringify(stkData)}`);
    }
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS mpesaCallbacks (
        checkoutRequestId TEXT PRIMARY KEY,
        merchantRequestId TEXT,
        resultCode INTEGER,
        resultDesc TEXT,
        amount REAL,
        receiptNumber TEXT,
        phoneNumber TEXT,
        businessId TEXT,
        branchId TEXT,
        timestamp INTEGER,
        utilizedTransactionId TEXT,
        utilizedCustomerId TEXT,
        utilizedCustomerName TEXT,
        utilizedAt INTEGER
      )
    `).run();
    for (const sql of [
      "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedTransactionId TEXT",
      "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerId TEXT",
      "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerName TEXT",
      "ALTER TABLE mpesaCallbacks ADD COLUMN utilizedAt INTEGER",
      "CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, branchId, receiptNumber)"
    ]) {
      try {
        await env.DB.prepare(sql).run();
      } catch (e) {
      }
    }
    await env.DB.prepare(`
      INSERT INTO mpesaCallbacks 
      (checkoutRequestId, merchantRequestId, resultCode, resultDesc, amount, phoneNumber, businessId, branchId, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      stkData.CheckoutRequestID,
      stkData.MerchantRequestID,
      999,
      "PENDING",
      amount,
      phone,
      body.businessId,
      body.branchId,
      Date.now()
    ).run();
    return new Response(JSON.stringify({
      success: true,
      message: stkData.CustomerMessage || "M-Pesa request sent successfully",
      checkoutRequestId: stkData.CheckoutRequestID
    }), { headers: jsonHeaders2() });
  } catch (err) {
    console.error("[M-Pesa Request Error]:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders2() });
  }
}, "onRequest");

// api/sync/flush.ts
var corsHeaders46 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json44(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders46, "Cache-Control": "no-store" }
  });
}
__name(json44, "json");
function serializeValue2(v) {
  if (v === null || v === void 0) return null;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}
__name(serializeValue2, "serializeValue");
async function ensureSyncSchema(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS idempotencyKeys (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      idempotencyKey TEXT NOT NULL,
      operation TEXT NOT NULL,
      deviceId TEXT,
      cashierName TEXT,
      createdAt INTEGER NOT NULL
    )`
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_lookup ON idempotencyKeys(businessId, branchId, idempotencyKey)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS productIngredients (id TEXT PRIMARY KEY, productId TEXT NOT NULL, ingredientProductId TEXT NOT NULL, quantity REAL NOT NULL, businessId TEXT, updated_at INTEGER)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS stockMovements (id TEXT PRIMARY KEY, productId TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, timestamp INTEGER NOT NULL, reference TEXT, branchId TEXT, businessId TEXT, shiftId TEXT, updated_at INTEGER)").run();
  const migrations = [
    "ALTER TABLE transactions ADD COLUMN branchId TEXT",
    "ALTER TABLE transactions ADD COLUMN businessId TEXT",
    "ALTER TABLE transactions ADD COLUMN shiftId TEXT",
    "ALTER TABLE transactions ADD COLUMN approvedBy TEXT",
    "ALTER TABLE transactions ADD COLUMN pendingRefundItems TEXT",
    "ALTER TABLE transactions ADD COLUMN changeGiven REAL",
    "ALTER TABLE transactions ADD COLUMN mpesaReference TEXT",
    "ALTER TABLE transactions ADD COLUMN mpesaCode TEXT",
    "ALTER TABLE transactions ADD COLUMN mpesaCustomer TEXT",
    "ALTER TABLE transactions ADD COLUMN mpesaCheckoutRequestId TEXT",
    "ALTER TABLE transactions ADD COLUMN cashierId TEXT",
    "ALTER TABLE transactions ADD COLUMN customerId TEXT",
    "ALTER TABLE transactions ADD COLUMN customerName TEXT",
    "ALTER TABLE transactions ADD COLUMN discount REAL",
    "ALTER TABLE transactions ADD COLUMN discountType TEXT",
    "ALTER TABLE transactions ADD COLUMN splitPayments TEXT",
    "ALTER TABLE transactions ADD COLUMN splitData TEXT",
    "ALTER TABLE transactions ADD COLUMN isSynced INTEGER",
    "ALTER TABLE products ADD COLUMN businessId TEXT",
    "ALTER TABLE products ADD COLUMN branchId TEXT",
    "ALTER TABLE products ADD COLUMN unit TEXT",
    "ALTER TABLE products ADD COLUMN costPrice REAL",
    "ALTER TABLE products ADD COLUMN taxCategory TEXT DEFAULT 'A'",
    "ALTER TABLE products ADD COLUMN isBundle INTEGER DEFAULT 0",
    "ALTER TABLE products ADD COLUMN components TEXT",
    "ALTER TABLE products ADD COLUMN updated_at INTEGER",
    "ALTER TABLE customers ADD COLUMN totalSpent REAL",
    "ALTER TABLE customers ADD COLUMN balance REAL",
    "ALTER TABLE customers ADD COLUMN businessId TEXT",
    "ALTER TABLE customers ADD COLUMN updated_at INTEGER",
    "ALTER TABLE productIngredients ADD COLUMN businessId TEXT",
    "ALTER TABLE stockMovements ADD COLUMN reference TEXT",
    "ALTER TABLE stockMovements ADD COLUMN branchId TEXT",
    "ALTER TABLE stockMovements ADD COLUMN businessId TEXT",
    "ALTER TABLE stockMovements ADD COLUMN shiftId TEXT",
    "ALTER TABLE stockMovements ADD COLUMN updated_at INTEGER"
  ];
  for (const sql of migrations) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureSyncSchema, "ensureSyncSchema");
var onRequest5 = /* @__PURE__ */ __name(async (context) => {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders46 });
  if (request.method !== "POST") return json44({ error: "Method not allowed" }, 405);
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DB) return json44({ error: "DB binding missing" }, 500);
  await ensureSyncSchema(env.DB);
  const businessId = request.headers.get("X-Business-ID") || "";
  const branchId = request.headers.get("X-Branch-ID") || "";
  if (!businessId || !branchId) return json44({ error: "X-Business-ID and X-Branch-ID required" }, 400);
  if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json44({ error: "Access denied" }, 403);
  const body = await request.json().catch(() => null);
  const deviceId = body?.deviceId ? String(body.deviceId).slice(0, 120) : null;
  const cashierName = body?.cashierName ? String(body.cashierName).slice(0, 120) : null;
  const mutations = Array.isArray(body?.mutations) ? body.mutations : [];
  if (mutations.length === 0) return json44({ success: true, applied: 0, skipped: 0 });
  if (mutations.length > 25) return json44({ error: "Too many offline sales in one sync request." }, 413);
  if (mutations.some((m) => m.table !== "transactions" || m.op !== "UPSERT" || !String(m.idempotencyKey || "").trim())) {
    return json44({ error: "Offline sync only accepts valid sale records." }, 400);
  }
  const idemIds = mutations.map((m) => `${businessId}|${branchId}|${String(m.idempotencyKey || "").trim()}`);
  const placeholders = idemIds.map(() => "?").join(",");
  const existingIdem = placeholders ? await env.DB.prepare(`SELECT id FROM idempotencyKeys WHERE id IN (${placeholders})`).bind(...idemIds).all() : { results: [] };
  const existingIdemIds = new Set((existingIdem.results || []).map((row) => String(row.id)));
  const validMutations = mutations.filter((m) => {
    const idempotencyKey = String(m.idempotencyKey || "").trim();
    return !existingIdemIds.has(`${businessId}|${branchId}|${idempotencyKey}`);
  });
  const skippedCount = mutations.length - validMutations.length;
  if (validMutations.length === 0) {
    return json44({ success: true, applied: 0, skipped: skippedCount });
  }
  const finalBatch = [];
  const { results: pragma } = await env.DB.prepare(`PRAGMA table_info('transactions')`).all();
  const validTxCols = new Set(pragma.map((r) => r.name));
  const transactionMutations = validMutations.filter((m) => m.table === "transactions" && m.op === "UPSERT");
  const payloads = transactionMutations.map((m) => m.payload || {});
  let sideEffects = [];
  try {
    sideEffects = await hardenTransactionBatch({
      db: env.DB,
      businessId,
      branchId,
      principal: auth.principal,
      service: auth.service,
      sourceLabel: "Sale (Sync)"
    }, payloads);
  } catch (err) {
    const status = err instanceof PolicyError ? err.status : 400;
    return json44({ error: err?.message || "Offline sale was rejected." }, status);
  }
  for (const payload of payloads) {
    payload.businessId = businessId;
    payload.branchId = branchId;
    const cols = Object.keys(payload).filter((k) => validTxCols.has(k));
    if (cols.length > 0) {
      const sql = `INSERT OR REPLACE INTO transactions (${cols.map((c) => '"' + c + '"').join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
      finalBatch.push(env.DB.prepare(sql).bind(...cols.map((c) => serializeValue2(payload[c]))));
    }
  }
  finalBatch.push(...sideEffects);
  for (const m of validMutations) {
    const idempotencyKey = String(m.idempotencyKey || "").trim();
    const idemId = `${businessId}|${branchId}|${idempotencyKey}`;
    finalBatch.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO idempotencyKeys (id, businessId, branchId, idempotencyKey, operation, deviceId, cashierName, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(idemId, businessId, branchId, idempotencyKey, "transactions:UPSERT", deviceId, cashierName, Date.now())
    );
  }
  try {
    if (finalBatch.length > 0) {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < finalBatch.length; i += CHUNK_SIZE) {
        await env.DB.batch(finalBatch.slice(i, i + CHUNK_SIZE));
      }
    }
  } catch (err) {
    console.error("[Sync Flush Error]", err?.message || err);
    return json44({ error: err?.message || "Offline sync failed." }, 500);
  }
  return json44({ success: true, applied: validMutations.length, skipped: skippedCount });
}, "onRequest");

// api/sync/heartbeat.ts
var corsHeaders47 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json45(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders47, "Cache-Control": "no-store" }
  });
}
__name(json45, "json");
async function ensureDeviceSyncSchema(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS deviceSyncStatus (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      deviceId TEXT NOT NULL,
      cashierName TEXT,
      lastSyncAt INTEGER,
      updated_at INTEGER
    )`
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_deviceSyncStatus_branch ON deviceSyncStatus(businessId, branchId, lastSyncAt)").run();
}
__name(ensureDeviceSyncSchema, "ensureDeviceSyncSchema");
var onRequest6 = /* @__PURE__ */ __name(async (context) => {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders47 });
  if (request.method !== "POST") return json45({ error: "Method not allowed" }, 405);
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DB) return json45({ error: "DB binding missing" }, 500);
  await ensureDeviceSyncSchema(env.DB);
  const businessId = request.headers.get("X-Business-ID") || "";
  const branchId = request.headers.get("X-Branch-ID") || "";
  if (!businessId || !branchId) return json45({ error: "X-Business-ID and X-Branch-ID required" }, 400);
  if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json45({ error: "Access denied" }, 403);
  const body = await request.json().catch(() => null);
  const deviceId = String(body?.deviceId || "").trim();
  const cashierName = body?.cashierName ? String(body.cashierName).slice(0, 120) : null;
  const lastSyncAt = Number(body?.lastSyncAt || Date.now());
  if (!deviceId) return json45({ error: "deviceId required" }, 400);
  const id = `${businessId}|${branchId}|${deviceId}`;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO deviceSyncStatus (id, businessId, branchId, deviceId, cashierName, lastSyncAt, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, businessId, branchId, deviceId, cashierName, lastSyncAt, Date.now()).run();
  return json45({ success: true });
}, "onRequest");

// api/sync/status.ts
var corsHeaders48 = {
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json46(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders48, "Cache-Control": "no-store" }
  });
}
__name(json46, "json");
async function ensureDeviceSyncSchema2(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS deviceSyncStatus (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      deviceId TEXT NOT NULL,
      cashierName TEXT,
      lastSyncAt INTEGER,
      updated_at INTEGER
    )`
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_deviceSyncStatus_branch ON deviceSyncStatus(businessId, branchId, lastSyncAt)").run();
}
__name(ensureDeviceSyncSchema2, "ensureDeviceSyncSchema");
var onRequest7 = /* @__PURE__ */ __name(async (context) => {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders48 });
  if (request.method !== "GET") return json46({ error: "Method not allowed" }, 405);
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DB) return json46({ error: "DB binding missing" }, 500);
  await ensureDeviceSyncSchema2(env.DB);
  const businessId = request.headers.get("X-Business-ID") || "";
  const branchId = request.headers.get("X-Branch-ID") || "";
  if (!businessId || !branchId) return json46({ error: "X-Business-ID and X-Branch-ID required" }, 400);
  if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json46({ error: "Access denied" }, 403);
  const { results } = await env.DB.prepare(
    `SELECT deviceId, cashierName, lastSyncAt, updated_at
     FROM deviceSyncStatus
     WHERE businessId = ? AND branchId = ?
     ORDER BY lastSyncAt DESC
     LIMIT 100`
  ).bind(businessId, branchId).all();
  return json46({ success: true, rows: results || [] });
}, "onRequest");

// api/images/[id].ts
var MAX_IMAGE_BYTES = 2 * 1024 * 1024;
var ALLOWED_TYPES = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
var onRequestPost41 = /* @__PURE__ */ __name(async (context) => {
  const { request, env } = context;
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;
  if (!auth.service && auth.principal.role !== "ADMIN" && auth.principal.role !== "MANAGER" && auth.principal.role !== "ROOT") {
    return new Response(JSON.stringify({ error: "Admin or manager access required." }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
  const formData = await request.formData();
  const file = formData.get("file");
  if (!file) {
    return new Response("No file uploaded", { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return new Response(JSON.stringify({ error: "Only JPEG, PNG, WebP, or GIF images are allowed." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return new Response(JSON.stringify({ error: "Image is too large. Use an image below 2 MB." }), {
      status: 413,
      headers: { "Content-Type": "application/json" }
    });
  }
  const id = crypto.randomUUID();
  const buffer = await file.arrayBuffer();
  await env.IMAGES_KV.put(id, buffer, {
    metadata: {
      name: file.name,
      type: file.type,
      uploadedBy: auth.principal.userId,
      businessId: auth.principal.businessId || ""
    }
  });
  return new Response(JSON.stringify({ id, url: `/api/images/${id}` }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}, "onRequestPost");
var onRequestGet2 = /* @__PURE__ */ __name(async (context) => {
  const { env, params } = context;
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!id) return new Response("Not found", { status: 404 });
  const { value, metadata } = await env.IMAGES_KV.getWithMetadata(id, { type: "arrayBuffer" });
  if (!value) return new Response("Not found", { status: 404 });
  return new Response(value, {
    headers: {
      "Content-Type": metadata?.type || "image/png",
      "Cache-Control": "public, max-age=31536000",
      "X-Content-Type-Options": "nosniff"
    }
  });
}, "onRequestGet");

// api/billing/[[action]].ts
var corsHeaders49 = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function json47(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders49 }
  });
}
__name(json47, "json");
function asNumber22(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber22, "asNumber");
function boolInt(value, fallback = 0) {
  if (value === void 0 || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}
__name(boolInt, "boolInt");
function clamp2(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
__name(clamp2, "clamp");
function timingSafeEqual3(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(timingSafeEqual3, "timingSafeEqual");
function currentPeriod(now = /* @__PURE__ */ new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
__name(currentPeriod, "currentPeriod");
function dueDateMs(period, dueDay) {
  const [year, month] = period.split("-").map(Number);
  const d = new Date(year, (month || 1) - 1, clamp2(Math.floor(dueDay || 1), 1, 28), 23, 59, 59, 999);
  return d.getTime();
}
__name(dueDateMs, "dueDateMs");
function invoiceIdFor(businessId, period) {
  return `bill_${businessId}_${period}`;
}
__name(invoiceIdFor, "invoiceIdFor");
function paymentStatus(resultCode) {
  const code = Number(resultCode);
  if (code === 0) return "PAID";
  if (code === 999) return "PENDING";
  return "FAILED";
}
__name(paymentStatus, "paymentStatus");
function formatPhone2(phone) {
  let cleaned = String(phone || "").replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = `254${cleaned.substring(1)}`;
  if (cleaned.startsWith("7") || cleaned.startsWith("1")) cleaned = `254${cleaned}`;
  return cleaned;
}
__name(formatPhone2, "formatPhone");
async function ensureBillingSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS billingAccounts (
      businessId TEXT PRIMARY KEY,
      monthlyBaseFee REAL DEFAULT 3000,
      pricePerBranch REAL DEFAULT 500,
      discountType TEXT DEFAULT 'FIXED',
      discountValue REAL DEFAULT 0,
      dueDay INTEGER DEFAULT 5,
      bannerEnabled INTEGER DEFAULT 0,
      bannerMessage TEXT,
      allowPartial INTEGER DEFAULT 1,
      minPaymentAmount REAL DEFAULT 500,
      status TEXT DEFAULT 'ACTIVE',
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS billingInvoices (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      period TEXT NOT NULL,
      branchCount INTEGER DEFAULT 0,
      monthlyBaseFee REAL DEFAULT 0,
      pricePerBranch REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
      discountType TEXT DEFAULT 'FIXED',
      discountValue REAL DEFAULT 0,
      discountAmount REAL DEFAULT 0,
      totalDue REAL DEFAULT 0,
      amountPaid REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      dueDate INTEGER,
      status TEXT DEFAULT 'PENDING',
      notes TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS billingPayments (
      id TEXT PRIMARY KEY,
      invoiceId TEXT NOT NULL,
      businessId TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      status TEXT DEFAULT 'PAID',
      receiptNumber TEXT,
      phoneNumber TEXT,
      checkoutRequestId TEXT,
      merchantRequestId TEXT,
      resultCode INTEGER,
      resultDesc TEXT,
      recordedBy TEXT,
      notes TEXT,
      timestamp INTEGER,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    "CREATE INDEX IF NOT EXISTS idx_billingInvoices_business ON billingInvoices(businessId, period)",
    "CREATE INDEX IF NOT EXISTS idx_billingPayments_invoice ON billingPayments(invoiceId, status)",
    "CREATE INDEX IF NOT EXISTS idx_billingPayments_checkout ON billingPayments(checkoutRequestId)"
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
    }
  }
}
__name(ensureBillingSchema, "ensureBillingSchema");
async function first2(db, sql, ...bindings) {
  const row = await db.prepare(sql).bind(...bindings).first();
  return row;
}
__name(first2, "first");
async function getAccount(db, businessId) {
  const row = await first2(db, "SELECT * FROM billingAccounts WHERE businessId = ?", businessId);
  if (row) return row;
  const account = {
    businessId,
    monthlyBaseFee: 3e3,
    pricePerBranch: 500,
    discountType: "FIXED",
    discountValue: 0,
    dueDay: 5,
    bannerEnabled: 0,
    bannerMessage: "Your Mtaani POS software subscription is due. Pay by M-Pesa to keep your account current.",
    allowPartial: 1,
    minPaymentAmount: 500,
    status: "ACTIVE",
    updated_at: Date.now()
  };
  await db.prepare(`
    INSERT OR REPLACE INTO billingAccounts
    (businessId, monthlyBaseFee, pricePerBranch, discountType, discountValue, dueDay, bannerEnabled, bannerMessage, allowPartial, minPaymentAmount, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    account.businessId,
    account.monthlyBaseFee,
    account.pricePerBranch,
    account.discountType,
    account.discountValue,
    account.dueDay,
    account.bannerEnabled,
    account.bannerMessage,
    account.allowPartial,
    account.minPaymentAmount,
    account.status,
    account.updated_at
  ).run();
  return account;
}
__name(getAccount, "getAccount");
async function branchCount(db, businessId) {
  const row = await first2(db, "SELECT COUNT(*) AS count FROM branches WHERE businessId = ? AND COALESCE(isActive, 1) != 0", businessId);
  return asNumber22(row?.count, 0);
}
__name(branchCount, "branchCount");
async function recomputeInvoice(db, invoiceId) {
  const invoice = await first2(db, "SELECT * FROM billingInvoices WHERE id = ?", invoiceId);
  if (!invoice) return null;
  const paidRow = await first2(db, "SELECT COALESCE(SUM(amount), 0) AS paid FROM billingPayments WHERE invoiceId = ? AND status = 'PAID'", invoiceId);
  const amountPaid = Math.max(0, asNumber22(paidRow?.paid, 0));
  const totalDue = Math.max(0, asNumber22(invoice.totalDue, 0));
  const balance = Math.max(0, totalDue - amountPaid);
  const status = balance <= 0 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "PENDING";
  await db.prepare("UPDATE billingInvoices SET amountPaid = ?, balance = ?, status = ?, updated_at = ? WHERE id = ?").bind(amountPaid, balance, status, Date.now(), invoiceId).run();
  return { ...invoice, amountPaid, balance, status };
}
__name(recomputeInvoice, "recomputeInvoice");
async function ensureInvoice(db, businessId, period = currentPeriod()) {
  const account = await getAccount(db, businessId);
  const branches = await branchCount(db, businessId);
  const monthlyBaseFee = Math.max(0, asNumber22(account.monthlyBaseFee, 0));
  const pricePerBranch = Math.max(0, asNumber22(account.pricePerBranch, 0));
  const subtotal = monthlyBaseFee + branches * pricePerBranch;
  const discountType = account.discountType === "PERCENT" ? "PERCENT" : "FIXED";
  const rawDiscount = Math.max(0, asNumber22(account.discountValue, 0));
  const discountAmount = discountType === "PERCENT" ? subtotal * clamp2(rawDiscount, 0, 100) / 100 : Math.min(subtotal, rawDiscount);
  const totalDue = Math.max(0, subtotal - discountAmount);
  const id = invoiceIdFor(businessId, period);
  const existing = await first2(db, "SELECT amountPaid, created_at FROM billingInvoices WHERE id = ?", id);
  const amountPaid = Math.max(0, asNumber22(existing?.amountPaid, 0));
  const balance = Math.max(0, totalDue - amountPaid);
  const status = balance <= 0 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "PENDING";
  const now = Date.now();
  await db.prepare(`
    INSERT OR REPLACE INTO billingInvoices
    (id, businessId, period, branchCount, monthlyBaseFee, pricePerBranch, subtotal, discountType, discountValue, discountAmount, totalDue, amountPaid, balance, dueDate, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    businessId,
    period,
    branches,
    monthlyBaseFee,
    pricePerBranch,
    subtotal,
    discountType,
    rawDiscount,
    discountAmount,
    totalDue,
    amountPaid,
    balance,
    dueDateMs(period, account.dueDay),
    status,
    existing?.created_at || now,
    now
  ).run();
  return { id, businessId, period, branchCount: branches, monthlyBaseFee, pricePerBranch, subtotal, discountType, discountValue: rawDiscount, discountAmount, totalDue, amountPaid, balance, dueDate: dueDateMs(period, account.dueDay), status };
}
__name(ensureInvoice, "ensureInvoice");
async function billingSummary(db) {
  const { results } = await db.prepare("SELECT id, name, code, isActive FROM businesses ORDER BY name").all();
  const rows = [];
  for (const business of results || []) {
    const account = await getAccount(db, business.id);
    const invoice = await ensureInvoice(db, business.id);
    rows.push({
      business,
      branchCount: invoice.branchCount,
      account,
      invoice
    });
  }
  return rows;
}
__name(billingSummary, "billingSummary");
function mpesaConfig(env) {
  const consumerKey = env.BILLING_MPESA_CONSUMER_KEY;
  const consumerSecret = env.BILLING_MPESA_CONSUMER_SECRET;
  const shortcode = env.BILLING_MPESA_SHORTCODE;
  const passkey = env.BILLING_MPESA_PASSKEY;
  const callbackSecret = env.BILLING_MPESA_CALLBACK_SECRET;
  const isProd = env.BILLING_MPESA_ENV === "production";
  if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackSecret) return null;
  return {
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    callbackSecret,
    baseUrl: isProd ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke",
    envName: isProd ? "production" : "sandbox"
  };
}
__name(mpesaConfig, "mpesaConfig");
async function triggerBillingStk(request, env, body) {
  const businessId = String(body?.businessId || "").trim();
  const phone = formatPhone2(String(body?.phone || ""));
  if (!businessId || !phone) return json47({ error: "Business and phone are required." }, 400);
  const account = await getAccount(env.DB, businessId);
  const invoice = await ensureInvoice(env.DB, businessId, String(body?.period || currentPeriod()));
  const balance = Math.max(0, asNumber22(invoice.balance, 0));
  if (balance <= 0) return json47({ error: "This bill is already fully paid." }, 400);
  let amount = Math.ceil(asNumber22(body?.amount, balance));
  if (!account.allowPartial) amount = Math.ceil(balance);
  if (amount <= 0) return json47({ error: "Enter a valid amount." }, 400);
  if (amount > balance) amount = Math.ceil(balance);
  if (account.allowPartial && amount < Math.min(balance, Math.max(1, asNumber22(account.minPaymentAmount, 1)))) {
    return json47({ error: `Minimum partial payment is Ksh ${Math.round(asNumber22(account.minPaymentAmount, 1)).toLocaleString()}.` }, 400);
  }
  const config = mpesaConfig(env);
  if (!config) return json47({ error: "Billing M-Pesa is not configured. Add BILLING_MPESA_* Pages secrets first." }, 500);
  const authString = btoa(`${config.consumerKey}:${config.consumerSecret}`);
  const tokenRes = await fetch(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${authString}` }
  });
  if (!tokenRes.ok) throw new Error(`Failed to generate billing M-Pesa token: ${await tokenRes.text()}`);
  const { access_token } = await tokenRes.json();
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const password = btoa(`${config.shortcode}${config.passkey}${timestamp}`);
  const urlObj = new URL(request.url);
  const callbackUrl = `${urlObj.protocol}//${urlObj.host}/api/billing/callback/${config.callbackSecret}`;
  const stkRes = await fetch(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: config.shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: `MTAANI-${businessId.slice(0, 8).toUpperCase()}`,
      TransactionDesc: `Mtaani POS software bill ${invoice.period}`
    })
  });
  const stkData = await stkRes.json();
  if (!stkRes.ok || stkData.errorCode) throw new Error(`Software M-Pesa request failed: ${JSON.stringify(stkData)}`);
  const paymentId = `billpay_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(`
    INSERT INTO billingPayments
    (id, invoiceId, businessId, amount, method, status, phoneNumber, checkoutRequestId, merchantRequestId, resultCode, resultDesc, recordedBy, timestamp, updated_at)
    VALUES (?, ?, ?, ?, 'MPESA', 'PENDING', ?, ?, ?, 999, 'PENDING', 'STK_PROMPT', ?, ?)
  `).bind(paymentId, invoice.id, businessId, amount, phone, stkData.CheckoutRequestID, stkData.MerchantRequestID, Date.now(), Date.now()).run();
  return json47({
    success: true,
    paymentId,
    invoiceId: invoice.id,
    checkoutRequestId: stkData.CheckoutRequestID,
    message: stkData.CustomerMessage || "Software payment request sent."
  });
}
__name(triggerBillingStk, "triggerBillingStk");
async function handleCallback(action, request, env) {
  const receivedSecret = action[1];
  const expectedSecret = env.BILLING_MPESA_CALLBACK_SECRET;
  if (!expectedSecret || !receivedSecret || !timingSafeEqual3(receivedSecret, expectedSecret)) return json47({ ResultCode: 1, ResultDesc: "Unauthorized" }, 401);
  const data = await request.json().catch(() => null);
  const callbackData = data?.Body?.stkCallback;
  if (!callbackData) return json47({ ResultCode: 0, ResultDesc: "Ignored" });
  const checkoutRequestId = callbackData.CheckoutRequestID;
  const resultCode = Number(callbackData.ResultCode);
  const resultDesc = callbackData.ResultDesc || "";
  let receiptNumber = "";
  let paidAmount = 0;
  let phoneNumber = "";
  if (resultCode === 0 && callbackData.CallbackMetadata?.Item) {
    for (const item of callbackData.CallbackMetadata.Item) {
      if (item.Name === "Amount") paidAmount = asNumber22(item.Value, 0);
      if (item.Name === "MpesaReceiptNumber") receiptNumber = item.Value;
      if (item.Name === "PhoneNumber") phoneNumber = String(item.Value || "");
    }
  }
  const existing = await first2(env.DB, "SELECT * FROM billingPayments WHERE checkoutRequestId = ? LIMIT 1", checkoutRequestId);
  if (existing && existing.status !== "PENDING") return json47({ ResultCode: 0, ResultDesc: "Duplicate ignored" });
  if (existing) {
    await env.DB.prepare(`
      UPDATE billingPayments
      SET status = ?, resultCode = ?, resultDesc = ?, receiptNumber = ?, amount = ?, phoneNumber = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      paymentStatus(resultCode),
      resultCode,
      resultDesc,
      receiptNumber || existing.receiptNumber || "",
      paidAmount || existing.amount,
      phoneNumber || existing.phoneNumber || "",
      Date.now(),
      existing.id
    ).run();
    await recomputeInvoice(env.DB, existing.invoiceId);
  }
  return json47({ ResultCode: 0, ResultDesc: "Success" });
}
__name(handleCallback, "handleCallback");
var onRequestOptions42 = /* @__PURE__ */ __name(async () => new Response(null, { headers: corsHeaders49 }), "onRequestOptions");
var onRequest8 = /* @__PURE__ */ __name(async ({ request, env, params }) => {
  try {
    if (!env.DB) return json47({ error: "DB binding missing" }, 500);
    const action = (params.action || []).map((part) => String(part || ""));
    if (action[0] === "callback") {
      await ensureBillingSchema(env.DB);
      return handleCallback(action, request, env);
    }
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const rootAccess = auth.service || auth.principal.role === "ROOT";
    await ensureBillingSchema(env.DB);
    const url = new URL(request.url);
    const route = action[0] || "current";
    if (request.method === "GET" && route === "summary") {
      if (!rootAccess) return json47({ error: "Root access required." }, 403);
      return json47({ rows: await billingSummary(env.DB) });
    }
    if (request.method === "GET" && route === "current") {
      const businessId = String(url.searchParams.get("businessId") || request.headers.get("X-Business-ID") || "").trim();
      if (!businessId) return json47({ error: "Business is required." }, 400);
      if (!canAccessBusiness(auth.principal, businessId)) return json47({ error: "Access denied." }, 403);
      const account = await getAccount(env.DB, businessId);
      const invoice = await ensureInvoice(env.DB, businessId, String(url.searchParams.get("period") || currentPeriod()));
      return json47({ account, invoice, showBanner: !!account.bannerEnabled });
    }
    if (request.method === "POST" && route === "account") {
      if (!rootAccess) return json47({ error: "Root access required." }, 403);
      const body = await request.json().catch(() => null);
      const businessId = String(body?.businessId || "").trim();
      if (!businessId) return json47({ error: "Business is required." }, 400);
      const account = {
        businessId,
        monthlyBaseFee: Math.max(0, asNumber22(body?.monthlyBaseFee, 3e3)),
        pricePerBranch: Math.max(0, asNumber22(body?.pricePerBranch, 500)),
        discountType: body?.discountType === "PERCENT" ? "PERCENT" : "FIXED",
        discountValue: Math.max(0, asNumber22(body?.discountValue, 0)),
        dueDay: clamp2(Math.floor(asNumber22(body?.dueDay, 5)), 1, 28),
        bannerEnabled: boolInt(body?.bannerEnabled, 0),
        bannerMessage: String(body?.bannerMessage || "Your Mtaani POS software subscription is due. Pay by M-Pesa to keep your account current.").slice(0, 500),
        allowPartial: boolInt(body?.allowPartial, 1),
        minPaymentAmount: Math.max(1, asNumber22(body?.minPaymentAmount, 500)),
        status: String(body?.status || "ACTIVE").slice(0, 30),
        updated_at: Date.now()
      };
      await env.DB.prepare(`
        INSERT OR REPLACE INTO billingAccounts
        (businessId, monthlyBaseFee, pricePerBranch, discountType, discountValue, dueDay, bannerEnabled, bannerMessage, allowPartial, minPaymentAmount, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        account.businessId,
        account.monthlyBaseFee,
        account.pricePerBranch,
        account.discountType,
        account.discountValue,
        account.dueDay,
        account.bannerEnabled,
        account.bannerMessage,
        account.allowPartial,
        account.minPaymentAmount,
        account.status,
        account.updated_at
      ).run();
      const invoice = await ensureInvoice(env.DB, businessId);
      return json47({ success: true, account, invoice });
    }
    if (request.method === "POST" && route === "invoice") {
      if (!rootAccess) return json47({ error: "Root access required." }, 403);
      const body = await request.json().catch(() => null);
      const businessId = String(body?.businessId || "").trim();
      if (!businessId) return json47({ error: "Business is required." }, 400);
      return json47({ success: true, invoice: await ensureInvoice(env.DB, businessId, String(body?.period || currentPeriod())) });
    }
    if (request.method === "POST" && route === "payment") {
      if (!rootAccess) return json47({ error: "Root access required." }, 403);
      const body = await request.json().catch(() => null);
      const businessId = String(body?.businessId || "").trim();
      const amount = Math.max(0, asNumber22(body?.amount, 0));
      if (!businessId || amount <= 0) return json47({ error: "Business and amount are required." }, 400);
      const invoice = await ensureInvoice(env.DB, businessId, String(body?.period || currentPeriod()));
      const id = `billpay_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      await env.DB.prepare(`
        INSERT INTO billingPayments
        (id, invoiceId, businessId, amount, method, status, receiptNumber, recordedBy, notes, timestamp, updated_at)
        VALUES (?, ?, ?, ?, ?, 'PAID', ?, ?, ?, ?, ?)
      `).bind(
        id,
        invoice.id,
        businessId,
        amount,
        String(body?.method || "MANUAL").slice(0, 30),
        String(body?.receiptNumber || "").slice(0, 120),
        String(body?.recordedBy || "System Admin").slice(0, 120),
        String(body?.notes || "").slice(0, 500),
        Date.now(),
        Date.now()
      ).run();
      return json47({ success: true, paymentId: id, invoice: await recomputeInvoice(env.DB, invoice.id) });
    }
    if (request.method === "POST" && route === "stkpush") {
      const body = await request.json().catch(() => null);
      const businessId = String(body?.businessId || "").trim();
      if (!businessId) return json47({ error: "Business is required." }, 400);
      if (!canAccessBusiness(auth.principal, businessId)) return json47({ error: "Access denied." }, 403);
      return triggerBillingStk(request, env, body);
    }
    if (request.method === "GET" && route === "status") {
      const id = action[1];
      if (!id) return json47({ error: "Payment id required." }, 400);
      const payment = await first2(env.DB, "SELECT * FROM billingPayments WHERE id = ? OR checkoutRequestId = ? LIMIT 1", id, id);
      if (!payment) return json47({ found: false });
      if (!canAccessBusiness(auth.principal, payment.businessId)) return json47({ error: "Access denied." }, 403);
      const invoice = await recomputeInvoice(env.DB, payment.invoiceId);
      return json47({ found: true, payment, invoice });
    }
    return json47({ error: "Not found" }, 404);
  } catch (err) {
    console.error("[Billing API]", err);
    return json47({ error: err?.message || "Billing request failed." }, 500);
  }
}, "onRequest");

// api/data/[[table]].ts
var ALLOWED_TABLES = /* @__PURE__ */ new Set([
  "users",
  "products",
  "transactions",
  "cashPicks",
  "shifts",
  "endOfDayReports",
  "stockMovements",
  "expenses",
  "customers",
  "customerPayments",
  "serviceItems",
  "salesInvoices",
  "suppliers",
  "supplierPayments",
  "creditNotes",
  "dailySummaries",
  "stockAdjustmentRequests",
  "purchaseOrders",
  "settings",
  "categories",
  "branches",
  "businesses",
  "system",
  "expenseAccounts",
  "financialAccounts",
  "productIngredients",
  "loginAttempts",
  "auditLogs"
]);
var GLOBAL_TABLES = /* @__PURE__ */ new Set(["users", "branches", "settings", "expenseAccounts", "financialAccounts", "customers", "serviceItems", "suppliers", "products", "productIngredients", "categories"]);
var UNSCOPED_TABLES = /* @__PURE__ */ new Set(["businesses", "loginAttempts"]);
var MANAGER_WRITE_TABLES = /* @__PURE__ */ new Set([
  "products",
  "productIngredients",
  "serviceItems",
  "suppliers",
  "purchaseOrders",
  "supplierPayments",
  "creditNotes",
  "salesInvoices",
  "stockMovements",
  "expenses"
]);
var CASHIER_WRITE_TABLES = /* @__PURE__ */ new Set([
  "transactions",
  "customers",
  "customerPayments",
  "shifts",
  "cashPicks",
  "endOfDayReports",
  "dailySummaries",
  "stockAdjustmentRequests"
]);
var STAFF_ROLES4 = /* @__PURE__ */ new Set(["ADMIN", "MANAGER", "CASHIER"]);
var MANAGER_DELETE_TABLES = /* @__PURE__ */ new Set([
  "products",
  "productIngredients",
  "serviceItems",
  "suppliers",
  "purchaseOrders",
  "supplierPayments",
  "creditNotes",
  "salesInvoices",
  "customers",
  "expenses",
  "stockAdjustmentRequests"
]);
var COMMAND_ONLY_WRITE_TABLES = /* @__PURE__ */ new Set([
  "businesses",
  "users",
  "branches",
  "settings",
  "categories",
  "expenseAccounts",
  "products",
  "productIngredients",
  "serviceItems",
  "customers",
  "customerPayments",
  "suppliers",
  "supplierPayments",
  "creditNotes",
  "purchaseOrders",
  "salesInvoices",
  "expenses",
  "financialAccounts",
  "cashPicks",
  "shifts",
  "endOfDayReports",
  "dailySummaries",
  "stockAdjustmentRequests",
  "stockMovements",
  "auditLogs"
]);
var corsHeaders50 = {
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID"
};
function jsonHeaders3() {
  return { "Content-Type": "application/json", ...corsHeaders50 };
}
__name(jsonHeaders3, "jsonHeaders");
function secureJsonHeaders() {
  return {
    "Content-Type": "application/json",
    ...corsHeaders50,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'",
    "Cache-Control": "no-store, no-cache, must-revalidate"
  };
}
__name(secureJsonHeaders, "secureJsonHeaders");
var SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, isActive INTEGER DEFAULT 1, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, businessId TEXT, branchId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, sellingPrice REAL NOT NULL, costPrice REAL, taxCategory TEXT NOT NULL, stockQuantity REAL NOT NULL, unit TEXT, barcode TEXT NOT NULL, imageUrl TEXT, reorderPoint REAL, isBundle INTEGER DEFAULT 0, components TEXT, businessId TEXT, branchId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS productIngredients (id TEXT PRIMARY KEY, productId TEXT NOT NULL, ingredientProductId TEXT NOT NULL, quantity REAL NOT NULL, businessId TEXT, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, total REAL NOT NULL, subtotal REAL NOT NULL, tax REAL NOT NULL, discountAmount REAL, discountReason TEXT, items TEXT NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, paymentMethod TEXT, amountTendered REAL, changeGiven REAL, mpesaReference TEXT, mpesaCode TEXT, mpesaCustomer TEXT, mpesaCheckoutRequestId TEXT, cashierId TEXT, cashierName TEXT, customerId TEXT, customerName TEXT, discount REAL, discountType TEXT, splitPayments TEXT, splitData TEXT, isSynced INTEGER, approvedBy TEXT, pendingRefundItems TEXT, shiftId TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS cashPicks (id TEXT PRIMARY KEY, amount REAL NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, userName TEXT, shiftId TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, startTime INTEGER NOT NULL, endTime INTEGER, openingFloat REAL, cashierName TEXT NOT NULL, status TEXT NOT NULL, branchId TEXT, lastSyncAt INTEGER, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS endOfDayReports (id TEXT PRIMARY KEY, shiftId TEXT, timestamp INTEGER NOT NULL, openingFloat REAL, totalSales REAL NOT NULL, grossSales REAL NOT NULL, taxTotal REAL NOT NULL, cashSales REAL NOT NULL, mpesaSales REAL NOT NULL, totalExpenses REAL NOT NULL, totalPicks REAL NOT NULL, totalRefunds REAL, expectedCash REAL NOT NULL, reportedCash REAL NOT NULL, difference REAL NOT NULL, cashierName TEXT NOT NULL, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS stockMovements (id TEXT PRIMARY KEY, productId TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, timestamp INTEGER NOT NULL, reference TEXT, branchId TEXT, businessId TEXT, shiftId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, amount REAL NOT NULL, category TEXT NOT NULL, description TEXT, timestamp INTEGER NOT NULL, userName TEXT, status TEXT NOT NULL, source TEXT, accountId TEXT, productId TEXT, quantity REAL, preparedBy TEXT, approvedBy TEXT, shiftId TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, totalSpent REAL, balance REAL, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS customerPayments (id TEXT PRIMARY KEY, customerId TEXT NOT NULL, amount REAL NOT NULL, paymentMethod TEXT NOT NULL, transactionCode TEXT, reference TEXT, allocations TEXT, timestamp INTEGER NOT NULL, preparedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS serviceItems (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, description TEXT, price REAL NOT NULL, taxCategory TEXT DEFAULT 'A', isActive INTEGER DEFAULT 1, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS salesInvoices (id TEXT PRIMARY KEY, invoiceNumber TEXT NOT NULL, customerId TEXT NOT NULL, customerName TEXT, customerPhone TEXT, customerEmail TEXT, items TEXT NOT NULL, subtotal REAL NOT NULL, tax REAL NOT NULL, total REAL NOT NULL, paidAmount REAL DEFAULT 0, balance REAL DEFAULT 0, status TEXT NOT NULL, issueDate INTEGER NOT NULL, dueDate INTEGER, notes TEXT, preparedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT, address TEXT, kraPin TEXT, balance REAL, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS supplierPayments (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, purchaseOrderId TEXT, purchaseOrderIds TEXT, creditNoteIds TEXT, amount REAL NOT NULL, paymentMethod TEXT NOT NULL, transactionCode TEXT, timestamp INTEGER NOT NULL, reference TEXT, source TEXT, accountId TEXT, shiftId TEXT, preparedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS creditNotes (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, amount REAL NOT NULL, reference TEXT NOT NULL, timestamp INTEGER NOT NULL, reason TEXT, status TEXT DEFAULT 'PENDING', allocatedTo TEXT, productId TEXT, quantity REAL, branchId TEXT, businessId TEXT, shiftId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS dailySummaries (id TEXT PRIMARY KEY, date INTEGER NOT NULL, shiftIds TEXT NOT NULL, totalSales REAL NOT NULL, grossSales REAL NOT NULL, taxTotal REAL NOT NULL, totalExpenses REAL NOT NULL, totalPicks REAL NOT NULL, totalVariance REAL NOT NULL, timestamp INTEGER NOT NULL, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS stockAdjustmentRequests (id TEXT PRIMARY KEY, productId TEXT NOT NULL, productName TEXT, oldQty REAL, newQty REAL, requestedQuantity REAL, reason TEXT NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, preparedBy TEXT, approvedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS purchaseOrders (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, items TEXT NOT NULL, totalAmount REAL NOT NULL, status TEXT NOT NULL, approvalStatus TEXT NOT NULL, paymentStatus TEXT, paidAmount REAL, orderDate INTEGER NOT NULL, expectedDate INTEGER, receivedDate INTEGER, invoiceNumber TEXT, poNumber TEXT, preparedBy TEXT, approvedBy TEXT, receivedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, storeName TEXT NOT NULL, location TEXT, tillNumber TEXT, kraPin TEXT, receiptFooter TEXT, ownerModeEnabled INTEGER DEFAULT 0, autoApproveOwnerActions INTEGER DEFAULT 1, cashSweepEnabled INTEGER DEFAULT 1, cashDrawerLimit REAL DEFAULT 5000, cashFloatTarget REAL DEFAULT 1000, aiAssistantEnabled INTEGER DEFAULT 1, aiDailyRequestLimit INTEGER DEFAULT 20, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, iconName TEXT NOT NULL, color TEXT NOT NULL, businessId TEXT, branchId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS branches (id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL, phone TEXT, tillNumber TEXT, kraPin TEXT, isActive INTEGER NOT NULL DEFAULT 1, businessId TEXT, mpesaConsumerKey TEXT, mpesaConsumerSecret TEXT, mpesaPasskey TEXT, mpesaEnv TEXT, mpesaType TEXT DEFAULT 'paybill', mpesaStoreNumber TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS expenseAccounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS financialAccounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0, businessId TEXT, branchId TEXT, accountNumber TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS mpesaCallbacks (checkoutRequestId TEXT PRIMARY KEY, merchantRequestId TEXT, resultCode INTEGER, resultDesc TEXT, amount REAL, receiptNumber TEXT, phoneNumber TEXT, businessId TEXT, branchId TEXT, timestamp INTEGER, utilizedTransactionId TEXT, utilizedCustomerId TEXT, utilizedCustomerName TEXT, utilizedAt INTEGER);
CREATE TABLE IF NOT EXISTS deviceSyncStatus (id TEXT PRIMARY KEY, businessId TEXT NOT NULL, branchId TEXT NOT NULL, deviceId TEXT NOT NULL, cashierName TEXT, lastSyncAt INTEGER, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_deviceSyncStatus_branch ON deviceSyncStatus(businessId, branchId, lastSyncAt);
CREATE TABLE IF NOT EXISTS deviceSyncStatus (id TEXT PRIMARY KEY, businessId TEXT NOT NULL, branchId TEXT NOT NULL, deviceId TEXT NOT NULL, cashierName TEXT, lastSyncAt INTEGER, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_deviceSyncStatus_branch ON deviceSyncStatus(businessId, branchId, lastSyncAt);
CREATE TABLE IF NOT EXISTS idempotencyKeys (id TEXT PRIMARY KEY, businessId TEXT NOT NULL, branchId TEXT NOT NULL, idempotencyKey TEXT NOT NULL, operation TEXT NOT NULL, deviceId TEXT, cashierName TEXT, transactionId TEXT, createdAt INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_lookup ON idempotencyKeys(businessId, branchId, idempotencyKey);
CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_transaction ON idempotencyKeys(businessId, branchId, transactionId);
CREATE TABLE IF NOT EXISTS aiUsage (id TEXT PRIMARY KEY, businessId TEXT NOT NULL, userId TEXT NOT NULL, userName TEXT, branchId TEXT, day TEXT NOT NULL, count INTEGER DEFAULT 0, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_aiUsage_scope ON aiUsage(businessId, userId, day);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_stockmovements_product ON stockMovements(productId);
CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS auditLogs (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, userId TEXT, userName TEXT, action TEXT NOT NULL, entity TEXT, entityId TEXT, severity TEXT NOT NULL, details TEXT, businessId TEXT, branchId TEXT, updated_at INTEGER);
`;
function serializeValue3(v) {
  if (v === null || v === void 0) return null;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}
__name(serializeValue3, "serializeValue");
function deserializeRow5(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}
__name(deserializeRow5, "deserializeRow");
function isAdminLike(role) {
  return role === "ADMIN" || role === "ROOT";
}
__name(isAdminLike, "isAdminLike");
function canWriteTable(role, table, service) {
  if (service || isAdminLike(role)) return true;
  if (role === "MANAGER") return MANAGER_WRITE_TABLES.has(table) || CASHIER_WRITE_TABLES.has(table);
  if (role === "CASHIER") return CASHIER_WRITE_TABLES.has(table);
  return false;
}
__name(canWriteTable, "canWriteTable");
function canDeleteTable(role, table, service) {
  if (service || isAdminLike(role)) return true;
  if (role === "MANAGER") return MANAGER_DELETE_TABLES.has(table);
  return false;
}
__name(canDeleteTable, "canDeleteTable");
function asNumber23(value, fallback = 0) {
  const n3 = Number(value);
  return Number.isFinite(n3) ? n3 : fallback;
}
__name(asNumber23, "asNumber");
function roundMoney12(value) {
  return Math.round(value * 100) / 100;
}
__name(roundMoney12, "roundMoney");
function trimText24(value, max = 160) {
  const text2 = String(value ?? "").trim();
  if (!text2) return void 0;
  return text2.slice(0, max);
}
__name(trimText24, "trimText");
function asArray4(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
__name(asArray4, "asArray");
async function existingRowsById(db, table, businessId, ids) {
  const rows = /* @__PURE__ */ new Map();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return rows;
  const placeholders = uniqueIds.map(() => "?").join(",");
  const { results } = await db.prepare(`SELECT * FROM ${table} WHERE businessId = ? AND id IN (${placeholders})`).bind(businessId, ...uniqueIds).all();
  results.forEach((row) => rows.set(String(row.id), deserializeRow5(row)));
  return rows;
}
__name(existingRowsById, "existingRowsById");
async function protectCustomerTotals(db, businessId, branchId, principalRole, service, items) {
  if (service || isAdminLike(principalRole)) return;
  if (!branchId) throw new PolicyError("Branch is required for customer changes.", 400);
  const existing = await existingRowsById(db, "customers", businessId, items.map((item) => String(item?.id || "").trim()));
  items.forEach((item) => {
    const saved = existing.get(String(item?.id || "").trim());
    if (saved?.branchId && saved.branchId !== branchId) {
      throw new PolicyError("You cannot change customers from another branch.", 403);
    }
    item.name = trimText24(item.name, 120) || saved?.name || "Customer";
    item.phone = trimText24(item.phone, 40) || saved?.phone || "";
    item.email = trimText24(item.email, 120) || saved?.email || "";
    item.totalSpent = Number(saved?.totalSpent || 0);
    item.balance = Number(saved?.balance || 0);
    item.branchId = saved?.branchId || branchId;
  });
}
__name(protectCustomerTotals, "protectCustomerTotals");
async function hardenCustomerPaymentWrites(db, businessId, branchId, principalName, items) {
  const sideEffects = [];
  const existing = await existingRowsById(db, "customerPayments", businessId, items.map((item) => String(item?.id || "").trim()));
  const methods = /* @__PURE__ */ new Set(["CASH", "MPESA", "BANK", "PDQ", "CHEQUE"]);
  const allocationTypes = /* @__PURE__ */ new Set(["SALE", "INVOICE"]);
  const now = Date.now();
  for (const item of items) {
    const id = String(item?.id || "").trim();
    if (!id) throw new PolicyError("Customer payment ID is required.");
    if (existing.has(id)) throw new PolicyError("Customer payment records cannot be edited after saving.", 403);
    const customerId = trimText24(item.customerId, 120);
    if (!customerId) throw new PolicyError("Customer is required for payment.");
    const amount = roundMoney12(asNumber23(item.amount));
    if (amount <= 0 || amount > 1e7) throw new PolicyError("Payment amount is invalid.");
    const method = String(item.paymentMethod || "").toUpperCase();
    item.customerId = customerId;
    item.amount = amount;
    item.paymentMethod = methods.has(method) ? method : "CASH";
    item.transactionCode = trimText24(item.transactionCode, 80);
    item.reference = trimText24(item.reference, 160) || "Customer payment";
    item.preparedBy = trimText24(item.preparedBy, 120) || principalName;
    item.timestamp = Math.min(asNumber23(item.timestamp, now), now + 5 * 60 * 1e3);
    item.updated_at = now;
    let allocationTotal = 0;
    item.allocations = asArray4(item.allocations).slice(0, 50).map((allocation) => {
      const sourceType = String(allocation?.sourceType || "").toUpperCase();
      const sourceId = trimText24(allocation?.sourceId, 120);
      const allocationAmount = roundMoney12(asNumber23(allocation?.amount));
      return sourceType && sourceId && allocationTypes.has(sourceType) && allocationAmount > 0 ? { sourceType, sourceId, amount: allocationAmount } : null;
    }).filter(Boolean);
    for (const allocation of item.allocations) allocationTotal += allocation.amount;
    if (allocationTotal > amount + 0.01) {
      throw new PolicyError("Payment allocations exceed the payment amount.", 400);
    }
    sideEffects.push(
      db.prepare(`UPDATE customers SET balance = MAX(0, COALESCE(balance, 0) - ?), updated_at = ? WHERE id = ? AND businessId = ?`).bind(amount, now, customerId, businessId)
    );
    for (const allocation of item.allocations) {
      if (allocation.sourceType !== "INVOICE") continue;
      sideEffects.push(
        db.prepare(
          `UPDATE salesInvoices
           SET paidAmount = MIN(COALESCE(total, 0), COALESCE(paidAmount, 0) + ?),
               balance = MAX(0, COALESCE(balance, total, 0) - ?),
               status = CASE WHEN MAX(0, COALESCE(balance, total, 0) - ?) <= 0 THEN 'PAID' ELSE 'PARTIAL' END,
               updated_at = ?
           WHERE id = ? AND customerId = ? AND businessId = ?`
        ).bind(allocation.amount, allocation.amount, allocation.amount, now, allocation.sourceId, customerId, businessId)
      );
    }
  }
  return sideEffects;
}
__name(hardenCustomerPaymentWrites, "hardenCustomerPaymentWrites");
function looksLikeStoredPassword(value) {
  return isPasswordHashCurrent(value) || /^[a-f0-9]{64}$/i.test(value) || value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$");
}
__name(looksLikeStoredPassword, "looksLikeStoredPassword");
async function hardenUserWrites(db, businessId, principalRole, principalUserId, service, items) {
  const existing = await existingRowsById(db, "users", businessId, items.map((item) => String(item?.id || "").trim()));
  const adminCountRow = await db.prepare("SELECT COUNT(*) AS count FROM users WHERE businessId = ? AND role = 'ADMIN'").bind(businessId).first();
  const currentAdminCount = Number(adminCountRow?.count || 0);
  for (const item of items) {
    const id = String(item?.id || crypto.randomUUID()).trim();
    item.id = id;
    const saved = existing.get(id);
    const role = String(item.role || saved?.role || "CASHIER").trim().toUpperCase();
    if (role === "ROOT" || !STAFF_ROLES4.has(role)) {
      throw new PolicyError("Staff role is not allowed.", 403);
    }
    if (!service && principalRole !== "ROOT" && saved?.role === "ADMIN" && role !== "ADMIN" && currentAdminCount <= 1) {
      throw new PolicyError("The last administrator cannot be changed.", 403);
    }
    item.name = trimText24(item.name, 120) || saved?.name || "Staff Member";
    item.role = role;
    item.branchId = role === "ADMIN" ? trimText24(item.branchId, 120) || null : trimText24(item.branchId, 120) || saved?.branchId || null;
    item.updated_at = Date.now();
    const providedPassword = String(item.password || "");
    if (providedPassword) {
      if (!service && looksLikeStoredPassword(providedPassword)) {
        throw new PolicyError("Password must be entered as text so the server can secure it.", 400);
      }
      item.password = isPasswordHashCurrent(providedPassword) ? providedPassword : await hashPassword(providedPassword);
    } else if (saved?.password) {
      item.password = saved.password;
    } else {
      throw new PolicyError("Password is required for new staff accounts.", 400);
    }
  }
}
__name(hardenUserWrites, "hardenUserWrites");
async function enforceGlobalBranchOwnership(db, table, businessId, branchId, principalRole, service, items) {
  if (service || isAdminLike(principalRole)) return;
  if (!branchId) throw new PolicyError("Branch is required for this change.", 400);
  if (table !== "suppliers") return;
  const existing = await existingRowsById(db, table, businessId, items.map((item) => String(item?.id || "").trim()));
  items.forEach((item) => {
    const saved = existing.get(String(item?.id || "").trim());
    if (saved?.branchId && saved.branchId !== branchId) {
      throw new PolicyError("You cannot change records from another branch.", 403);
    }
    item.branchId = saved?.branchId || branchId;
  });
}
__name(enforceGlobalBranchOwnership, "enforceGlobalBranchOwnership");
var BRANCH_MPESA_LOCKED_FIELDS = [
  "mpesaConsumerKey",
  "mpesaConsumerSecret",
  "mpesaPasskey",
  "mpesaEnv",
  "mpesaType",
  "mpesaStoreNumber"
];
function redactBranch(row) {
  const out = { ...row };
  out.mpesaConsumerKeySet = !!row.mpesaConsumerKey;
  out.mpesaConsumerSecretSet = !!row.mpesaConsumerSecret;
  out.mpesaPasskeySet = !!row.mpesaPasskey;
  out.mpesaConfigured = !!(row.mpesaConsumerKey && row.mpesaConsumerSecret && row.mpesaPasskey);
  out.mpesaEnv = row.mpesaEnv || "sandbox";
  out.mpesaType = row.mpesaType || "paybill";
  out.mpesaStoreNumber = row.mpesaStoreNumber ? "Saved" : "";
  delete out.mpesaConsumerKey;
  delete out.mpesaConsumerSecret;
  delete out.mpesaPasskey;
  return out;
}
__name(redactBranch, "redactBranch");
function redactRows(table, rows) {
  if (table === "branches") return rows.map(redactBranch);
  if (table === "users") return rows.map((row) => {
    const out = { ...row };
    delete out.password;
    delete out.pin;
    return out;
  });
  return rows;
}
__name(redactRows, "redactRows");
var onRequest9 = /* @__PURE__ */ __name(async (context) => {
  const { request, env, params } = context;
  try {
    const parts = params.table ?? [];
    const table = parts[0];
    const recordId = parts[1];
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders50 });
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const { principal, service } = auth;
    if (!env.DB) {
      return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500, headers: secureJsonHeaders() });
    }
    const contentLength = request.headers.get("Content-Length");
    if (contentLength && parseInt(contentLength) > 1048576) {
      return new Response(JSON.stringify({ error: "Request too large" }), { status: 413, headers: secureJsonHeaders() });
    }
    const requestedBusinessId = request.headers.get("X-Business-ID");
    const businessId = principal.role === "ROOT" || service ? requestedBusinessId : principal.businessId;
    const branchId = request.headers.get("X-Branch-ID");
    if (table === "system") {
      if (recordId === "ping") {
        return new Response(JSON.stringify({ success: true, message: "pong" }), { headers: jsonHeaders3() });
      }
      if (recordId === "status") {
        if (principal.role !== "ROOT" && !service) {
          return new Response(JSON.stringify({ error: "Root access required" }), { status: 403, headers: jsonHeaders3() });
        }
        return new Response(JSON.stringify({ success: true, hasDB: !!env.DB, hasSecret: !!env.API_SECRET }), { headers: jsonHeaders3() });
      }
      if (recordId === "setup") {
        if (principal.role !== "ROOT" && !service) {
          return new Response(JSON.stringify({ error: "Root access required" }), { status: 403, headers: jsonHeaders3() });
        }
        const statements = SCHEMA_SQL.split(";").map((s2) => s2.trim()).filter((s2) => s2.length > 0);
        for (const s2 of statements) {
          try {
            await env.DB.prepare(s2).run();
          } catch (e) {
          }
        }
        const migrationCols = [
          ["products", "unit TEXT"],
          ["products", "branchId TEXT"],
          ["products", "costPrice REAL"],
          ["products", "taxCategory TEXT DEFAULT 'A'"],
          ["products", "reorderPoint REAL"],
          ["products", "isBundle INTEGER DEFAULT 0"],
          ["products", "components TEXT"],
          ["transactions", "shiftId TEXT"],
          ["transactions", "approvedBy TEXT"],
          ["transactions", "pendingRefundItems TEXT"],
          ["transactions", "changeGiven REAL"],
          ["transactions", "mpesaReference TEXT"],
          ["transactions", "mpesaCode TEXT"],
          ["transactions", "mpesaCustomer TEXT"],
          ["transactions", "mpesaCheckoutRequestId TEXT"],
          ["transactions", "cashierId TEXT"],
          ["transactions", "customerId TEXT"],
          ["transactions", "customerName TEXT"],
          ["transactions", "discount REAL"],
          ["transactions", "discountType TEXT"],
          ["transactions", "splitPayments TEXT"],
          ["transactions", "splitData TEXT"],
          ["transactions", "isSynced INTEGER"],
          ["customerPayments", "allocations TEXT"],
          ["categories", "branchId TEXT"],
          ["shifts", "lastSyncAt INTEGER"],
          ["shifts", "openingFloat REAL"],
          ["businesses", "isActive INTEGER DEFAULT 1"],
          ["stockAdjustmentRequests", "preparedBy TEXT"],
          ["stockAdjustmentRequests", "approvedBy TEXT"],
          ["users", "branchId TEXT"],
          ["cashPicks", "shiftId TEXT"],
          ["stockMovements", "shiftId TEXT"],
          ["expenses", "source TEXT"],
          ["expenses", "accountId TEXT"],
          ["expenses", "productId TEXT"],
          ["expenses", "quantity REAL"],
          ["expenses", "preparedBy TEXT"],
          ["expenses", "approvedBy TEXT"],
          ["expenses", "shiftId TEXT"],
          ["supplierPayments", "source TEXT"],
          ["supplierPayments", "accountId TEXT"],
          ["supplierPayments", "shiftId TEXT"],
          ["supplierPayments", "creditNoteIds TEXT"],
          ["supplierPayments", "reference TEXT"],
          ["supplierPayments", "preparedBy TEXT"],
          ["suppliers", "address TEXT"],
          ["suppliers", "kraPin TEXT"],
          ["creditNotes", "status TEXT DEFAULT 'PENDING'"],
          ["creditNotes", "allocatedTo TEXT"],
          ["creditNotes", "shiftId TEXT"],
          ["creditNotes", "productId TEXT"],
          ["creditNotes", "quantity REAL"],
          ["purchaseOrders", "poNumber TEXT"],
          ["purchaseOrders", "preparedBy TEXT"],
          ["purchaseOrders", "approvedBy TEXT"],
          ["purchaseOrders", "receivedBy TEXT"],
          ["endOfDayReports", "totalRefunds REAL"],
          ["financialAccounts", "accountNumber TEXT"],
          ["branches", "mpesaConsumerKey TEXT"],
          ["branches", "mpesaConsumerSecret TEXT"],
          ["branches", "mpesaPasskey TEXT"],
          ["branches", "mpesaEnv TEXT"],
          ["branches", "mpesaType TEXT DEFAULT 'paybill'"],
          ["branches", "mpesaStoreNumber TEXT"],
          ["settings", "location TEXT"],
          ["settings", "ownerModeEnabled INTEGER DEFAULT 0"],
          ["settings", "autoApproveOwnerActions INTEGER DEFAULT 1"],
          ["settings", "cashSweepEnabled INTEGER DEFAULT 1"],
          ["settings", "cashDrawerLimit REAL DEFAULT 5000"],
          ["settings", "cashFloatTarget REAL DEFAULT 1000"],
          ["settings", "aiAssistantEnabled INTEGER DEFAULT 1"],
          ["settings", "aiDailyRequestLimit INTEGER DEFAULT 20"],
          ["mpesaCallbacks", "utilizedTransactionId TEXT"],
          ["mpesaCallbacks", "utilizedCustomerId TEXT"],
          ["mpesaCallbacks", "utilizedCustomerName TEXT"],
          ["mpesaCallbacks", "utilizedAt INTEGER"]
        ];
        const allTables = ["users", "products", "productIngredients", "transactions", "cashPicks", "shifts", "endOfDayReports", "stockMovements", "expenses", "customers", "customerPayments", "serviceItems", "salesInvoices", "suppliers", "supplierPayments", "creditNotes", "dailySummaries", "stockAdjustmentRequests", "purchaseOrders", "settings", "categories", "branches", "financialAccounts", "auditLogs"];
        for (const t of allTables) {
          try {
            await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN businessId TEXT`).run();
          } catch (e) {
          }
        }
        for (const [t, col] of migrationCols) {
          try {
            await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN ${col}`).run();
          } catch (e) {
          }
        }
        return new Response(JSON.stringify({ success: true, message: "Database initialized." }), { headers: jsonHeaders3() });
      }
    }
    if (!table || !ALLOWED_TABLES.has(table)) {
      return new Response(JSON.stringify({ error: "Table not allowed" }), { status: 400, headers: jsonHeaders3() });
    }
    if (table === "loginAttempts") {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)").run();
    }
    if (table === "productIngredients") {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS productIngredients (id TEXT PRIMARY KEY, productId TEXT NOT NULL, ingredientProductId TEXT NOT NULL, quantity REAL NOT NULL, businessId TEXT, updated_at INTEGER)").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId)").run();
    }
    if (table === "customerPayments") {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS customerPayments (id TEXT PRIMARY KEY, customerId TEXT NOT NULL, amount REAL NOT NULL, paymentMethod TEXT NOT NULL, transactionCode TEXT, reference TEXT, allocations TEXT, timestamp INTEGER NOT NULL, preparedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER)").run();
      try {
        await env.DB.prepare("ALTER TABLE customerPayments ADD COLUMN allocations TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE salesInvoices ADD COLUMN paidAmount REAL DEFAULT 0").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE salesInvoices ADD COLUMN balance REAL DEFAULT 0").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE salesInvoices ADD COLUMN status TEXT DEFAULT 'SENT'").run();
      } catch (e) {
      }
    }
    if (table === "serviceItems") {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS serviceItems (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, description TEXT, price REAL NOT NULL, taxCategory TEXT DEFAULT 'A', isActive INTEGER DEFAULT 1, businessId TEXT, updated_at INTEGER)").run();
    }
    if (table === "salesInvoices") {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS salesInvoices (id TEXT PRIMARY KEY, invoiceNumber TEXT NOT NULL, customerId TEXT NOT NULL, customerName TEXT, customerPhone TEXT, customerEmail TEXT, items TEXT NOT NULL, subtotal REAL NOT NULL, tax REAL NOT NULL, total REAL NOT NULL, paidAmount REAL DEFAULT 0, balance REAL DEFAULT 0, status TEXT NOT NULL, issueDate INTEGER NOT NULL, dueDate INTEGER, notes TEXT, preparedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER)").run();
    }
    if (table === "transactions") {
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN branchId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN businessId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN shiftId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN approvedBy TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN pendingRefundItems TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN changeGiven REAL").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN mpesaReference TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN mpesaCode TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN mpesaCustomer TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN mpesaCheckoutRequestId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN cashierId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN customerId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN customerName TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN discount REAL").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN discountType TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN splitPayments TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN splitData TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE transactions ADD COLUMN isSynced INTEGER").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN businessId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN branchId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN unit TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN costPrice REAL").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN taxCategory TEXT DEFAULT 'A'").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN isBundle INTEGER DEFAULT 0").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN components TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN updated_at INTEGER").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE customers ADD COLUMN totalSpent REAL").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE customers ADD COLUMN balance REAL").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE customers ADD COLUMN businessId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE customers ADD COLUMN updated_at INTEGER").run();
      } catch (e) {
      }
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS productIngredients (id TEXT PRIMARY KEY, productId TEXT NOT NULL, ingredientProductId TEXT NOT NULL, quantity REAL NOT NULL, businessId TEXT, updated_at INTEGER)").run();
      try {
        await env.DB.prepare("ALTER TABLE productIngredients ADD COLUMN businessId TEXT").run();
      } catch (e) {
      }
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId)").run();
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS stockMovements (id TEXT PRIMARY KEY, productId TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, timestamp INTEGER NOT NULL, reference TEXT, branchId TEXT, businessId TEXT, shiftId TEXT, updated_at INTEGER)").run();
      try {
        await env.DB.prepare("ALTER TABLE stockMovements ADD COLUMN reference TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE stockMovements ADD COLUMN branchId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE stockMovements ADD COLUMN businessId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE stockMovements ADD COLUMN shiftId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE stockMovements ADD COLUMN updated_at INTEGER").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE idempotencyKeys ADD COLUMN transactionId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_transaction ON idempotencyKeys(businessId, branchId, transactionId)").run();
      } catch (e) {
      }
    }
    if (table === "products") {
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN unit TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN branchId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN costPrice REAL").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN taxCategory TEXT DEFAULT 'A'").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN reorderPoint REAL").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN isBundle INTEGER DEFAULT 0").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE products ADD COLUMN components TEXT").run();
      } catch (e) {
      }
    }
    if (table === "expenses") {
      try {
        await env.DB.prepare("ALTER TABLE expenses ADD COLUMN productId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE expenses ADD COLUMN quantity REAL").run();
      } catch (e) {
      }
    }
    if (table === "settings") {
      try {
        await env.DB.prepare("ALTER TABLE settings ADD COLUMN ownerModeEnabled INTEGER DEFAULT 0").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE settings ADD COLUMN autoApproveOwnerActions INTEGER DEFAULT 1").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE settings ADD COLUMN cashSweepEnabled INTEGER DEFAULT 1").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE settings ADD COLUMN cashDrawerLimit REAL DEFAULT 5000").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE settings ADD COLUMN cashFloatTarget REAL DEFAULT 1000").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE settings ADD COLUMN aiAssistantEnabled INTEGER DEFAULT 1").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE settings ADD COLUMN aiDailyRequestLimit INTEGER DEFAULT 20").run();
      } catch (e) {
      }
    }
    if (table === "creditNotes") {
      try {
        await env.DB.prepare("ALTER TABLE creditNotes ADD COLUMN status TEXT DEFAULT 'PENDING'").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE creditNotes ADD COLUMN allocatedTo TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE creditNotes ADD COLUMN shiftId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE creditNotes ADD COLUMN productId TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE creditNotes ADD COLUMN quantity REAL").run();
      } catch (e) {
      }
    }
    if (table === "branches") {
      try {
        await env.DB.prepare("ALTER TABLE branches ADD COLUMN mpesaConsumerKey TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE branches ADD COLUMN mpesaConsumerSecret TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE branches ADD COLUMN mpesaPasskey TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE branches ADD COLUMN mpesaEnv TEXT").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE branches ADD COLUMN mpesaType TEXT DEFAULT 'paybill'").run();
      } catch (e) {
      }
      try {
        await env.DB.prepare("ALTER TABLE branches ADD COLUMN mpesaStoreNumber TEXT").run();
      } catch (e) {
      }
    }
    if (request.method === "GET") {
      if (table === "businesses") {
        const query = principal.role === "ROOT" || service ? env.DB.prepare(`SELECT id, name, code, isActive FROM businesses`) : env.DB.prepare(`SELECT id, name, code, isActive FROM businesses WHERE id = ?`).bind(principal.businessId);
        const { results } = await query.all();
        return new Response(JSON.stringify(results.map(deserializeRow5)), { headers: jsonHeaders3() });
      }
      if (table === "loginAttempts") {
        if (principal.role !== "ROOT" && !service) {
          return new Response(JSON.stringify({ error: "Root access required" }), { status: 403, headers: jsonHeaders3() });
        }
        const { results } = await env.DB.prepare(`SELECT * FROM loginAttempts`).all();
        return new Response(JSON.stringify(results.map(deserializeRow5)), { headers: jsonHeaders3() });
      }
      if (!businessId || !canAccessBusiness(principal, businessId)) {
        return new Response(JSON.stringify({ error: "X-Business-ID header required" }), { status: 400, headers: jsonHeaders3() });
      }
      if (branchId && !canAccessBranch(principal, branchId)) {
        return new Response(JSON.stringify({ error: "Branch access denied" }), { status: 403, headers: jsonHeaders3() });
      }
      if (!GLOBAL_TABLES.has(table) && !branchId) {
        return new Response(JSON.stringify({ error: "X-Branch-ID header required for this table" }), { status: 400, headers: jsonHeaders3() });
      }
      if (GLOBAL_TABLES.has(table)) {
        let results = [];
        if (table === "users" && !isAdminLike(principal.role)) {
          const query = await env.DB.prepare(`SELECT * FROM users WHERE businessId = ? AND id = ?`).bind(businessId, principal.userId).all();
          results = query.results || [];
        } else if (table === "branches" && !isAdminLike(principal.role) && principal.branchId) {
          const query = await env.DB.prepare(`SELECT * FROM branches WHERE businessId = ? AND id = ?`).bind(businessId, principal.branchId).all();
          results = query.results || [];
        } else if (table === "customers" && principal.role === "CASHIER" && branchId) {
          const query = await env.DB.prepare(`SELECT * FROM customers WHERE businessId = ? AND (branchId IS NULL OR branchId = ?)`).bind(businessId, branchId).all();
          results = query.results || [];
        } else if (table === "financialAccounts" && principal.role === "CASHIER") {
          results = [];
        } else if ((table === "suppliers" || table === "expenseAccounts") && principal.role === "CASHIER") {
          results = [];
        } else if (table === "financialAccounts" && principal.role === "MANAGER" && principal.branchId) {
          const query = await env.DB.prepare(`SELECT * FROM financialAccounts WHERE businessId = ? AND (branchId IS NULL OR branchId = ?)`).bind(businessId, principal.branchId).all();
          results = query.results || [];
        } else {
          const query = await env.DB.prepare(`SELECT * FROM ${table} WHERE businessId = ?`).bind(businessId).all();
          results = query.results || [];
        }
        return new Response(JSON.stringify(redactRows(table, results.map(deserializeRow5))), { headers: jsonHeaders3() });
      } else {
        const { results } = await env.DB.prepare(`SELECT * FROM ${table} WHERE businessId = ? AND branchId = ?`).bind(businessId, branchId).all();
        return new Response(JSON.stringify(redactRows(table, results.map(deserializeRow5))), { headers: jsonHeaders3() });
      }
    }
    if (request.method === "POST") {
      const body = await request.json();
      const items = Array.isArray(body) ? body : [body];
      if (items.length === 0) return new Response(JSON.stringify({ success: true, count: 0 }), { headers: jsonHeaders3() });
      if (items.length > 250) return new Response(JSON.stringify({ error: "Too many records in one request" }), { status: 413, headers: jsonHeaders3() });
      if (table === "businesses") {
        if (principal.role !== "ROOT" && !service) {
          return new Response(JSON.stringify({ error: "Root access required" }), { status: 403, headers: jsonHeaders3() });
        }
        items.forEach((item) => {
          if (typeof item?.code === "string") item.code = item.code.trim().toUpperCase();
        });
      }
      if (table === "loginAttempts" && principal.role !== "ROOT" && !service) {
        return new Response(JSON.stringify({ error: "Root access required" }), { status: 403, headers: jsonHeaders3() });
      }
      if (!canWriteTable(principal.role, table, service)) {
        return new Response(JSON.stringify({ error: "You are not allowed to change this data." }), { status: 403, headers: jsonHeaders3() });
      }
      if (!service && COMMAND_ONLY_WRITE_TABLES.has(table)) {
        return new Response(JSON.stringify({ error: `Writes to ${table} must use the domain API.` }), { status: 409, headers: jsonHeaders3() });
      }
      if (table === "branches") {
        items.forEach((item) => {
          for (const field of BRANCH_MPESA_LOCKED_FIELDS) delete item[field];
        });
      }
      if (!UNSCOPED_TABLES.has(table)) {
        if (!businessId || !canAccessBusiness(principal, businessId)) {
          return new Response(JSON.stringify({ error: "X-Business-ID header required for POST" }), { status: 400, headers: jsonHeaders3() });
        }
        items.forEach((item) => {
          item.businessId = businessId;
        });
        if (!GLOBAL_TABLES.has(table)) {
          if (!branchId || !canAccessBranch(principal, branchId)) {
            return new Response(JSON.stringify({ error: "X-Branch-ID header required for POST to this table" }), { status: 400, headers: jsonHeaders3() });
          }
          items.forEach((item) => {
            item.branchId = branchId;
          });
        }
      }
      if (table === "settings" && principal.role !== "ROOT" && !service) {
        for (const item of items) {
          const existing = item?.id ? await env.DB.prepare("SELECT aiAssistantEnabled, aiDailyRequestLimit FROM settings WHERE id = ? AND businessId = ? LIMIT 1").bind(item.id, businessId).first() : null;
          if (existing) {
            item.aiAssistantEnabled = existing.aiAssistantEnabled;
            item.aiDailyRequestLimit = existing.aiDailyRequestLimit;
          } else {
            delete item.aiAssistantEnabled;
            delete item.aiDailyRequestLimit;
          }
        }
      }
      let sideEffects = [];
      try {
        if (table === "users") {
          await hardenUserWrites(env.DB, businessId, principal.role, principal.userId, service, items);
        }
        if (table === "customers") {
          await protectCustomerTotals(env.DB, businessId, branchId, principal.role, service, items);
        }
        if (table === "suppliers") {
          await enforceGlobalBranchOwnership(env.DB, table, businessId, branchId, principal.role, service, items);
        }
        if (table === "customerPayments") {
          sideEffects.push(...await hardenCustomerPaymentWrites(env.DB, businessId, branchId, principal.userName, items));
        }
        if (table === "transactions") {
          sideEffects = await hardenTransactionBatch({
            db: env.DB,
            businessId,
            branchId,
            principal,
            service
          }, items);
        }
      } catch (err) {
        const status = err instanceof PolicyError ? err.status : 400;
        return new Response(JSON.stringify({ error: err?.message || "Request was rejected." }), { status, headers: jsonHeaders3() });
      }
      const { results: pragma } = await env.DB.prepare(`PRAGMA table_info('${table}')`).all();
      const validCols = new Set(pragma.map((r) => r.name));
      const cols = Object.keys(items[0]).filter((k) => validCols.has(k));
      if (cols.length === 0) return new Response(JSON.stringify({ error: "No valid columns to insert" }), { status: 400, headers: jsonHeaders3() });
      const sql = `INSERT OR REPLACE INTO ${table} (${cols.map((c) => '"' + c + '"').join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
      const stmt = env.DB.prepare(sql);
      const batch = items.map((item) => stmt.bind(...cols.map((col) => serializeValue3(item[col]))));
      await env.DB.batch([...batch, ...sideEffects]);
      return new Response(JSON.stringify({ success: true, count: items.length }), { headers: jsonHeaders3() });
    }
    if (request.method === "DELETE") {
      let id = recordId;
      if (!id) {
        const body = await request.json();
        id = body?.id;
      }
      if (!id) return new Response(JSON.stringify({ error: "ID required for DELETE" }), { status: 400, headers: jsonHeaders3() });
      if (!service && COMMAND_ONLY_WRITE_TABLES.has(table)) {
        return new Response(JSON.stringify({ error: `Deletes from ${table} must use the domain API.` }), { status: 409, headers: jsonHeaders3() });
      }
      if (table === "businesses") {
        if (principal.role !== "ROOT" && !service) return new Response(JSON.stringify({ error: "Root access required" }), { status: 403, headers: jsonHeaders3() });
        const cascadeTables = ["users", "products", "productIngredients", "transactions", "cashPicks", "shifts", "endOfDayReports", "stockMovements", "expenses", "customers", "customerPayments", "serviceItems", "salesInvoices", "suppliers", "supplierPayments", "creditNotes", "dailySummaries", "stockAdjustmentRequests", "purchaseOrders", "settings", "categories", "branches", "financialAccounts"];
        const batch = cascadeTables.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE businessId = ?`).bind(id));
        batch.push(env.DB.prepare(`DELETE FROM businesses WHERE id = ?`).bind(id));
        await env.DB.batch(batch);
      } else if (table === "loginAttempts") {
        if (principal.role !== "ROOT" && !service) return new Response(JSON.stringify({ error: "Root access required" }), { status: 403, headers: jsonHeaders3() });
        await env.DB.prepare(`DELETE FROM loginAttempts WHERE id = ?`).bind(id).run();
      } else if (GLOBAL_TABLES.has(table)) {
        if (!businessId || !canAccessBusiness(principal, businessId)) return new Response(JSON.stringify({ error: "X-Business-ID required for DELETE" }), { status: 400, headers: jsonHeaders3() });
        if (!canDeleteTable(principal.role, table, service)) return new Response(JSON.stringify({ error: "You are not allowed to delete this data." }), { status: 403, headers: jsonHeaders3() });
        if (table === "users" && !service && principal.role !== "ROOT") {
          if (id === principal.userId) {
            return new Response(JSON.stringify({ error: "You cannot delete your own signed-in account." }), { status: 403, headers: jsonHeaders3() });
          }
          const user = await env.DB.prepare("SELECT role FROM users WHERE id = ? AND businessId = ? LIMIT 1").bind(id, businessId).first();
          if (user?.role === "ADMIN") {
            const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE businessId = ? AND role = 'ADMIN'").bind(businessId).first();
            if (Number(row?.count || 0) <= 1) {
              return new Response(JSON.stringify({ error: "The last administrator cannot be deleted." }), { status: 403, headers: jsonHeaders3() });
            }
          }
        }
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND businessId = ?`).bind(id, businessId).run();
      } else {
        if (!businessId || !branchId || !canAccessBusiness(principal, businessId) || !canAccessBranch(principal, branchId)) return new Response(JSON.stringify({ error: "X-Business-ID and X-Branch-ID required for DELETE" }), { status: 400, headers: jsonHeaders3() });
        if (!canDeleteTable(principal.role, table, service)) {
          if (table !== "transactions" || principal.role !== "CASHIER") {
            return new Response(JSON.stringify({ error: "You are not allowed to delete this data." }), { status: 403, headers: jsonHeaders3() });
          }
          const transaction = await env.DB.prepare(
            `SELECT cashierId, timestamp FROM transactions WHERE id = ? AND businessId = ? AND branchId = ? LIMIT 1`
          ).bind(id, businessId, branchId).first();
          const isOwnRecentSale = transaction && String(transaction.cashierId || "") === principal.userId && Date.now() - Number(transaction.timestamp || 0) <= 2 * 60 * 1e3;
          if (!isOwnRecentSale) {
            return new Response(JSON.stringify({ error: "Cashier accounts can only undo their own just-created sale." }), { status: 403, headers: jsonHeaders3() });
          }
        }
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND businessId = ? AND branchId = ?`).bind(id, businessId, branchId).run();
      }
      return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders3() });
    }
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders3() });
  } catch (err) {
    console.error("[Worker Error]", err);
    return new Response(JSON.stringify({ error: "Request failed." }), { status: 500, headers: jsonHeaders3() });
  }
}, "onRequest");

// api/_runtime-config.ts
var corsHeaders51 = {
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function jsonHeaders4() {
  return {
    "Content-Type": "application/json",
    ...corsHeaders51,
    // Ensure the browser/SW doesn't cache secrets
    "Cache-Control": "no-store, no-cache, must-revalidate"
  };
}
__name(jsonHeaders4, "jsonHeaders");
var onRequestGet3 = /* @__PURE__ */ __name(async (context) => {
  return new Response(
    JSON.stringify({
      apiKey: null,
      message: "Runtime secrets are server-side only."
    }),
    { headers: jsonHeaders4() }
  );
}, "onRequestGet");
var onRequestOptions43 = /* @__PURE__ */ __name(async () => {
  return new Response(null, { headers: corsHeaders51 });
}, "onRequestOptions");

// api/auth.ts
var corsHeaders52 = {
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
async function ensureAttemptTable3(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)").run();
}
__name(ensureAttemptTable3, "ensureAttemptTable");
async function ensureAuthSchema(db) {
  await ensureAttemptTable3(db);
  const userColumns = [
    "branchId TEXT",
    "pin TEXT",
    "updated_at INTEGER"
  ];
  for (const column of userColumns) {
    try {
      await db.prepare(`ALTER TABLE users ADD COLUMN ${column}`).run();
    } catch {
    }
  }
}
__name(ensureAuthSchema, "ensureAuthSchema");
async function getLockout(db, id) {
  await ensureAttemptTable3(db);
  const row = await db.prepare("SELECT count, lockedUntil FROM loginAttempts WHERE id = ?").bind(id).first();
  if (row?.lockedUntil && Date.now() < Number(row.lockedUntil)) {
    const mins = Math.ceil((Number(row.lockedUntil) - Date.now()) / 6e4);
    return { locked: true, message: `Account locked. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }
  return { locked: false };
}
__name(getLockout, "getLockout");
async function recordFailure(db, id) {
  await ensureAttemptTable3(db);
  const row = await db.prepare("SELECT count FROM loginAttempts WHERE id = ?").bind(id).first();
  const count = Number(row?.count || 0) + 1;
  const lockedUntil = count >= 5 ? Date.now() + 30 * 60 * 1e3 : null;
  await db.prepare("INSERT OR REPLACE INTO loginAttempts (id, count, lockedUntil, updated_at) VALUES (?, ?, ?, ?)").bind(id, count, lockedUntil, Date.now()).run();
}
__name(recordFailure, "recordFailure");
async function clearFailure(db, id) {
  await db.prepare("DELETE FROM loginAttempts WHERE id = ?").bind(id).run();
}
__name(clearFailure, "clearFailure");
function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    businessId: user.businessId,
    branchId: user.branchId || void 0
  };
}
__name(safeUser, "safeUser");
var onRequestOptions44 = /* @__PURE__ */ __name(async ({ request }) => {
  const blocked = rejectUntrustedBrowserOrigin(request);
  if (blocked) return blocked;
  return new Response(null, { headers: corsHeaders52 });
}, "onRequestOptions");
var onRequestDelete = /* @__PURE__ */ __name(async ({ request }) => {
  const blocked = rejectUntrustedBrowserOrigin(request);
  if (blocked) return blocked;
  return json({ success: true }, 200, {
    ...corsHeaders52,
    "Set-Cookie": clearSessionCookie(request)
  });
}, "onRequestDelete");
async function handleAuthPost(request, env) {
  const blocked = rejectUntrustedBrowserOrigin(request);
  if (blocked) return blocked;
  if (!env.API_SECRET) return json({ error: "Server is not configured." }, 500, corsHeaders52);
  if (!env.DB) return json({ error: "Database is not configured." }, 500, corsHeaders52);
  await ensureAuthSchema(env.DB);
  const body = await request.json().catch(() => null);
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  const businessCode = String(body?.businessCode || "").trim().toUpperCase();
  if (!username || !password) return json({ error: "Enter username and password." }, 400, corsHeaders52);
  if (env.ROOT_USERNAME && username === env.ROOT_USERNAME) {
    const rootLockoutId = `ROOT_LOGIN:${username.toLowerCase()}`;
    const rootLockout = await getLockout(env.DB, rootLockoutId);
    if (rootLockout.locked) return json({ error: rootLockout.message }, 423, corsHeaders52);
    if (env.ROOT_PASSWORD && password === env.ROOT_PASSWORD) {
      await clearFailure(env.DB, rootLockoutId);
      const token2 = await createSessionToken(env.API_SECRET, {
        userId: "root",
        userName: "System Root",
        role: "ROOT"
      });
      return json({ user: { id: "root", name: "System Root", role: "ROOT" }, businessId: null, branchId: null }, 200, {
        ...corsHeaders52,
        "Set-Cookie": createSessionCookie(request, token2)
      });
    }
    await recordFailure(env.DB, rootLockoutId);
    return json({ error: "Invalid username or password." }, 401, corsHeaders52);
  }
  if (!businessCode) return json({ error: "Enter the business code." }, 400, corsHeaders52);
  const lockoutId = `LOGIN:${businessCode}:${username.toLowerCase()}`;
  const lockout = await getLockout(env.DB, lockoutId);
  if (lockout.locked) return json({ error: lockout.message }, 423, corsHeaders52);
  const business = await env.DB.prepare("SELECT id, name, code, isActive FROM businesses WHERE code = ? LIMIT 1").bind(businessCode).first();
  if (!business || Number(business.isActive ?? 1) === 0) {
    await recordFailure(env.DB, lockoutId);
    return json({ error: "Business not found or inactive." }, 401, corsHeaders52);
  }
  const user = await env.DB.prepare(`
    SELECT id, name, role, password, businessId, branchId
    FROM users
    WHERE businessId = ? AND lower(trim(name)) = ?
    LIMIT 1
  `).bind(business.id, username.toLowerCase()).first();
  if (!user || !await verifyPassword(password, String(user.password || ""))) {
    await recordFailure(env.DB, lockoutId);
    return json({ error: "Invalid username or password." }, 401, corsHeaders52);
  }
  await clearFailure(env.DB, lockoutId);
  if (!isPasswordHashCurrent(String(user.password || ""))) {
    await env.DB.prepare("UPDATE users SET password = ?, updated_at = ? WHERE id = ? AND businessId = ?").bind(await hashPassword(password), Date.now(), user.id, business.id).run();
  }
  let branchId = user.branchId || null;
  if (!branchId) {
    const firstBranch = await env.DB.prepare("SELECT id FROM branches WHERE businessId = ? AND COALESCE(isActive, 1) != 0 ORDER BY name LIMIT 1").bind(business.id).first();
    branchId = firstBranch?.id || null;
  }
  const cleanUser = safeUser({ ...user, branchId });
  const branchScope = cleanUser.role === "ADMIN" || cleanUser.role === "ROOT" ? user.branchId || void 0 : branchId || void 0;
  const token = await createSessionToken(env.API_SECRET, {
    userId: cleanUser.id,
    userName: cleanUser.name,
    role: cleanUser.role,
    businessId: business.id,
    branchId: branchScope
  });
  return json({ user: cleanUser, businessId: business.id, branchId }, 200, {
    ...corsHeaders52,
    "Set-Cookie": createSessionCookie(request, token)
  });
}
__name(handleAuthPost, "handleAuthPost");
var onRequestPost42 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    return await handleAuthPost(request, env);
  } catch (err) {
    console.error("Auth request failed:", err?.message || err);
    return json({ error: "Could not sign in." }, 500, corsHeaders52);
  }
}, "onRequestPost");

// api/_middleware.ts
var onRequest10 = /* @__PURE__ */ __name(async (context) => {
  const { request } = context;
  const blocked = rejectUntrustedBrowserOrigin(request);
  if (blocked) return blocked;
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 25e5) {
    return new Response(JSON.stringify({ error: "Request too large." }), {
      status: 413,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
  const response = await context.next();
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");
  headers.delete("Access-Control-Allow-Origin");
  headers.delete("Access-Control-Allow-Credentials");
  if (origin && isTrustedBrowserOrigin(request)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.append("Vary", "Origin");
  }
  headers.set("X-Content-Type-Options", headers.get("X-Content-Type-Options") || "nosniff");
  headers.set("Referrer-Policy", headers.get("Referrer-Policy") || "no-referrer");
  headers.set("X-Frame-Options", headers.get("X-Frame-Options") || "DENY");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}, "onRequest");

// ../.wrangler/tmp/pages-BLAN55/functionsRoutes-0.06910572525175096.mjs
var routes = [
  {
    routePath: "/api/mpesa/callback/:secret*",
    mountPath: "/api/mpesa/callback",
    method: "",
    middlewares: [],
    modules: [onRequest]
  },
  {
    routePath: "/api/mpesa/status/:id*",
    mountPath: "/api/mpesa/status",
    method: "",
    middlewares: [],
    modules: [onRequest2]
  },
  {
    routePath: "/api/admin/branch",
    mountPath: "/api/admin",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions]
  },
  {
    routePath: "/api/admin/branch",
    mountPath: "/api/admin",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/admin/business",
    mountPath: "/api/admin",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions2]
  },
  {
    routePath: "/api/admin/business",
    mountPath: "/api/admin",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/admin/staff",
    mountPath: "/api/admin",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions3]
  },
  {
    routePath: "/api/admin/staff",
    mountPath: "/api/admin",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/admin/verify",
    mountPath: "/api/admin",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions4]
  },
  {
    routePath: "/api/admin/verify",
    mountPath: "/api/admin",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/api/ai/ask",
    mountPath: "/api/ai",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions5]
  },
  {
    routePath: "/api/ai/ask",
    mountPath: "/api/ai",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost5]
  },
  {
    routePath: "/api/audit/log",
    mountPath: "/api/audit",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions6]
  },
  {
    routePath: "/api/audit/log",
    mountPath: "/api/audit",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost6]
  },
  {
    routePath: "/api/cash/pick",
    mountPath: "/api/cash",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions7]
  },
  {
    routePath: "/api/cash/pick",
    mountPath: "/api/cash",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost7]
  },
  {
    routePath: "/api/catalog/category",
    mountPath: "/api/catalog",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions8]
  },
  {
    routePath: "/api/catalog/category",
    mountPath: "/api/catalog",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost8]
  },
  {
    routePath: "/api/catalog/expense-account",
    mountPath: "/api/catalog",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions9]
  },
  {
    routePath: "/api/catalog/expense-account",
    mountPath: "/api/catalog",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost9]
  },
  {
    routePath: "/api/catalog/service-item",
    mountPath: "/api/catalog",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions10]
  },
  {
    routePath: "/api/catalog/service-item",
    mountPath: "/api/catalog",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost10]
  },
  {
    routePath: "/api/close/day",
    mountPath: "/api/close",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions11]
  },
  {
    routePath: "/api/close/day",
    mountPath: "/api/close",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost11]
  },
  {
    routePath: "/api/close/shift",
    mountPath: "/api/close",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions12]
  },
  {
    routePath: "/api/close/shift",
    mountPath: "/api/close",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost12]
  },
  {
    routePath: "/api/customers/payment",
    mountPath: "/api/customers",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions13]
  },
  {
    routePath: "/api/customers/payment",
    mountPath: "/api/customers",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost13]
  },
  {
    routePath: "/api/customers/profile",
    mountPath: "/api/customers",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions14]
  },
  {
    routePath: "/api/customers/profile",
    mountPath: "/api/customers",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost14]
  },
  {
    routePath: "/api/expenses/approve",
    mountPath: "/api/expenses",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions15]
  },
  {
    routePath: "/api/expenses/approve",
    mountPath: "/api/expenses",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost15]
  },
  {
    routePath: "/api/expenses/delete",
    mountPath: "/api/expenses",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions16]
  },
  {
    routePath: "/api/expenses/delete",
    mountPath: "/api/expenses",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost16]
  },
  {
    routePath: "/api/expenses/reject",
    mountPath: "/api/expenses",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions17]
  },
  {
    routePath: "/api/expenses/reject",
    mountPath: "/api/expenses",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost17]
  },
  {
    routePath: "/api/expenses/submit",
    mountPath: "/api/expenses",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions18]
  },
  {
    routePath: "/api/expenses/submit",
    mountPath: "/api/expenses",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost18]
  },
  {
    routePath: "/api/finance/account",
    mountPath: "/api/finance",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions19]
  },
  {
    routePath: "/api/finance/account",
    mountPath: "/api/finance",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost19]
  },
  {
    routePath: "/api/mpesa/transactions",
    mountPath: "/api/mpesa",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/mpesa/transactions",
    mountPath: "/api/mpesa",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions20]
  },
  {
    routePath: "/api/mpesa/utilize",
    mountPath: "/api/mpesa",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions21]
  },
  {
    routePath: "/api/mpesa/utilize",
    mountPath: "/api/mpesa",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost20]
  },
  {
    routePath: "/api/mpesa/verify",
    mountPath: "/api/mpesa",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions22]
  },
  {
    routePath: "/api/mpesa/verify",
    mountPath: "/api/mpesa",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost21]
  },
  {
    routePath: "/api/products/save",
    mountPath: "/api/products",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions23]
  },
  {
    routePath: "/api/products/save",
    mountPath: "/api/products",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost22]
  },
  {
    routePath: "/api/purchases/approval",
    mountPath: "/api/purchases",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions24]
  },
  {
    routePath: "/api/purchases/approval",
    mountPath: "/api/purchases",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost23]
  },
  {
    routePath: "/api/purchases/receive",
    mountPath: "/api/purchases",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions25]
  },
  {
    routePath: "/api/purchases/receive",
    mountPath: "/api/purchases",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost24]
  },
  {
    routePath: "/api/purchases/save",
    mountPath: "/api/purchases",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions26]
  },
  {
    routePath: "/api/purchases/save",
    mountPath: "/api/purchases",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost25]
  },
  {
    routePath: "/api/sales/checkout",
    mountPath: "/api/sales",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions27]
  },
  {
    routePath: "/api/sales/checkout",
    mountPath: "/api/sales",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost26]
  },
  {
    routePath: "/api/sales/invoice-cancel",
    mountPath: "/api/sales",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions28]
  },
  {
    routePath: "/api/sales/invoice-cancel",
    mountPath: "/api/sales",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost27]
  },
  {
    routePath: "/api/sales/invoice-create",
    mountPath: "/api/sales",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions29]
  },
  {
    routePath: "/api/sales/invoice-create",
    mountPath: "/api/sales",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost28]
  },
  {
    routePath: "/api/sales/refund-approve",
    mountPath: "/api/sales",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions30]
  },
  {
    routePath: "/api/sales/refund-approve",
    mountPath: "/api/sales",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost29]
  },
  {
    routePath: "/api/sales/refund-reject",
    mountPath: "/api/sales",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions31]
  },
  {
    routePath: "/api/sales/refund-reject",
    mountPath: "/api/sales",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost30]
  },
  {
    routePath: "/api/sales/refund-request",
    mountPath: "/api/sales",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions32]
  },
  {
    routePath: "/api/sales/refund-request",
    mountPath: "/api/sales",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost31]
  },
  {
    routePath: "/api/settings/business",
    mountPath: "/api/settings",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions33]
  },
  {
    routePath: "/api/settings/business",
    mountPath: "/api/settings",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost32]
  },
  {
    routePath: "/api/stock/adjustment-approve",
    mountPath: "/api/stock",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions34]
  },
  {
    routePath: "/api/stock/adjustment-approve",
    mountPath: "/api/stock",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost33]
  },
  {
    routePath: "/api/stock/adjustment-reject",
    mountPath: "/api/stock",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions35]
  },
  {
    routePath: "/api/stock/adjustment-reject",
    mountPath: "/api/stock",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost34]
  },
  {
    routePath: "/api/stock/adjustment-request",
    mountPath: "/api/stock",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions36]
  },
  {
    routePath: "/api/stock/adjustment-request",
    mountPath: "/api/stock",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost35]
  },
  {
    routePath: "/api/stock/restock",
    mountPath: "/api/stock",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions37]
  },
  {
    routePath: "/api/stock/restock",
    mountPath: "/api/stock",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost36]
  },
  {
    routePath: "/api/suppliers/credit-note",
    mountPath: "/api/suppliers",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions38]
  },
  {
    routePath: "/api/suppliers/credit-note",
    mountPath: "/api/suppliers",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost37]
  },
  {
    routePath: "/api/suppliers/payment",
    mountPath: "/api/suppliers",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions39]
  },
  {
    routePath: "/api/suppliers/payment",
    mountPath: "/api/suppliers",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost38]
  },
  {
    routePath: "/api/suppliers/profile",
    mountPath: "/api/suppliers",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions40]
  },
  {
    routePath: "/api/suppliers/profile",
    mountPath: "/api/suppliers",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost39]
  },
  {
    routePath: "/api/user/password",
    mountPath: "/api/user",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions41]
  },
  {
    routePath: "/api/user/password",
    mountPath: "/api/user",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost40]
  },
  {
    routePath: "/api/mpesa/settings",
    mountPath: "/api/mpesa",
    method: "",
    middlewares: [],
    modules: [onRequest3]
  },
  {
    routePath: "/api/mpesa/stkpush",
    mountPath: "/api/mpesa",
    method: "",
    middlewares: [],
    modules: [onRequest4]
  },
  {
    routePath: "/api/sync/flush",
    mountPath: "/api/sync",
    method: "",
    middlewares: [],
    modules: [onRequest5]
  },
  {
    routePath: "/api/sync/heartbeat",
    mountPath: "/api/sync",
    method: "",
    middlewares: [],
    modules: [onRequest6]
  },
  {
    routePath: "/api/sync/status",
    mountPath: "/api/sync",
    method: "",
    middlewares: [],
    modules: [onRequest7]
  },
  {
    routePath: "/api/images/:id",
    mountPath: "/api/images",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/images/:id",
    mountPath: "/api/images",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost41]
  },
  {
    routePath: "/api/billing/:action*",
    mountPath: "/api/billing",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions42]
  },
  {
    routePath: "/api/billing/:action*",
    mountPath: "/api/billing",
    method: "",
    middlewares: [],
    modules: [onRequest8]
  },
  {
    routePath: "/api/data/:table*",
    mountPath: "/api/data",
    method: "",
    middlewares: [],
    modules: [onRequest9]
  },
  {
    routePath: "/api/_runtime-config",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/api/_runtime-config",
    mountPath: "/api",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions43]
  },
  {
    routePath: "/api/auth",
    mountPath: "/api",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete]
  },
  {
    routePath: "/api/auth",
    mountPath: "/api",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions44]
  },
  {
    routePath: "/api/auth",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost42]
  },
  {
    routePath: "/api",
    mountPath: "/api",
    method: "",
    middlewares: [onRequest10],
    modules: []
  }
];

// ../node_modules/wrangler/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
