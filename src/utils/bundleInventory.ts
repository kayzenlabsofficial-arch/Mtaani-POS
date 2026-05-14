import type { Product, ProductIngredient } from '../db';

export type IngredientLine = {
  ingredientProductId: string;
  quantity: number;
};

export function isBundleProduct(product: Product | null | undefined): boolean {
  return product?.isBundle === true || product?.isBundle === 1 || product?.isBundle === '1';
}

export function getProductIngredients(
  product: Product | null | undefined,
  productIngredients: ProductIngredient[] = []
): IngredientLine[] {
  if (!product) return [];

  const savedRows = productIngredients
    .filter(row => row.productId === product.id)
    .map(row => ({
      ingredientProductId: row.ingredientProductId,
      quantity: Number(row.quantity) || 0,
    }))
    .filter(row => row.ingredientProductId && row.quantity > 0);

  if (savedRows.length > 0) return savedRows;

  return (product.components || [])
    .map(row => ({
      ingredientProductId: row.productId,
      quantity: Number(row.quantity) || 0,
    }))
    .filter(row => row.ingredientProductId && row.quantity > 0);
}

export function getBundleAvailableStock(
  product: Product,
  products: Product[] = [],
  productIngredients: ProductIngredient[] = []
): number {
  const ingredients = getProductIngredients(product, productIngredients);
  if (!isBundleProduct(product) || ingredients.length === 0) return Number(product.stockQuantity) || 0;

  const ingredientStocks = ingredients.map(row => {
    const ingredient = products.find(p => p.id === row.ingredientProductId);
    if (!ingredient || row.quantity <= 0) return 0;
    return Math.floor((Number(ingredient.stockQuantity) || 0) / row.quantity);
  });

  return Math.max(0, Math.min(...ingredientStocks));
}

export function enrichProductsWithBundleStock(
  products: Product[] = [],
  productIngredients: ProductIngredient[] = []
): Product[] {
  return products.map(product => (
    isBundleProduct(product)
      ? { ...product, stockQuantity: getBundleAvailableStock(product, products, productIngredients) }
      : product
  ));
}

