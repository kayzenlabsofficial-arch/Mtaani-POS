import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Product, User } from './db';

export interface CartItem extends Product {
  cartQuantity: number;
}

const clampCartQuantity = (quantity: number, product: Product) => {
  const requested = Number.isFinite(quantity) ? quantity : 1;
  const stock = Number(product.stockQuantity);
  const rounded = (value: number) => Number(value.toFixed(3));

  if (Number.isFinite(stock) && stock > 0) {
    return rounded(Math.min(Math.max(0.001, requested), stock));
  }

  return rounded(Math.max(0.001, requested));
};

interface POSState {
  cart: CartItem[];
  isAdmin: boolean;
  isManager: boolean;
  currentUser: User | null;
  activeShift: any | null;
  activeBranchId: string | null;
  activeBusinessId: string | null;
  isSystemAdmin: boolean;
  login: (user: User) => void;
  logout: () => void;
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, delta: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  setCurrentUser: (user: User | null) => void;
  setActiveShift: (shift: any | null) => void;
  setActiveBranchId: (id: string | null) => void;
  setActiveBusinessId: (id: string | null) => void;
  paymentSupplierId: string | null;
  setPaymentSupplierId: (id: string | null) => void;
  selectedCustomerId: string | null;
  setSelectedCustomerId: (id: string | null) => void;
  resetSession: () => void;
}

const initialState = {
  cart: [] as CartItem[],
  isAdmin: false,
  isManager: false,
  currentUser: null as User | null,
  activeShift: null as any | null,
  activeBranchId: null as string | null,
  activeBusinessId: null as string | null,
  isSystemAdmin: false,
  paymentSupplierId: null as string | null,
  selectedCustomerId: null as string | null,
};

export const useStore = create<POSState>()(
  persist(
    (set) => ({
      ...initialState,
      setPaymentSupplierId: (id) => set({ paymentSupplierId: id }),
      setSelectedCustomerId: (id) => set({ selectedCustomerId: id }),
      setActiveBranchId: (activeBranchId) => set({ activeBranchId }),
      setActiveBusinessId: (activeBusinessId) => set({ activeBusinessId }),
      setCurrentUser: (user) => set({ 
        currentUser: user, 
        isAdmin: user?.role === 'ADMIN',
        isManager: user?.role === 'MANAGER',
        isSystemAdmin: user?.role === 'ROOT'
      }),
      login: (user) => set({ 
        currentUser: user, 
        isAdmin: user?.role === 'ADMIN',
        isManager: user?.role === 'MANAGER',
        isSystemAdmin: user?.role === 'ROOT'
      }),
      logout: () => set({ 
        ...initialState,
        activeBusinessId: null,
        activeBranchId: null
      }),
      setActiveShift: (activeShift) => set({ activeShift }),
      addToCart: (product) => set((state) => {
        const stock = Number(product.stockQuantity);
        if (Number.isFinite(stock) && stock <= 0) return { cart: state.cart };

        const existing = state.cart.find((item) => item.id === product.id);
        if (existing) {
          return {
            cart: state.cart.map((item) => 
              item.id === product.id 
                ? { ...item, ...product, cartQuantity: clampCartQuantity(item.cartQuantity + 1, product) } 
                : item
            )
          };
        }
        return { cart: [...state.cart, { ...product, cartQuantity: clampCartQuantity(1, product) }] };
      }),
      removeFromCart: (productId) => set((state) => ({
        cart: state.cart.filter((item) => item.id !== productId)
      })),
      updateQuantity: (productId, delta) => set((state) => ({
        cart: state.cart.map((item) => {
          if (item.id === productId) {
            return { ...item, cartQuantity: clampCartQuantity(item.cartQuantity + delta, item) };
          }
          return item;
        })
      })),
      setQuantity: (productId, quantity) => set((state) => ({
        cart: state.cart.map((item) => 
          item.id === productId 
            ? { ...item, cartQuantity: clampCartQuantity(Number(quantity), item) } 
            : item
        )
      })),
      clearCart: () => set({ cart: [], selectedCustomerId: null }),
      resetSession: () => set({ ...initialState }),
    }),
    {
      name: 'mtaani-pos-storage',
      version: 2,
      migrate: () => ({}),
      partialize: () => ({}),
    }
  )
);
