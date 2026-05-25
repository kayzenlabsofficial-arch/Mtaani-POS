import type { Product } from '../db';
import type { CartItem } from '../store';
import { roundMoney } from './posMoney';

export type ProductDiscountType = 'NONE' | 'FIXED' | 'PERCENT';

export function normaliseDiscountType(value: unknown): ProductDiscountType {
  const type = String(value || '').trim().toUpperCase();
  if (type === 'FIXED' || type === 'PERCENT') return type;
  return 'NONE';
}

export function productUnitDiscount(product: Pick<Product, 'sellingPrice' | 'discountType' | 'discountValue'>): number {
  const price = Math.max(0, Number(product.sellingPrice) || 0);
  const value = Math.max(0, Number(product.discountValue) || 0);
  const type = normaliseDiscountType(product.discountType);
  if (price <= 0 || value <= 0 || type === 'NONE') return 0;
  if (type === 'PERCENT') return roundMoney(Math.min(price, price * Math.min(value, 100) / 100));
  return roundMoney(Math.min(price, value));
}

export function productSalePrice(product: Pick<Product, 'sellingPrice' | 'discountType' | 'discountValue'>): number {
  return roundMoney(Math.max(0, (Number(product.sellingPrice) || 0) - productUnitDiscount(product)));
}

export function productDiscountLabel(product: Pick<Product, 'discountType' | 'discountValue'>): string {
  const type = normaliseDiscountType(product.discountType);
  const value = Number(product.discountValue) || 0;
  if (type === 'PERCENT' && value > 0) return `${Math.min(value, 100).toLocaleString()}% off`;
  if (type === 'FIXED' && value > 0) return `Ksh ${value.toLocaleString()} off`;
  return '';
}

export function calculateCartTotals(cart: Array<CartItem | (Product & { cartQuantity?: number })>) {
  return cart.reduce((totals, item) => {
    const quantity = Number((item as any).cartQuantity ?? 1) || 0;
    const unitPrice = Math.max(0, Number(item.sellingPrice) || 0);
    const unitDiscount = productUnitDiscount(item);
    totals.subtotal = roundMoney(totals.subtotal + unitPrice * quantity);
    totals.discountAmount = roundMoney(totals.discountAmount + unitDiscount * quantity);
    totals.total = roundMoney(totals.subtotal - totals.discountAmount);
    return totals;
  }, { subtotal: 0, discountAmount: 0, total: 0 });
}
