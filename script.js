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
    
    // Disable animations on mobile for better performance
    if (isMobile()) {
        const style = document.createElement('style');
        style.textContent = `
            * { animation-duration: 0.1s !important; }
            .bg-glow, .geo-shape { animation-duration: 0.1s !important; }
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
    const settingStoreName = document.getElementById('settingStoreName');
    const settingCurrency = document.getElementById('settingCurrency');
    const settingTimeZone = document.getElementById('settingTimeZone');
    const settingLowStockNotifications = document.getElementById('settingLowStockNotifications');
    const settingDailyReports = document.getElementById('settingDailyReports');
    const settingWeeklySummary = document.getElementById('settingWeeklySummary');
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

    async function loadSettings() {
    let settings = {};
    try {
        settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    } catch (e) {}
    
    try {
        const { data } = await window.POS_SUPABASE.getSettings();
        if (data) settings = { ...settings, ...data };
    } catch (e) {}
    
    if (settingStoreName && typeof settings.storeName === 'string') settingStoreName.value = settings.storeName;
    if (settingCurrency && settings.currency) settingCurrency.value = settings.currency;
    if (settingTimeZone && settings.timeZone) settingTimeZone.value = settings.timeZone;
    if (settingLowStockNotifications && typeof settings.lowStockNotifications === 'boolean') settingLowStockNotifications.checked = settings.lowStockNotifications;
    if (settingDailyReports && typeof settings.dailyReports === 'boolean') settingDailyReports.checked = settings.dailyReports;
    if (settingWeeklySummary && typeof settings.weeklySummary === 'boolean') settingWeeklySummary.checked = settings.weeklySummary;
    
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

    async function saveSettings() {
    const settings = {
        storeName: settingStoreName?.value.trim() || "Kirby's Hardware",
        currency: settingCurrency?.value || 'PHP',
        timeZone: settingTimeZone?.value || 'UTC-8',
        lowStockNotifications: settingLowStockNotifications?.checked ?? true,
        dailyReports: settingDailyReports?.checked ?? true,
        weeklySummary: settingWeeklySummary?.checked ?? false
    };
    
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
    
    const { error } = await window.POS_SUPABASE.saveSettings(settings);
    if (error) {
        showToast('Unable to save settings to cloud', 'error');
        return;
    }
        window.POS_APP_LOG?.('update', 'settings', 'System settings updated', 'info');
    showToast('Settings saved successfully', 'success');
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
    if (Array.isArray(snapshotOrders)) writeStoredRecords(ORDERS_KEY, orders.slice(0, 500));
    
    const status = orderStatusFilter?.value || '';
    const dateRange = orderDateFilter?.value || '';
    const now = Date.now();
    
    const filtered = orders.filter(order => {
        if (status && order.status !== status) return false;
        if (!dateRange) return true;
        const age = now - new Date(order.createdAt).getTime();
        const day = 24 * 60 * 60 * 1000;
        if (dateRange === 'Today') return age < day;
        if (dateRange === 'This Week') return age < day * 7;
        if (dateRange === 'This Month') return age < day * 31;
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
    
    const items = order.items || [];
    
    // Meta block — customer, receipt, payment
    document.getElementById('orderDetailsMeta').innerHTML = `
        <div class="order-details-row">
            <span>Receipt No</span>
            <strong>${escapeCustomerText(order.id)}</strong>
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
            <strong>${new Date(order.createdAt).toLocaleString()}</strong>
        </div>
        <div class="order-details-row">
            <span>Payment</span>
            <strong>${escapeCustomerText((order.paymentMethod || 'cash').toUpperCase())}</strong>
        </div>
    `;
    
    // Items block
    if (items.length === 0) {
        document.getElementById('orderDetailsItems').innerHTML = `
            <p style="text-align:center;color:var(--text-secondary);padding:1rem 0;">No items recorded</p>`;
    } else {
        document.getElementById('orderDetailsItems').innerHTML = items.map(item => {
            const qty = Number(item.quantity) || 0;
            const price = Number(item.price) || 0;
            const lineTotal = qty * price;
            const sizeLabel = item.size ? ` <span class="order-detail-size">(${escapeCustomerText(item.size)})</span>` : '';
            return `
                <div class="order-details-item">
                    <div class="order-details-item-name">
                        <span>${escapeCustomerText(item.name)}${sizeLabel}</span>
                        <span class="order-details-item-qty">${qty} × ${formatAppCurrency(price)}</span>
                    </div>
                    <strong>${formatAppCurrency(lineTotal)}</strong>
                </div>`;
        }).join('');
    }
    
    // Totals block
    const subtotal = Number(order.subtotal) || 0;
    const tax = Number(order.tax) || 0;
    const total = Number(order.total) || 0;
    document.getElementById('orderDetailsTotals').innerHTML = `
        <div class="order-details-row">
            <span>Subtotal</span>
            <strong>${formatAppCurrency(subtotal)}</strong>
        </div>
        <div class="order-details-row">
            <span>Tax</span>
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

    function generateReport(type) {
        let headers;
        let rows;
        if (type === 'customers') {
            headers = ['Name', 'Email', 'Phone', 'Orders', 'Total Spent'];
            rows = getCustomers().map(customer => [customer.name, customer.email, customer.phone, customer.orders, customer.totalSpent]);
        } else if (type === 'inventory') {
            const products = window.getInventorySnapshot?.() || [];
            headers = ['ID', 'Name', 'SKU', 'Category', 'Price', 'Quantity', 'Min Stock'];
            rows = products.map(product => [product.id, product.name, product.sku, product.category, product.price, product.quantity, product.minStock]);
        } else {
            const orders = readStoredRecords(ORDERS_KEY);
            headers = ['Order ID', 'Customer', 'Subtotal', 'Tax', 'Total', 'Payment', 'Date'];
            rows = orders.map(order => [order.id, order.customerName, order.subtotal, order.tax, order.total, order.paymentMethod, order.createdAt]);
        }
        downloadCsv(`${type}_report_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    window.POS_APP_LOG?.('export', 'reports', `${type} report exported`, 'info');
    showToast(`${type[0].toUpperCase()}${type.slice(1)} report exported`, 'success');
    }
    
    function setupReportFeatures() {
        document.querySelectorAll('.report-generate-btn').forEach(button => {
            button.addEventListener('click', () => generateReport(button.dataset.report));
        });
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
    
    // Re-render charts with theme-appropriate colors
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
    }

            function initializeTheme() {
        let savedTheme = 'light';
        try {
            savedTheme = localStorage.getItem(THEME_KEY) || 'light';
        } catch (e) {}
        
        applyTheme(savedTheme);
        
        // Shared toggle handler — used by both the login-page toggle
        // and the dashboard-nav toggle so they stay in sync via localStorage.
        const toggleTheme = () => {
            const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
            applyTheme(nextTheme);
            try {
                localStorage.setItem(THEME_KEY, nextTheme);
            } catch (e) {}
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
        toast.innerHTML = `
            <i class="fas ${icon}"></i>
            <span>${message}</span>
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
function getOverviewDayKey(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return d.toISOString().split('T')[0];
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
        const duration = 500;
        const start = performance.now();
        const step = (now) => {
            const t = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            const current = fromValue + (toValue - fromValue) * eased;
            el.textContent = formatter(current);
            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                el.dataset.rawValue = String(toValue);
                el.textContent = formatter(toValue);
            }
        };
        el.dataset.rawValue = String(toValue);
        el.classList.remove('kpi-animate');
        void el.offsetWidth;
        el.classList.add('kpi-animate');
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

    // Subtitle
    const subtitleEl = document.getElementById('ovCategorySubtitle');
    if (subtitleEl) {
        if (total === 0) {
            subtitleEl.textContent = `No sales in the ${getTopProductsPeriodLabel(period).toLowerCase()}`;
        } else {
            let text = `${sorted.length} categor${sorted.length === 1 ? 'y' : 'ies'} · ${formatAppCurrency(total)} total`;
            if (compareEnabled && previousTotal > 0) {
                const delta = ((total - previousTotal) / previousTotal) * 100;
                const sign = delta >= 0 ? '+' : '';
                const color = delta >= 0 ? '#4ade80' : '#f87171';
                text += ` · <strong style="color:${color}">${sign}${delta.toFixed(1)}%</strong> vs prev`;
            }
            subtitleEl.innerHTML = text;
        }
    }

    if (ovCategoryChartInstance) ovCategoryChartInstance.destroy();

    const isLight = document.documentElement.dataset.theme === 'light';
    const legendColor = isLight ? '#334155' : '#cbd5e1';

    ovCategoryChartInstance = new Chart(canvas, {
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
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: legendColor,
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
    
    if (ovTopProductsChartInstance) ovTopProductsChartInstance.destroy();
    
    const isLight = document.documentElement.dataset.theme === 'light';
    const gridColor = isLight ? 'rgba(148, 163, 184, 0.25)' : 'rgba(255, 255, 255, 0.08)';
    const tickColor = isLight ? '#475569' : '#94a3b8';
    
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
    
    ovTopProductsChartInstance = new Chart(canvas, {
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

    if (ovSalesChartInstance) ovSalesChartInstance.destroy();

    const isLight = document.documentElement.dataset.theme === 'light';
    const gridColor = isLight ? 'rgba(148, 163, 184, 0.25)' : 'rgba(255, 255, 255, 0.08)';
    const tickColor = isLight ? '#475569' : '#94a3b8';

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

    ovSalesChartInstance = new Chart(canvas, {
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
    const alerts = products
        .map(p => ({
            product: p,
            status: getStockStatusForWidget(p),
            qty: Number(p.quantity) || 0,
            min: Number(p.minStock ?? p.min_stock ?? 0) || 0
        }))
        .filter(item => item.status !== 'in_stock')
        .sort((a, b) => {
            // Out-of-stock items first, then lowest qty relative to min
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
    
    listEl.innerHTML = alerts.map(({ product, status, qty, min }) => {
        const isOut = status === 'out_of_stock';
        const color = isOut ? 'orange' : 'blue';
        const icon = isOut ? 'fa-times-circle' : 'fa-exclamation-triangle';
        const badgeClass = isOut ? 'stock-badge out-of-stock' : 'stock-badge low-stock';
        const badgeLabel = isOut ? 'Out of Stock' : `Low: ${qty} / ${min}`;
        return `
            <div class="activity-item" style="cursor: pointer;" onclick="window.navigateToPage?.('inventory')">
                <div class="activity-icon ${color}">
                    <i class="fas ${icon}"></i>
                </div>
                <div class="activity-content" style="flex: 1;">
                    <p><strong>${escapeCustomerText(product.name)}</strong></p>
                    <span class="activity-time">Product Code: ${escapeCustomerText(product.sku || 'N/A')} · Qty: ${qty}</span>
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
    const hourLabelColor = isLight ? '#475569' : '#94a3b8';
    const dayLabelColor = isLight ? '#334155' : '#cbd5e1';
    
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

function renderAiForecast(container, subtitleEl, data) {
    const list = Array.isArray(data.forecast) ? data.forecast : [];

    if (!list.length) {
        container.innerHTML = `<div class="ai-loading">${escapeCustomerText(data.summary || 'No forecast available yet.')}</div>`;
        if (subtitleEl) subtitleEl.textContent = 'Not enough data';
        return;
    }

    const total = list.reduce((s, d) => s + (Number(d.revenue) || 0), 0);
    const avg = total / list.length;
    const max = Math.max(...list.map(d => Number(d.revenue) || 0), 1);

    if (subtitleEl) {
        const arrow = data.trend === 'up' ? '↗' : data.trend === 'down' ? '↘' : '→';
        subtitleEl.textContent = `${arrow} Expected: ₱${total.toLocaleString('en-PH', { maximumFractionDigits: 0 })} over 14 days`;
    }

    const fmt = v => '₱' + Number(v).toLocaleString('en-PH', { maximumFractionDigits: 0 });

    const bars = list.map(d => {
        const v = Number(d.revenue) || 0;
        const h = Math.max(4, (v / max) * 100);
        return `<div class="ai-forecast-bar" style="height:${h}%" title="${escapeCustomerText(d.date)}: ${fmt(v)} (${escapeCustomerText(d.confidence || 'medium')} confidence)"></div>`;
    }).join('');

    const labels = list.map(d => `<span>${new Date(d.date).getDate()}</span>`).join('');

    container.innerHTML = `
        <div class="ai-forecast-summary">${escapeCustomerText(data.summary || '')}</div>
        <div class="ai-forecast-chart">${bars}</div>
        <div class="ai-forecast-xaxis">${labels}</div>
        <div class="ai-forecast-totals">
            <span>Avg/day: <strong>${fmt(avg)}</strong></span>
            <span>Total: <strong>${fmt(total)}</strong></span>
        </div>
    `;
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
        return `
            <div class="ai-restock-item">
                <div class="ai-restock-icon ${urgency}"><i class="fas ${iconFor(urgency)}"></i></div>
                <div class="ai-restock-body">
                    <span class="ai-restock-name">${escapeCustomerText(item.name)}</span>
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
            const cls = msg.role === 'user' ? 'user' : 'ai';
            html.push(`<div class="ai-bubble ${cls}">${escapeAiText(msg.text)}</div>`);
        });
    }

    threadEl.innerHTML = html.join('');
    threadEl.scrollTop = threadEl.scrollHeight;
}

function appendAiBubble(role, text, extraClass = '') {
    const threadEl = document.getElementById('aiThread');
    if (!threadEl) return;
    const div = document.createElement('div');
    div.className = `ai-bubble ${role}${extraClass ? ' ' + extraClass : ''}`;
    div.innerHTML = escapeAiText(text);
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
            const { answer } = await window.POS_AI.askQuestion(question, priorHistory);
            loadingEl.remove();
            appendAiBubble('ai', answer || 'AI returned an empty response.');

            // Persist to storage
            const history = loadAiThread();
            history.push({ role: 'user', text: question, ts: Date.now() });
            history.push({ role: 'ai', text: answer || '', ts: Date.now() });
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
            const online = navigator.onLine;
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

        // Browser online/offline events
        window.addEventListener('online', () => {
            render();
            window.dispatchEvent(new CustomEvent('pos-queue-flush-request'));
        });
        window.addEventListener('offline', render);

        // Refresh when queue changes (fired by pos.js once outbox is added)
        window.addEventListener('pos-queue-changed', render);
        window.addEventListener('pos-order-created', render);

        // Periodic safety net — every 15s
        setInterval(render, 15000);

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

        function getAlerts() {
            const products = window.getInventorySnapshot?.() || [];
            return products
                .map(p => {
                    const qty = Number(p.quantity) || 0;
                    const min = Number(p.minStock ?? p.min_stock ?? 0) || 0;
                    let status = null;
                    if (qty === 0) status = 'out_of_stock';
                    else if (qty <= min + LOW_STOCK_BUFFER) status = 'low_stock';
                    return status ? { product: p, qty, min, status } : null;
                })
                .filter(Boolean)
                .sort((a, b) => {
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
            list.innerHTML = visible.map(({ product, qty, min, status }) => {
                const isOut = status === 'out_of_stock';
                const badgeClass = isOut ? 'stock-badge out-of-stock' : 'stock-badge low-stock';
                const badgeLabel = isOut ? 'Out of Stock' : `Low: ${qty} / ${min}`;
                const icon = isOut ? 'fa-times-circle' : 'fa-exclamation-triangle';
                const iconClass = isOut ? 'orange' : 'blue';
                return `
                    <button type="button" class="notification-item">
                        <div class="notification-icon ${iconClass}">
                            <i class="fas ${icon}"></i>
                        </div>
                        <div class="notification-body">
                            <p class="notification-title">${escapeHtml(product.name)}</p>
                            <span class="notification-meta">${escapeHtml(product.sku || 'N/A')} · Qty ${qty}${min ? ` / min ${min}` : ''}</span>
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
        setInterval(refresh, 30000);

                        // Expose for other modules
        window.updateNotificationsBadge = refresh;

        refresh();
    })();


    // Expose for auth.js (assigned after the override wrappers, so the
    // session-save/clear behaviour is preserved).
    window.loadDashboard = loadDashboard;
    window.showLoginView = showLoginView;
    window.showView = showView;
    window.updateSystemStatus = updateSystemStatus;
    window.escapeCustomerText = escapeCustomerText;

    init();
    })();

