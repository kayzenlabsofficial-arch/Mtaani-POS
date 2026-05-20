import type { Product, PurchaseOrder } from '../db';

function purchaseItems(order: PurchaseOrder | any): any[] {
  if (Array.isArray(order?.items)) return order.items;
  if (typeof order?.items === 'string') {
    try {
      const parsed = JSON.parse(order.items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function suppliedProductIdsFromOrders(
  purchaseOrders: Array<PurchaseOrder | any> | undefined,
  supplierId: string | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!supplierId) return ids;

  for (const order of purchaseOrders || []) {
    if (order?.supplierId !== supplierId || order?.status !== 'RECEIVED') continue;
    for (const item of purchaseItems(order)) {
      const productId = String(item?.productId || '').trim();
      const receivedQty = Number(item?.receivedQuantity ?? item?.expectedQuantity ?? 0);
      if (productId && receivedQty > 0) ids.add(productId);
    }
  }

  return ids;
}

export function productsForSupplier(
  products: Product[] | undefined,
  purchaseOrders: Array<PurchaseOrder | any> | undefined,
  supplierId: string | undefined,
): Product[] {
  const allProducts = products || [];
  const knownIds = suppliedProductIdsFromOrders(purchaseOrders, supplierId);
  if (!supplierId || knownIds.size === 0) return allProducts;
  return allProducts.filter(product => knownIds.has(product.id));
}
