import React from 'react';
import { LogOut, Search, Store } from 'lucide-react';
import type { CartLine, Customer, PaymentMethod, Product, ReportSummary, Sale, SaleItem, StockMovement, StockReceipt, StoreProfile, User } from '../../types';
import type { AddStockInput, MiniAuthProps, MiniUiProps } from '../types';
import { emptyProduct, money, resizeLogo } from '../uiUtils';

export function MiniDesktopAuth({ mode, onSetup, onLogin }: MiniAuthProps) {
  const [setup, setSetup] = React.useState({ storeName: 'Smart POS Mini', name: 'Administrator', username: 'admin', password: '' });
  const [login, setLogin] = React.useState({ username: 'admin', password: '' });
  const [error, setError] = React.useState('');
  const isSetup = mode === 'setup';
  return (
    <div className="desktop-auth-page">
      <section className="desktop-auth-card">
        <div className="auth-mark"><Store size={30} /></div>
        <h1>{isSetup ? 'Create Smart POS Mini' : 'Smart POS Mini'}</h1>
        <p>Simple selling, stock control, credit tracking, and profit reporting.</p>
        <div className="auth-form">
          {isSetup ? (
            <>
              <input value={setup.storeName} onChange={e => setSetup({ ...setup, storeName: e.target.value })} placeholder="Store name" />
              <input value={setup.name} onChange={e => setSetup({ ...setup, name: e.target.value })} placeholder="Admin name" />
              <input value={setup.username} onChange={e => setSetup({ ...setup, username: e.target.value })} placeholder="Username" />
              <input type="password" value={setup.password} onChange={e => setSetup({ ...setup, password: e.target.value })} placeholder="Password" />
              {error && <p className="form-error">{error}</p>}
              <button className="primary" onClick={async () => {
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
              <button className="primary" onClick={async () => {
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

export function MiniDesktopApp(props: MiniUiProps) {
  const activeLabel = props.tabs.find(tab => tab.id === props.activeTab)?.label || 'Register';
  return (
    <div className="desktop-shell">
      <aside className="desktop-sidebar">
        <div className="brand-block">
          {props.profile.logoDataUrl ? <img src={props.profile.logoDataUrl} alt="" /> : <Store size={28} />}
          <div>
            <strong>{props.profile.storeName || 'Smart POS Mini'}</strong>
            <span>Default till</span>
          </div>
        </div>
        <nav className="desktop-nav">
          {props.tabs.map(tab => {
            const Icon = tab.Icon;
            return (
              <button key={tab.id} className={props.activeTab === tab.id ? 'active' : ''} onClick={() => props.setActiveTab(tab.id)}>
                <Icon size={18} />
                {tab.label}
              </button>
            );
          })}
        </nav>
        <button className="ghost desktop-logout" onClick={props.signOut}><LogOut size={17} /> Sign out</button>
      </aside>
      <main className="desktop-main">
        <header className="desktop-topbar">
          <div>
            <h1>{activeLabel}</h1>
            <p>{props.user.name} - {props.user.role.toLowerCase()}</p>
          </div>
          <button className="secondary" onClick={() => void props.refresh()} disabled={props.busy}>Refresh</button>
        </header>
        {props.notice && <div className="notice"><span>{props.notice}</span><button onClick={props.clearNotice}>Close</button></div>}
        <DesktopScreen {...props} />
      </main>
    </div>
  );
}

function DesktopScreen(props: MiniUiProps) {
  if (props.activeTab === 'REGISTER') return <RegisterDesktop products={props.products} onCheckout={props.onCheckout} />;
  if (props.activeTab === 'INVENTORY' && props.isAdmin) return <InventoryDesktop products={props.products} onSave={props.onSaveProduct} onDelete={props.onDeleteProduct} />;
  if (props.activeTab === 'ADD_STOCK' && props.isAdmin) return <AddStockDesktop products={props.products.filter(product => Number(product.isActive) !== 0)} onAddStock={props.onAddStock} />;
  if (props.activeTab === 'DOCUMENTS') return <DocumentsDesktop sales={props.sales} saleItems={props.saleItems} stockReceipts={props.stockReceipts} stockMovements={props.stockMovements} showStock={props.isAdmin} profile={props.profile} />;
  if (props.activeTab === 'REPORTS' && props.isAdmin) return <ReportsDesktop summary={props.summary} />;
  if (props.activeTab === 'CUSTOMERS') return <CustomersDesktop customers={props.customers} onPay={props.onPayCustomer} />;
  if (props.activeTab === 'PROFILE' && props.isAdmin) {
    return <ProfileDesktop profile={props.profile} users={props.users} onSave={props.onSaveProfile} onSaveUser={props.onSaveUser} onDeactivateUser={props.onDeactivateUser} />;
  }
  return <section className="panel"><p className="muted">This area is not available for this user.</p></section>;
}

function RegisterDesktop({ products, onCheckout }: { products: Product[]; onCheckout: MiniUiProps['onCheckout'] }) {
  const [search, setSearch] = React.useState('');
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const [method, setMethod] = React.useState<PaymentMethod>('CASH');
  const [mpesaReference, setMpesaReference] = React.useState('');
  const [customer, setCustomer] = React.useState({ name: '', phone: '' });
  const visible = products
    .filter(product => Number(product.isActive) !== 0)
    .filter(product => `${product.name} ${product.sku || ''} ${product.barcode || ''}`.toLowerCase().includes(search.toLowerCase()));
  const productMap = new Map(products.map(product => [product.id, product]));
  const total = cart.reduce((sum, line) => sum + Number(productMap.get(line.productId)?.sellingPrice || 0) * line.quantity, 0);
  const addProduct = (product: Product) => setCart(current => {
    const existing = current.find(line => line.productId === product.id);
    if (existing) return current.map(line => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line);
    return [...current, { productId: product.id, quantity: 1 }];
  });

  return (
    <div className="desktop-register-grid">
      <section className="panel product-browser">
        <div className="section-title">
          <div><h2>Products</h2><p>Search and add items to the current sale.</p></div>
          <span>{visible.length} items</span>
        </div>
        <div className="search-box"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products" /></div>
        <div className="product-grid">
          {visible.map(product => (
            <button key={product.id} className="product-tile" onClick={() => addProduct(product)} disabled={Number(product.stockQuantity) <= 0}>
              <strong>{product.name}</strong>
              <span>{money(product.sellingPrice)}</span>
              <small>Stock {Number(product.stockQuantity).toLocaleString()}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="panel cart-panel">
        <h2>Sale Cart</h2>
        <div className="cart-lines">
          {cart.length === 0 && <p className="muted">Choose products to start a sale.</p>}
          {cart.map(line => {
            const product = productMap.get(line.productId);
            if (!product) return null;
            return (
              <div key={line.productId} className="cart-line">
                <div><strong>{product.name}</strong><span>{money(product.sellingPrice)} each</span></div>
                <input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e => setCart(cart.map(row => row.productId === line.productId ? { ...row, quantity: Number(e.target.value) } : row).filter(row => row.quantity > 0))} />
                <b>{money(Number(product.sellingPrice) * line.quantity)}</b>
              </div>
            );
          })}
        </div>
        <div className="total-row"><span>Total</span><strong>{money(total)}</strong></div>
        <div className="segmented">
          {(['CASH', 'MPESA', 'CREDIT'] as PaymentMethod[]).map(option => <button key={option} className={method === option ? 'active' : ''} onClick={() => setMethod(option)}>{option}</button>)}
        </div>
        {method === 'MPESA' && <input value={mpesaReference} onChange={e => setMpesaReference(e.target.value)} placeholder="M-Pesa reference (optional)" />}
        {method === 'CREDIT' && (
          <div className="stack">
            <input value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} placeholder="Customer name" />
            <input value={customer.phone} onChange={e => setCustomer({ ...customer, phone: e.target.value })} placeholder="Customer phone (optional)" />
          </div>
        )}
        <button className="primary checkout" disabled={!cart.length} onClick={async () => {
          await onCheckout({ paymentMethod: method, mpesaReference, customer, items: cart });
          setCart([]);
          setMpesaReference('');
          setCustomer({ name: '', phone: '' });
          setMethod('CASH');
        }}>Complete sale</button>
      </section>
    </div>
  );
}

function InventoryDesktop({ products, onSave, onDelete }: { products: Product[]; onSave: MiniUiProps['onSaveProduct']; onDelete: MiniUiProps['onDeleteProduct'] }) {
  const [form, setForm] = React.useState<Partial<Product>>(emptyProduct);
  return (
    <div className="two-column">
      <section className="panel">
        <div className="section-title"><div><h2>{form.id ? 'Edit product' : 'Add product'}</h2><p>Prices are used for sales and P&L snapshots.</p></div></div>
        <input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Product name" />
        <input value={form.sku || ''} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="SKU" />
        <input value={form.barcode || ''} onChange={e => setForm({ ...form, barcode: e.target.value })} placeholder="Barcode" />
        <input type="number" value={form.sellingPrice || ''} onChange={e => setForm({ ...form, sellingPrice: Number(e.target.value) })} placeholder="Selling price" />
        <input type="number" value={form.costPrice || ''} onChange={e => setForm({ ...form, costPrice: Number(e.target.value) })} placeholder="Opening or fallback cost" />
        <button className="primary" onClick={async () => { await onSave(form); setForm(emptyProduct); }}>Save product</button>
      </section>
      <section className="panel">
        <div className="section-title"><div><h2>Products</h2><p>Current selling price, average cost, and available stock.</p></div></div>
        <div className="table-list">
          {products.map(product => (
            <div key={product.id} className="table-row">
              <div><strong>{product.name}</strong><span>{money(product.sellingPrice)} - Avg cost {money(product.costPrice)} - Stock {Number(product.stockQuantity).toLocaleString()}</span></div>
              <div className="row-actions">
                <button className="secondary" onClick={() => setForm(product)}>Edit</button>
                <button className="danger" onClick={() => void onDelete(product.id)}>Deactivate</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AddStockDesktop({ products, onAddStock }: { products: Product[]; onAddStock: (input: AddStockInput) => Promise<void> }) {
  const [note, setNote] = React.useState('');
  const [items, setItems] = React.useState([{ productId: '', quantity: 1, unitCost: 0 }]);
  const totalCost = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitCost || 0), 0);
  return (
    <div className="desktop-add-stock">
      <section className="panel">
        <div className="section-title"><div><h2>Add Stock</h2><p>Every added unit cost is saved and used for stock value and gross profit.</p></div><span>{money(totalCost)}</span></div>
        {items.map((item, index) => (
          <div key={index} className="receive-line">
            <select value={item.productId} onChange={e => setItems(items.map((row, i) => i === index ? { ...row, productId: e.target.value } : row))}>
              <option value="">Select product</option>
              {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
            <input type="number" min="0.001" step="0.001" value={item.quantity} onChange={e => setItems(items.map((row, i) => i === index ? { ...row, quantity: Number(e.target.value) } : row))} placeholder="Qty" />
            <input type="number" min="0" step="0.01" value={item.unitCost} onChange={e => setItems(items.map((row, i) => i === index ? { ...row, unitCost: Number(e.target.value) } : row))} placeholder="Unit cost" />
            <button className="ghost" onClick={() => setItems(items.filter((_, i) => i !== index))}>Remove</button>
          </div>
        ))}
        <button className="secondary" onClick={() => setItems([...items, { productId: '', quantity: 1, unitCost: 0 }])}>Add line</button>
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Stock note or supplier reference" />
        <button className="primary" onClick={async () => { await onAddStock({ note, items }); setNote(''); setItems([{ productId: '', quantity: 1, unitCost: 0 }]); }}>Add stock</button>
      </section>
      <section className="panel stock-help">
        <h2>Cost tracking</h2>
        <p>Added stock updates the product average cost. Sales keep a cost snapshot, so later stock costs do not rewrite old P&L.</p>
        <div className="metric compact"><span>Stock to add</span><strong>{money(totalCost)}</strong></div>
      </section>
    </div>
  );
}

function DocumentsDesktop({ sales, saleItems, stockReceipts, stockMovements, showStock, profile }: {
  sales: Sale[];
  saleItems: SaleItem[];
  stockReceipts: StockReceipt[];
  stockMovements: StockMovement[];
  showStock: boolean;
  profile: StoreProfile;
}) {
  return (
    <div className="two-column">
      <section className="panel">
        <h2>Sales documents</h2>
        {sales.map(sale => (
          <article key={sale.id} className="document-card">
            <div className="doc-head">
              {profile.logoDataUrl && <img src={profile.logoDataUrl} alt="" />}
              <div><strong>{sale.receiptNumber}</strong><span>{new Date(sale.timestamp).toLocaleString()}</span></div>
              <b>{money(sale.total)}</b>
            </div>
            <p>{sale.paymentMethod}{sale.customerName ? ` - ${sale.customerName}` : ''}{sale.mpesaReference ? ` - ${sale.mpesaReference}` : ''}</p>
            <ul>{saleItems.filter(item => item.saleId === sale.id).map(item => <li key={item.id}>{item.productName} x {item.quantity} - {money(item.lineTotal)} - Cost {money(item.lineCost)}</li>)}</ul>
          </article>
        ))}
      </section>
      {showStock && (
        <section className="panel">
          <h2>Stock added documents</h2>
          {stockReceipts.map(receipt => (
            <article key={receipt.id} className="document-card">
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

function ReportsDesktop({ summary }: { summary: ReportSummary | null }) {
  if (!summary) return <section className="panel"><p className="muted">No report data yet.</p></section>;
  return (
    <div className="reports">
      {[
        ['Revenue', summary.revenue],
        ['COGS', summary.cogs],
        ['Gross profit', summary.grossProfit],
        ['Stock added cost', summary.stockAddedCost],
        ['Stock value', summary.stockValue],
        ['Credit outstanding', summary.creditOutstanding],
      ].map(([label, value]) => <div key={label} className="metric"><span>{label}</span><strong>{money(value)}</strong></div>)}
      <section className="panel report-wide">
        <h2>Payment methods</h2>
        <div className="method-bars">{(['CASH', 'MPESA', 'CREDIT'] as PaymentMethod[]).map(method => <div key={method}><span>{method}</span><b>{money(summary.salesByMethod[method])}</b></div>)}</div>
      </section>
      <section className="panel report-wide">
        <h2>Top products</h2>
        {summary.topProducts.map(product => <div key={product.productId} className="table-row"><div><strong>{product.name}</strong><span>{product.quantity} sold - COGS {money(product.cogs)}</span></div><b>{money(product.sales)}</b></div>)}
      </section>
    </div>
  );
}

function CustomersDesktop({ customers, onPay }: { customers: Customer[]; onPay: MiniUiProps['onPayCustomer'] }) {
  const [form, setForm] = React.useState({ customerId: '', amount: 0, paymentMethod: 'CASH' as 'CASH' | 'MPESA', reference: '' });
  return (
    <div className="two-column">
      <section className="panel">
        <h2>Settle credit</h2>
        <select value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })}>
          <option value="">Select customer</option>
          {customers.filter(customer => Number(customer.balance) > 0).map(customer => <option key={customer.id} value={customer.id}>{customer.name} - {money(customer.balance)}</option>)}
        </select>
        <input type="number" value={form.amount || ''} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} placeholder="Amount" />
        <select value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value as 'CASH' | 'MPESA' })}><option>CASH</option><option>MPESA</option></select>
        <input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="Reference (optional)" />
        <button className="primary" onClick={async () => { await onPay(form); setForm({ customerId: '', amount: 0, paymentMethod: 'CASH', reference: '' }); }}>Record payment</button>
      </section>
      <section className="panel">
        <h2>Customers</h2>
        {customers.map(customer => <div key={customer.id} className="table-row"><div><strong>{customer.name}</strong><span>{customer.phone || 'No phone'} - Paid {money(customer.totalPaid)}</span></div><b>{money(customer.balance)}</b></div>)}
      </section>
    </div>
  );
}

function ProfileDesktop({ profile, users, onSave, onSaveUser, onDeactivateUser }: {
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
    <div className="two-column">
      <section className="panel">
        <h2>Store profile</h2>
        <div className="logo-preview">{logoDataUrl ? <img src={logoDataUrl} alt="" /> : <Store size={46} />}</div>
        <input value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="Store name" />
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => {
          const file = e.target.files?.[0];
          if (file) setLogoDataUrl(await resizeLogo(file));
        }} />
        <button className="primary" onClick={() => void onSave({ storeName, logoDataUrl })}>Save profile</button>
      </section>
      <section className="panel">
        <h2>Users</h2>
        <div className="stack">
          <input value={userForm.name || ''} onChange={e => setUserForm({ ...userForm, name: e.target.value })} placeholder="Full name" />
          <input value={userForm.username || ''} onChange={e => setUserForm({ ...userForm, username: e.target.value })} placeholder="Username" />
          <select value={userForm.role || 'CASHIER'} onChange={e => setUserForm({ ...userForm, role: e.target.value as User['role'] })}>
            <option value="CASHIER">Cashier</option>
            <option value="ADMIN">Admin</option>
          </select>
          <input type="password" value={userForm.password || ''} onChange={e => setUserForm({ ...userForm, password: e.target.value })} placeholder={userForm.id ? 'New password (optional)' : 'Password'} />
          <button className="primary" onClick={async () => {
            await onSaveUser(userForm);
            setUserForm({ name: '', username: '', role: 'CASHIER', password: '' });
          }}>{userForm.id ? 'Update user' : 'Create user'}</button>
          {userForm.id && <button className="ghost" onClick={() => setUserForm({ name: '', username: '', role: 'CASHIER', password: '' })}>Cancel edit</button>}
        </div>
        <div className="table-list user-list">
          {users.map(account => (
            <div key={account.id} className="table-row">
              <div><strong>{account.name}</strong><span>{account.username} - {account.role.toLowerCase()} - {Number(account.isActive ?? 1) ? 'active' : 'inactive'}</span></div>
              <div className="row-actions">
                <button className="secondary" onClick={() => setUserForm({ ...account, password: '' })}>Edit</button>
                {Number(account.isActive ?? 1) !== 0 && <button className="danger" onClick={() => void onDeactivateUser(account.id)}>Deactivate</button>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
