import type { Product } from '../db';
import { apiRequest } from './apiClient';

export type ProductIngredientInput = {
  ingredientProductId: string;
  quantity: number;
};

export const ProductService = {
  save(input: {
    product: Partial<Product> & { id?: string };
    ingredients?: ProductIngredientInput[];
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; product: Product }>('/api/products/save', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};

