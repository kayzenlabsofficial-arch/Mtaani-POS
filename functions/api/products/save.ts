import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const PRODUCT_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function isTruthy(value: unknown) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

async function ensureSchema(db: D1Database) {
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

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !PRODUCT_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to manage products.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const productInput = body?.product || body || {};
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || productInput.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || productInput.branchId || '').trim();
    if (!businessId || !branchId) return json({ error: 'Business and branch are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    const name = trimText(productInput.name, 160);
    if (!name) return json({ error: 'Product name is required.' }, 400);

    await ensureSchema(env.DB);
    const productId = trimText(productInput.id || body?.productId, 160) || crypto.randomUUID();
    const existing = await env.DB.prepare(`
      SELECT *
      FROM products
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(productId, businessId).first<any>();
    if (existing?.branchId && existing.branchId !== branchId) throw new PolicyError('Product belongs to another branch.', 403);

    const isBundle = isTruthy(productInput.isBundle);
    const ingredients = Array.isArray(body?.ingredients)
      ? body.ingredients
      : Array.isArray(productInput.ingredients)
        ? productInput.ingredients
        : [];

    const cleanIngredients = ingredients
      .map((row: any) => ({
        ingredientProductId: trimText(row?.ingredientProductId || row?.productId, 160),
        quantity: asNumber(row?.quantity),
      }))
      .filter((row: any) => row.ingredientProductId && row.quantity > 0)
      .slice(0, 100);

    if (isBundle && cleanIngredients.length === 0) throw new PolicyError('Add at least one ingredient for this bulk item.', 400);
    if (isBundle && cleanIngredients.some((row: any) => row.ingredientProductId === productId)) {
      throw new PolicyError('A bulk item cannot use itself as an ingredient.', 400);
    }

    for (const ingredient of cleanIngredients) {
      const ingredientProduct = await env.DB.prepare(`
        SELECT id, branchId
        FROM products
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(ingredient.ingredientProductId, businessId).first<any>();
      if (!ingredientProduct) throw new PolicyError('A selected ingredient was not found.', 404);
      if (ingredientProduct.branchId && ingredientProduct.branchId !== branchId) throw new PolicyError('A selected ingredient belongs to another branch.', 403);
    }

    const now = Date.now();
    const product = {
      id: productId,
      name,
      category: trimText(productInput.category, 120) || 'General',
      sellingPrice: roundMoney(Math.max(0, asNumber(productInput.sellingPrice))),
      costPrice: roundMoney(Math.max(0, asNumber(productInput.costPrice))),
      taxCategory: ['A', 'C', 'E'].includes(String(productInput.taxCategory || '').toUpperCase()) ? String(productInput.taxCategory).toUpperCase() : 'A',
      stockQuantity: isBundle ? 0 : existing ? asNumber(existing.stockQuantity) : Math.max(0, asNumber(productInput.stockQuantity)),
      unit: trimText(productInput.unit, 24) || 'pcs',
      barcode: trimText(productInput.barcode, 80) || `SKU-${Date.now()}`,
      reorderPoint: Math.max(0, asNumber(productInput.reorderPoint, 5)),
      isBundle: isBundle ? 1 : 0,
      components: isBundle ? cleanIngredients.map((row: any) => ({ productId: row.ingredientProductId, quantity: row.quantity })) : [],
      branchId: existing?.branchId || branchId,
      businessId,
      updated_at: now,
    };

    const statements: D1PreparedStatement[] = [
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
        now,
      ),
      env.DB.prepare(`DELETE FROM productIngredients WHERE productId = ? AND businessId = ?`).bind(product.id, businessId),
    ];

    if (isBundle) {
      for (const ingredient of cleanIngredients) {
        statements.push(
          env.DB.prepare(`
            INSERT INTO productIngredients (id, productId, ingredientProductId, quantity, businessId, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(`${product.id}_${ingredient.ingredientProductId}`, product.id, ingredient.ingredientProductId, ingredient.quantity, businessId, now)
        );
      }
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
        existing ? 'product.update' : 'product.create',
        'product',
        product.id,
        'INFO',
        `${existing ? 'Updated' : 'Created'} product ${product.name}.`,
        businessId,
        branchId,
        now,
      )
    );

    await env.DB.batch(statements);
    return json({ success: true, product });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not save product.' }, status);
  }
};

