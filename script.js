(function() {
    const supabaseApi = window.POS_SUPABASE || {};

    // Auth helpers now live in auth.js. Expose thin shims so existing code
    // inside this file that calls isSupabaseReady() / getAuthMode() still works.
    const authMode = { local: 'local', supabase: 'supabase' };

    function isSupabaseReady() {
        return !!(supabaseApi && typeof supabaseApi.isConfigured === 'function' && supabaseApi.isConfigured());
    }

    function getAuthMode() {
        return isSupabaseReady() ? authMode.supabase : authMode.local;
    }

    async function getCurrentUser() {
        if (!isSupabaseReady()) {
            return { user: null, error: new Error('Backend is not configured.') };
        }
        return supabaseApi.getCurrentUser();
    }

    // ---------- RESPONSIVE DETECTION ----------
    const isMobile = () => window.innerWidth < 768;
    const isTablet = () => window.innerWidth >= 768 && window.innerWidth < 1024;
    const isDesktop = () => window.innerWidth >= 1024;

    // Disable decorative background animations on mobile for battery
    // and paint performance. This used to be `* { animation-duration:
    // 0.1s !important; }` — that rule also compressed the theme-reveal
    // transition down to 100ms, which made it invisible. Scoped to just
    // the ambient glow shapes now.
    if (isMobile()) {
        const style = document.createElement('style');
        style.textContent = `
            .bg-glow, .geo-shape { animation: none !important; }
        `;
        document.head.appendChild(style);
    }

    // ---------- USER DB (delegated to auth.js) ----------
    const ADMIN_CREATED_KEY = 'pos_admin_account_created';
    const MAX_ADMIN_ACCOUNTS = 2;

    const getUsers = () => window.AUTH?.getUsers?.() || [];
    const saveUsers = (u) => window.AUTH?.saveUsers?.(u);
    const getAdminAccountCount = () => window.AUTH?.getAdminAccountCount?.() || 0;
    const findUserByEmail = (email) => window.AUTH?.findUserByEmail?.(email);
    const addUser = (user) => window.AUTH?.addUser?.(user);
    const refreshAdminAvailability = () => window.AUTH?.refreshAdminAvailability?.();
    function hasAdminAccount() { return getAdminAccountCount() > 0; }

    // ---------- DOM ELEMENTS ----------
    const signinView = document.getElementById('signinView');
    const forgotView = document.getElementById('forgotView');
    const accountStatusText = document.getElementById('accountStatusText');
    const loginContainer = document.getElementById('loginContainer');
    const dashboardContainer = document.getElementById('dashboardContainer');
    const userDisplayName = document.getElementById('userDisplayName');
    const dashboardUserName = document.getElementById('dashboardUserName');
    const userDropdownBtn = document.getElementById('userDropdownBtn');
    const userDropdownMenu = document.getElementById('userDropdownMenu');
    const logoutBtn = document.getElementById('logoutBtn');
    const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
    const mobileToggle = document.getElementById('mobileToggle');
    const sidebar = document.getElementById('sidebar');
    const themeToggle = document.getElementById('themeToggle');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const resetSettingsBtn = document.getElementById('resetSettingsBtn');
    const settingStoreName = document.getElementById('settingStoreName');
    const settingStoreAddress = document.getElementById('settingStoreAddress');
    const settingStoreContact = document.getElementById('settingStoreContact');
    const settingReceiptFooter = document.getElementById('settingReceiptFooter');
    const settingTaxRate = document.getElementById('settingTaxRate');
    const settingGcashNumber = document.getElementById('settingGcashNumber');
    const settingGcashName = document.getElementById('settingGcashName');
    const customerSearch = document.getElementById('customerSearch');
    const addCustomerBtn = document.getElementById('addCustomerBtn');
    const customersTableBody = document.getElementById('customersTableBody');
    const ordersTableBody = document.getElementById('ordersTableBody');
    const orderStatusFilter = document.getElementById('orderStatusFilter');
    const orderDateFilter = document.getElementById('orderDateFilter');
    
    
    let selectedRole = 'admin';
    let currentUser = null;
    

    const ORDERS_KEY = 'pos_orders';
const AUDIT_KEY = 'pos_audit_logs';
const CUSTOMERS_KEY = 'pos_customers';
    const CUSTOMERS_CACHE_READY_KEY = 'pos_customers_cache_ready';
  

    const ROLE_ACCESS = {
        admin: new Set(['overview', 'pos', 'inventory', 'orders', 'customers', 'reports', 'audit', 'users', 'settings']),
        cashier: new Set(['overview', 'pos', 'orders', 'customers', 'reports'])
    };

    function getUserRole(user = currentUser) {
        const role = user?.role || user?.user_metadata?.role || user?.app_metadata?.role;
        return String(role || '').trim().toLowerCase() === 'admin' ? 'admin' : 'cashier';
    }

    function canAccessPage(page, user = currentUser) {
        return ROLE_ACCESS[getUserRole(user)].has(page);
    }

    function applyRoleAccess(user = currentUser) {
        const role = getUserRole(user);
        document.querySelectorAll('.sidebar-link[data-page]').forEach(link => {
            const isAllowed = ROLE_ACCESS[role].has(link.dataset.page);
            link.hidden = !isAllowed;
            link.setAttribute('aria-hidden', String(!isAllowed));
        });

        const activePage = document.querySelector('.page-content.active')?.id.replace('page-', '');
        if (activePage && !canAccessPage(activePage, user)) {
            window.navigateToPage('overview');
        }
    }

    // ---------- THEME ----------
    const THEME_KEY = 'pos_theme';
    const SETTINGS_KEY = 'pos_settings';

    // Canonical defaults — Reset and missing-field fallbacks read from here.
    const SETTINGS_DEFAULTS = {
        storeName: "Kirby's Hardware",
        storeAddress: 'Gimeno Bldg, Gungon St, Santa Maria, 3022 Bulacan',
        storeContact: '0935 491 9766',
        receiptFooter: 'Thank you for your business!',
        taxRate: 8,
        gcashNumber: '0993 591 7971',
        gcashName: 'Gabriel A'
    };

    function collectSettingsFromForm() {
        const taxRaw = parseFloat(settingTaxRate?.value);
        return {
            storeName: (settingStoreName?.value || '').trim() || SETTINGS_DEFAULTS.storeName,
            storeAddress: (settingStoreAddress?.value || '').trim() || SETTINGS_DEFAULTS.storeAddress,
            storeContact: (settingStoreContact?.value || '').trim() || SETTINGS_DEFAULTS.storeContact,
            receiptFooter: (settingReceiptFooter?.value || '').trim() || SETTINGS_DEFAULTS.receiptFooter,
            taxRate: Number.isFinite(taxRaw) && taxRaw >= 0 && taxRaw <= 50 ? taxRaw : SETTINGS_DEFAULTS.taxRate,
            gcashNumber: (settingGcashNumber?.value || '').trim() || SETTINGS_DEFAULTS.gcashNumber,
            gcashName: (settingGcashName?.value || '').trim() || SETTINGS_DEFAULTS.gcashName
        };
    }

    function applySettingsToForm(settings) {
        if (!settings) return;
        if (settingStoreName && typeof settings.storeName === 'string') settingStoreName.value = settings.storeName;
        if (settingStoreAddress && typeof settings.storeAddress === 'string') settingStoreAddress.value = settings.storeAddress;
        if (settingStoreContact && typeof settings.storeContact === 'string') settingStoreContact.value = settings.storeContact;
        if (settingReceiptFooter && typeof settings.receiptFooter === 'string') settingReceiptFooter.value = settings.receiptFooter;
        if (settingTaxRate && settings.taxRate != null) settingTaxRate.value = settings.taxRate;
        if (settingGcashNumber && typeof settings.gcashNumber === 'string') settingGcashNumber.value = settings.gcashNumber;
        if (settingGcashName && typeof settings.gcashName === 'string') settingGcashName.value = settings.gcashName;
    }

    // Broadcast a "settings updated" signal so POS can refresh its tax
    // label and any other live UI.
    function announceSettingsChange() {
        try {
            window.dispatchEvent(new CustomEvent('pos-settings-updated'));
        } catch (e) {}
    }

    async function loadSettings() {
        let settings = {};
        try {
            settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        } catch (e) {}

        try {
            const { data } = await window.POS_SUPABASE.getSettings();
            if (data) settings = { ...settings, ...data };
        } catch (e) {}

        // Merge against defaults so every field is populated.
        settings = { ...SETTINGS_DEFAULTS, ...settings };
        applySettingsToForm(settings);

        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
        announceSettingsChange();
    }

    async function saveSettings() {
        const btn = document.getElementById('saveSettingsBtn');
        const originalHtml = btn?.innerHTML;
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
        }

        const settings = collectSettingsFromForm();

        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}

        try {
            const { error } = await window.POS_SUPABASE.saveSettings(settings);
            if (error) {
                showToast('Unable to save settings to cloud', 'error');
                window.POS_APP_LOG?.('update', 'settings', 'Settings save failed', 'warning');
                return;
            }
            window.POS_APP_LOG?.('update', 'settings', 'System settings updated', 'info');
            showToast('Settings saved successfully', 'success');
            announceSettingsChange();
        } catch (err) {
            showToast('Unable to save settings', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml || '<i class="fas fa-save"></i> Save Settings';
            }
        }
    }

    async function resetSettings() {
        if (!window.confirm('Reset all settings to defaults? This cannot be undone.')) return;

        const btn = document.getElementById('resetSettingsBtn');
        const originalHtml = btn?.innerHTML;
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting…';
        }

        try {
            applySettingsToForm(SETTINGS_DEFAULTS);
            try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS_DEFAULTS)); } catch (e) {}
            const { error } = await window.POS_SUPABASE.saveSettings(SETTINGS_DEFAULTS);
            if (error) {
                showToast('Reset failed — could not reach cloud', 'error');
                return;
            }
            window.POS_APP_LOG?.('update', 'settings', 'Settings reset to defaults', 'info');
            showToast('Settings reset to defaults', 'success');
            announceSettingsChange();
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml || '<i class="fas fa-rotate-left"></i> Reset to Defaults';
            }
        }
    }
    
    function readStoredRecords(key) {
        try {
            const records = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(records) ? records : [];
        } catch (error) {
            return [];
        }
    }

    function writeStoredRecords(key, records) {
        localStorage.setItem(key, JSON.stringify(records));
    }

    function formatAppCurrency(value) {
        return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0);
    }

    

    

    function renderOrders(snapshotOrders = null) {
    if (!ordersTableBody) return;
    
    const orders = Array.isArray(snapshotOrders) ? snapshotOrders : readStoredRecords(ORDERS_KEY);
    if (Array.isArray(snapshotOrders)) writeStoredRecords(ORDERS_KEY, orders.slice(0, 2000));
    
    const status = orderStatusFilter?.value || '';
    const dateRange = orderDateFilter?.value || '';

    // Manila calendar-day boundaries. "Today" means start-of-day in
    // Asia/Manila, not a rolling 24h window — otherwise yesterday's
    // afternoon sales bleed into today's list.
    const STORE_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
    const startTodayMs = (() => {
        const shifted = new Date(Date.now() + STORE_TZ_OFFSET_MS);
        shifted.setUTCHours(0, 0, 0, 0);
        return shifted.getTime() - STORE_TZ_OFFSET_MS;
    })();
    const dayMs = 24 * 60 * 60 * 1000;

    const filtered = orders.filter(order => {
        if (status && order.status !== status) return false;
        if (!dateRange) return true;
        const ts = new Date(order.createdAt).getTime();
        if (isNaN(ts)) return false;
        if (dateRange === 'Today') return ts >= startTodayMs;
        if (dateRange === 'This Week') return ts >= startTodayMs - 6 * dayMs;
        if (dateRange === 'This Month') return ts >= startTodayMs - 30 * dayMs;
        return true;
    });
    
    if (!filtered.length) {
        ordersTableBody.innerHTML = '<tr><td colspan="7" class="empty-table-message">No orders found</td></tr>';
        return;
    }
    
    ordersTableBody.innerHTML = filtered.map(order => {
    const items = (order.items || []).map(item => `${escapeCustomerText(item.name)} x${item.quantity}`).join(', ');
    const itemCount = (order.items || []).length;
    return `<tr>
        <td>${escapeCustomerText(order.id)}</td>
        <td>${escapeCustomerText(order.customerName || 'Walk-in customer')}</td>
        <td class="order-items-cell" title="Click to view all items">
            <button type="button" class="order-items-btn" data-order-id="${escapeCustomerText(order.id)}">
                <span class="order-items-text">${items || 'No items'}</span>
                ${itemCount > 2 ? `<span class="order-items-badge">View ${itemCount} items</span>` : ''}
            </button>
        </td>
        <td>${formatAppCurrency(order.total)}</td>
        <td><span class="stock-badge in-stock">${escapeCustomerText(order.status)}</span></td>
        <td>${new Date(order.createdAt).toLocaleString()}</td>
        <td><button class="btn-icon delete order-delete-btn" type="button" data-order-id="${escapeCustomerText(order.id)}" title="Delete order"><i class="fas fa-trash"></i></button></td>
    </tr>`;
}).join('');
}

    async function deleteOrder(orderId) {
    const { error } = await window.POS_SUPABASE.deleteOrder(orderId);
    if (error) { showToast(error.message, 'error'); return; }
    const orders = readStoredRecords(ORDERS_KEY).filter(order => order.id !== orderId);
    writeStoredRecords(ORDERS_KEY, orders);
window.POS_APP_LOG?.('delete', 'orders', `Order ${orderId} deleted`, 'warning');
renderOrders();
    showToast('Order deleted', 'success');
}

   function setupOrderFeatures() {
    orderStatusFilter?.addEventListener('change', renderOrders);
    orderDateFilter?.addEventListener('change', renderOrders);
    
    ordersTableBody?.addEventListener('click', event => {
        // Delete button
        const deleteBtn = event.target.closest('.order-delete-btn');
        if (deleteBtn) {
            if (!window.confirm('Delete this order record?')) return;
            deleteOrder(deleteBtn.dataset.orderId);
            return;
        }
        
        // View items button
        const viewBtn = event.target.closest('.order-items-btn');
        if (viewBtn) {
            openOrderDetails(viewBtn.dataset.orderId);
        }
    });
    
    renderOrders();
}

   function openOrderDetails(orderId) {
    const orders = readStoredRecords(ORDERS_KEY);
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order) return;

    const items = Array.isArray(order.items) ? order.items : [];
    const isGcash = String(order.paymentMethod || '').toLowerCase() === 'gcash';

    // ---- META BLOCK ----
    const statusLabel = escapeCustomerText(order.status || 'Completed');
    const statusClass = String(order.status || '').toLowerCase() === 'cancelled'
        ? 'out-of-stock'
        : 'in-stock';

    document.getElementById('orderDetailsMeta').innerHTML = `
        <div class="order-details-row">
            <span>Receipt No</span>
            <strong style="font-family:ui-monospace,'SF Mono',monospace;font-size:12px;">${escapeCustomerText(order.id)}</strong>
        </div>
        <div class="order-details-row">
            <span>Customer</span>
            <strong>${escapeCustomerText(order.customerName || 'Walk-in customer')}</strong>
        </div>
        ${order.customerPhone ? `
        <div class="order-details-row">
            <span>Phone</span>
            <strong>${escapeCustomerText(order.customerPhone)}</strong>
        </div>` : ''}
        <div class="order-details-row">
            <span>Date</span>
            <strong>${escapeCustomerText(new Date(order.createdAt).toLocaleString())}</strong>
        </div>
        <div class="order-details-row">
            <span>Payment</span>
            <strong>${isGcash ? 'GCash' : 'Cash'}</strong>
        </div>
        ${isGcash && order.gcashReference ? `
        <div class="order-details-row">
            <span>GCash Ref No.</span>
            <strong style="font-family:ui-monospace,'SF Mono',monospace;font-size:12px;">${escapeCustomerText(order.gcashReference)}</strong>
        </div>` : ''}
        <div class="order-details-row">
            <span>Status</span>
            <span class="stock-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="order-details-row">
            <span>Items</span>
            <strong>${items.length} item${items.length === 1 ? '' : 's'}</strong>
        </div>
    `;

    // ---- ITEMS BLOCK ----
    if (items.length === 0) {
        document.getElementById('orderDetailsItems').innerHTML = `
            <p style="text-align:center;color:var(--text-secondary);padding:1rem 0;">No items recorded</p>`;
    } else {
        document.getElementById('orderDetailsItems').innerHTML = items.map(item => {
            const qty = Number(item.quantity) || 0;
            const price = Number(item.price) || 0;
            const lineTotal = qty * price;

            // Show both size and brand if present
            const bits = [];
            if (item.size) bits.push(`<span class="order-detail-size">(${escapeCustomerText(item.size)})</span>`);
            if (item.brand) bits.push(`<span class="order-detail-size">· ${escapeCustomerText(item.brand)}</span>`);
            const variantLabel = bits.length ? ' ' + bits.join(' ') : '';

            return `
                <div class="order-details-item">
                    <div class="order-details-item-name">
                        <span>${escapeCustomerText(item.name)}${variantLabel}</span>
                        <span class="order-details-item-qty">${qty} × ${formatAppCurrency(price)}</span>
                    </div>
                    <strong>${formatAppCurrency(lineTotal)}</strong>
                </div>`;
        }).join('');
    }

    // ---- TOTALS BLOCK ----
    const subtotal = Number(order.subtotal) || 0;
    const tax = Number(order.tax) || 0;
    const total = Number(order.total) || 0;
    document.getElementById('orderDetailsTotals').innerHTML = `
        <div class="order-details-row">
            <span>Subtotal</span>
            <strong>${formatAppCurrency(subtotal)}</strong>
        </div>
        <div class="order-details-row">
            <span>Tax (8%)</span>
            <strong>${formatAppCurrency(tax)}</strong>
        </div>
        <div class="order-details-row order-details-grand">
            <span>Total</span>
            <strong>${formatAppCurrency(total)}</strong>
        </div>
    `;

    document.getElementById('orderDetailsModal')?.classList.add('active');
}

// Order Details modal close handlers
document.getElementById('closeOrderDetailsModal')?.addEventListener('click', () => {
    document.getElementById('orderDetailsModal')?.classList.remove('active');
});

