import { belongsToShop } from './inventoryIntegrity';

export function belongsToActiveShop(row: { shopId?: string | null }, activeShopId?: string | null): boolean {
  return belongsToShop(row, activeShopId);
}
