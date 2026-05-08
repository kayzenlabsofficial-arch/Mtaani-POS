import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Product, User } from './db';

export interface CartItem extends Product {
  cartQuantity: number;
}

interface POSState {
  cart: CartItem[];
  isAdmin: boolean;
  isManager: boolean;
  currentUser: User | null;
  activeShift: any | null;
  activeBranchId: string | null;
  activeBusinessId: string | null;
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
        isManager: user?.role === 'MANAGER'
      }),
      setActiveShift: (activeShift) => set({ activeShift }),
      addToCart: (product) => set((state) => {
        const existing = state.cart.find((item) => item.id === product.id);
        if (existing) {
          return {
            cart: state.cart.map((item) => 
              item.id === product.id 
                ? { ...item, cartQuantity: item.cartQuantity + 1 } 
                : item
            )
          };
        }
        return { cart: [...state.cart, { ...product, cartQuantity: 1 }] };
      }),
      removeFromCart: (productId) => set((state) => ({
        cart: state.cart.filter((item) => item.id !== productId)
      })),
      updateQuantity: (productId, delta) => set((state) => ({
        cart: state.cart.map((item) => {
          if (item.id === productId) {
            const newQuantity = Math.max(0.001, item.cartQuantity + delta);
            return { ...item, cartQuantity: Number(newQuantity.toFixed(3)) };
          }
          return item;
        })
      })),
      setQuantity: (productId, quantity) => set((state) => ({
        cart: state.cart.map((item) => 
          item.id === productId 
            ? { ...item, cartQuantity: Number(quantity) } 
            : item
        )
      })),
      clearCart: () => set({ cart: [], selectedCustomerId: null }),
      resetSession: () => set({ ...initialState }),
    }),
    {
      name: 'mtaani-pos-storage',
    }
  )
);
