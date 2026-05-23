import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Product, User } from './db';

export interface CartItem extends Product {
  cartQuantity: number;
}

export interface HeldOrder {
  id: string;
  name: string;
  items: CartItem[];
  total: number;
  itemCount: number;
  createdAt: number;
  businessId: string | null;
  shopId: string | null;
}

type SafeUser = Omit<User, 'password'> & { password: string };

const sanitizeUser = (user: SafeUser | null): SafeUser | null => {
  if (!user) return null;
  const { password, ...safe } = user as any;
  return { ...safe, password: '' } as SafeUser;
};

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
  heldOrders: HeldOrder[];
  isAdmin: boolean;
  isManager: boolean;
  currentUser: SafeUser | null;
  activeShift: any | null;
  activeShopId: string | null;
  activeBusinessId: string | null;
  authToken: string | null;
  isSystemAdmin: boolean;
  login: (user: SafeUser, authToken?: string | null) => void;
  logout: () => void;
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, delta: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  setCart: (items: CartItem[]) => void;
  clearCart: () => void;
  holdCurrentOrder: (name?: string) => HeldOrder | null;
  resumeHeldOrder: (orderId: string) => HeldOrder | null;
  deleteHeldOrder: (orderId: string) => void;
  setCurrentUser: (user: SafeUser | null) => void;
  setActiveShift: (shift: any | null) => void;
  setActiveShopId: (id: string | null) => void;
  setActiveBusinessId: (id: string | null) => void;
  paymentSupplierId: string | null;
  setPaymentSupplierId: (id: string | null) => void;
  selectedCustomerId: string | null;
  setSelectedCustomerId: (id: string | null) => void;
  resetSession: () => void;
}

const initialState = {
  cart: [] as CartItem[],
  heldOrders: [] as HeldOrder[],
  isAdmin: false,
  isManager: false,
  currentUser: null as SafeUser | null,
  activeShift: null as any | null,
  activeShopId: null as string | null,
  activeBusinessId: null as string | null,
  authToken: null as string | null,
  isSystemAdmin: false,
  paymentSupplierId: null as string | null,
  selectedCustomerId: null as string | null,
};

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `held_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
};

const cloneCart = (cart: CartItem[]) => cart.map(item => ({ ...item }));

const estimateCartTotal = (cart: CartItem[]) => cart.reduce((sum, item) => {
  const price = Number(item.sellingPrice) || 0;
  const quantity = Number(item.cartQuantity) || 0;
  return sum + (price * quantity);
}, 0);

const countCartItems = (cart: CartItem[]) => cart.reduce((sum, item) => sum + (Number(item.cartQuantity) || 0), 0);

export const useStore = create<POSState>()(
  persist(
    (set) => ({
      ...initialState,
      setPaymentSupplierId: (id) => set({ paymentSupplierId: id }),
      setSelectedCustomerId: (id) => set({ selectedCustomerId: id }),
      setActiveShopId: (activeShopId) => set({ activeShopId }),
      setActiveBusinessId: (activeBusinessId) => set({ activeBusinessId }),
      setCurrentUser: (user) => set({ 
        currentUser: sanitizeUser(user), 
        isAdmin: user?.role === 'ADMIN',
        isManager: user?.role === 'MANAGER',
        isSystemAdmin: user?.role === 'ROOT'
      }),
      login: (user, authToken = null) => set({ 
        currentUser: sanitizeUser(user), 
        authToken,
        isAdmin: user?.role === 'ADMIN',
        isManager: user?.role === 'MANAGER',
        isSystemAdmin: user?.role === 'ROOT'
      }),
      logout: () => set({ 
        ...initialState,
        activeBusinessId: null,
        activeShopId: null,
        authToken: null
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
      setCart: (items) => set({ cart: cloneCart(items) }),
      clearCart: () => set({ cart: [], selectedCustomerId: null }),
      holdCurrentOrder: (name) => {
        let heldOrder: HeldOrder | null = null;
        set((state) => {
          if (state.cart.length === 0) return { heldOrders: state.heldOrders };

          heldOrder = {
            id: createId(),
            name: name?.trim() || `Held order ${state.heldOrders.length + 1}`,
            items: cloneCart(state.cart),
            total: estimateCartTotal(state.cart),
            itemCount: countCartItems(state.cart),
            createdAt: Date.now(),
            businessId: state.activeBusinessId,
            shopId: state.activeShopId,
          };

          return {
            cart: [],
            selectedCustomerId: null,
            heldOrders: [heldOrder, ...state.heldOrders],
          };
        });
        return heldOrder;
      },
      resumeHeldOrder: (orderId) => {
        let resumedOrder: HeldOrder | null = null;
        set((state) => {
          const order = state.heldOrders.find(item => item.id === orderId);
          if (!order) return { heldOrders: state.heldOrders };
          resumedOrder = order;
          return {
            cart: cloneCart(order.items),
            selectedCustomerId: null,
            heldOrders: state.heldOrders.filter(item => item.id !== orderId),
          };
        });
        return resumedOrder;
      },
      deleteHeldOrder: (orderId) => set((state) => ({
        heldOrders: state.heldOrders.filter(item => item.id !== orderId)
      })),
      resetSession: () => set({ ...initialState }),
    }),
    {
      name: 'mtaani-pos-storage',
      version: 5,
      migrate: (persistedState) => {
        const state = persistedState && typeof persistedState === 'object' ? persistedState as Partial<POSState> : {};
        return {
          ...state,
          currentUser: null,
          authToken: null,
          isAdmin: false,
          isManager: false,
          isSystemAdmin: false,
        } as any;
      },
      partialize: (state) => ({
        currentUser: sanitizeUser(state.currentUser),
        isAdmin: state.isAdmin,
        isManager: state.isManager,
        isSystemAdmin: state.isSystemAdmin,
        activeShift: state.activeShift,
        activeBusinessId: state.activeBusinessId,
        activeShopId: state.activeShopId,
        authToken: state.authToken,
        heldOrders: state.heldOrders,
      }),
    }
  )
);