document.getElementById('orderDetailsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'orderDetailsModal') {
        e.target.classList.remove('active');
    }
});

    function downloadCsv(filename, headers, rows) {
        const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const csv = [headers, ...rows].map(row => row.map(escapeCsv).join(',')).join('\n');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // ----------------------------------------------------------------
    // REPORTS — period resolution
    //
    // Returns { start: Date, end: Date, label: string, key: string } for
    // the currently-selected report period. The `key` is a URL-safe
    // slug suitable for filenames.
    //
    // Returns null if the user has selected "custom" but the range is
    // incomplete or invalid — callers must fall back to unfiltered data.
    // ----------------------------------------------------------------
    function getReportPeriodRange(period) {
        const now = new Date();
        const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
        const endOfDay   = d => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

        let start, end, label;

        switch (period) {
            case 'today':
                start = startOfDay(now); end = endOfDay(now); label = 'Today';
                break;

            case 'yesterday': {
                const y = new Date(now); y.setDate(y.getDate() - 1);
                start = startOfDay(y); end = endOfDay(y); label = 'Yesterday';
                break;
            }

            case '7d': {
                const s = new Date(now); s.setDate(s.getDate() - 6);
                start = startOfDay(s); end = endOfDay(now); label = 'Last 7 days';
                break;
            }

            case '30d': {
                const s = new Date(now); s.setDate(s.getDate() - 29);
                start = startOfDay(s); end = endOfDay(now); label = 'Last 30 days';
                break;
            }

            case 'this-month':
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                end = endOfDay(now);
                label = 'This month';
                break;

            case 'last-month': {
                const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const lastMonthEnd = new Date(firstThisMonth.getTime() - 1);
                start = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
                end = lastMonthEnd;
                label = 'Last month';
                break;
            }

            case 'this-year':
                start = new Date(now.getFullYear(), 0, 1);
                end = endOfDay(now);
                label = 'This year';
                break;

            case 'last-year':
                start = new Date(now.getFullYear() - 1, 0, 1);
                end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
                label = 'Last year';
                break;

            case 'all':
            default:
                start = new Date(0);
                end = endOfDay(now);
                label = 'All time';
                break;
        }

        return { start, end, label, key: period };
    }

    function getActiveReportRange() {
        const periodEl = document.getElementById('reportPeriod');
        const period = periodEl?.value || 'all';

        if (period === 'custom') {
            const startEl = document.getElementById('reportCustomStart');
            const endEl = document.getElementById('reportCustomEnd');
            if (!startEl?.value || !endEl?.value) return null;

            const start = new Date(startEl.value + 'T00:00:00');
            const end = new Date(endEl.value + 'T23:59:59.999');
            if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
            if (start > end) return null;

            const fmt = d => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
            return {
                start, end,
                label: `${fmt(start)} – ${fmt(end)}`,
                key: `${startEl.value}_to_${endEl.value}`
            };
        }

        return getReportPeriodRange(period);
    }

    function refreshReportPeriodSummary() {
        const el = document.getElementById('reportPeriodSummary');
        if (!el) return;

        const range = getActiveReportRange();
        if (!range) {
            el.innerHTML = '';
            return;
        }

        const allOrders = readStoredRecords(ORDERS_KEY);
        const orders = filterOrdersInRange(allOrders, range.start, range.end);
        const revenue = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);

        el.innerHTML =
            `<strong>${range.label}</strong> · ` +
            `${orders.length} order${orders.length === 1 ? '' : 's'} · ` +
            `${formatAppCurrency(revenue)}`;
    }

    // Shared builder — returns { title, headers, rows, totals } for both
    // CSV and PDF exporters so the two never drift apart.
    function buildReportData(type) {
        if (type === 'customers') {
            const customers = getCustomers();
            const totalSpent = customers.reduce((s, c) => s + (Number(c.totalSpent) || 0), 0);
            const totalOrders = customers.reduce((s, c) => s + (Number(c.orders) || 0), 0);
            return {
                title: 'Customer Report',
                headers: ['Name', 'Email', 'Phone', 'Orders', 'Total Spent'],
                rows: customers.map(c => [
                    c.name || '', c.email || '', c.phone || '',
                    Number(c.orders) || 0,
                    `₱${(Number(c.totalSpent) || 0).toFixed(2)}`
                ]),
                totals: { 'Total customers': customers.length, 'Total orders': totalOrders, 'Total spent': `₱${totalSpent.toFixed(2)}` }
            };
        }

        if (type === 'inventory') {
            const products = window.getInventorySnapshot?.() || [];
            const totalValue = products.reduce((s, p) => s + ((Number(p.quantity) || 0) * (Number(p.price) || 0)), 0);
            const lowStock = products.filter(p => (Number(p.quantity) || 0) > 0 && (Number(p.quantity) || 0) <= (Number(p.minStock) || 0)).length;
            const outOfStock = products.filter(p => (Number(p.quantity) || 0) === 0).length;
            return {
                title: 'Inventory Report',
                headers: ['ID', 'Name', 'SKU', 'Category', 'Price', 'Quantity', 'Min Stock'],
                rows: products.map(p => [
                    p.id, p.name || '', p.sku || '', p.category || '',
                    `₱${(Number(p.price) || 0).toFixed(2)}`,
                    Number(p.quantity) || 0,
                    Number(p.minStock) || 0
                ]),
                totals: { 'Total products': products.length, 'Low stock': lowStock, 'Out of stock': outOfStock, 'Inventory value': `₱${totalValue.toFixed(2)}` }
            };
        }

        // Default: sales / financial → order listing, filtered by the
        // currently-selected report period.
        const range = getActiveReportRange();
        const allOrders = readStoredRecords(ORDERS_KEY);
        const orders = range
            ? filterOrdersInRange(allOrders, range.start, range.end)
            : allOrders;

        const totalRevenue = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
        const totalTax = orders.reduce((s, o) => s + (Number(o.tax) || 0), 0);

        return {
            title: type === 'financial' ? 'Financial Report' : 'Sales Report',
            period: range ? range.label : 'All time',
            periodKey: range ? range.key : 'all',
            headers: ['Order ID', 'Customer', 'Subtotal', 'Tax', 'Total', 'Payment', 'Date'],
            rows: orders.map(o => [
                o.id, o.customerName || 'Walk-in',
                `₱${(Number(o.subtotal) || 0).toFixed(2)}`,
                `₱${(Number(o.tax) || 0).toFixed(2)}`,
                `₱${(Number(o.total) || 0).toFixed(2)}`,
                o.paymentMethod || 'cash',
                o.createdAt ? new Date(o.createdAt).toLocaleString() : ''
            ]),
            totals: {
                'Total orders': orders.length,
                'Total revenue': `₱${totalRevenue.toFixed(2)}`,
                'Total tax': `₱${totalTax.toFixed(2)}`,
                'Period': range ? range.label : 'All time'
            }
        };
    }

    function generateReport(type) {
        const data = buildReportData(type);

        // Filename includes the period key so two exports for different
        // ranges don't overwrite each other on the user's disk.
        const stamp = new Date().toISOString().split('T')[0];
        const periodKey = data.periodKey || 'all';
        const filename = `${type}_report_${periodKey}_${stamp}.csv`;

        downloadCsv(filename, data.headers, data.rows);
        window.POS_APP_LOG?.('export', 'reports', `${type} report exported (CSV) · ${data.period || 'All time'}`, 'info');
        showToast(
            `${type[0].toUpperCase()}${type.slice(1)} report exported${data.period ? ` (${data.period})` : ''}`,
            'success'
        );
    }

    // PDF export — builds a print-ready document in a new window and
    // triggers the browser's print dialog. Users choose "Save as PDF".
    function generateReportPdf(type) {
        const data = buildReportData(type);
        if (!data.rows.length) {
            showToast('No data to export', 'error');
            return;
        }

        const storeName = settingStoreName?.value?.trim() || "Kirby's Hardware";
        const generatedAt = new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
        const cashierName = window.POS_CURRENT_USER?.user_metadata?.full_name
            || window.POS_CURRENT_USER?.displayName
            || window.POS_CURRENT_USER?.email
            || 'System';

        const esc = v => String(v ?? '').replace(/[&<>"']/g, c => (
            { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
        ));

        const totalsRows = Object.entries(data.totals || {})
            .map(([k, v]) => `<div class="sum-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`)
            .join('');

        const headerCells = data.headers.map(h => `<th>${esc(h)}</th>`).join('');
        const bodyRows = data.rows.map(row =>
            `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`
        ).join('');

        const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(data.title)} — ${esc(storeName)}</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        color: #111;
        padding: 32px 36px;
        font-size: 12px;
        line-height: 1.5;
    }
    .header {
        border-bottom: 3px solid #E0A300;
        padding-bottom: 14px;
        margin-bottom: 20px;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
    }
    .store-name {
        font-size: 22px;
        font-weight: 800;
        color: #111;
        letter-spacing: -0.01em;
    }
    .report-title {
        font-size: 15px;
        font-weight: 700;
        color: #8a5a00;
        margin-top: 4px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
    .meta {
        text-align: right;
        font-size: 11px;
        color: #555;
        line-height: 1.6;
    }
    .meta strong { color: #111; }
    .totals {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 24px;
        margin-bottom: 18px;
        padding: 12px 14px;
        background: #fbf5e6;
        border-left: 3px solid #E0A300;
        border-radius: 4px;
    }
    .sum-row {
        display: flex;
        gap: 8px;
        align-items: baseline;
        font-size: 12px;
    }
    .sum-row span { color: #555; }
    .sum-row strong { color: #111; font-size: 13px; font-weight: 800; }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
    }
    thead th {
        background: #f5efe0;
        color: #111;
        text-align: left;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 10px;
        padding: 9px 10px;
        border-bottom: 2px solid #E0A300;
        white-space: nowrap;
    }
    tbody td {
        padding: 8px 10px;
        border-bottom: 1px solid #ece6d8;
        color: #222;
        vertical-align: top;
    }
    tbody tr:nth-child(even) td { background: #faf8f3; }
    tbody tr:last-child td { border-bottom: 1px solid #d6cfc0; }
    .footer {
        margin-top: 20px;
        padding-top: 12px;
        border-top: 1px dashed #d6cfc0;
        font-size: 10px;
        color: #777;
        text-align: center;
    }
    @media print {
        body { padding: 16px 20px; }
        thead th { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        tbody tr:nth-child(even) td { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .totals { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
    @page { margin: 12mm; }
</style>
</head>
<body>
    <div class="header">
        <div>
            <div class="store-name">${esc(storeName)}</div>
            <div class="report-title">${esc(data.title)}</div>
        </div>
        <div class="meta">
            ${data.period ? `<div><strong>Period:</strong> ${esc(data.period)}</div>` : ''}
            <div><strong>Generated:</strong> ${esc(generatedAt)}</div>
            <div><strong>By:</strong> ${esc(cashierName)}</div>
            <div><strong>Rows:</strong> ${data.rows.length}</div>
        </div>
    </div>

    ${totalsRows ? `<div class="totals">${totalsRows}</div>` : ''}

    <table>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
    </table>

    <div class="footer">
        Kirby's Hardware — ${esc(data.title)} · Generated ${esc(generatedAt)}
    </div>

    <script>
        window.addEventListener('load', () => {
            setTimeout(() => window.print(), 250);
        });
    </script>
</body>
</html>`;

        const printWindow = window.open('', '_blank', 'width=900,height=700');
        if (!printWindow) {
            showToast('Allow pop-ups to export PDF', 'error');
            return;
        }
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();

        window.POS_APP_LOG?.('export', 'reports', `${type} report exported (PDF)`, 'info');
        showToast(`${type[0].toUpperCase()}${type.slice(1)} report ready — choose "Save as PDF"`, 'success');
    }
    
    function setupReportFeatures() {
        document.querySelectorAll('.report-generate-btn').forEach(button => {
            button.addEventListener('click', () => generateReport(button.dataset.report));
        });
        document.querySelectorAll('.report-pdf-btn').forEach(button => {
            button.addEventListener('click', () => generateReportPdf(button.dataset.report));
        });

        // ---- Period selector ----
        const periodEl = document.getElementById('reportPeriod');
        const customRangeEl = document.getElementById('reportCustomRange');
        const startEl = document.getElementById('reportCustomStart');
        const endEl = document.getElementById('reportCustomEnd');

        function toggleCustomVisibility() {
            if (!customRangeEl) return;
            customRangeEl.hidden = periodEl?.value !== 'custom';
        }

        // Default the custom range inputs to the last 7 days when first revealed
        function seedCustomRangeIfEmpty() {
            if (startEl?.value && endEl?.value) return;
            const now = new Date();
            const s = new Date(now); s.setDate(s.getDate() - 6);
            const iso = d => d.toISOString().split('T')[0];
            if (startEl && !startEl.value) startEl.value = iso(s);
            if (endEl && !endEl.value) endEl.value = iso(now);
        }

        periodEl?.addEventListener('change', () => {
            if (periodEl.value === 'custom') seedCustomRangeIfEmpty();
            toggleCustomVisibility();
            refreshReportPeriodSummary();
        });

        startEl?.addEventListener('change', refreshReportPeriodSummary);
        endEl?.addEventListener('change', refreshReportPeriodSummary);

        // Initial state on load
        toggleCustomVisibility();
        refreshReportPeriodSummary();

        // Keep the summary fresh when orders change (Firestore subscription
        // fires on the Orders page, but a login-time snapshot also lands here)
        window.addEventListener('pos-order-created', refreshReportPeriodSummary);
    }

    

    function getCustomers() {
        try {
            const customers = JSON.parse(localStorage.getItem(CUSTOMERS_KEY) || '[]');
            return Array.isArray(customers) ? customers : [];
        } catch (e) {
            return [];
        }
    }

    function escapeCustomerText(value) {
        return String(value || '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[character]));
    }

    function renderCustomers(searchTerm = '', snapshotCustomers = null) {
    if (!customersTableBody) return;

    const customers = Array.isArray(snapshotCustomers) ? snapshotCustomers : getCustomers();
    if (Array.isArray(snapshotCustomers)) {
        localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
        localStorage.setItem(CUSTOMERS_CACHE_READY_KEY, 'true');
    }

    const search = searchTerm.trim().toLowerCase();
    const filtered = customers.filter(customer =>
        [customer.name, customer.email, customer.phone].some(value =>
            String(value || '').toLowerCase().includes(search)
        )
    );

    if (!filtered.length) {
        customersTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 3rem;"><i class="fas fa-users" style="font-size: 3rem; color: #cbd5e0; display: block; margin-bottom: 1rem;"></i><p style="color: #718096;">No customers found</p></td></tr>';
        return;
    }

    customersTableBody.innerHTML = filtered.map(customer => `
        <tr>
            <td>${escapeCustomerText(customer.name)}</td>
            <td>${escapeCustomerText(customer.email) || '&mdash;'}</td>
            <td>${escapeCustomerText(customer.phone) || '&mdash;'}</td>
            <td>${Number(customer.orders) || 0}</td>
            <td>₱${(Number(customer.totalSpent) || 0).toFixed(2)}</td>
            <td><button class="btn-icon delete" type="button" data-customer-id="${customer.id}" title="Delete customer"><i class="fas fa-trash"></i></button></td>
        </tr>`).join('');
}

    async function addCustomer() {
    const name = window.prompt('Customer name:')?.trim();
    if (!name) return;
    const email = window.prompt('Customer email (optional):')?.trim() || '';
    const phone = window.prompt('Customer phone (optional):')?.trim() || '';

    // Local cache (instant)
    const customers = getCustomers();
    customers.push({ id: Date.now(), name, email, phone, orders: 0, totalSpent: 0 });
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));

    // Firestore sync
    const { error } = await window.POS_SUPABASE.addCustomer({
        name, email, phone, orders: 0, totalSpent: 0
    });
        if (error) { showToast(error.message, 'error'); return; }
    
    window.POS_APP_LOG?.('create', 'customers', `Customer ${name} added`, 'info');
    showToast('Customer added successfully', 'success');
    renderCustomers(customerSearch?.value || '');
    }

    if (customerSearch) customerSearch.addEventListener('input', event => renderCustomers(event.target.value));
    if (addCustomerBtn) addCustomerBtn.addEventListener('click', addCustomer);
    if (customersTableBody) {
    customersTableBody.addEventListener('click', async event => {
        const deleteButton = event.target.closest('[data-customer-id]');
        if (!deleteButton) return;
        const customerId = deleteButton.dataset.customerId;
        if (!window.confirm('Delete this customer?')) return;
        
        const { error } = await window.POS_SUPABASE.deleteCustomer(customerId);
        if (error) { showToast(error.message, 'error'); return; }
        
        const customers = getCustomers().filter(customer => String(customer.id) !== String(customerId));
localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));

window.POS_APP_LOG?.('delete', 'customers', `Customer ${customerId} deleted`, 'warning');
showToast('Customer deleted successfully', 'success');
renderCustomers(customerSearch?.value || '');
    });
    }

    function applyTheme(theme) {
    const isLight = theme === 'light';
    document.documentElement.dataset.theme = isLight ? 'light' : 'dark';

    if (themeToggle) {
        const nextMode = isLight ? 'dark' : 'light';
        themeToggle.setAttribute('aria-label', `Switch to ${nextMode} mode`);
        themeToggle.setAttribute('title', `Switch to ${nextMode} mode`);
    }
    // Chart re-renders are deferred to refreshChartsAfterThemeChange().
    // Running them here blocks the main thread during the view-transition
    // snapshot, which is what produces the visible stutter on toggle.
    }

    /* Runs AFTER the reveal animation has finished. Uses idle time
       so it never competes with the compositor. */
    function refreshChartsAfterThemeChange() {
        if (document.getElementById('ovSalesChart') && typeof renderSalesChart === 'function') {
            renderSalesChart();
        }
        if (document.getElementById('ovTopProductsChart') && typeof renderTopProductsChart === 'function') {
            renderTopProductsChart();
        }
        if (document.getElementById('ovCategoryChart') && typeof renderSalesByCategoryChart === 'function') {
            renderSalesByCategoryChart();
        }
        if (document.getElementById('ovHourlyHeatmap') && typeof renderHourlyHeatmap === 'function') {
            renderHourlyHeatmap();
        }
        // In-place color update for the AI forecast chart — avoids the
        // expensive Chart.js teardown/rebuild that refreshAiCards() causes.
        if (aiForecastChartInstance) {
            refreshAiChartsInPlace();
        }
    }

    /* Updates chart colors on the existing Chart.js instance instead
       of destroying and rebuilding it. No network call, no canvas
       reallocation, no layout thrash. */
    function refreshAiChartsInPlace() {
        if (!aiForecastChartInstance) return;
        const isLight = document.documentElement.dataset.theme === 'light';
        const accent    = isLight ? '#E0A300' : '#FACC15';
        const accentRgb = isLight ? '224, 163, 0' : '250, 204, 21';
        const tickColor = isLight ? '#756c5e' : '#8a8275';

        const ds = aiForecastChartInstance.data.datasets;
        ds.forEach(d => {
            if (d.label === 'forecast') {
                d.borderColor = accent;
                d.pointBackgroundColor = accent;
            }
            if (d.label === '_bandUpper') {
                d.backgroundColor = `rgba(${accentRgb}, 0.14)`;
            }
        });

        const opts = aiForecastChartInstance.options;
        if (opts.plugins?.tooltip) {
            opts.plugins.tooltip.titleColor = isLight ? '#100e0a' : '#fef9e7';
            opts.plugins.tooltip.bodyColor  = isLight ? '#756c5e' : '#d6cfc0';
            opts.plugins.tooltip.borderColor = `rgba(${accentRgb}, 0.35)`;
        }
        if (opts.scales?.x?.ticks) opts.scales.x.ticks.color = tickColor;

        aiForecastChartInstance.update('none');
    }

    /* ============================================================
       THEME REVEAL
       Computes the geometry needed to expand a circle from the
       theme button's center all the way to the farthest viewport
       corner, then drives a View-Transition-based reveal. Browsers
       without View Transitions get a short radial flash fallback.
       ============================================================ */

    function computeThemeRevealGeometry(sourceEl) {
        // Fall back to viewport center if we don't have a source element.
        const rect = sourceEl?.getBoundingClientRect?.();
        const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
        const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;

        // Distance from the click point to the farthest corner is the
        // radius we need so the reveal fully covers the viewport.
        const dx = Math.max(cx, window.innerWidth - cx);
        const dy = Math.max(cy, window.innerHeight - cy);
        const radius = Math.hypot(dx, dy);

        return { cx, cy, radius };
    }

    /* ------------------------------------------------------------
       Device-tier heuristic for the theme reveal.

       The View Transitions clip-path composites two full-page
       snapshots. On premium silicon that's free. On mid-range
       Android GPUs (Helio G99, Snapdragon 6-series, Dimensity 700)
       it stays above ~40fps only with all the optimizations from
       the CSS patch. Below that tier the reveal drops frames hard
       and the flash fallback is the better UX.

       Chrome exposes navigator.deviceMemory in GB (rounded down
       to the nearest power of 2). It's the best GPU-tier proxy
       available without spinning up a benchmark.
       ------------------------------------------------------------ */
    function shouldUseViewTransitionReveal() {
        // View Transitions works in Chrome/Edge 111+ and Safari 18+.
        // The API check is the only real gate we need. The hardware
        // checks from earlier were masking the reveal on capable
        // devices — Chrome caps deviceMemory at 8, most phones report 4,
        // so the mem>=8 test rejected nearly every Android.
        if (typeof document.startViewTransition !== 'function') return false;

        // The ONE case where we intentionally skip the reveal: the
        // user has asked the OS for reduced motion. This is the most
        // common reason people report "nothing happens" — check your
        // system settings if this still doesn't work.
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            return false;
        }

        return true;
    }

    let themeRevealInProgress = false;

    function performThemeReveal(sourceEl, nextTheme) {
        // ------------------------------------------------------------
        // Cross-browser circular reveal. Does NOT use startViewTransition
        // (that API is missing in this browser). Instead: a full-screen
        // overlay whose clip-path expands from the click point using
        // a plain CSS keyframe animation. Works in every browser.
        // ------------------------------------------------------------

        const overlay = document.getElementById('theme-reveal-overlay');

        // Safety net — if the overlay element is missing, just swap.
        if (!overlay) {
            applyTheme(nextTheme);
            try { localStorage.setItem(THEME_KEY, nextTheme); } catch (e) {}
            refreshChartsAfterThemeChange();
            return;
        }

        if (themeRevealInProgress) return;
        themeRevealInProgress = true;
        sourceEl?.classList.add('spin');
        sourceEl?.setAttribute('aria-busy', 'true');

        // 1. Where did the user click?
        const rect = sourceEl?.getBoundingClientRect?.();
        const clickX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
        const clickY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;

        // 2. Radius big enough to cover the whole screen from that point.
        const dx = Math.max(clickX, window.innerWidth - clickX);
        const dy = Math.max(clickY, window.innerHeight - clickY);
        const maxRadius = Math.hypot(dx, dy) + 120;

        // 3. Feed the geometry to the keyframes.
        overlay.style.setProperty('--click-x', `${clickX}px`);
        overlay.style.setProperty('--click-y', `${clickY}px`);
        overlay.style.setProperty('--max-radius', `${maxRadius}px`);

        // 4. Swap the theme on the page behind the overlay.
        applyTheme(nextTheme);
        try { localStorage.setItem(THEME_KEY, nextTheme); } catch (e) {}

        // 5. Restart the animation (reflow trick handles rapid re-clicks).
        overlay.classList.remove('animate');
        void overlay.offsetWidth;
        overlay.classList.add('animate');

        // 6. Cleanup + chart refresh after the reveal animation.
        const revealDuration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            ? 0
            : 580;
        setTimeout(() => {
            overlay.classList.remove('animate');
            sourceEl?.classList.remove('spin');
            sourceEl?.removeAttribute('aria-busy');
            themeRevealInProgress = false;

            const run = () => {
                try { refreshChartsAfterThemeChange(); }
                catch (e) { console.warn('[theme] chart refresh failed', e); }
            };
            if ('requestIdleCallback' in window) {
                requestIdleCallback(run, { timeout: 500 });
            } else {
                setTimeout(run, 60);
            }
        }, revealDuration);
    }

    function initializeTheme() {
        let savedTheme = 'light';
        try {
            savedTheme = localStorage.getItem(THEME_KEY) || 'light';
        } catch (e) {}

        // Initial apply — no reveal animation on first paint.
        applyTheme(savedTheme);

        // Shared toggle handler — used by both the login-page toggle
        // and the dashboard-nav toggle so they stay in sync via localStorage.
        const toggleTheme = (event) => {
            const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';

            // Whichever button triggered this is the reveal origin.
            const source = event?.currentTarget || themeToggle || themeToggleLogin;

            // Small icon spin — runs alongside the reveal so even if
            // View Transitions is disabled the toggle still feels alive.
            source?.classList.add('spin');
            setTimeout(() => source?.classList.remove('spin'), 600);

            performThemeReveal(source, nextTheme);
        };

        if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

        const themeToggleLogin = document.getElementById('themeToggleLogin');
        if (themeToggleLogin) themeToggleLogin.addEventListener('click', toggleTheme);
    }

    // ---------- TOAST ----------
    function showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
        const safeMsg = String(message ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
        toast.innerHTML = `
            <i class="fas ${icon}"></i>
            <span>${safeMsg}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
        `;
        container.appendChild(toast);
        
        // Auto-remove toast
        const toastTimeout = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
        
        // Allow manual dismissal
        toast.style.cursor = 'pointer';
        toast.addEventListener('click', () => {
            clearTimeout(toastTimeout);
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
        });
    }

// ---------- OVERVIEW: STATS + CHART ----------
// Store timezone: Asia/Manila = UTC+8 (no DST). Returns the
// calendar-day key in Manila so "today" on the KPI cards matches
// the orders table and the audit log.
const OVERVIEW_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
function getOverviewDayKey(offsetDays = 0) {
    const shifted = new Date(Date.now() + OVERVIEW_TZ_OFFSET_MS - offsetDays * 86400000);
    return shifted.toISOString().split('T')[0];
}

function readOrdersFromStorage() {
    try {
        return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
    } catch (e) { return []; }
}

function readCustomersFromStorage() {
    try {
        return JSON.parse(localStorage.getItem(CUSTOMERS_KEY) || '[]');
    } catch (e) { return []; }
}

function computeOverviewDelta(today, yesterday) {
    if (yesterday === 0 && today === 0) return { text: '—', cls: '' };
    if (yesterday === 0) return { text: '+100% vs yesterday', cls: 'positive' };
    const pct = ((today - yesterday) / yesterday) * 100;
    const sign = pct >= 0 ? '+' : '';
    return { text: `${sign}${pct.toFixed(1)}% vs yesterday`, cls: pct >= 0 ? 'positive' : 'negative' };
}

function refreshOverviewStats() {
    const orders = readOrdersFromStorage();
    const customers = readCustomersFromStorage();
    const products = window.getInventorySnapshot?.() || [];
    
    const todayKey = getOverviewDayKey(0);
    const yesterdayKey = getOverviewDayKey(1);
    const weekAgoTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    
    const todayOrders = orders.filter(o => o.createdAt?.startsWith(todayKey));
    const yesterdayOrders = orders.filter(o => o.createdAt?.startsWith(yesterdayKey));
    
    const todaySales = todayOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const yesterdaySales = yesterdayOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    
    const inStockCount = products.filter(p => (Number(p.quantity) || 0) > 0).length;
    const lowStockCount = products.filter(p => {
        const qty = Number(p.quantity) || 0;
        const min = Number(p.minStock ?? p.min_stock ?? 0) || 0;
        return qty > 0 && qty <= min;
    }).length;
    const outOfStockCount = products.filter(p => (Number(p.quantity) || 0) === 0).length;
    
    // Count-up animation for KPI values
    const animateNumber = (el, toValue, formatter) => {
        if (!el) return;
        const fromValue = Number(el.dataset.rawValue) || 0;
        // Fast path — no visual change, skip the frame loop entirely.
        if (fromValue === toValue) {
            el.textContent = formatter(toValue);
            return;
        }
        const duration = 400;
        const start = performance.now();
        el.dataset.rawValue = String(toValue);
        function step(now) {
            const t = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            el.textContent = formatter(fromValue + (toValue - fromValue) * eased);
            if (t < 1) requestAnimationFrame(step);
            else el.textContent = formatter(toValue);
        }
        requestAnimationFrame(step);
    };
    
    const salesEl = document.getElementById('ovTodaySales');
    const ordersEl = document.getElementById('ovOrdersToday');
    const productsEl = document.getElementById('ovProductsInStock');
    const customersEl = document.getElementById('ovActiveCustomers');
    
    animateNumber(salesEl, todaySales, v => formatAppCurrency(v));
    animateNumber(ordersEl, todayOrders.length, v => String(Math.round(v)));
    animateNumber(productsEl, inStockCount, v => String(Math.round(v)));
    animateNumber(customersEl, customers.length, v => String(Math.round(v)));
    
    // Delta labels with arrows
    const setDelta = (id, delta) => {
        const el = document.getElementById(id);
        if (!el) return;
        let arrow = '';
        if (delta.cls === 'positive') arrow = '↗ ';
        else if (delta.cls === 'negative') arrow = '↘ ';
        el.textContent = delta.text === '—' ? '—' : arrow + delta.text;
        el.className = `stat-change ${delta.cls}`.trim();
    };
    
    setDelta('ovTodaySalesDelta', computeOverviewDelta(todaySales, yesterdaySales));
    setDelta('ovOrdersTodayDelta', computeOverviewDelta(todayOrders.length, yesterdayOrders.length));
    setDelta('ovProductsDelta', {
        text: `${lowStockCount} low · ${outOfStockCount} out`,
        cls: (lowStockCount + outOfStockCount) > 0 ? 'negative' : ''
    });
    
    const newThisWeek = customers.filter(c => {
        const ts = Number(c.id) || 0;
        return ts > 0 && ts >= weekAgoTime;
    }).length;
    setDelta('ovCustomersDelta', {
        text: newThisWeek > 0 ? `+${newThisWeek} this week` : '—',
        cls: newThisWeek > 0 ? 'positive' : ''
    });
}


let ovCategoryChartInstance = null;
const CATEGORY_PERIOD_KEY = 'pos_category_period';

const CATEGORY_COLORS = {
    tools:       '#3b82f6',
    hardware:    '#f59e0b',
    electrical:  '#eab308',
    plumbing:    '#0ea5e9',
    paint:       '#ec4899',
    garden:      '#22c55e',
    building:    '#a855f7',
    fasteners:   '#64748b',
    safety:      '#ef4444'
};
const FALLBACK_CATEGORY_COLORS = ['#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#84cc16', '#d946ef', '#fb7185'];

function formatCategoryLabel(cat) {
    return String(cat || 'uncategorized')
        .split(/[\s_]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function getCategoryColor(category, index) {
    if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category];
    return FALLBACK_CATEGORY_COLORS[index % FALLBACK_CATEGORY_COLORS.length];
}

function getCategoryPeriod() {
    const select = document.getElementById('ovCategoryPeriod');
    if (select?.value) return select.value;
    try {
        const saved = localStorage.getItem(CATEGORY_PERIOD_KEY);
        if (saved) return saved;
    } catch (e) {}
    return '30d';
}

function aggregateCategoryRevenue(orders, nameToCategory) {
    const revenueByCategory = {};
    orders.forEach(order => {
        (order.items || []).forEach(item => {
            // Priority: baked-in category → name lookup → uncategorized
            const cat =
                item.category ||
                nameToCategory[String(item.name || '').toLowerCase()] ||
                'uncategorized';
            const revenue = (Number(item.price) || 0) * (Number(item.quantity) || 0);
            revenueByCategory[cat] = (revenueByCategory[cat] || 0) + revenue;
        });
    });
    return revenueByCategory;
}

function renderSalesByCategoryChart() {
    const canvas = document.getElementById('ovCategoryChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const period = getCategoryPeriod();
    const compareEnabled = !!document.getElementById('ovCategoryCompare')?.checked;

    const allOrders = readOrdersFromStorage();
    const products = window.getInventorySnapshot?.() || [];

    // Build name → category lookup from current inventory (fallback for old orders)
    const nameToCategory = {};
    products.forEach(p => {
        if (p.name) nameToCategory[String(p.name).toLowerCase()] = p.category || 'uncategorized';
    });

    // Current-period orders
    const range = getSalesPeriodRange(period);
    const currentOrders = filterOrdersInRange(allOrders, range.start, range.end);
    const revenueByCategory = aggregateCategoryRevenue(currentOrders, nameToCategory);

    const sorted = Object.entries(revenueByCategory)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

    const labels = sorted.map(([cat]) => formatCategoryLabel(cat));
    const data = sorted.map(([, v]) => v);
    const colors = sorted.map(([cat], i) => getCategoryColor(cat, i));
    const total = data.reduce((s, v) => s + v, 0);

    // Previous period (for compare)
    let previousTotal = 0;
    if (compareEnabled) {
        const prev = getPreviousPeriodRange(period);
        const prevOrders = filterOrdersInRange(allOrders, prev.start, prev.end);
        const prevRevenue = aggregateCategoryRevenue(prevOrders, nameToCategory);
        previousTotal = Object.values(prevRevenue).reduce((s, v) => s + v, 0);
    }

    // Subtitle — leads with the top category so the "one look" reading
    // is "Paint is 42% of revenue" instead of just a raw total.
    const subtitleEl = document.getElementById('ovCategorySubtitle');
    if (subtitleEl) {
        if (total === 0) {
            subtitleEl.textContent = `No sales in the ${getTopProductsPeriodLabel(period).toLowerCase()}`;
        } else {
            const topIdx = data.indexOf(Math.max(...data));
            const topLabel = labels[topIdx];
            const topPct = total > 0 ? ((data[topIdx] / total) * 100).toFixed(1) : '0.0';

            let text = `<strong>${topLabel}</strong> leads at ${topPct}% · `;
            text += `${sorted.length} categor${sorted.length === 1 ? 'y' : 'ies'} · `;
            text += `${formatAppCurrency(total)} total`;
            if (compareEnabled && previousTotal > 0) {
                const delta = ((total - previousTotal) / previousTotal) * 100;
                const sign = delta >= 0 ? '+' : '';
                const color = delta >= 0 ? '#4ade80' : '#f87171';
                text += ` · <strong style="color:${color}">${sign}${delta.toFixed(1)}%</strong> vs prev`;
            }
            subtitleEl.innerHTML = text;
        }
    }

    const isLight = document.documentElement.dataset.theme === 'light';
    const legendColor = isLight ? '#3d3831' : '#d6cfc0';

    // Custom plugin — writes "42%\nPaint" inside the donut hole.
    // Theme colors are read LIVE inside afterDraw so the text follows
    // the active theme even if it changes after the chart was created.
    const categoryCenterText = {
        id: 'categoryCenterText',
        afterDraw(chart) {
            const data = chart.data?.datasets?.[0]?.data || [];
            if (!data.length) return;
            const totalLocal = data.reduce((s, v) => s + (Number(v) || 0), 0);
            if (totalLocal === 0) return;

            const maxVal = Math.max(...data.map(v => Number(v) || 0));
            const topIdx = data.findIndex(v => (Number(v) || 0) === maxVal);
            if (topIdx < 0) return;

            const topLabel = chart.data.labels[topIdx] || '';
            const topPct = ((maxVal / totalLocal) * 100).toFixed(0);

            // Re-read theme at draw time — survives live theme toggles
            // and initial-boot races where data-theme hadn't been set yet.
            const light = document.documentElement.dataset.theme === 'light';
            const centerTitleColor = light ? '#100e0a' : '#fef9e7';
            const centerSubColor   = light ? '#756c5e' : '#b8ad9c';

            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            const cx = (chartArea.left + chartArea.right) / 2;
            const cy = (chartArea.top + chartArea.bottom) / 2;

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.fillStyle = centerTitleColor;
            ctx.font = '800 22px Inter, system-ui, sans-serif';
            ctx.fillText(`${topPct}%`, cx, cy - 10);

            ctx.fillStyle = centerSubColor;
            ctx.font = '600 11px Inter, system-ui, sans-serif';
            ctx.fillText(topLabel, cx, cy + 12);

            ctx.restore();
        }
    };

    ovCategoryChartInstance = upsertChart(ovCategoryChartInstance, canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderColor: isLight ? '#ffffff' : '#0f172a',
                borderWidth: 2,
                hoverOffset: 8
            }]
        },
        plugins: [categoryCenterText],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            // Reserve a little room so the legend column doesn't sit
            // flush against the canvas edge on narrow containers.
            layout: {
                padding: { top: 8, right: 8, bottom: 8, left: 8 }
            },
            plugins: {
                legend: {
                    position: 'right',
                    align: 'center',
                    labels: {
                        color: legendColor,
                        boxWidth: 12,
                        boxHeight: 12,
                        padding: 10,
                        font: { size: 12 },
                        generateLabels: (chart) => {
                            const ds = chart.data?.datasets?.[0];
                            if (!ds) return [];
                            const vals = ds.data || [];
                            const sum = vals.reduce((s, v) => s + (Number(v) || 0), 0);
                            return (chart.data.labels || []).map((label, i) => {
                                const v = Number(vals[i]) || 0;
                                const pct = sum > 0 ? ((v / sum) * 100).toFixed(1) : '0.0';
                                return {
                                    text: `${label}  ${pct}%`,
                                    fillStyle: ds.backgroundColor[i],
                                    strokeStyle: ds.backgroundColor[i],
                                    lineWidth: 0,
                                    hidden: false,
                                    index: i,
                                    fontColor: legendColor
                                };
                            });
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f1f5f9',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(22, 163, 74, 0.4)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: ctx => {
                            const val = ctx.parsed || 0;
                            const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
                            return `${formatAppCurrency(val)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function setupCategoryPeriodControls() {
    const periodSelect = document.getElementById('ovCategoryPeriod');
    const compareToggle = document.getElementById('ovCategoryCompare');

    if (periodSelect) {
        try {
            const saved = localStorage.getItem(CATEGORY_PERIOD_KEY);
            if (saved && periodSelect.querySelector(`option[value="${saved}"]`)) {
                periodSelect.value = saved;
            }
        } catch (e) {}
        periodSelect.addEventListener('change', () => {
            try { localStorage.setItem(CATEGORY_PERIOD_KEY, periodSelect.value); } catch (e) {}
            renderSalesByCategoryChart();
        });
    }

    if (compareToggle) {
        compareToggle.addEventListener('change', renderSalesByCategoryChart);
    }
}
// ---------- OVERVIEW: TOP PRODUCTS CHART (CONFIGURABLE PERIOD) ----------
let ovTopProductsChartInstance = null;
const TOP_PRODUCTS_PERIOD_KEY = 'pos_top_products_period';

function getTopProductsPeriod() {
    const select = document.getElementById('ovTopProductsPeriod');
    if (select?.value) return select.value;
    try {
        const saved = localStorage.getItem(TOP_PRODUCTS_PERIOD_KEY);
        if (saved) return saved;
    } catch (e) {}
    return '30d';
}

function getTopProductsPeriodLabel(period) {
    const labels = {
        '7d': 'Last 7 days',
        '30d': 'Last 30 days',
        '90d': 'Last 90 days',
        'this-month': 'This Month',
        'last-month': 'Last Month',
        'this-year': 'This Year',
        'last-year': 'Last Year'
    };
    return labels[period] || 'Last 30 days';
}

function aggregateUnitsByProduct(orders) {
    const counts = {};
    orders.forEach(order => {
        (order.items || []).forEach(item => {
            const name = item.name || 'Unknown';
            const qty = Number(item.quantity) || 0;
            if (qty <= 0) return;
            counts[name] = (counts[name] || 0) + qty;
        });
    });
    return counts;
}

function filterOrdersInRange(orders, start, end) {
    const startMs = start.getTime();
    const endMs = end.getTime();
    return orders.filter(o => {
        const ts = new Date(o.createdAt).getTime();
        return !isNaN(ts) && ts >= startMs && ts <= endMs;
    });
}

function renderTopProductsChart() {
    const canvas = document.getElementById('ovTopProductsChart');
    if (!canvas || typeof Chart === 'undefined') return;
    
    const period = getTopProductsPeriod();
    const compareEnabled = !!document.getElementById('ovTopProductsCompare')?.checked;
    
    const orders = readOrdersFromStorage();
    const range = getSalesPeriodRange(period);
    const currentOrders = filterOrdersInRange(orders, range.start, range.end);
    const currentCounts = aggregateUnitsByProduct(currentOrders);
    
    // Top 5 selected from CURRENT period only
    const sortedCurrent = Object.entries(currentCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    const labels = sortedCurrent.map(([name]) => name);
    const currentData = sortedCurrent.map(([, qty]) => qty);
    const currentTotal = currentData.reduce((s, v) => s + v, 0);
    
    // Compare: same 5 products, previous period units
    let previousData = null;
    let previousTotal = 0;
    if (compareEnabled) {
        const prev = getPreviousPeriodRange(period);
        const prevOrders = filterOrdersInRange(orders, prev.start, prev.end);
        const prevCounts = aggregateUnitsByProduct(prevOrders);
        previousData = labels.map(name => prevCounts[name] || 0);
        previousTotal = previousData.reduce((s, v) => s + v, 0);
    }
    
    // Subtitle
    const subtitleEl = document.getElementById('ovTopProductsSubtitle');
    if (subtitleEl) {
        if (labels.length === 0) {
            subtitleEl.textContent = `No sales in the ${getTopProductsPeriodLabel(period).toLowerCase()}`;
        } else {
            let text = `${currentOrders.length} order${currentOrders.length === 1 ? '' : 's'} · ${currentTotal} unit${currentTotal === 1 ? '' : 's'}`;
            if (compareEnabled && previousTotal > 0) {
                const delta = ((currentTotal - previousTotal) / previousTotal) * 100;
                const sign = delta >= 0 ? '+' : '';
                text += ` · ${sign}${delta.toFixed(1)}% vs prev`;
            }
            subtitleEl.textContent = text;
        }
    }
    
    const isLight = document.documentElement.dataset.theme === 'light';
    const gridColor = isLight ? 'rgba(120, 95, 55, 0.16)' : 'rgba(255, 255, 255, 0.08)';
    const tickColor = isLight ? '#756c5e' : '#94a3b8';
    
    const datasets = [{
        label: getTopProductsPeriodLabel(period),
        data: currentData,
        backgroundColor: 'rgba(22, 163, 74, 0.65)',
        borderColor: '#16a34a',
        borderWidth: 1,
        borderRadius: 6
    }];
    
    if (compareEnabled && previousData) {
        datasets.push({
            label: 'Previous period',
            data: previousData,
            backgroundColor: isLight ? 'rgba(148, 163, 184, 0.45)' : 'rgba(100, 116, 139, 0.55)',
            borderColor: isLight ? '#94a3b8' : '#64748b',
            borderWidth: 1,
            borderRadius: 6
        });
    }
    
    ovTopProductsChartInstance = upsertChart(ovTopProductsChartInstance, canvas, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: compareEnabled,
                    labels: {
                        color: tickColor,
                        boxWidth: 12,
                        boxHeight: 12,
                        padding: 12,
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f1f5f9',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(22, 163, 74, 0.4)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: ctx => {
                            const v = ctx.parsed.x || 0;
                            return `${ctx.dataset.label}: ${v} unit${v === 1 ? '' : 's'} sold`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: gridColor },
                    ticks: { color: tickColor, precision: 0 }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: tickColor }
                }
            }
        }
    });
}

function setupTopProductsPeriodControls() {
    const periodSelect = document.getElementById('ovTopProductsPeriod');
    const compareToggle = document.getElementById('ovTopProductsCompare');
    
    if (periodSelect) {
        try {
            const saved = localStorage.getItem(TOP_PRODUCTS_PERIOD_KEY);
            if (saved && periodSelect.querySelector(`option[value="${saved}"]`)) {
                periodSelect.value = saved;
            }
        } catch (e) {}
        
        periodSelect.addEventListener('change', () => {
            try { localStorage.setItem(TOP_PRODUCTS_PERIOD_KEY, periodSelect.value); } catch (e) {}
            renderTopProductsChart();
        });
    }
    
    if (compareToggle) {
        compareToggle.addEventListener('change', renderTopProductsChart);
    }
}


// ---------- OVERVIEW: CONFIGURABLE SALES CHART ----------
let ovSalesChartInstance = null;
const SALES_PERIOD_KEY = 'pos_sales_period';

/* ============================================================
   CHART REUSE HELPER
   Instead of destroy()+new Chart() on every refresh — which
   rebuilds the canvas, re-parses config, and replays the entry
   animation — mutate the existing instance and update in place.
   First paint still animates; refreshes are instant.
   ============================================================ */
function upsertChart(existing, canvas, config) {
    if (!existing) return new Chart(canvas, config);

    const savedAnim = existing.options?.animation;
    if (existing.options) existing.options.animation = false;

    existing.data.labels = config.data.labels;
    existing.data.datasets = config.data.datasets;
    if (config.options) existing.options = config.options;

    if (existing.options) existing.options.animation = savedAnim;
    existing.update('none');
    return existing;
}

function getSalesPeriodRange(period) {
    const now = new Date();
    let start, end, bucket;

    switch (period) {
        case '30d': {
            end = new Date(now);
            end.setHours(23, 59, 59, 999);
            start = new Date(now);
            start.setDate(start.getDate() - 29);
            start.setHours(0, 0, 0, 0);
            bucket = 'day';
            break;
        }
        case '90d': {
            end = new Date(now);
            end.setHours(23, 59, 59, 999);
            start = new Date(now);
            start.setDate(start.getDate() - 89);
            start.setHours(0, 0, 0, 0);
            bucket = 'week';
            break;
        }
        case 'this-month': {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date(now);
            end.setHours(23, 59, 59, 999);
            bucket = 'day';
            break;
        }
        case 'last-month': {
            start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            end = new Date(now.getFullYear(), now.getMonth(), 0);
            end.setHours(23, 59, 59, 999);
            bucket = 'day';
            break;
        }
        case 'this-year': {
            start = new Date(now.getFullYear(), 0, 1);
            end = new Date(now);
            end.setHours(23, 59, 59, 999);
            bucket = 'month';
            break;
        }
        case 'last-year': {
            start = new Date(now.getFullYear() - 1, 0, 1);
            end = new Date(now.getFullYear() - 1, 11, 31);
            end.setHours(23, 59, 59, 999);
            bucket = 'month';
            break;
        }
        case '7d':
        default: {
            end = new Date(now);
            end.setHours(23, 59, 59, 999);
            start = new Date(now);
            start.setDate(start.getDate() - 6);
            start.setHours(0, 0, 0, 0);
            bucket = 'day';
            break;
        }
    }

    return { start, end, bucket };
}

function getPreviousPeriodRange(period) {
    const { start, end, bucket } = getSalesPeriodRange(period);
    const durationMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);
    return { start: prevStart, end: prevEnd, bucket };
}

function buildSalesBuckets(start, end, bucket) {
    const buckets = [];

    if (bucket === 'day') {
        const d = new Date(start);
        d.setHours(0, 0, 0, 0);
        while (d <= end) {
            const dayStart = new Date(d);
            const dayEnd = new Date(d);
            dayEnd.setHours(23, 59, 59, 999);
            buckets.push({
                label: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
                start: dayStart,
                end: dayEnd
            });
            d.setDate(d.getDate() + 1);
        }
    } else if (bucket === 'week') {
        const d = new Date(start);
        d.setHours(0, 0, 0, 0);
        // Snap to Monday
        const dayOfWeek = d.getDay();
        const diff = (dayOfWeek + 6) % 7;
        d.setDate(d.getDate() - diff);
        while (d <= end) {
            const wkStart = new Date(d);
            const wkEnd = new Date(d);
            wkEnd.setDate(wkEnd.getDate() + 6);
            wkEnd.setHours(23, 59, 59, 999);
            buckets.push({
                label: `Wk ${wkStart.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`,
                start: wkStart,
                end: wkEnd
            });
            d.setDate(d.getDate() + 7);
        }
    } else if (bucket === 'month') {
        const d = new Date(start.getFullYear(), start.getMonth(), 1);
        while (d <= end) {
            const mStart = new Date(d.getFullYear(), d.getMonth(), 1);
            const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
            mEnd.setHours(23, 59, 59, 999);
            buckets.push({
                label: mStart.toLocaleDateString('en-PH', { month: 'short' }),
                start: mStart,
                end: mEnd
            });
            d.setMonth(d.getMonth() + 1);
        }
    }

    return buckets;
}

function sumOrdersInRange(orders, rangeStart, rangeEnd) {
    const startMs = rangeStart.getTime();
    const endMs = rangeEnd.getTime();
    let total = 0;
    for (const o of orders) {
        const ts = new Date(o.createdAt).getTime();
        if (isNaN(ts)) continue;
        if (ts >= startMs && ts <= endMs) {
            total += Number(o.total) || 0;
        }
    }
    return total;
}

function getPeriodLabel(period) {
    const labels = {
        '7d': 'Last 7 days',
        '30d': 'Last 30 days',
        '90d': 'Last 90 days',
        'this-month': 'This Month',
        'last-month': 'Last Month',
        'this-year': 'This Year',
        'last-year': 'Last Year'
    };
    return labels[period] || 'Last 7 days';
}

function formatSalesSummary(total, buckets, bucketType, compareTotal, compareEnabled) {
    const bucketUnit = bucketType === 'day' ? 'day' : bucketType === 'week' ? 'week' : 'month';
    const avg = buckets.length > 0 ? total / buckets.length : 0;
    const peak = buckets.length > 0 ? Math.max(...buckets.map(b => b.value)) : 0;

    let summary = `<strong>Total:</strong> ${formatAppCurrency(total)} · `;
    summary += `<strong>Avg/${bucketUnit}:</strong> ${formatAppCurrency(avg)} · `;
    summary += `<strong>Peak:</strong> ${formatAppCurrency(peak)}`;

    if (compareEnabled && compareTotal > 0) {
        const delta = ((total - compareTotal) / compareTotal) * 100;
        const sign = delta >= 0 ? '+' : '';
        const color = delta >= 0 ? '#4ade80' : '#f87171';
        summary += ` · <strong style="color:${color}">${sign}${delta.toFixed(1)}%</strong> vs prev`;
    }

    return summary;
}

function renderSalesChart() {
    const canvas = document.getElementById('ovSalesChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const periodSelect = document.getElementById('ovSalesPeriod');
    const compareToggle = document.getElementById('ovSalesCompare');
    const period = periodSelect?.value || localStorage.getItem(SALES_PERIOD_KEY) || '7d';
    const compareEnabled = !!compareToggle?.checked;

    const range = getSalesPeriodRange(period);
    const buckets = buildSalesBuckets(range.start, range.end, range.bucket);
    const orders = readOrdersFromStorage();

    const labels = buckets.map(b => b.label);
    const data = buckets.map(b => sumOrdersInRange(orders, b.start, b.end));
    const total = data.reduce((s, v) => s + v, 0);

    let compareData = null;
    let compareTotal = 0;
    if (compareEnabled) {
        const prev = getPreviousPeriodRange(period);
        const prevBuckets = buildSalesBuckets(prev.start, prev.end, prev.bucket);
        // Align by index (both should have same bucket count for equivalent ranges)
        compareData = buckets.map((_, i) => {
            const pb = prevBuckets[i];
            if (!pb) return 0;
            return sumOrdersInRange(orders, pb.start, pb.end);
        });
        compareTotal = compareData.reduce((s, v) => s + v, 0);
    }

    // Update summary line
    const summaryEl = document.getElementById('ovSalesChartSummary');
    if (summaryEl) {
        const decorated = buckets.map((b, i) => ({ value: data[i] }));
        summaryEl.innerHTML = formatSalesSummary(total, decorated, range.bucket, compareTotal, compareEnabled);
    }

    const isLight = document.documentElement.dataset.theme === 'light';
    const gridColor = isLight ? 'rgba(120, 95, 55, 0.16)' : 'rgba(255, 255, 255, 0.08)';
    const tickColor = isLight ? '#756c5e' : '#94a3b8';

    const datasets = [{
        label: getPeriodLabel(period),
        data,
        borderColor: '#16a34a',
        backgroundColor: 'rgba(22, 163, 74, 0.15)',
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#16a34a',
        pointBorderColor: '#16a34a',
        pointRadius: data.length > 30 ? 0 : 4,
        pointHoverRadius: 6
    }];

    if (compareEnabled && compareData) {
        datasets.push({
            label: 'Previous period',
            data: compareData,
            borderColor: isLight ? '#94a3b8' : '#64748b',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 4],
            fill: false,
            tension: 0.35,
            pointBackgroundColor: isLight ? '#94a3b8' : '#64748b',
            pointBorderColor: isLight ? '#94a3b8' : '#64748b',
            pointRadius: data.length > 30 ? 0 : 3,
            pointHoverRadius: 5
        });
    }

    ovSalesChartInstance = upsertChart(ovSalesChartInstance, canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: compareEnabled,
                    labels: {
                        color: tickColor,
                        boxWidth: 12,
                        boxHeight: 12,
                        padding: 12,
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f1f5f9',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(22, 163, 74, 0.4)',
                    borderWidth: 1,
                    padding: 10,
                    displayColors: compareEnabled,
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${formatAppCurrency(ctx.parsed.y)}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: gridColor },
                    ticks: {
                        color: tickColor,
                        callback: v => '₱' + Number(v).toLocaleString('en-PH')
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: tickColor,
                        maxRotation: data.length > 14 ? 45 : 0,
                        autoSkip: true,
                        maxTicksLimit: 12
                    }
                }
            }
        }
    });
}

function setupSalesPeriodControls() {
    const periodSelect = document.getElementById('ovSalesPeriod');
    const compareToggle = document.getElementById('ovSalesCompare');

    // Restore saved preference
    if (periodSelect) {
        const saved = localStorage.getItem(SALES_PERIOD_KEY);
        if (saved && periodSelect.querySelector(`option[value="${saved}"]`)) {
            periodSelect.value = saved;
        }
        periodSelect.addEventListener('change', () => {
            try { localStorage.setItem(SALES_PERIOD_KEY, periodSelect.value); } catch (e) {}
            renderSalesChart();
        });
    }

    if (compareToggle) {
        compareToggle.addEventListener('change', renderSalesChart);
    }
}

// ---------- OVERVIEW: RECENT ACTIVITY ----------
function actionIconFor(action) {
    switch (String(action || '').toLowerCase()) {
        case 'create': return 'fa-plus-circle';
        case 'update': return 'fa-edit';
        case 'delete': return 'fa-trash';
        case 'login':  return 'fa-sign-in-alt';
        case 'logout': return 'fa-sign-out-alt';
        case 'export': return 'fa-download';
        case 'view':   return 'fa-eye';
        default:       return 'fa-info-circle';
    }
}

function actionColorFor(action) {
    switch (String(action || '').toLowerCase()) {
        case 'create': return 'green';
        case 'update': return 'blue';
        case 'delete': return 'orange';
        case 'login':  return 'green';
        case 'logout': return 'orange';
        case 'export': return 'purple';
        case 'view':   return 'blue';
        default:       return 'blue';
    }
}

function getRelativeTime(timestamp) {
    const then = new Date(timestamp).getTime();
    if (!then || isNaN(then)) return '';
    const sec = Math.floor((Date.now() - then) / 1000);
    if (sec < 0) return 'just now';
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
    return new Date(timestamp).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function renderRecentActivity() {
    const listEl = document.getElementById('ovActivityList');
    if (!listEl) return;

    const logs = readStoredRecords(AUDIT_KEY);
    const orders = readOrdersFromStorage();
    let items = [];

    // Primary source: audit logs (they capture orders, inventory, customers, settings, auth)
    if (logs.length > 0) {
        items = logs.slice(0, 6).map(log => ({
            ts: new Date(log.timestamp).getTime(),
            icon: actionIconFor(log.action),
            color: actionColorFor(log.action),
            html: `<strong>${escapeCustomerText(log.user)}</strong> · ${escapeCustomerText(log.description)}`,
            time: getRelativeTime(log.timestamp)
        }));
    }
    // Fallback: recent orders if audit logs are empty
    else if (orders.length > 0) {
        items = orders.slice(0, 6).map(order => ({
            ts: new Date(order.createdAt).getTime(),
            icon: 'fa-shopping-cart',
            color: 'blue',
            html: `<strong>${escapeCustomerText(order.customerName || 'Walk-in customer')}</strong> placed an order · ${formatAppCurrency(order.total)}`,
            time: getRelativeTime(order.createdAt)
        }));
    }

    if (items.length === 0) {
        listEl.innerHTML = `
            <div class="activity-item" style="justify-content: center; color: var(--text-secondary); font-size: 14px; padding: 1.5rem 0;">
                <span>No recent activity yet</span>
            </div>
        `;
        return;
    }

    listEl.innerHTML = items.map(item => `
        <div class="activity-item">
            <div class="activity-icon ${item.color}">
                <i class="fas ${item.icon}"></i>
            </div>
            <div class="activity-content">
                <p>${item.html}</p>
                <span class="activity-time">${item.time}</span>
            </div>
        </div>
    `).join('');
}

// ---------- OVERVIEW: LOW STOCK ALERTS ----------
function getStockStatusForWidget(product) {
    const qty = Number(product.quantity) || 0;
    const min = Number(product.minStock ?? product.min_stock ?? 0) || 0;
    if (qty === 0) return 'out_of_stock';
    if (qty <= min) return 'low_stock';
    return 'in_stock';
}

function renderLowStockWidget() {
    const listEl = document.getElementById('ovLowStockList');
    if (!listEl) return;
    
    const products = window.getInventorySnapshot?.() || [];
    
    // Filter to low/out-of-stock products, sorted by urgency
    const sliceOf = (p) => {
        const v = p.variants;
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) {
            return Object.entries(v)
                .filter(([, val]) => val && typeof val === 'object')
                .map(([k, val]) => {
                    const [size, brand] = String(k).split('::');
                    return { size: size || '', brand: brand || '', stock: Number(val.stock) || 0 };
                });
        }
        const ss = p.sizeStocks;
        if (ss && typeof ss === 'object' && !Array.isArray(ss) && Object.keys(ss).length) {
            return Object.entries(ss).map(([size, stock]) => ({ size, brand: '', stock: Number(stock) || 0 }));
        }
        const bs = p.brandStocks;
        if (bs && typeof bs === 'object' && !Array.isArray(bs) && Object.keys(bs).length) {
            return Object.entries(bs).map(([brand, stock]) => ({ size: '', brand, stock: Number(stock) || 0 }));
        }
        return [{ size: '', brand: '', stock: Number(p.quantity) || 0 }];
    };

    const alerts = products
        .map(p => {
            const min = Number(p.minStock ?? p.min_stock ?? 0) || 0;
            const slices = sliceOf(p);
            const lowSlices = slices.filter(s => s.stock <= min);
            const status = slices.every(s => s.stock === 0) ? 'out_of_stock'
                          : lowSlices.length ? 'low_stock'
                          : 'in_stock';
            return {
                product: p,
                status,
                qty: slices.reduce((t, s) => t + s.stock, 0),
                min,
                lowSlices,
            };
        })
        .filter(item => item.status !== 'in_stock')
        .sort((a, b) => {
            if (a.status !== b.status) return a.status === 'out_of_stock' ? -1 : 1;
            return (a.qty - a.min) - (b.qty - b.min);
        })
        .slice(0, 6);
    
    const subtitleEl = document.getElementById('ovLowStockSubtitle');
    if (subtitleEl) {
        const outCount = alerts.filter(a => a.status === 'out_of_stock').length;
        const lowCount = alerts.filter(a => a.status === 'low_stock').length;
        subtitleEl.textContent = alerts.length > 0 ?
            `${outCount} out · ${lowCount} low` :
            '';
    }
    
    if (alerts.length === 0) {
        listEl.innerHTML = `
            <div class="activity-item" style="justify-content: center; color: var(--text-secondary); font-size: 14px; padding: 1.5rem 0;">
                <span><i class="fas fa-check-circle" style="color: #4ade80; margin-right: 6px;"></i> All stock levels are healthy</span>
            </div>
        `;
        return;
    }
    
    listEl.innerHTML = alerts.map(({ product, status, qty, min, lowSlices }) => {
        const isOut = status === 'out_of_stock';
        const color = isOut ? 'orange' : 'blue';
        const icon = isOut ? 'fa-times-circle' : 'fa-exclamation-triangle';
        const badgeClass = isOut ? 'stock-badge out-of-stock' : 'stock-badge low-stock';

        const sliceNames = (lowSlices || [])
            .map(s => [s.size, s.brand].filter(Boolean).join(' · '))
            .filter(Boolean);
        const badgeLabel = isOut
            ? 'Out of Stock'
            : (sliceNames.length > 1 ? `${sliceNames.length} low` : `Low: ${qty} / ${min}`);

        const detail = sliceNames.length && sliceNames.length <= 3
            ? `Low: ${sliceNames.join(', ')}`
            : `Product Code: ${escapeCustomerText(product.sku || 'N/A')} · Qty: ${qty}`;

        return `
            <div class="activity-item" style="cursor: pointer;" onclick="window.navigateToPage?.('inventory')">
                <div class="activity-icon ${color}">
                    <i class="fas ${icon}"></i>
                </div>
                <div class="activity-content" style="flex: 1;">
                    <p><strong>${escapeCustomerText(product.name)}</strong></p>
                    <span class="activity-time">${detail}</span>
                </div>
                <span class="${badgeClass}">${badgeLabel}</span>
            </div>
        `;
    }).join('');
}

// ---------- OVERVIEW: HOURLY SALES HEATMAP ----------
function renderHourlyHeatmap() {
    const container = document.getElementById('ovHourlyHeatmap');
    if (!container) return;
    
    const orders = readOrdersFromStorage();
    const monthAgoTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = orders.filter(o => {
        const ts = new Date(o.createdAt).getTime();
        return !isNaN(ts) && ts >= monthAgoTime;
    });
    
    // Business-hours window — adjust if your shop opens earlier/later
    const START_HOUR = 6;
    const END_HOUR = 22;
    const HOURS = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) HOURS.push(h);
    
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    // grid[dayIndex][hourIndex] = total sales
    const grid = DAYS.map(() => HOURS.map(() => 0));
    let maxValue = 0;
    let grandTotal = 0;
    
    recent.forEach(order => {
        const d = new Date(order.createdAt);
        const dayIdx = d.getDay();
        const hour = d.getHours();
        if (hour < START_HOUR || hour > END_HOUR) return;
        const hourIdx = hour - START_HOUR;
        const total = Number(order.total) || 0;
        grid[dayIdx][hourIdx] += total;
        grandTotal += total;
        if (grid[dayIdx][hourIdx] > maxValue) maxValue = grid[dayIdx][hourIdx];
    });
    
    const subtitleEl = document.getElementById('ovHourlySubtitle');
    if (subtitleEl) {
        subtitleEl.textContent = maxValue > 0 ?
            `${recent.length} order${recent.length === 1 ? '' : 's'} · ${formatAppCurrency(grandTotal)} total` :
            'No sales in the last 30 days';
    }
    
    const isLight = document.documentElement.dataset.theme === 'light';
    const hourLabelColor = isLight ? '#756c5e' : '#94a3b8';
    const dayLabelColor = isLight ? '#3d3831' : '#cbd5e1';
    
    function formatHour(h) {
        if (h === 0) return '12a';
        if (h < 12) return h + 'a';
        if (h === 12) return '12p';
        return (h - 12) + 'p';
    }
    
    function cellColor(value) {
        if (value === 0 || maxValue === 0) {
            return isLight ? 'rgba(148, 163, 184, 0.08)' : 'rgba(255, 255, 255, 0.03)';
        }
        const intensity = Math.pow(value / maxValue, 0.65); // gamma for better spread
        const alpha = 0.15 + intensity * 0.85;
        return `rgba(22, 163, 74, ${alpha.toFixed(2)})`;
    }
    
    // Build the table
    let html = '<div style="overflow-x: auto; padding-bottom: 0.5rem;">';
    html += '<table style="border-collapse: separate; border-spacing: 2px; width: 100%; min-width: 720px; font-size: 11px;">';
    
    // Header
    html += '<thead><tr>';
    html += `<th style="text-align: left; padding: 4px 8px; color: ${hourLabelColor}; font-weight: 500;"></th>`;
    HOURS.forEach(h => {
        html += `<th style="padding: 4px 0; color: ${hourLabelColor}; font-weight: 500; text-align: center; min-width: 30px;">${formatHour(h)}</th>`;
    });
    html += '</tr></thead>';
    
    // Body
    html += '<tbody>';
    DAYS.forEach((day, dayIdx) => {
        html += '<tr>';
        html += `<td style="text-align: left; padding: 4px 8px; color: ${dayLabelColor}; font-weight: 600; white-space: nowrap;">${day}</td>`;
        HOURS.forEach((hour, hourIdx) => {
            const val = grid[dayIdx][hourIdx];
            const bg = cellColor(val);
            const title = `${day} ${formatHour(hour)}: ${formatAppCurrency(val)}`;
            html += `<td title="${escapeCustomerText(title)}" style="padding: 0; text-align: center;"><div style="width: 100%; height: 22px; background: ${bg}; border-radius: 4px;"></div></td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table></div>';
    
    // Legend
    html += `
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 10px; font-size: 11px; color: ${hourLabelColor};">
            <span>Low</span>
            <div style="display: flex; gap: 3px;">
                <div style="width: 16px; height: 10px; border-radius: 2px; background: rgba(22, 163, 74, 0.2);"></div>
                <div style="width: 16px; height: 10px; border-radius: 2px; background: rgba(22, 163, 74, 0.4);"></div>
                <div style="width: 16px; height: 10px; border-radius: 2px; background: rgba(22, 163, 74, 0.6);"></div>
                <div style="width: 16px; height: 10px; border-radius: 2px; background: rgba(22, 163, 74, 0.8);"></div>
                <div style="width: 16px; height: 10px; border-radius: 2px; background: rgba(22, 163, 74, 1);"></div>
            </div>
            <span>High</span>
        </div>
    `;
    
    container.innerHTML = html;
}


// Coalesces rapid refreshOverview() calls into a single trailing render.
// Firestore's onSnapshot fires its initial snapshot immediately on subscribe,
// so a single login produces one refresh per subscription (orders, customers,
// inventory) plus one chained from the inventory-products-loaded event.
// Without debouncing that's 4-5 full chart-destroying rebuilds in ~300ms,
// which also fires 8-10 AI proxy calls and trips Gemini's 15 RPM limit.
let __ovRefreshTimer = null;

function scheduleOverviewRefresh(delayMs = 250) {
    if (__ovRefreshTimer) clearTimeout(__ovRefreshTimer);
    __ovRefreshTimer = setTimeout(() => {
        __ovRefreshTimer = null;
        refreshOverview();
    }, delayMs);
}

function refreshOverview() {
    refreshOverviewStats();
    renderSalesChart();
    renderTopProductsChart();
    renderSalesByCategoryChart();
    renderLowStockWidget();
    renderHourlyHeatmap();
    renderRecentActivity();
    // Only hit the AI proxy when the Overview page is actually visible.
    // Background refreshes (sales, inventory snapshots) skip the network
    // entirely; the next visit to Overview triggers a fresh load via
    // navigateToPage('overview').
    if (document.getElementById('page-overview')?.classList.contains('active')) {
        refreshAiCards();
    }
}

// ---------- AI FEATURES ----------
async function refreshAiCards() {
    if (!window.POS_AI) return;

    const forecastEl = document.getElementById('aiForecastContent');
    const forecastSub = document.getElementById('aiForecastSubtitle');
    const restockEl = document.getElementById('aiRestockContent');
    const restockSub = document.getElementById('aiRestockSubtitle');

    if (forecastEl) {
        try {
            const data = await window.POS_AI.forecastSales();
            renderAiForecast(forecastEl, forecastSub, data);
        } catch (err) {
            forecastEl.innerHTML = `<div class="ai-loading" style="color:#f87171;">⚠️ ${escapeCustomerText(err.message || 'Forecast failed')}</div>`;
            if (forecastSub) forecastSub.textContent = 'Unavailable';
        }
    }

    if (restockEl) {
        try {
            const data = await window.POS_AI.restockPriority();
            renderAiRestock(restockEl, restockSub, data);
        } catch (err) {
            restockEl.innerHTML = `<div class="ai-loading" style="color:#f87171;">⚠️ ${escapeCustomerText(err.message || 'Restock ranking failed')}</div>`;
            if (restockSub) restockSub.textContent = 'Unavailable';
        }
    }
}

/* ============================================================
   AI FORECAST — Chart.js line chart with area fill.
   Chart.js is already loaded for the overview charts; we reuse
   it here. Instance is cached module-level and destroyed on
   every render so theme switches and scenario changes rebuild
   cleanly without leaking canvases.
   ============================================================ */

let aiForecastChartInstance = null;

function _destroyAiForecastChart() {
    if (aiForecastChartInstance) {
        try { aiForecastChartInstance.destroy(); } catch (e) {}
        aiForecastChartInstance = null;
    }
}

/* Soft glow behind the final (endpoint) dot — draws the eye to
   "where we're heading," which is the whole point of a forecast.
   `datasetIndex` targets the point-estimate dataset, which may not
   be index 0 when the confidence band is drawn. */
function _aiForecastGlowPlugin(accentRgb, datasetIndex = 0) {
    return {
        id: 'aiForecastGlow',
        afterDatasetsDraw(chart) {
            const meta = chart.getDatasetMeta(datasetIndex);
            if (!meta?.data?.length) return;
            const last = meta.data[meta.data.length - 1];
            if (!last) return;
            const { ctx } = chart;
            ctx.save();
            ctx.beginPath();
            ctx.arc(last.x, last.y, 18, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${accentRgb}, 0.08)`;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(last.x, last.y, 11, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${accentRgb}, 0.18)`;
            ctx.fill();
            ctx.restore();
        }
    };
}

/* Faint dashed baseline at y=0 for visual anchoring. */
function _aiForecastBaselinePlugin(accentRgb) {
    return {
        id: 'aiForecastBaseline',
        beforeDatasetsDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea || !scales?.y) return;
            const y = scales.y.getPixelForValue(0);
            if (!Number.isFinite(y)) return;
            ctx.save();
            ctx.strokeStyle = `rgba(${accentRgb}, 0.18)`;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(chartArea.left, y);
            ctx.lineTo(chartArea.right, y);
            ctx.stroke();
            ctx.restore();
        }
    };
}

function _renderAiForecastChart(canvas, payload) {
    _destroyAiForecastChart();
    if (!canvas || typeof Chart === 'undefined') return;

    const { dates, revenues, lowers = null, uppers = null } = payload;

    // Band is only drawn when both bound arrays are present and aligned.
    const hasBand =
        Array.isArray(lowers) && Array.isArray(uppers) &&
        lowers.length === revenues.length &&
        uppers.length === revenues.length &&
        lowers.every(v => Number.isFinite(v)) &&
        uppers.every(v => Number.isFinite(v));

    const isLight = document.documentElement.dataset.theme === 'light';

    const accent      = isLight ? '#E0A300' : '#FACC15';
    const accentRgb   = isLight ? '224, 163, 0' : '250, 204, 21';
    const tickColor   = isLight ? '#756c5e' : '#8a8275';
    const pointBorder = isLight ? '#ffffff' : '#141210';
    const tooltipBg   = isLight ? 'rgba(255, 253, 247, 0.98)' : 'rgba(20, 18, 16, 0.96)';
    const tooltipText = isLight ? '#100e0a' : '#fef9e7';
    const tooltipSub  = isLight ? '#756c5e' : '#d6cfc0';

    // Y-axis must cover the upper band, not just the point line,
    // otherwise the band's top edge gets clipped.
    const maxVal = Math.max(...revenues, ...(hasBand ? uppers : []), 1);

    const pointRadius = revenues.map((_, i) => i === revenues.length - 1 ? 8 : 4.5);
    const pointHover  = revenues.map((_, i) => i === revenues.length - 1 ? 11 : 7);

    const labels = dates.map(d => [
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
        String(d.getDate())
    ]);

    const datasets = [];

    // --- Confidence band (drawn first, sits behind the line) ---
    // Chart.js semantics: `fill: '-1'` fills from the current dataset
    // down to the previous one. So we push lower, then upper, and the
    // upper's fill creates the band.
    if (hasBand) {
        datasets.push({
            label: '_bandLower',
            data: lowers,
            borderColor: 'transparent',
            borderWidth: 0,
            pointRadius: 0,
            pointHoverRadius: 0,
            pointHitRadius: 0,
            tension: 0.35,
            fill: false
        });
        datasets.push({
            label: '_bandUpper',
            data: uppers,
            borderColor: 'transparent',
            borderWidth: 0,
            pointRadius: 0,
            pointHoverRadius: 0,
            pointHitRadius: 0,
            tension: 0.35,
            fill: '-1',
            backgroundColor: `rgba(${accentRgb}, 0.14)`
        });
    }

    // --- Point-estimate line (drawn last, sits on top of the band) ---
    datasets.push({
        label: 'forecast',
        data: revenues,
        borderColor: accent,
        borderWidth: 2.5,
        tension: 0.35,
        // When the band is visible, the band already fills the area.
        // When it's not, fall back to the original gradient fill.
        fill: hasBand ? false : true,
        backgroundColor: hasBand ? 'transparent' : (ctx) => {
            const { chart } = ctx;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return 'transparent';
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0,   `rgba(${accentRgb}, 0.32)`);
            g.addColorStop(0.6, `rgba(${accentRgb}, 0.10)`);
            g.addColorStop(1,   `rgba(${accentRgb}, 0)`);
            return g;
        },
        pointRadius,
        pointHoverRadius: pointHover,
        pointBackgroundColor: accent,
        pointBorderColor: pointBorder,
        pointBorderWidth: 2,
        pointHitRadius: 18
    });

    // The point dataset is always last in the array. Pass its index
    // to the glow plugin so the halo lands on the correct dot.
    const pointDatasetIndex = datasets.length - 1;

    aiForecastChartInstance = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        plugins: [
            _aiForecastGlowPlugin(accentRgb, pointDatasetIndex),
            _aiForecastBaselinePlugin(accentRgb)
        ],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 16, right: 14, left: 4, bottom: 0 } },
            animation: { duration: 550, easing: 'easeOutCubic' },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: tooltipBg,
                    titleColor: tooltipText,
                    bodyColor: tooltipSub,
                    borderColor: `rgba(${accentRgb}, 0.35)`,
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false,
                    titleFont: { size: 11, weight: '600' },
                    bodyFont:  { size: 14, weight: '700' },
                    // Band datasets have no visible values — filter them
                    // out so the tooltip shows only the point estimate.
                    filter: item => item.datasetIndex === pointDatasetIndex,
                    callbacks: {
                        title: items => {
                            const d = dates[items[0].dataIndex];
                            return d.toLocaleDateString('en-PH', {
                                weekday: 'long', month: 'short', day: 'numeric'
                            });
                        },
                        label: ctx => {
                            const point = '₱' + Math.round(Number(ctx.parsed.y) || 0).toLocaleString('en-PH');
                            if (!hasBand) return point;
                            const i = ctx.dataIndex;
                            const lo = '₱' + Math.round(lowers[i]).toLocaleString('en-PH');
                            const hi = '₱' + Math.round(uppers[i]).toLocaleString('en-PH');
                            return [point, `Range: ${lo} – ${hi}`];
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        color: tickColor,
                        font: { size: 10, weight: '600' },
                        padding: 8
                    }
                },
                y: {
                    display: false,
                    beginAtZero: true,
                    suggestedMax: maxVal * 1.20,
                    grid: { color: 'transparent', drawTicks: false }
                }
            }
        }
    });
}

function renderAiForecast(container, subtitleEl, data) {
    if (!container) return;

    // Destroy the old instance BEFORE nuking the DOM, so it never
    // points at a detached canvas.
    _destroyAiForecastChart();

    const list = Array.isArray(data.forecast) ? data.forecast : [];
    const raw = data._raw || {};

    if (!list.length) {
        container.innerHTML = `<div class="ai-loading">${escapeCustomerText(data.summary || 'No forecast available yet.')}</div>`;
        if (subtitleEl) subtitleEl.textContent = 'Not enough data';
        return;
    }

    const fmt = v => '₱' + Math.round(Number(v) || 0).toLocaleString('en-PH');

    const revenues = list.map(d => Number(d.revenue) || 0);
    const total = revenues.reduce((s, v) => s + v, 0);
    const avg = total / revenues.length;
    const max = Math.max(...revenues, 1);
    const min = Math.min(...revenues);

    const spread = max - min;
    const isFlat = max > 0 && (spread / max) < 0.01;

    // Trend describes what the STORE is doing, not what the forecast
    // shape looks like. A flat forecast produced by historical_mean
    // means the data was too noisy to model — that is not "stable".
    const mapeNum = Number(raw.validation_mape);
    const lowConfidence = Number.isFinite(mapeNum) && mapeNum > 30;

    let trend = 'stable';
    if (lowConfidence) {
        trend = 'uncertain';
    } else if (revenues.length >= 2 && !isFlat) {
        const first = revenues[0];
        const last = revenues[revenues.length - 1];
        trend = last > first * 1.02 ? 'up'
              : last < first * 0.98 ? 'down'
              : 'stable';
    }

    let vsLastPct = null;
    // Backend renamed this key to `_14` when the series widened from
    // 7 to 14 days. Keep the old key as a fallback so cached responses
    // from before the upgrade still resolve.
    const series = raw.daily_series_last_14 || raw.daily_series_last_7 || [];
    if (Array.isArray(series) && series.length === 14) {
        // Compare the 7-day forecast total to the last 7 days of
        // actuals (the tail of the 14-day window).
        const last7 = series.slice(-7);
        const lastActual = last7.reduce((s, d) => s + (Number(d.revenue) || 0), 0);
        if (lastActual > 0) vsLastPct = ((total - lastActual) / lastActual) * 100;
    } else if (Array.isArray(series) && series.length === 7) {
        // Legacy fallback for pre-upgrade cached responses.
        const lastActual = series.reduce((s, d) => s + (Number(d.revenue) || 0), 0);
        if (lastActual > 0) vsLastPct = ((total - lastActual) / lastActual) * 100;
    }

    if (subtitleEl) {
        const arrow = trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→';
        let text = `${arrow} Expected: ${fmt(total)} over 7 days`;
        if (vsLastPct != null) {
            const sign = vsLastPct >= 0 ? '+' : '';
            text += ` · ${sign}${vsLastPct.toFixed(1)}% vs last 7`;
        }
        subtitleEl.textContent = text;
    }

    const modelLabel = raw.method_label
        || (raw.method === 'linear_regression' ? 'Linear regression'
        : raw.method === 'seasonal_naive' ? 'Seasonal naive (same weekday last week)'
        : raw.method === 'moving_average' ? '7-day weighted moving average'
        : raw.method === 'historical_mean' ? 'Historical daily average'
        : 'Statistical forecast');

    const mae = raw.validation_mae;
    const mape = raw.validation_mape;
    // Lead with MAPE when it's high — the peso error understates
    // uncertainty on bimodal sales data where ₱840 can be 1800% of
    // a slow day's revenue.
    // `mapeNum` and `lowConfidence` are already declared above —
    // do NOT redeclare them here.
    const hasMape = mape != null && Number.isFinite(mapeNum);
    const hasMae  = mae  != null && Number.isFinite(Number(mae));

    let errorPill = '';
    if (hasMape && mapeNum > 30) {
        errorPill = `<span class="ai-pill ai-pill-error ai-pill-error-high">± ${mapeNum.toFixed(1)}% typical error</span>`;
    } else if (hasMape && hasMae) {
        errorPill = `<span class="ai-pill ai-pill-error">± ${fmt(mae)} error · ${mapeNum.toFixed(1)}% MAPE</span>`;
    } else if (hasMae) {
        errorPill = `<span class="ai-pill ai-pill-error">± ${fmt(mae)} error</span>`;
    }

    const trendCls = trend === 'up' ? 'ai-pill-up'
                    : trend === 'down' ? 'ai-pill-down'
                    : trend === 'uncertain' ? 'ai-pill-uncertain'
                    : 'ai-pill-flat';
    const trendIcon = trend === 'up' ? '↗'
                    : trend === 'down' ? '↘'
                    : trend === 'uncertain' ? '⚠'
                    : '→';
    const trendText = trend === 'up' ? 'Upward'
                    : trend === 'down' ? 'Downward'
                    : trend === 'uncertain' ? 'Low confidence'
                    : 'Stable';

    const summaryText = String(data.summary || '').replace(/\bPHP\s?/gi, '₱');

    // Chart region. Flat forecasts keep the CSS fallback — a
    // horizontal line chart for 7 identical values is noise.
    let chartHtml = '';
    if (isFlat) {
        chartHtml = `
            <div class="ai-forecast-flat">
                <div class="ai-forecast-flat-line"></div>
                <div class="ai-forecast-flat-dot"></div>
                <div class="ai-forecast-flat-label">${fmt(avg)} / day</div>
            </div>
            <div class="ai-forecast-flat-note">All ${list.length} days projected at the same value — no clear trend to show.</div>
        `;
    } else {
        chartHtml = `
            <div class="ai-forecast-canvas-wrap">
                <canvas id="aiForecastChart" role="img"
                        aria-label="7-day revenue forecast line chart"></canvas>
            </div>
        `;
    }

    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const labels = list.map(d => {
        const dt = new Date(String(d.date) + 'T00:00:00');
        if (isNaN(dt.getTime())) return `<span>${escapeCustomerText(d.date)}</span>`;
        return `<span>${WEEKDAYS[dt.getDay()]} ${dt.getDate()}</span>`;
    }).join('');

    container.innerHTML = `
        <div class="ai-forecast-pills">
            <span class="ai-pill ai-pill-model">📊 ${escapeCustomerText(modelLabel)}</span>
            ${errorPill}
            <span class="ai-pill ${trendCls}">${trendIcon} ${trendText}</span>
        </div>
        <div class="ai-forecast-summary${lowConfidence ? ' ai-forecast-summary-warn' : ''}">${escapeCustomerText(summaryText)}</div>
        ${chartHtml}
        ${isFlat ? `<div class="ai-forecast-xaxis">${labels}</div>` : ''}
        <div class="ai-forecast-totals">
            <span>Avg/day: <strong>${fmt(avg)}</strong></span>
            <span>Total: <strong>${fmt(total)}</strong></span>
        </div>
    `;

    // Create the Chart.js instance after the canvas is in the DOM.
    if (!isFlat) {
        const canvas = container.querySelector('#aiForecastChart');
        if (canvas) {
            // Only draw the band when every day carries both bounds.
            // Older cached responses (pre-backend-upgrade) lack these
            // fields — the chart falls back to a line-only render.
            const hasBand = list.every(d => d.lower != null && d.upper != null);
            _renderAiForecastChart(canvas, {
                dates: list.map(d => new Date(String(d.date) + 'T00:00:00')),
                revenues,
                lowers: hasBand ? list.map(d => Number(d.lower) || 0) : null,
                uppers: hasBand ? list.map(d => Number(d.upper) || 0) : null
            });
        }
    }
}

function renderAiRestock(container, subtitleEl, data) {
    const items = Array.isArray(data.items) ? data.items : [];

    if (!items.length) {
        container.innerHTML = `<div class="ai-loading">All stock levels look healthy.</div>`;
        if (subtitleEl) subtitleEl.textContent = '';
        return;
    }

    const critical = items.filter(i => i.urgency === 'critical').length;
    if (subtitleEl) {
        subtitleEl.textContent = `${items.length} item${items.length === 1 ? '' : 's'}` + (critical > 0 ? ` · ${critical} critical` : '');
    }

    const iconFor = u => ({
        critical: 'fa-fire',
        high: 'fa-exclamation-triangle',
        medium: 'fa-info-circle',
        low: 'fa-check-circle'
    }[u] || 'fa-info-circle');

    container.innerHTML = items.map(item => {
        const urgency = ['critical', 'high', 'medium', 'low'].includes(item.urgency) ? item.urgency : 'low';
        const days = (item.daysLeft != null && isFinite(item.daysLeft) && item.daysLeft < 999)
            ? ` · ${Number(item.daysLeft).toFixed(1)} days left`
            : '';
        // Slice label pill (S, M, L, Bosny, etc.) — only shown when the
        // product tracks per-size or per-brand stock.
        const sliceLabel = item.label
            ? `<span class="ai-restock-slice">${escapeCustomerText(item.label)}</span>`
            : '';
        return `
            <div class="ai-restock-item">
                <div class="ai-restock-icon ${urgency}"><i class="fas ${iconFor(urgency)}"></i></div>
                <div class="ai-restock-body">
                    <span class="ai-restock-name">${escapeCustomerText(item.name)}${sliceLabel}</span>
                    <span class="ai-restock-reason">${escapeCustomerText(item.reason || '')}${days}</span>
                </div>
                <div class="ai-restock-action">Order ${escapeCustomerText(item.recommendedOrder ?? '?')}</div>
            </div>
        `;
    }).join('');
}

// ---------- AI ASSISTANT — FAB + SLIDE-OUT PANEL ----------
const AI_THREAD_KEY = 'pos_ai_thread';
const AI_THREAD_MAX = 20;

function loadAiThread() {
    try {
        const raw = localStorage.getItem(AI_THREAD_KEY);
        const arr = JSON.parse(raw || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function saveAiThread(thread) {
    try {
        localStorage.setItem(AI_THREAD_KEY, JSON.stringify(thread.slice(-AI_THREAD_MAX)));
    } catch (e) {}
}

function escapeAiText(value) {
    return String(value || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/* ============================================================
   AI MESSAGE FORMATTING
   - Colours money values green
   - Colours stock status keywords
   - Turns product names into clickable buttons
   Safe: escapes HTML first, then wraps in placeholders so the
   patterns can't conflict with each other.
   ============================================================ */
let __aiProductRegexCache = null;
function getProductRegexes() {
    const products = (window.getInventorySnapshot?.() || [])
        .map(p => String(p.name || '').trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length); // longest first

    const key = products.join('\x00');
    if (__aiProductRegexCache?.key === key) return __aiProductRegexCache.list;

    const list = products.map(name => {
        const escName = escapeAiText(name);
        const escPattern = escName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return {
            name,
            rx: new RegExp(`(^|[^A-Za-z0-9])(${escPattern})(?=[^A-Za-z0-9]|$)`, 'g')
        };
    });

    __aiProductRegexCache = { key, list };
    return list;
}

function formatAiMessage(rawText, meta) {
    let cleaned = String(rawText || '').trim();

    // Strip common AI filler openings that add no information.
    cleaned = cleaned
        .replace(/^(Based on (the )?(STORE_DATA|data|numbers|figures)[,:\s]*)/i, '')
        .replace(/^(According to (the )?(STORE_DATA|data|numbers|figures)[,:\s]*)/i, '')
        .replace(/^(Great question[!.,]?\s*)/i, '')
        .replace(/^(Sure[!,.]?\s*)/i, '')
        .replace(/^(Of course[!,.]?\s*)/i, '')
        .replace(/^(Certainly[!,.]?\s*)/i, '')
        .trim();

    // Capitalize first character after stripping.
    if (cleaned) cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

    let safe = escapeAiText(cleaned);
    const placeholders = [];

    const stash = (html) => {
        const token = `\u0001${placeholders.length}\u0002`;
        placeholders.push(html);
        return token;
    };

    // ---- 1. Product names → clickable buttons ----
    // Regexes are compiled once per product-list snapshot and cached,
    // so repeated AI bubbles don't re-compile hundreds of patterns.
    for (const { name, rx } of getProductRegexes()) {
        safe = safe.replace(rx, (full, prefix, hit) => {
            const button = `<button type="button" class="ai-product-link" data-product-name="${escapeAiText(name)}">${hit}</button>`;
            return prefix + stash(button);
        });
    }

    // ---- 2. Money values → green ----
    // Matches "PHP 1,234.56", "PHP1,234", "₱1,234.56"
    // Normalizes "PHP X" → "₱X" so the AI chat reads with a peso sign.
    safe = safe.replace(
        /(PHP\s?[\d,]+(?:\.\d{1,2})?|₱\s?[\d,]+(?:\.\d{1,2})?)/g,
        m => {
            const normalized = m.replace(/^PHP\s?/i, '₱');
            return stash(`<span class="ai-money">${normalized}</span>`);
        }
    );

    // ---- 3. Stock status keywords ----
    safe = safe.replace(
        /\b(low on stock|low stock|out of stock|critical|unavailable)\b/gi,
        m => {
            const danger = /out of stock|critical|unavailable/i.test(m);
            const cls = danger ? 'ai-status-danger' : 'ai-status-warn';
            return stash(`<span class="${cls}">${m}</span>`);
        }
    );

    // ---- Restore placeholders in order ----
    placeholders.forEach((html, i) => {
        safe = safe.split(`\u0001${i}\u0002`).join(html);
    });

    return safe;
}

function renderAiThread() {
    const threadEl = document.getElementById('aiThread');
    if (!threadEl) return;

    const history = loadAiThread();
    const html = [];

    if (history.length === 0) {
        html.push(`
            <div class="ai-bubble ai">
                Hi! Ask me about your store — sales, stock, top products, or what to restock.
            </div>`);
    } else {
        history.forEach(msg => {
            const isUser = msg.role === 'user';
            const cls = isUser ? 'user' : 'ai';

            if (isUser) {
                // User messages stay plain text — never re-formatted.
                html.push(`<div class="ai-bubble ${cls}">${escapeAiText(msg.text)}</div>`);
            } else {
                const body = formatAiMessage(msg.text, msg);
                const meta = msg.source
                    ? `<div class="ai-bubble-meta">via ${escapeAiText(msg.source)}</div>`
                    : '';
                html.push(`<div class="ai-bubble ${cls}">${body}${meta}</div>`);
            }
        });
    }

    threadEl.innerHTML = html.join('');
    threadEl.scrollTop = threadEl.scrollHeight;
}

function appendAiBubble(role, text, extraClass = '', meta = null) {
    const threadEl = document.getElementById('aiThread');
    if (!threadEl) return;
    const div = document.createElement('div');
    div.className = `ai-bubble ${role}${extraClass ? ' ' + extraClass : ''}`;

    if (role === 'user') {
        div.innerHTML = escapeAiText(text);
    } else {
        const body = formatAiMessage(text, meta);
        const metaLine = meta?.source
            ? `<div class="ai-bubble-meta">via ${escapeAiText(meta.source)}</div>`
            : '';
        div.innerHTML = body + metaLine;
    }

    threadEl.appendChild(div);
    threadEl.scrollTop = threadEl.scrollHeight;
    return div;
}

function openAiPanel() {
    const panel = document.getElementById('aiPanel');
    const fab = document.getElementById('aiFab');
    if (!panel || !fab) return;

    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    fab.setAttribute('aria-expanded', 'true');
    document.body.classList.add('ai-panel-open');

    setTimeout(() => document.getElementById('aiPanelInput')?.focus(), 250);
}

function closeAiPanel() {
    const panel = document.getElementById('aiPanel');
    const fab = document.getElementById('aiFab');
    if (!panel || !fab) return;

    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    fab.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('ai-panel-open');
}

function clearAiThread() {
    if (!window.confirm('Clear the conversation?')) return;
    try { localStorage.removeItem(AI_THREAD_KEY); } catch (e) {}
    renderAiThread();
}

function setupAiFeatures() {
    if (!window.POS_AI) {
        console.warn('[AI] POS_AI not loaded — check that ai.js is included before script.js');
        return;
    }

    // ---- Open / close panel ----
    document.getElementById('aiFab')?.addEventListener('click', openAiPanel);
    document.getElementById('aiPanelClose')?.addEventListener('click', closeAiPanel);
    document.getElementById('aiClearThread')?.addEventListener('click', clearAiThread);

    // ---- Esc closes panel ----
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('aiPanel')?.classList.contains('open')) {
            closeAiPanel();
        }
    });

    // ---- Restore thread from localStorage ----
    renderAiThread();

        // ---- Product link clicks → jump to inventory with the name pre-filled ----
    document.getElementById('aiThread')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.ai-product-link');
        if (!btn) return;
        const name = btn.dataset.productName;
        if (!name) return;

        // Close the AI panel so the user sees the inventory page
        closeAiPanel();

        // Navigate + pre-fill the search after the page renders
        window.navigateToPage?.('inventory');
        setTimeout(() => {
            const search = document.getElementById('inventorySearch');
            if (search) {
                search.value = name;
                search.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, 200);
    });
    // ---- Form submission ----
    const form = document.getElementById('aiPanelForm');
    const input = document.getElementById('aiPanelInput');
    const sendBtn = document.getElementById('aiPanelSend');
    const quickPromptsEl = document.getElementById('aiQuickPrompts');

    function setQuickPromptsDisabled(disabled) {
        quickPromptsEl?.querySelectorAll('.ai-chip').forEach(chip => {
            chip.disabled = disabled;
        });
    }

    // ---- Quick-prompt chips: fill the input, then submit ----
    quickPromptsEl?.addEventListener('click', (e) => {
        const chip = e.target.closest('.ai-chip');
        if (!chip || chip.disabled || !input) return;
        const prompt = chip.dataset.prompt;
        if (!prompt) return;
        input.value = prompt;
        form?.requestSubmit();
    });

    // Minimum gap between chat messages. Protects Groq's token-per-minute
    // budget — a rapid burst of 4-5 messages can blow past 8k TPM in one
    // 60s window even with a trimmed payload.
    const CHAT_COOLDOWN_MS = 4000;
    let __lastChatAt = 0;

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const question = (input?.value || '').trim();
        if (!question) return;

        // Enforce the cooldown — refuse silently rather than spamming
        // the user with an error, since they just sent a message.
        const since = Date.now() - __lastChatAt;
        if (since < CHAT_COOLDOWN_MS) {
            const waitSec = Math.ceil((CHAT_COOLDOWN_MS - since) / 1000);
            appendAiBubble('ai', `Please wait ${waitSec}s between messages.`, 'error');
            return;
        }
        __lastChatAt = Date.now();

        // Capture history BEFORE appending the new bubble, so the current
        // question is not duplicated inside the prompt's history block.
        const priorHistory = loadAiThread();

        // Append user message
        appendAiBubble('user', question);
        input.value = '';
        input.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        setQuickPromptsDisabled(true);

        // Append loading placeholder
        const loadingEl = appendAiBubble('ai', 'Thinking…', 'loading');
        loadingEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Thinking…';

        try {
            const result = await window.POS_AI.askQuestion(question, priorHistory);
            const answer = result.answer || 'AI returned an empty response.';
            loadingEl.remove();
            appendAiBubble('ai', answer, '', result);

            // Persist to storage — include intent + source so the
            // meta line survives a page reload.
            const history = loadAiThread();
            history.push({ role: 'user', text: question, ts: Date.now() });
            history.push({
                role: 'ai',
                text: answer,
                ts: Date.now(),
                intent: result.intent,
                source: result.source
            });
            saveAiThread(history);
        } catch (err) {
            loadingEl.remove();
            appendAiBubble('ai', err.message || 'AI request failed.', 'error');

            const history = loadAiThread();
            history.push({ role: 'user', text: question, ts: Date.now() });
            history.push({ role: 'ai', text: '⚠️ ' + (err.message || 'AI request failed.'), ts: Date.now() });
            saveAiThread(history);
        } finally {
            input.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
            setQuickPromptsDisabled(false);
            input.focus();
        }
    });

    // ---- Forecast + Restock refresh buttons ----
    // Each button now invalidates only its own cache key, so refreshing
    // the forecast doesn't force the restock list to re-fetch on the
    // next render — and vice versa.
    document.getElementById('aiForecastRefresh')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        window.POS_AI.clearCache('forecast_14d');
        await refreshAiCards();
        btn.disabled = false;
    });

    document.getElementById('aiRestockRefresh')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        window.POS_AI.clearCache('restock_priority');
        await refreshAiCards();
        btn.disabled = false;
    });
}



/* ============================================================
   MODAL EXIT ANIMATION
   Keeps `.closing` on the element for 200ms so the fade-out
   transition has time to run before the class is removed.
   Patches classList.remove for modal/show classes globally.
   ============================================================ */
(function setupModalExitAnimation() {
    const EXIT_MS = 200;
    const animatable = new WeakMap();
    const origRemove = DOMTokenList.prototype.remove;
    DOMTokenList.prototype.remove = function (...tokens) {
        const el = this._element || null;
        // Scope the delay to modal-like containers ONLY. The previous
        // version delayed every `.active` / `.show` / `.open` removal
        // globally, which double-highlighted sidebar links and page
        // tabs for 200ms on every click.
        const isModalLike = el && (
            el.classList.contains('modal') ||
            el.classList.contains('modal-content') ||
            el.classList.contains('modal-overlay') ||
            el.classList.contains('modal-card') ||
            el.classList.contains('notifications-panel') ||
            el.classList.contains('ai-panel')
        );
        if (
            isModalLike &&
            tokens.some(t => t === 'show' || t === 'active' || t === 'open') &&
            tokens.length === 1 &&
            !animatable.has(el)
        ) {
            // Defer the actual removal by one frame so CSS gets a
            // chance to see the class-less state and animate out.
            const token = tokens[0];
            animatable.set(el, true);
            // Force a "closing" state — most modal CSS uses opacity/visibility
            // on the base class, so this triggers the transition already
            // defined in input.css.
            requestAnimationFrame(() => {
                setTimeout(() => {
                    animatable.delete(el);
                    origRemove.call(this, token);
                }, EXIT_MS);
            });
            return;
        }
        return origRemove.apply(this, tokens);
    };
})();

// ---------- DASHBOARD FUNCTIONS ----------
    function loadDashboard(user) {
        document.body.classList.add('is-logged-in');
        loginContainer.style.display = 'none';
        dashboardContainer.style.display = 'flex';
    
    const name = user?.user_metadata?.full_name ||
        user?.email?.split('@')[0] ||
        'User';
    currentUser = user;
window.POS_CURRENT_USER = user;
applyRoleAccess(user);
    
    if (userDisplayName) userDisplayName.textContent = name;
    if (dashboardUserName) dashboardUserName.textContent = name;
    
    const avatar = userDropdownBtn?.querySelector('img');
    if (avatar) {
        avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4F46E5&color=fff`;
    }
    
    if (accountStatusText) {
        accountStatusText.textContent = `Logged in as ${name}`;
    }
    
    showToast(`Welcome, ${name}!`, 'success');
    localStorage.setItem(CUSTOMERS_CACHE_READY_KEY, 'false');
    
    refreshOverview();
    
    renderOrders();
    renderCustomers();
    window.renderAuditLogs?.();
    
    // ---------- REAL-TIME SUBSCRIPTIONS ----------
    if (window._posUnsubscribers) {
        window._posUnsubscribers.forEach(fn => { try { fn(); } catch (e) {} });
    }
    window._posUnsubscribers = [
        window.POS_SUPABASE.subscribeOrders(orders => {
            renderOrders(orders);
            scheduleOverviewRefresh();
        }),
        window.POS_SUPABASE.subscribeCustomers(customers => {
            renderCustomers(customerSearch?.value || '', customers);
            scheduleOverviewRefresh();
        }),
        window.POS_SUPABASE.subscribeInventory(products => {
            window.renderPosCatalog?.(products);
            window.setInventoryProducts?.(products);
            scheduleOverviewRefresh();
        }),
        window.POS_SUPABASE.subscribeAuditLogs(logs => {
    window.renderAuditLogs?.(logs);
    renderRecentActivity();
})
    ];
    window.flushPendingSales?.();
}

    function showLoginView() {
    document.body.classList.remove('is-logged-in');
    loginContainer.style.display = 'flex';
        dashboardContainer.style.display = 'none';
    currentUser = null;
    window.POS_CURRENT_USER = null;
    showView(signinView);
    updateSystemStatus();
}

    // ---------- UPDATE SYSTEM STATUS ----------
    function updateSystemStatus() {
        if (!accountStatusText) return;
        
        if (isSupabaseReady()) {
            accountStatusText.textContent = 'Firebase connected ✓';
            return;
        }
        
        const adminCount = getAdminAccountCount();
        const users = getUsers();
        const hasCashier = users.some(u => u.role === 'cashier');
        
        if (adminCount >= MAX_ADMIN_ACCOUNTS) {
            accountStatusText.textContent = hasCashier
                ? 'System ready: Admin & Cashier available'
                : 'Admin limit reached — Cashier registration open';
        } else if (adminCount > 0 && hasCashier) {
            accountStatusText.textContent = `System ready: ${adminCount} of ${MAX_ADMIN_ACCOUNTS} Admin accounts created`;
        } else if (adminCount > 0 && !hasCashier) {
            accountStatusText.textContent = `Admin registration available (${MAX_ADMIN_ACCOUNTS - adminCount} slot${MAX_ADMIN_ACCOUNTS - adminCount === 1 ? '' : 's'} left)`;
        } else if (adminCount === 0 && hasCashier) {
            accountStatusText.textContent = 'Cashier exists — Admin registration required';
        } else {
            accountStatusText.textContent = 'No accounts yet — Create Admin first';
        }
    }

    // ---------- UPDATE SIGNUP ROLE (removed — signup lives in auth.js) ----------

    // ---------- SHOW VIEW ----------
    function showView(view) {
        if (signinView) signinView.style.display = 'none';
        if (forgotView) forgotView.style.display = 'none';
        if (view) view.style.display = 'block';
        
        // Scroll to top on mobile
        if (isMobile()) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    // ---------- PASSWORD TOGGLE ----------
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            if (input) {
                if (input.type === 'password') {
                    input.type = 'text';
                    btn.innerHTML = '<i class="fas fa-eye-slash"></i>';
                } else {
                    input.type = 'password';
                    btn.innerHTML = '<i class="fas fa-eye"></i>';
                }
            }
        });
    });

    // ---------- PREVENT ZOOM ON INPUT FOCUS (Mobile) ----------
    if (isMobile()) {
        document.querySelectorAll('input, select, textarea').forEach(el => {
            el.addEventListener('focus', function() {
                this.style.fontSize = '16px';
            });
        });
    }

    // ---------- FORM SWITCHING (handled in auth.js) ----------

    // ---------- VALIDATION (delegated to auth.js) ----------
    const validateEmail = (email) => window.AUTH?.validateEmail?.(email) ?? false;

    // ---------- SIGN IN (handled in auth.js) ----------

    // ---------- SIGN UP (removed — admin-only creation lives in auth.js) ----------

    // ---------- FORGOT PASSWORD (handled in auth.js) ----------

    // ---------- LOGOUT (handled in auth.js) ----------

    // ---------- USER DROPDOWN TOGGLE ----------
    if (userDropdownBtn) {
        userDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (userDropdownMenu) userDropdownMenu.classList.toggle('show');
        });
    }

    document.addEventListener('click', () => {
        if (userDropdownMenu) userDropdownMenu.classList.remove('show');
    });

    // ---------- SIDEBAR TOGGLE (mobile drawer + desktop collapse) ----------
    (function setupSidebarToggle() {
        if (!mobileToggle || !sidebar) return;

        const COLLAPSE_KEY = 'pos_sidebar_collapsed';
        const isDesktop = () => window.innerWidth > 768;

        // Native tooltips on each nav item (visible when collapsed)
        sidebar.querySelectorAll('.sidebar-link').forEach(link => {
            const label = link.querySelector('span')?.textContent?.trim();
            if (label) link.setAttribute('title', label);
        });

        function saveCollapse(collapsed) {
            try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) {}
        }

        function readCollapse() {
            try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) { return false; }
        }

        function setToggleA11y(collapsed) {
            mobileToggle.setAttribute('aria-expanded', String(!collapsed));
            mobileToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        }

        // Restore saved state on load (desktop only)
        if (isDesktop() && readCollapse()) {
            document.body.classList.add('sidebar-collapsed');
            setToggleA11y(true);
        } else {
            setToggleA11y(false);
        }

        mobileToggle.addEventListener('click', () => {
            if (isDesktop()) {
                const collapsed = document.body.classList.toggle('sidebar-collapsed');
                saveCollapse(collapsed);
                setToggleA11y(collapsed);
            } else {
                sidebar.classList.toggle('open');
                mobileToggle.setAttribute('aria-expanded',
                    String(sidebar.classList.contains('open')));
            }
        });

        // Esc closes mobile drawer
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !isDesktop() && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                mobileToggle.setAttribute('aria-expanded', 'false');
            }
        });

        // Cleanup / restore when crossing the breakpoint
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (!isDesktop()) {
                    document.body.classList.remove('sidebar-collapsed');
                    sidebar.classList.remove('open');
                    mobileToggle.setAttribute('aria-expanded', 'false');
                } else {
                    const saved = readCollapse();
                    document.body.classList.toggle('sidebar-collapsed', saved);
                    setToggleA11y(saved);
                }
            }, 150);
        });
    })();

    // ---------- SIDEBAR NAVIGATION ----------
    document.querySelectorAll('.sidebar-link[data-page]').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            const page = this.dataset.page;
            if (!canAccessPage(page)) {
                window.navigateToPage('overview');
                return;
            }

            // Remove active from all
            document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            
            // Show corresponding page
            document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
            const target = document.getElementById(`page-${page}`);
            if (target) target.classList.add('active');
            
        // Initialize inventory if navigating to inventory page
        if (page === 'inventory') {
            window.initInventory?.();
        }
        if (page === 'pos') {
            window.reloadPosCatalog?.();
        }
        if (page === 'overview') {
            refreshAiCards();
        }
        if (page === 'users') {
            window.AUTH?.renderUsers?.().catch(() => {});
        }
        
        // Close mobile sidebar
        if (sidebar) sidebar.classList.remove('open');
        });
        }); 
        
    // ---------- NAVIGATION FUNCTION ----------
    window.navigateToPage = function(page) {
    if (!canAccessPage(page)) {
        page = 'overview';
    }
    
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    const sidebarLink = document.querySelector(`.sidebar-link[data-page="${page}"]`);
    if (sidebarLink) sidebarLink.classList.add('active');
    
    document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');
    
    if (page === 'inventory') {
        window.initInventory?.();
    }
    if (page === 'pos') {
        window.reloadPosCatalog?.();
    }
    if (page === 'overview') {
        refreshAiCards();
    }
    if (page === 'users') {
        window.AUTH?.renderUsers?.().catch(() => {});
    }
};

    document.querySelectorAll('.kpi-clickable[data-kpi-target]').forEach(card => {
    const handleKpiClick = () => {
        const target = card.dataset.kpiTarget;
        const filter = card.dataset.kpiFilter || '';
        
        window.navigateToPage(target);
        
        // Apply optional filter based on which card was clicked
        if (target === 'orders' && filter === 'today') {
            setTimeout(() => {
                const dateFilter = document.getElementById('orderDateFilter');
                if (dateFilter) {
                    dateFilter.value = 'Today';
                    dateFilter.dispatchEvent(new Event('change'));
                }
            }, 100);
        }
        
        if (target === 'reports' && filter === 'sales') {
            setTimeout(() => {
                const btn = document.querySelector('.report-generate-btn[data-report="sales"]');
                if (btn) btn.focus();
            }, 100);
        }
    };
    
    card.addEventListener('click', handleKpiClick);
    card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleKpiClick();
        }
    });
});

    // ---------- ROLE CHANGE (removed with signup form) ----------

    /* Legacy inventory implementation removed; inventory.js owns this feature. */
    /*
    
    // Inventory State
    let inventoryState = {
        products: [],
        filteredProducts: [],
        currentPage: 1,
        itemsPerPage: 10,
        searchTerm: '',
        categoryFilter: '',
        stockFilter: '',
        editingProductId: null,
        deletingProductId: null
    };

    // Sample inventory data
    // Initialize Inventory
    function initInventory() {
        // Load products from localStorage or use sample data
        inventoryState.products = [];
        
        updateInventoryStats();
        filterProducts();
        setupInventoryEventListeners();
    }

    // Save products to localStorage
    function saveProducts() {
    }

    // Update inventory statistics
    function updateInventoryStats() {
        const totalProductsEl = document.getElementById('totalProducts');
        const inStockProductsEl = document.getElementById('inStockProducts');
        const lowStockProductsEl = document.getElementById('lowStockProducts');
        const outOfStockProductsEl = document.getElementById('outOfStockProducts');
        
        if (!totalProductsEl) return;
        
        const total = inventoryState.products.length;
        const inStock = inventoryState.products.filter(p => p.quantity > p.minStock).length;
        const lowStock = inventoryState.products.filter(p => p.quantity > 0 && p.quantity <= p.minStock).length;
        const outOfStock = inventoryState.products.filter(p => p.quantity === 0).length;
        
        totalProductsEl.textContent = total;
        inStockProductsEl.textContent = inStock;
        lowStockProductsEl.textContent = lowStock;
        outOfStockProductsEl.textContent = outOfStock;
    }

    // Get stock status
    function getStockStatus(quantity, minStock) {
        if (quantity === 0) return 'out_of_stock';
        if (quantity <= minStock) return 'low_stock';
        if (quantity > minStock * 2) return 'over_stock';
        return 'in_stock';
    }

    // Get stock badge HTML
    function getStockBadge(status) {
        const badges = {
            'in_stock': '<span class="stock-badge in-stock"><i class="fas fa-check-circle"></i> In Stock</span>',
            'low_stock': '<span class="stock-badge low-stock"><i class="fas fa-exclamation-triangle"></i> Low Stock</span>',
            'out_of_stock': '<span class="stock-badge out-of-stock"><i class="fas fa-times-circle"></i> Out of Stock</span>',
            'over_stock': '<span class="stock-badge over-stock"><i class="fas fa-arrow-up"></i> Over Stocked</span>'
        };
        return badges[status] || badges.in_stock;
    }

    // Filter products based on search and filters
    function filterProducts() {
        const { searchTerm, categoryFilter, stockFilter } = inventoryState;
        
        inventoryState.filteredProducts = inventoryState.products.filter(product => {
            // Search filter
            if (searchTerm) {
                const searchLower = searchTerm.toLowerCase();
                const matchesSearch = 
                    product.name.toLowerCase().includes(searchLower) ||
                    product.sku.toLowerCase().includes(searchLower) ||
                    (product.supplier && product.supplier.toLowerCase().includes(searchLower));
                if (!matchesSearch) return false;
            }
            
            // Category filter
            if (categoryFilter && product.category !== categoryFilter) {
                return false;
            }
            
            // Stock filter
            if (stockFilter) {
                const status = getStockStatus(product.quantity, product.minStock);
                if (status !== stockFilter) return false;
            }
            
            return true;
        });
        
        inventoryState.currentPage = 1;
        renderInventoryTable();
        renderPagination();
    }

    // Render inventory table
    function renderInventoryTable() {
        const tbody = document.getElementById('inventoryTableBody');
        const table = document.getElementById('inventoryTable');
        const emptyState = document.getElementById('inventoryEmpty');
        const loadingSpinner = document.getElementById('inventoryLoading');
        
        if (!tbody) return;
        
        // Show loading spinner
        if (loadingSpinner) loadingSpinner.style.display = 'block';
        if (table) table.style.display = 'none';
        
        setTimeout(() => {
            if (loadingSpinner) loadingSpinner.style.display = 'none';
            
            if (inventoryState.filteredProducts.length === 0) {
                if (table) table.style.display = 'none';
                if (emptyState) emptyState.style.display = 'block';
                return;
            }
            
            if (emptyState) emptyState.style.display = 'none';
            if (table) table.style.display = 'table';
            
            // Calculate pagination
            const startIndex = (inventoryState.currentPage - 1) * inventoryState.itemsPerPage;
            const endIndex = Math.min(startIndex + inventoryState.itemsPerPage, inventoryState.filteredProducts.length);
            const pageProducts = inventoryState.filteredProducts.slice(startIndex, endIndex);
            
            const categoryIcons = {
                'tools': '🔧',
                'hardware': '🔩',
                'electrical': '⚡',
                'plumbing': '🔧',
                'paint': '🎨',
                'garden': '🌿',
                'building': '🏗️',
                'fasteners': '🔗',
                'safety': '🛡️'
            };
            
            tbody.innerHTML = pageProducts.map(product => {
                const status = getStockStatus(product.quantity, product.minStock);
                
                return `
                    <tr>
                        <td>
                            <div class="product-info">
                                <div class="product-image">${categoryIcons[product.category] || '📦'}</div>
                                <div class="product-details">
                                    <p class="product-name">${product.name}</p>
                                    <span class="product-sku">Product Code: ${product.sku}</span>
                                </div>
                            </div>
                        </td>
                        <td>${product.category}</td>
                        <td>$${product.price.toFixed(2)}</td>
                        <td>
                            <input type="number" 
                                   class="quantity-input" 
                                   value="${product.quantity}" 
                                   min="0"
                                   data-product-id="${product.id}"
                                   onchange="updateQuantity(${product.id}, this.value)">
                        </td>
                        <td>${getStockBadge(status)}</td>
                        <td>${product.lastUpdated}</td>
                        <td>
                            <div class="action-buttons">
                                <button class="btn-icon edit" onclick="editProduct(${product.id})" title="Edit">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn-icon delete" onclick="showDeleteModal(${product.id})" title="Delete">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }, 300);
    }

    // Render pagination
    function renderPagination() {
        const pagination = document.getElementById('inventoryPagination');
        if (!pagination) return;
        
        const totalPages = Math.ceil(inventoryState.filteredProducts.length / inventoryState.itemsPerPage);
        
        if (totalPages <= 1) {
            pagination.innerHTML = '';
            return;
        }
        
        let paginationHTML = `
            <button class="page-btn" onclick="changePage(${inventoryState.currentPage - 1})" 
                    ${inventoryState.currentPage === 1 ? 'disabled' : ''}>
                <i class="fas fa-chevron-left"></i>
            </button>
        `;
        
        for (let i = 1; i <= totalPages; i++) {
            paginationHTML += `
                <button class="page-btn ${inventoryState.currentPage === i ? 'active' : ''}" 
                        onclick="changePage(${i})">
                    ${i}
                </button>
            `;
        }
        
        paginationHTML += `
            <button class="page-btn" onclick="changePage(${inventoryState.currentPage + 1})" 
                    ${inventoryState.currentPage === totalPages ? 'disabled' : ''}>
                <i class="fas fa-chevron-right"></i>
            </button>
        `;
        
        pagination.innerHTML = paginationHTML;
    }

    // Expose functions to global scope for onclick handlers
    window.changePage = function(page) {
        const totalPages = Math.ceil(inventoryState.filteredProducts.length / inventoryState.itemsPerPage);
        if (page < 1 || page > totalPages) return;
        inventoryState.currentPage = page;
        renderInventoryTable();
        renderPagination();
    };

    window.updateQuantity = function(productId, newQuantity) {
        const quantity = parseInt(newQuantity);
        if (quantity < 0 || isNaN(quantity)) return;
        
        const product = inventoryState.products.find(p => p.id === productId);
        if (product) {
            product.quantity = quantity;
            product.lastUpdated = new Date().toISOString().split('T')[0];
            saveProducts();
            updateInventoryStats();
            filterProducts();
            showToast('Quantity updated successfully', 'success');
        }
    };

    window.editProduct = function(productId) {
        openProductModal(productId);
    };

    window.showDeleteModal = function(productId) {
        inventoryState.deletingProductId = productId;
        const product = inventoryState.products.find(p => p.id === productId);
        if (product) {
            const deleteProductName = document.getElementById('deleteProductName');
            if (deleteProductName) deleteProductName.textContent = `${product.name} (${product.sku})`;
        }
        const deleteModal = document.getElementById('deleteModal');
        if (deleteModal) deleteModal.classList.add('active');
    };

    // Setup inventory event listeners
    function setupInventoryEventListeners() {
        // Add Product Button
        const addProductBtn = document.getElementById('addProductBtn');
        if (addProductBtn) {
            addProductBtn.onclick = function() {
                openProductModal(null);
            };
        }
        
        // Export Button
        const exportBtn = document.getElementById('exportInventoryBtn');
        if (exportBtn) {
            exportBtn.onclick = function() {
                exportInventory();
            };
        }
        
        // Search Input
        const searchInput = document.('inventorySearch');
        if (searchInput) {
            searchInput.oninput = function() {
                inventoryState.searchTerm = this.value;
                filterProducts();
            };
        }
        
        // Category Filter
        const categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter) {
            categoryFilter.onchange = function() {
                inventoryState.categoryFilter = this.value;
                filterProducts();
            };
        }
        
        // Stock Filter
        const stockFilter = document.getElementById('stockFilter');
        if (stockFilter) {
            stockFilter.onchange = function() {
                inventoryState.stockFilter = this.value;
                filterProducts();
            };
        }
        
        // Product Modal
        const closeProductModalBtn = document.getElementById('closeProductModal');
        if (closeProductModalBtn) {
            closeProductModalBtn.onclick = closeProductModal;
        }
        
        const cancelProductBtn = document.getElementById('cancelProductBtn');
        if (cancelProductBtn) {
            cancelProductBtn.onclick = closeProductModal;
        }
        
        const productForm = document.getElementById('productForm');
        if (productForm) {
            productForm.onsubmit = saveProduct;
        }
        
        // Delete Modal
        const closeDeleteModalBtn = document.getElementById('closeDeleteModal');
        if (closeDeleteModalBtn) {
            closeDeleteModalBtn.onclick = closeDeleteModal;
        }
        
        const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        if (cancelDeleteBtn) {
            cancelDeleteBtn.onclick = closeDeleteModal;
        }
        
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        if (confirmDeleteBtn) {
            confirmDeleteBtn.onclick = confirmDelete;
        }
        
        // Close modals on outside click
        window.onclick = function(event) {
            const productModal = document.getElementById('productModal');
            const deleteModal = document.getElementById('deleteModal');
            if (event.target === productModal) {
                closeProductModal();
            }
            if (event.target === deleteModal) {
                closeDeleteModal();
            }
        };
    }

    // Open product modal
    function openProductModal(productId = null) {
        inventoryState.editingProductId = productId;
        const modal = document.getElementById('productModal');
        const title = document.getElementById('productModalTitle');
        const form = document.getElementById('productForm');
        
        if (!modal || !title || !form) return;
        
        form.reset();
        
        if (productId) {
            const product = inventoryState.products.find(p => p.id === productId);
            if (product) {
                title.textContent = 'Edit Product';
                document.getElementById('productName').value = product.name;
                document.getElementById('productSKU').value = product.sku;
                document.getElementById('productCategory').value = product.category;
                document.getElementById('productPrice').value = product.price;
                document.getElementById('productQuantity').value = product.quantity;
                document.getElementById('productMinStock').value = product.minStock;
                document.getElementById('productSupplier').value = product.supplier || '';
                document.getElementById('productSize').value = product.size || '';
                document.getElementById('productDescription').value = product.description || '';
            }
        } else {
            title.textContent = 'Add Product';
        }
        
        modal.classList.add('active');
    }

    // Close product modal
    function closeProductModal() {
        const modal = document.getElementById('productModal');
        if (modal) modal.classList.remove('active');
        inventoryState.editingProductId = null;
    }

    // Save product
    function saveProduct(event) {
        event.preventDefault();
        
        const productData = {
            name: document.getElementById('productName').value.trim(),
            sku: document.getElementById('productSKU').value.trim(),
            category: document.getElementById('productCategory').value,
            price: parseFloat(document.getElementById('productPrice').value),
            quantity: parseInt(document.getElementById('productQuantity').value),
            minStock: parseInt(document.getElementById('productMinStock').value),
            supplier: document.getElementById('productSupplier').value.trim(),
            size: document.getElementById('productSize').value.trim(),
            description: document.getElementById('productDescription').value.trim()
        };
        
        // Validate SKU uniqueness
        const skuExists = inventoryState.products.some(p => 
            p.sku === productData.sku && p.id !== inventoryState.editingProductId
        );
        
        if (skuExists) {
            showToast('Product code already exists', 'error');
            return;
        }
        
        if (inventoryState.editingProductId) {
            // Update existing product
            const index = inventoryState.products.findIndex(p => p.id === inventoryState.editingProductId);
            if (index !== -1) {
                inventoryState.products[index] = {
                    ...inventoryState.products[index],
                    ...productData,
                    lastUpdated: new Date().toISOString().split('T')[0]
                };
                showToast('Product updated successfully', 'success');
            }
        } else {
            // Add new product
            const newProduct = {
                id: Date.now(),
                ...productData,
                lastUpdated: new Date().toISOString().split('T')[0]
            };
            inventoryState.products.push(newProduct);
            showToast('Product added successfully', 'success');
        }
        
        saveProducts();
        updateInventoryStats();
        filterProducts();
        closeProductModal();
    }

    // Close delete modal
    function closeDeleteModal() {
        const modal = document.getElementById('deleteModal');
        if (modal) modal.classList.remove('active');
        inventoryState.deletingProductId = null;
    }

    // Confirm delete
    function confirmDelete() {
        if (inventoryState.deletingProductId) {
            inventoryState.products = inventoryState.products.filter(p => p.id !== inventoryState.deletingProductId);
            saveProducts();
            updateInventoryStats();
            filterProducts();
            showToast('Product deleted successfully', 'success');
        }
        closeDeleteModal();
    }

    // Export inventory to CSV
    function exportInventory() {
        if (inventoryState.products.length === 0) {
            showToast('No products to export', 'error');
            return;
        }
        
        const headers = ['ID', 'Name', 'Product Code', 'Category', 'Price', 'Quantity', 'Min Stock', 'Supplier', 'Location', 'Description', 'Last Updated'];
        const csvData = inventoryState.products.map(p => [
            p.id,
            p.name,
            p.sku,
            p.category,
            p.price,
            p.quantity,
            p.minStock,
            p.supplier || '',
            p.location || '',
            p.description || '',
            p.lastUpdated
        ]);
        
        const csvContent = [
            headers.join(','),
            ...csvData.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `inventory_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast('Inventory exported successfully', 'success');
    }

    */

    // ---------- CHECK AUTH STATUS (moved to auth.js) ----------

    // ---------- WINDOW RESIZE HANDLER ----------
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            // Handle responsive changes
        }, 250);
    });

    // ---------- PREVENT LAYOUT SHIFT ----------
    document.addEventListener('DOMContentLoaded', () => {
        if (isMobile()) {
            document.body.style.overflow = 'overlay';
        }
    });

    // ---------- INIT ----------
    function init() {
    initializeTheme();
    loadSettings();

    // Settings page buttons
    document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSettings);
    document.getElementById('resetSettingsBtn')?.addEventListener('click', resetSettings);

    renderCustomers();
    setupOrderFeatures();
    setupReportFeatures();
