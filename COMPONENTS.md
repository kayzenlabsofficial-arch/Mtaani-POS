# Mtaani POS: UI Component Catalog

This document catalogs the primary UI components, buttons, and interaction patterns used across the Mtaani POS ecosystem.

---

## 🏗️ Shared Infrastructure Components

### 1. `NestedControlPanel.tsx`
The primary container for secondary logic and insights.
- **Location**: `src/components/shared/NestedControlPanel.tsx`
- **Features**: 
    - Header with Title/Subtitle.
    - Glassmorphic backdrop.
    - Close button with hover animation.
- **Usage**: Used in every operational tab (Inventory, Expenses, Admin, etc.) to house "Tools" and "Analytics."

### 2. `Sidebar.tsx`
The main navigation hub.
- **Features**: 
    - Auto-hiding on mobile.
    - Role-based filtering (hides Admin links for Cashiers).
    - Status indicators (Active/Inactive states).

### 3. `SearchableSelect.tsx`
A high-performance dropdown replacement.
- **Features**: 
    - Inline search filtering.
    - Custom keyword mapping.
    - Responsive positioning.

### 4. `BarcodeScanner.tsx`
Integrated camera-based scanning node.
- **Features**: 
    - Real-time decoding.
    - Visual feedback on capture.

---

## 🔘 Button Architecture (Standardized Patterns)

### 1. Primary Action Buttons (Gradients)
High-visibility buttons for critical path actions (Create, Deploy, Save).
- **Styles**: `grad-blue`, `grad-indigo`, `grad-emerald`.
- **Classes**: `px-6 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl press`.

### 2. Secondary Utility Buttons (Outlined/Ghost)
Used for filtering, tool toggles, and optional actions.
- **Styles**: `bg-white text-slate-600 border-2 border-slate-100`.
- **Classes**: `p-2.5 rounded-xl hover:border-indigo-300 transition-all`.

### 3. Contextual Icon Buttons
Used for Row-level actions (Edit, Delete, Sync).
- **Styles**: `bg-slate-50 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600`.
- **Classes**: `w-10 h-10 flex items-center justify-center rounded-xl transition-all`.

---

## 📦 High-Density UI Components

### 1. The "Mission Control" Header
Standardized header pattern used across all redesigned tabs.
- **Pattern**: Title (left), Subtitle (left), Action Group (right).
- **Component**: Found in `src/components/tabs/AdminPanel.tsx` and others.

### 2. Personnel / Entity Cards
Used for Staff, Branches, and Suppliers.
- **Features**: 
    - Initials Avatar (bg-indigo-50).
    - Dynamic Status Pills (Operational, Suspended, etc.).
    - Contextual metadata (Building2 icon, Phone icon).

### 3. Metric Stat Cards
Used in Dashboard and Reports.
- **Features**: 
    - Large tabular numbers.
    - Trend indicators (up/down arrows).
    - Glassmorphic iconography.

### 4. Transaction / Movement Ledgers
Modernized lists for Sales and Inventory movements.
- **Features**: 
    - Zebra striping on hover.
    - High-contrast value columns.
    - Type-specific iconography.

---

## 🛠️ Global Utility Classes
Apply these to maintain the premium feel:
- **`press`**: `active:scale-95 transition-all` (Tactile feedback).
- **`shadow-blue`**: `shadow-[0_20px_50px_rgba(37,99,235,0.2)]`.
- **`no-scrollbar`**: Hides scrollbars while maintaining functionality.
- **`glass`**: `bg-white/70 backdrop-blur-md border border-white/20`.
