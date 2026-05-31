# Mtaani POS — Audit Fix Tasks

## Critical
- [x] Fix `MAIN_ACCOUNT` missing from `TAB_FEATURES` in `accessControl.ts`

## High Priority
- [x] Remove `bcryptjs` from `dependencies` in `package.json`
- [x] Move `tailwindcss` and `vite` to `devDependencies` only in `package.json`
- [x] Type `activeShift` properly using `Shift` interface in `store.ts`
- [x] Remove dead `discountValue`, `discountType`, `setDiscountValue` no-ops from `useMtaaniPOS.ts`
- [x] Remove duplicate `approveExpenseRequest` (same body as `applyApprovedExpenseEffects`) from `approvalWorkflows.ts`
- [x] Add `SUPPLIER_PAYMENTS` its own access feature key (separate from `tab.suppliers`)
- [x] Add missing cost price warning indicators to desktop and mobile inventory tabs