window.setupAuditFeatures?.();
setupSalesPeriodControls();
setupTopProductsPeriodControls();
setupCategoryPeriodControls();
setupAiFeatures();

    // Auth boot (signin/forgot/logout + checkAuth) lives in auth.js
    window.AUTH?.initAuth?.();
    window.AUTH?.setupUserManagement?.();

        // Update system status
        updateSystemStatus();

        // Log device type
        if (isDesktop()) {
            console.log('Desktop view initialized');
        } else if (isTablet()) {
            console.log('Tablet view initialized');
        } else {
            console.log('Mobile view initialized');
        }
        
        // Show Supabase status
        if (isSupabaseReady()) {
            
            if (accountStatusText) {
                accountStatusText.textContent = 'Firebase connected ✓';
            }
        } else {
            console.log('⚠️ Using local storage mode');
        }
    }
    
        // Override loadDashboard to always save session (offline fallback)
    const originalLoadDashboard = loadDashboard;
    loadDashboard = function(user) {
        originalLoadDashboard(user);
        try {
            localStorage.setItem('pos_current_user', JSON.stringify(user));
        } catch (e) {}
    };
    
    // Override showLoginView to clear session
    const originalShowLoginView = showLoginView;
    showLoginView = function() {
        originalShowLoginView();
        try {
            localStorage.removeItem('pos_current_user');
        } catch (e) {}
    };


        // ---------- OFFLINE INDICATOR ----------
    (function setupOfflineIndicator() {
        const banner = document.getElementById('offlineBanner');
        const bannerText = document.getElementById('offlineBannerText');
        const pendingCount = document.getElementById('offlinePendingCount');

        if (!banner) return;

        const QUEUE_KEY = 'pos_order_queue';

        function getPendingCount() {
            try {
                const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
                return Array.isArray(q) ? q.length : 0;
            } catch (e) {
                return 0;
            }
        }

        function render() {
            // Use the effective-online flag (updated by the heartbeat
            // below) instead of raw navigator.onLine, which lies on
            // captive portals and when the API host is unreachable.
            const online = navigator.onLine && __effectiveOnline;
            const pending = getPendingCount();

            // Nothing to show
            if (online && pending === 0) {
                banner.style.display = 'none';
                return;
            }

            banner.style.display = 'flex';

            if (!online) {
                banner.classList.add('offline');
                bannerText.textContent = pending > 0
                    ? `You're offline — ${pending} sale${pending === 1 ? '' : 's'} queued, will sync when online`
                    : "You're offline — sales are queued and will sync automatically";
            } else {
                banner.classList.remove('offline');
                const queueError = localStorage.getItem('pos_order_queue_error');
                bannerText.textContent = pending > 0
                    ? queueError
                        ? `${pending} queued sale${pending === 1 ? '' : 's'} need attention: ${queueError}`
                        : `Back online — syncing ${pending} queued sale${pending === 1 ? '' : 's'}…`
                    : '';
            }

            if (pending > 0) {
                pendingCount.hidden = false;
                pendingCount.textContent = `${pending} pending`;
            } else {
                pendingCount.hidden = true;
            }
        }

        // ---- Effective online tracking ----
        // navigator.onLine is not reliable — it says "online" even when
        // the wifi router has no internet (captive portal) or when the
        // Vercel function is unreachable. Track a resolved state that
        // combines the browser flag with a lightweight heartbeat.
        let __effectiveOnline = navigator.onLine;

        function setEffectiveOnline(state) {
            if (__effectiveOnline === state) return;
            __effectiveOnline = state;
            render();
        }

        // Browser online/offline events
        window.addEventListener('online', () => {
            setEffectiveOnline(true);
            window.dispatchEvent(new CustomEvent('pos-queue-flush-request'));
        });
        window.addEventListener('offline', () => {
            setEffectiveOnline(false);
        });

        // Refresh when queue changes (fired by pos.js once outbox is added)
        window.addEventListener('pos-queue-changed', render);
        window.addEventListener('pos-order-created', render);

        // Periodic safety net — every 15s, paused while hidden
        window.posSetInterval(render, 15000);
        window.addEventListener('pos-tab-visible', render);

        // Heartbeat every 30s while online. A tiny same-origin HEAD
        // request tells us whether we actually reach the server.
        // Catches captive portals where navigator.onLine lies.
        window.posSetInterval(async () => {
            if (!navigator.onLine) return;
            try {
                await fetch('/manifest.json', {
                    method: 'HEAD',
                    cache: 'no-store',
                    signal: AbortSignal.timeout(4000)
                });
                setEffectiveOnline(true);
            } catch (e) {
                setEffectiveOnline(false);
            }
        }, 30000);

        // Expose so pos.js can trigger an immediate re-render
        window.updateOfflineIndicator = render;

        render();
    })();

    
