import React from 'react';
import { LogOut, Search, Store } from 'lucide-react';
import type { CartLine, Customer, PaymentMethod, Product, ReportSummary, Sale, SaleItem, StockMovement, StockReceipt, StoreProfile, User } from '../../types';
import type { AddStockInput, MiniAuthProps, MiniUiProps } from '../types';
import { emptyProduct, money, resizeLogo } from '../uiUtils';

export function MiniPhoneAuth({ mode, onSetup, onLogin }: MiniAuthProps) {
  const [setup, setSetup] = React.useState({ storeName: 'Smart POS Mini', name: 'Administrator', username: 'admin', password: '' });
  const [login, setLogin] = React.useState({ username: 'admin', password: '' });
  const [error, setError] = React.useState('');
  const isSetup = mode === 'setup';
  return (
    <div className="phone-auth-page">
      <section className="phone-auth-panel">
        <div className="phone-auth-brand"><Store size={28} /><span>{isSetup ? 'Create Mini POS' : 'Smart POS Mini'}</span></div>
        <div className="phone-form">
          {isSetup ? (
            <>
              <input value={setup.storeName} onChange={e => setSetup({ ...setup, storeName: e.target.value })} placeholder="Store name" />
              <input value={setup.name} onChange={e => setSetup({ ...setup, name: e.target.value })} placeholder="Admin name" />
              <input value={setup.username} onChange={e => setSetup({ ...setup, username: e.target.value })} placeholder="Username" />
              <input type="password" value={setup.password} onChange={e => setSetup({ ...setup, password: e.target.value })} placeholder="Password" />
              {error && <p className="form-error">{error}</p>}
              <button className="primary phone-wide-button" onClick={async () => {
                try {
                  await onSetup(setup);
                } catch (err: any) {
                  setError(err.message || 'Setup failed.');
                }
              }}>Create admin</button>
            </>
          ) : (
            <>
              <input value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })} placeholder="Username" />
              <input type="password" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })} placeholder="Password" />
              {error && <p className="form-error">{error}</p>}
              <button className="primary phone-wide-button" onClick={async () => {
                try {
                  await onLogin(login);
                } catch (err: any) {
                  setError(err.message || 'Login failed.');
                }
              }}>Sign in</button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export function MiniPhoneApp(props: MiniUiProps) {
  const activeLabel = props.tabs.find(tab => tab.id === props.activeTab)?.label || 'Register';
  return (
    <div className="phone-shell">
      <header className="phone-header">
        <div className="phone-brand">
          {props.profile.logoDataUrl ? <img src={props.profile.logoDataUrl} alt="" /> : <Store size={24} />}
          <div>
            <strong>{props.profile.storeName || 'Smart POS Mini'}</strong>
            <span>{props.user.name} - {props.user.role.toLowerCase()}</span>
          </div>
        </div>
        <button className="ghost phone-icon-button" onClick={props.signOut} aria-label="Sign out"><LogOut size={18} /></button>
      </header>
      <main className="phone-main">
        <div className="phone-page-title">
          <h1>{activeLabel}</h1>
          <button className="secondary" onClick={() => void props.refresh()} disabled={props.busy}>Refresh</button>
        </div>
        {props.notice && <div className="notice"><span>{props.notice}</span><button onClick={props.clearNotice}>Close</button></div>}
        <PhoneScreen {...props} />
      </main>
      <nav className="phone-bottom-nav">
        {props.tabs.map(tab => {
          const Icon = tab.Icon;
          return (
            <button key={tab.id} className={props.activeTab === tab.id ? 'active' : ''} onClick={() => props.setActiveTab(tab.id)}>
              <Icon size={19} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function PhoneScreen(props: MiniUiProps) {
  if (props.activeTab === 'REGISTER') return <RegisterPhone products={props.products} onCheckout={props.onCheckout} />;
  if (props.activeTab === 'INVENTORY' && props.isAdmin) return <InventoryPhone products={props.products} onSave={props.onSaveProduct} onDelete={props.onDeleteProduct} />;
  if (props.activeTab === 'ADD_STOCK' && props.isAdmin) return <AddStockPhone products={props.products.filter(product => Number(product.isActive) !== 0)} onAddStock={props.onAddStock} />;
  if (props.activeTab === 'DOCUMENTS') return <DocumentsPhone sales={props.sales} saleItems={props.saleItems} stockReceipts={props.stockReceipts} stockMovements={props.stockMovements} showStock={props.isAdmin} profile={props.profile} />;
  if (props.activeTab === 'REPORTS' && props.isAdmin) return <ReportsPhone summary={props.summary} />;
  if (props.activeTab === 'CUSTOMERS') return <CustomersPhone customers={props.customers} onPay={props.onPayCustomer} />;
  if (props.activeTab === 'PROFILE' && props.isAdmin) return <ProfilePhone profile={props.profile} users={props.users} onSave={props.onSaveProfile} onSaveUser={props.onSaveUser} onDeactivateUser={props.onDeactivateUser} />;
  return <section className="phone-panel"><p className="muted">This area is not available for this user.</p></section>;
}

function RegisterPhone({ products, onCheckout }: { products: Product[]; onCheckout: MiniUiProps['onCheckout'] }) {
  const [search, setSearch] = React.useState('');
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const [method, setMethod] = React.useState<PaymentMethod>('CASH');
  const [mpesaReference, setMpesaReference] = React.useState('');
  const [customer, setCustomer] = React.useState({ name: '', phone: '' });
  const productMap = new Map(products.map(product => [product.id, product]));
  const visible = products
    .filter(product => Number(product.isActive) !== 0)
    .filter(product => `${product.name} ${product.sku || ''} ${product.barcode || ''}`.toLowerCase().includes(search.toLowerCase()));
  const total = cart.reduce((sum, line) => sum + Number(productMap.get(line.productId)?.sellingPrice || 0) * line.quantity, 0);
  const addProduct = (product: Product) => setCart(current => {
    const existing = current.find(line => line.productId === product.id);
    if (existing) return current.map(line => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line);
    return [...current, { productId: product.id, quantity: 1 }];
  });
  return (
    <div className="phone-register">
      <section className="phone-panel phone-cart-first">
        <div className="phone-total">
          <span>Total</span>
          <strong>{money(total)}</strong>
        </div>
        <div className="segmented phone-segmented">
          {(['CASH', 'MPESA', 'CREDIT'] as PaymentMethod[]).map(option => <button key={option} className={method === option ? 'active' : ''} onClick={() => setMethod(option)}>{option}</button>)}
        </div>
        {method === 'MPESA' && <input value={mpesaReference} onChange={e => setMpesaReference(e.target.value)} placeholder="M-Pesa reference (optional)" />}
        {method === 'CREDIT' && (
          <div className="stack">
            <input value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} placeholder="Customer name" />
            <input value={customer.phone} onChange={e => setCustomer({ ...customer, phone: e.target.value })} placeholder="Customer phone (optional)" />
          </div>
        )}
        <div className="phone-cart-lines">
          {cart.length === 0 && <p className="muted">Add products below.</p>}
          {cart.map(line => {
            const product = productMap.get(line.productId);
            if (!product) return null;
            return (
              <div key={line.productId} className="phone-cart-line">
                <div><strong>{product.name}</strong><span>{money(product.sellingPrice)} each</span></div>
                <input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e => setCart(cart.map(row => row.productId === line.productId ? { ...row, quantity: Number(e.target.value) } : row).filter(row => row.quantity > 0))} />
              </div>
            );
          })}
        </div>
        <button className="primary phone-wide-button" disabled={!cart.length} onClick={async () => {
          await onCheckout({ paymentMethod: method, mpesaReference, customer, items: cart });
          setCart([]);
          setMpesaReference('');
          setCustomer({ name: '', phone: '' });
          setMethod('CASH');
        }}>Complete sale</button>
      </section>
      <section className="phone-panel">
        <div className="search-box"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products" /></div>
        <div className="phone-product-list">
          {visible.map(product => (
            <button key={product.id} className="phone-product-row" onClick={() => addProduct(product)} disabled={Number(product.stockQuantity) <= 0}>
              <div><strong>{product.name}</strong><span>Stock {Number(product.stockQuantity).toLocaleString()}</span></div>
              <b>{money(product.sellingPrice)}</b>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function InventoryPhone({ products, onSave, onDelete }: { products: Product[]; onSave: MiniUiProps['onSaveProduct']; onDelete: MiniUiProps['onDeleteProduct'] }) {
  const [form, setForm] = React.useState<Partial<Product>>(emptyProduct);
  return (
    <div className="phone-stack">
      <section className="phone-panel">
        <h2>{form.id ? 'Edit product' : 'Add product'}</h2>
        <input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Product name" />
        <input value={form.sku || ''} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="SKU" />
        <input value={form.barcode || ''} onChange={e => setForm({ ...form, barcode: e.target.value })} placeholder="Barcode" />
        <input type="number" value={form.sellingPrice || ''} onChange={e => setForm({ ...form, sellingPrice: Number(e.target.value) })} placeholder="Selling price" />
        <input type="number" value={form.costPrice || ''} onChange={e => setForm({ ...form, costPrice: Number(e.target.value) })} placeholder="Opening or fallback cost" />
        <button className="primary phone-wide-button" onClick={async () => { await onSave(form); setForm(emptyProduct); }}>Save product</button>
      </section>
      <section className="phone-panel">
        <h2>Products</h2>
        {products.map(product => (
          <div key={product.id} className="phone-list-card">
            <div><strong>{product.name}</strong><span>{money(product.sellingPrice)} - Avg cost {money(product.costPrice)} - Stock {Number(product.stockQuantity).toLocaleString()}</span></div>
            <div className="row-actions"><button className="secondary" onClick={() => setForm(product)}>Edit</button><button className="danger" onClick={() => void onDelete(product.id)}>Deactivate</button></div>
          </div>
        ))}
      </section>
    </div>
  );
}

function AddStockPhone({ products, onAddStock }: { products: Product[]; onAddStock: (input: AddStockInput) => Promise<void> }) {
  const [note, setNote] = React.useState('');
  const [items, setItems] = React.useState([{ productId: '', quantity: 1, unitCost: 0 }]);
  const totalCost = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitCost || 0), 0);
  return (
    <section className="phone-panel phone-stack">
      <div className="phone-total">
        <span>Stock cost to add</span>
        <strong>{money(totalCost)}</strong>
      </div>
      {items.map((item, index) => (
        <div key={index} className="phone-stock-line">
          <select value={item.productId} onChange={e => setItems(items.map((row, i) => i === index ? { ...row, productId: e.target.value } : row))}>
            <option value="">Select product</option>
            {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <div className="phone-split-inputs">
            <input type="number" min="0.001" step="0.001" value={item.quantity} onChange={e => setItems(items.map((row, i) => i === index ? { ...row, quantity: Number(e.target.value) } : row))} placeholder="Qty" />
            <input type="number" min="0" step="0.01" value={item.unitCost} onChange={e => setItems(items.map((row, i) => i === index ? { ...row, unitCost: Number(e.target.value) } : row))} placeholder="Unit cost" />
          </div>
          <button className="ghost" onClick={() => setItems(items.filter((_, i) => i !== index))}>Remove line</button>
        </div>
      ))}
      <button className="secondary phone-wide-button" onClick={() => setItems([...items, { productId: '', quantity: 1, unitCost: 0 }])}>Add line</button>
      <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Stock note or supplier reference" />
      <button className="primary phone-wide-button" onClick={async () => { await onAddStock({ note, items }); setNote(''); setItems([{ productId: '', quantity: 1, unitCost: 0 }]); }}>Add stock</button>
    </section>
  );
}

function DocumentsPhone({ sales, saleItems, stockReceipts, stockMovements, showStock, profile }: {
  sales: Sale[];
  saleItems: SaleItem[];
  stockReceipts: StockReceipt[];
  stockMovements: StockMovement[];
  showStock: boolean;
  profile: StoreProfile;
}) {
  return (
    <div className="phone-stack">
      <section className="phone-panel">
        <h2>Sales documents</h2>
        {sales.map(sale => (
          <article key={sale.id} className="phone-document-card">
            <div className="doc-head">{profile.logoDataUrl && <img src={profile.logoDataUrl} alt="" />}<div><strong>{sale.receiptNumber}</strong><span>{new Date(sale.timestamp).toLocaleString()}</span></div><b>{money(sale.total)}</b></div>
            <p>{sale.paymentMethod}{sale.customerName ? ` - ${sale.customerName}` : ''}{sale.mpesaReference ? ` - ${sale.mpesaReference}` : ''}</p>
            <ul>{saleItems.filter(item => item.saleId === sale.id).map(item => <li key={item.id}>{item.productName} x {item.quantity} - {money(item.lineTotal)} - Cost {money(item.lineCost)}</li>)}</ul>
          </article>
        ))}
      </section>
      {showStock && (
        <section className="phone-panel">
          <h2>Stock added documents</h2>
          {stockReceipts.map(receipt => (
            <article key={receipt.id} className="phone-document-card">
              <div className="doc-head"><strong>{receipt.receiptNumber}</strong><span>{new Date(receipt.timestamp).toLocaleString()}</span><b>{money(receipt.totalCost)}</b></div>
              <p>{receipt.note || 'Manual stock addition'}</p>
              <ul>{stockMovements.filter(row => row.referenceId === receipt.id).map(row => <li key={row.id}>{row.productName} +{row.quantity} @ {money(row.unitCost)}</li>)}</ul>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function ReportsPhone({ summary }: { summary: ReportSummary | null }) {
  if (!summary) return <section className="phone-panel"><p className="muted">No report data yet.</p></section>;
  return (
    <div className="phone-stack">
      <section className="phone-metrics">
        {[
          ['Revenue', summary.revenue],
          ['COGS', summary.cogs],
          ['Gross profit', summary.grossProfit],
          ['Stock added cost', summary.stockAddedCost],
          ['Stock value', summary.stockValue],
          ['Credit outstanding', summary.creditOutstanding],
        ].map(([label, value]) => <div key={label} className="metric"><span>{label}</span><strong>{money(value)}</strong></div>)}
      </section>
      <section className="phone-panel">
        <h2>Payment methods</h2>
        <div className="method-bars">{(['CASH', 'MPESA', 'CREDIT'] as PaymentMethod[]).map(method => <div key={method}><span>{method}</span><b>{money(summary.salesByMethod[method])}</b></div>)}</div>
      </section>
      <section className="phone-panel">
        <h2>Top products</h2>
        {summary.topProducts.map(product => <div key={product.productId} className="phone-list-card"><div><strong>{product.name}</strong><span>{product.quantity} sold - COGS {money(product.cogs)}</span></div><b>{money(product.sales)}</b></div>)}
      </section>
    </div>
  );
}

function CustomersPhone({ customers, onPay }: { customers: Customer[]; onPay: MiniUiProps['onPayCustomer'] }) {
  const [form, setForm] = React.useState({ customerId: '', amount: 0, paymentMethod: 'CASH' as 'CASH' | 'MPESA', reference: '' });
  return (
    <div className="phone-stack">
      <section className="phone-panel phone-form">
        <h2>Settle credit</h2>
        <select value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })}>
          <option value="">Select customer</option>
          {customers.filter(customer => Number(customer.balance) > 0).map(customer => <option key={customer.id} value={customer.id}>{customer.name} - {money(customer.balance)}</option>)}
        </select>
        <input type="number" value={form.amount || ''} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} placeholder="Amount" />
        <select value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value as 'CASH' | 'MPESA' })}><option>CASH</option><option>MPESA</option></select>
        <input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="Reference (optional)" />
        <button className="primary phone-wide-button" onClick={async () => { await onPay(form); setForm({ customerId: '', amount: 0, paymentMethod: 'CASH', reference: '' }); }}>Record payment</button>
      </section>
      <section className="phone-panel">
        <h2>Customers</h2>
        {customers.map(customer => <div key={customer.id} className="phone-list-card"><div><strong>{customer.name}</strong><span>{customer.phone || 'No phone'} - Paid {money(customer.totalPaid)}</span></div><b>{money(customer.balance)}</b></div>)}
      </section>
    </div>
  );
}

function ProfilePhone({ profile, users, onSave, onSaveUser, onDeactivateUser }: {
  profile: StoreProfile;
  users: User[];
  onSave: MiniUiProps['onSaveProfile'];
  onSaveUser: MiniUiProps['onSaveUser'];
  onDeactivateUser: MiniUiProps['onDeactivateUser'];
}) {
  const [storeName, setStoreName] = React.useState(profile.storeName || 'Smart POS Mini');
  const [logoDataUrl, setLogoDataUrl] = React.useState<string | null>(profile.logoDataUrl || null);
  const [userForm, setUserForm] = React.useState<Partial<User> & { password?: string }>({ name: '', username: '', role: 'CASHIER', password: '' });
  React.useEffect(() => {
    setStoreName(profile.storeName || 'Smart POS Mini');
    setLogoDataUrl(profile.logoDataUrl || null);
  }, [profile]);
  return (
    <div className="phone-stack">
      <section className="phone-panel phone-form">
        <h2>Store profile</h2>
        <div className="logo-preview">{logoDataUrl ? <img src={logoDataUrl} alt="" /> : <Store size={46} />}</div>
        <input value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="Store name" />
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => {
          const file = e.target.files?.[0];
          if (file) setLogoDataUrl(await resizeLogo(file));
        }} />
        <button className="primary phone-wide-button" onClick={() => void onSave({ storeName, logoDataUrl })}>Save profile</button>
      </section>
      <section className="phone-panel phone-form">
        <h2>Users</h2>
        <input value={userForm.name || ''} onChange={e => setUserForm({ ...userForm, name: e.target.value })} placeholder="Full name" />
        <input value={userForm.username || ''} onChange={e => setUserForm({ ...userForm, username: e.target.value })} placeholder="Username" />
        <select value={userForm.role || 'CASHIER'} onChange={e => setUserForm({ ...userForm, role: e.target.value as User['role'] })}><option value="CASHIER">Cashier</option><option value="ADMIN">Admin</option></select>
        <input type="password" value={userForm.password || ''} onChange={e => setUserForm({ ...userForm, password: e.target.value })} placeholder={userForm.id ? 'New password (optional)' : 'Password'} />
        <button className="primary phone-wide-button" onClick={async () => { await onSaveUser(userForm); setUserForm({ name: '', username: '', role: 'CASHIER', password: '' }); }}>{userForm.id ? 'Update user' : 'Create user'}</button>
        {userForm.id && <button className="ghost phone-wide-button" onClick={() => setUserForm({ name: '', username: '', role: 'CASHIER', password: '' })}>Cancel edit</button>}
      </section>
      <section className="phone-panel">
        {users.map(account => (
          <div key={account.id} className="phone-list-card">
            <div><strong>{account.name}</strong><span>{account.username} - {account.role.toLowerCase()} - {Number(account.isActive ?? 1) ? 'active' : 'inactive'}</span></div>
            <div className="row-actions"><button className="secondary" onClick={() => setUserForm({ ...account, password: '' })}>Edit</button>{Number(account.isActive ?? 1) !== 0 && <button className="danger" onClick={() => void onDeactivateUser(account.id)}>Deactivate</button>}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
