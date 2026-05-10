# Mtaani POS: Master Blueprint & Genetic Specification

This document contains the complete structural and visual DNA of the Mtaani POS system. It is designed to allow an AI or developer to recreate an exact functional and visual replica of the current system.

---

## 1. Global Visual Configuration (Tailwind / CSS)

### Design Tokens
Include these in your `tailwind.config.js` or global CSS:
```javascript
theme: {
  extend: {
    colors: {
      slate: { 950: '#020617' },
      indigo: { 600: '#4f46e5', 700: '#4338ca' },
      emerald: { 600: '#059669', 700: '#047857' },
      rose: { 600: '#e11d48', 700: '#be123c' },
      blue: { 600: '#2563eb', 700: '#1d4ed8' },
    },
    borderRadius: {
      '2xl': '1rem',
      '3xl': '1.5rem',
      '4xl': '2rem',
      '5xl': '3rem',
    },
    boxShadow: {
      'blue': '0 20px 50px rgba(37,99,235,0.2)',
      'indigo': '0 20px 50px rgba(79,70,229,0.2)',
      'emerald': '0 20px 50px rgba(5,150,105,0.2)',
      'rose': '0 20px 50px rgba(225,29,72,0.2)',
    }
  }
}
```

### Premium Gradients
```css
.grad-blue { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); }
.grad-indigo { background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%); }
.grad-emerald { background: linear-gradient(135deg, #059669 0%, #047857 100%); }
.grad-rose { background: linear-gradient(135deg, #e11d48 0%, #be123c 100%); }
```

---

## 2. Core UI Orchestration (`MtaaniPOS.tsx`)
The app uses a `Tabbed Navigation` pattern driven by a central state.

### Layout Skeleton
```jsx
<div className="flex h-screen bg-slate-50 overflow-hidden font-inter">
  <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
  <main className="flex-1 overflow-y-auto relative no-scrollbar">
    <TopBar />
    <div className="p-4 lg:p-8">
      {/* Dynamic Tab Content Rendering */}
      {activeTab === 'REGISTER' && <RegisterTab />}
      {activeTab === 'INVENTORY' && <InventoryTab />}
      {/* ... other tabs */}
    </div>
  </main>
</div>
```

---

## 3. The "Control Center" Pattern
The most critical UI innovation is the `NestedControlPanel`.

### Component Archetype
```tsx
export default function NestedControlPanel({ title, subtitle, children, onClose }) {
  return (
    <div className="bg-white/70 backdrop-blur-xl border-2 border-slate-100 rounded-[2.5rem] p-8 shadow-2xl animate-in slide-in-from-top-2">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h3 className="text-xl font-black text-slate-900 tracking-tight">{title}</h3>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{subtitle}</p>
        </div>
        <button onClick={onClose} className="p-3 bg-slate-50 text-slate-400 rounded-2xl hover:text-rose-600 transition-all">
          <X size={20} />
        </button>
      </div>
      {children}
    </div>
  );
}
```

---

## 4. The "Premium Product Node" (Register & Inventory)
All products are rendered in cards with this specific structure:
- **Container**: `bg-white p-5 rounded-[2rem] border-2 border-slate-100 hover:border-indigo-300 transition-all`.
- **Icon Node**: `w-14 h-14 rounded-[1.25rem] flex items-center justify-center bg-indigo-50 text-indigo-600`.
- **Typography**: Name (`text-base font-black`), Price (`text-xl font-black tabular-nums`).
- **Tactile Feedback**: Every interactive element has the `press` class (`active:scale-95 transition-all`).

---

## 5. Data Nervous System (D1/Dexie)
The UI expects data to be hydrated from these primary tables:
- **Products**: `id, name, sellingPrice, stockQuantity, reorderPoint, category`.
- **Transactions**: `id, items[], total, paymentMethod, status, timestamp`.
- **Branches**: `id, name, location, isActive, businessId`.
- **Users**: `id, name, role (ADMIN|CASHIER), branchId`.

---

## 6. Interaction Rules
1. **No Flatness**: Every primary action must have a gradient and a matching deep shadow.
2. **Aggressive Rounding**: Do not use `rounded-md` or `rounded-lg`. Only use `rounded-2xl` for buttons and `rounded-[2.5rem]` or larger for cards.
3. **Heavy Headers**: Titles must be `font-black` (900 weight).
4. **Micro-Labels**: Every major section must have an uppercase, wide-tracked sublabel above or below the title.
5. **No Placeholders**: Icons must always be `lucide-react` with `stroke-width={2.5}`.