// Refresh overview when data changes.
// refreshOverview() already gates on Overview visibility, so AI calls
// only fire when the user is actually looking at the AI cards. The old
// scheduleAiRefresh() path bypassed that gate and fired unconditionally
// at 4s, doubling the AI proxy calls during normal use.
window.addEventListener('pos-order-created', () => {
    scheduleOverviewRefresh();
});
window.addEventListener('inventory-products-loaded', () => {
    scheduleOverviewRefresh();
});
    
        // ---------- NOTIFICATIONS BELL + PANEL ----------
    (function setupNotificationsBell() {
        const btn = document.getElementById('notificationsBtn');
        const badge = document.getElementById('notificationsBadge');
        const panel = document.getElementById('notificationsPanel');
        const list = document.getElementById('notificationsList');
        const countEl = document.getElementById('notificationsPanelCount');
        const footer = document.getElementById('notificationsFooter');
        const viewAllBtn = document.getElementById('notificationsViewAll');

        if (!btn || !badge || !panel || !list) return;

        const MAX_VISIBLE = 8;
        const LOW_STOCK_BUFFER = 0;

        function escapeHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));
        }

        function getStockSlices(product) {
            // Mirror the inventory.js slice order so this bell agrees with
            // the Inventory page and the restock panel.
            const v = product.variants;
            if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) {
                return Object.entries(v)
                    .filter(([, val]) => val && typeof val === 'object')
                    .map(([key, val]) => {
                        const [size, brand] = String(key).split('::');
                        return { size: size || '', brand: brand || '', stock: Number(val.stock) || 0 };
                    });
            }
            const ss = product.sizeStocks;
            if (ss && typeof ss === 'object' && !Array.isArray(ss) && Object.keys(ss).length) {
                return Object.entries(ss).map(([size, stock]) => ({ size, brand: '', stock: Number(stock) || 0 }));
            }
            const bs = product.brandStocks;
            if (bs && typeof bs === 'object' && !Array.isArray(bs) && Object.keys(bs).length) {
                return Object.entries(bs).map(([brand, stock]) => ({ size: '', brand, stock: Number(stock) || 0 }));
            }
            return [{ size: '', brand: '', stock: Number(product.quantity) || 0 }];
        }

        function getAlerts() {
            const products = window.getInventorySnapshot?.() || [];
            const alerts = [];
            for (const p of products) {
                const min = Number(p.minStock ?? p.min_stock ?? 0) || 0;
                const slices = getStockSlices(p);
                const lowSlices = slices.filter(s => s.stock <= min + LOW_STOCK_BUFFER);
                if (!lowSlices.length) continue;

                // Whole product is out if every slice is 0
                const allZero = slices.every(s => s.stock === 0);
                const status = allZero ? 'out_of_stock' : 'low_stock';

                // Aggregate qty displayed — sum across slices for the row
                const totalQty = slices.reduce((t, s) => t + s.stock, 0);
                alerts.push({
                    product: p,
                    qty: totalQty,
                    min,
                    status,
                    sliceCount: lowSlices.length,
                    lowSlices,
                });
            }
            return alerts.sort((a, b) => {
                if (a.status !== b.status) return a.status === 'out_of_stock' ? -1 : 1;
                return (a.qty - a.min) - (b.qty - b.min);
            });
        }

        function renderBadge(alerts) {
            const count = alerts.length;
            if (count === 0) {
                badge.style.display = 'none';
                btn.setAttribute('title', 'No alerts');
            } else {
                badge.style.display = '';
                badge.textContent = count > 99 ? '99+' : String(count);
                btn.setAttribute('title', `${count} alert${count === 1 ? '' : 's'}`);
            }
        }

        function renderPanel(alerts) {
            if (countEl) countEl.textContent = String(alerts.length);

            if (alerts.length === 0) {
                list.innerHTML = `
                    <div class="notifications-empty">
                        <i class="fas fa-check-circle"></i>
                        <p>All stock levels are healthy</p>
                    </div>`;
                if (footer) footer.style.display = 'none';
                return;
            }

            const visible = alerts.slice(0, MAX_VISIBLE);
            list.innerHTML = visible.map(({ product, qty, min, status, sliceCount, lowSlices }) => {
                const isOut = status === 'out_of_stock';
                const badgeClass = isOut ? 'stock-badge out-of-stock' : 'stock-badge low-stock';
                const badgeLabel = isOut
                    ? 'Out of Stock'
                    : (sliceCount > 1 ? `${sliceCount} sizes low` : `Low: ${qty} / ${min}`);
                const icon = isOut ? 'fa-times-circle' : 'fa-exclamation-triangle';
                const iconClass = isOut ? 'orange' : 'blue';

                // Show the specific slice names when there are 1-3 low ones
                const sliceHint = (sliceCount > 0 && sliceCount <= 3 && !isOut)
                    ? `<div class="notification-slices">${lowSlices
                          .map(s => escapeHtml([s.size, s.brand].filter(Boolean).join(' · ') || 'stock'))
                          .join(', ')}</div>`
                    : '';

                return `
                    <button type="button" class="notification-item">
                        <div class="notification-icon ${iconClass}">
                            <i class="fas ${icon}"></i>
                        </div>
                        <div class="notification-body">
                            <p class="notification-title">${escapeHtml(product.name)}</p>
                            <span class="notification-meta">${escapeHtml(product.sku || 'N/A')} · Qty ${qty}${min ? ` / min ${min}` : ''}</span>
                            ${sliceHint}
                        </div>
                        <span class="${badgeClass}">${badgeLabel}</span>
                    </button>`;
            }).join('');

            if (footer) footer.style.display = alerts.length > MAX_VISIBLE ? '' : 'none';
        }

        function refresh() {
            const alerts = getAlerts();
            renderBadge(alerts);
            renderPanel(alerts);
        }

        function openPanel() {
            panel.classList.add('show');
            btn.setAttribute('aria-expanded', 'true');
            refresh();
        }

        function closePanel() {
            panel.classList.remove('show');
            btn.setAttribute('aria-expanded', 'false');
        }

        function togglePanel() {
            if (panel.classList.contains('show')) closePanel();
            else openPanel();
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePanel();
            btn.style.transform = 'scale(0.92)';
            setTimeout(() => { btn.style.transform = ''; }, 120);
        });

        // Outside click closes the panel
        document.addEventListener('click', (e) => {
            if (!panel.classList.contains('show')) return;
            if (panel.contains(e.target) || btn.contains(e.target)) return;
            closePanel();
        });

        // Esc closes
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && panel.classList.contains('show')) closePanel();
        });

        // Click a row → jump to inventory and close
        list.addEventListener('click', (e) => {
            const item = e.target.closest('.notification-item');
            if (!item) return;
            closePanel();
            window.navigateToPage?.('inventory');
        });

        // "View all" → inventory
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', () => {
                closePanel();
                window.navigateToPage?.('inventory');
            });
        }

        // Live updates
        window.addEventListener('inventory-products-loaded', refresh);
        window.addEventListener('pos-order-created', refresh);
        window.addEventListener('pos-queue-changed', refresh);
        window.posSetInterval(refresh, 30000);
        window.addEventListener('pos-tab-visible', refresh);

                        // Expose for other modules
        window.updateNotificationsBadge = refresh;

        refresh();
    })();


    // ---------- SERVICE WORKER UPDATE NOTIFICATION ----------
    // When a new SW version is installed, it posts SW_UPDATED. We
    // surface that as a clickable toast so the user can reload into
    // the new version at their convenience — no forced reloads.
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data?.type !== 'SW_UPDATED') return;
            if (window.__posSwUpdateShown) return;
            window.__posSwUpdateShown = true;

            const container = document.getElementById('toastContainer');
            if (!container) return;

            const toast = document.createElement('div');
            toast.className = 'toast info';
            toast.style.cursor = 'pointer';
            toast.innerHTML = `
                <i class="fas fa-cloud-arrow-down"></i>
                <span>A new version is available. Tap to reload.</span>
                <button class="toast-close" type="button" aria-label="Dismiss">&times;</button>
            `;
            container.appendChild(toast);

            toast.addEventListener('click', (e) => {
                if (e.target.closest('.toast-close')) {
                    toast.remove();
                    return;
                }
                navigator.serviceWorker.controller?.postMessage('SKIP_WAITING');
                setTimeout(() => window.location.reload(), 100);
            });
        });
    }

    // Expose a read-only settings accessor for pos.js and any other
    // module that needs live store config (tax, GCash, receipt).
    window.POS_SETTINGS = {
        get: function () {
            let stored = {};
            try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) {}
            return { ...SETTINGS_DEFAULTS, ...stored };
        }
    };

    // Expose for auth.js (assigned after the override wrappers, so the
    // session-save/clear behaviour is preserved).
    window.loadDashboard = loadDashboard;
    window.showLoginView = showLoginView;
    window.showView = showView;
    window.updateSystemStatus = updateSystemStatus;
    window.escapeCustomerText = escapeCustomerText;

    init();
    })();
