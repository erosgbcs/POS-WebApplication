(function() {
    const supabaseApi = window.POS_SUPABASE || {};

    // Example Supabase setup:
    // window.POS_SUPABASE.setConfig({
    //     enabled: true,
    //     url: 'https://your-project-ref.supabase.co',
    //     anonKey: 'your-anon-key',
    //     tableName: 'profiles'
    // });

    const authMode = {
        local: 'local',
        supabase: 'supabase'
    };

    function getAuthMode() {
        return isSupabaseReady() ? authMode.supabase : authMode.local;
    }

    function isSupabaseReady() {
        return !!(supabaseApi && typeof supabaseApi.isConfigured === 'function' && supabaseApi.isConfigured());
    }

    async function signInWithSupabase(email, password) {
        if (!isSupabaseReady()) {
            return { data: null, error: new Error('Supabase is not configured.') };
        }
        return supabaseApi.signInUser({ email, password });
    }

    async function signUpWithSupabase({ fullName, email, password, role }) {
        if (!isSupabaseReady()) {
            return { data: null, error: new Error('Supabase is not configured.') };
        }
        return supabaseApi.signUpUser({ fullName, email, password, role });
    }

    async function resetPasswordWithSupabase(email) {
        if (!isSupabaseReady()) {
            return { data: null, error: new Error('Supabase is not configured.') };
        }
        return supabaseApi.getClient().auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin || window.location.href
        });
    }

    async function signOutWithSupabase() {
        if (!isSupabaseReady()) {
            return { error: new Error('Supabase is not configured.') };
        }
        return supabaseApi.signOut();
    }

   async function getCurrentUser() {
    if (!isSupabaseReady()) {
        return { user: null, error: new Error('Backend is not configured.') };
    }
    // Delegate to firebase.js — it correctly uses user.uid
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

    // ---------- USER DATABASE (localStorage) ----------
    const USERS_KEY = 'pos_users_pro_v2';
    
    function getUsers() {
        try {
            const stored = localStorage.getItem(USERS_KEY);
            if (stored) {
                const users = JSON.parse(stored);
                return Array.isArray(users) ? users : [];
            }
        } catch (e) {
            console.error('Error reading users:', e);
        }
        return [];
    }

    function saveUsers(users) {
        try {
            localStorage.setItem(USERS_KEY, JSON.stringify(users));
        } catch (e) {
            console.error('Error saving users:', e);
        }
    }

    function findUserByEmail(email) {
        return getUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
    }

    function addUser(user) {
        const users = getUsers();
        users.push(user);
        saveUsers(users);
    }

    // ---------- DOM ELEMENTS ----------
    const signinView = document.getElementById('signinView');
    const signupView = document.getElementById('signupView');
    const forgotView = document.getElementById('forgotView');
    const signinForm = document.getElementById('signinForm');
    const signupForm = document.getElementById('signupForm');
    const forgotForm = document.getElementById('forgotForm');
    const signupRoleSelect = document.getElementById('signupRole');
    const adminRoleOption = document.getElementById('adminRoleOption');
    const signupRoleInfo = document.getElementById('signupRoleInfo');
    const roleAvailabilityAlert = document.getElementById('roleAvailabilityAlert');
    const roleAvailabilityText = document.getElementById('roleAvailabilityText');
    const accountRequestsSection = document.getElementById('accountRequestsSection');
    const accountRequestsBody = document.getElementById('accountRequestsBody');
    const accountRequestsStatus = document.getElementById('accountRequestsStatus');
    const loadCsvTestDataBtn = document.getElementById('loadCsvTestDataBtn');
    const resetCsvTestDataBtn = document.getElementById('resetCsvTestDataBtn');
    const accountStatusText = document.getElementById('accountStatusText');
    const loginContainer = document.getElementById('loginContainer');
    const dashboardContainer = document.getElementById('dashboardContainer');
    const userDisplayName = document.getElementById('userDisplayName');
    const dashboardUserName = document.getElementById('dashboardUserName');
    const userDropdownBtn = document.getElementById('userDropdownBtn');
    const userDropdownMenu = document.getElementById('userDropdownMenu');
    const profileMenuBtn = document.getElementById('profileMenuBtn');
    const settingsMenuBtn = document.getElementById('settingsMenuBtn');
    const profileModal = document.getElementById('profileModal');
    const profileModalClose = document.getElementById('profileModalClose');
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
    const orderSearch = document.getElementById('orderSearch');
    const orderStatusFilter = document.getElementById('orderStatusFilter');
    const orderDateFilter = document.getElementById('orderDateFilter');
    const orderCustomDate = document.getElementById('orderCustomDate');
    const exportOrdersBtn = document.getElementById('exportOrdersBtn');
    
    
    let currentUser = null;
    

    const ORDERS_KEY = 'pos_orders';
const AUDIT_KEY = 'pos_audit_logs';
const CUSTOMERS_KEY = 'pos_customers';
    const CUSTOMERS_CACHE_READY_KEY = 'pos_customers_cache_ready';
  

    const ROLE_ACCESS = {
        admin: new Set(['overview', 'pos', 'inventory', 'orders', 'customers', 'reports', 'audit', 'settings']),
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

    

    

    function getFilteredOrders(orders = readStoredRecords(ORDERS_KEY)) {
        const status = orderStatusFilter?.value || '';
        const dateRange = orderDateFilter?.value || '';
        const customDate = orderCustomDate?.value || '';
        const searchTerm = orderSearch?.value.trim().toLowerCase() || '';
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;

        return orders.filter(order => {
            if (status && order.status !== status) return false;

            if (dateRange === 'custom') {
                if (!customDate) return false;
                const timestamp = new Date(order.createdAt);
                if (Number.isNaN(timestamp.getTime())) return false;
                const orderDate = [
                    timestamp.getFullYear(),
                    String(timestamp.getMonth() + 1).padStart(2, '0'),
                    String(timestamp.getDate()).padStart(2, '0')
                ].join('-');
                if (orderDate !== customDate) return false;
            } else if (dateRange) {
                const timestamp = new Date(order.createdAt).getTime();
                if (Number.isNaN(timestamp)) return false;
                const age = now - timestamp;
                if (dateRange === 'Today' && age >= day) return false;
                if (dateRange === 'This Week' && age >= day * 7) return false;
                if (dateRange === 'This Month' && age >= day * 31) return false;
            }

            if (searchTerm) {
                const itemText = (order.items || []).map(item =>
                    [item.name, item.size, item.quantity].filter(Boolean).join(' ')
                ).join(' ');
                const searchableText = [
                    order.id,
                    order.customerName,
                    order.customerPhone,
                    order.status,
                    order.paymentMethod,
                    order.total,
                    itemText
                ].filter(Boolean).join(' ').toLowerCase();
                if (!searchableText.includes(searchTerm)) return false;
            }

            return true;
        });
    }

    function renderOrders(snapshotOrders = null) {
    if (!ordersTableBody) return;
    
    const orders = Array.isArray(snapshotOrders) ? snapshotOrders : readStoredRecords(ORDERS_KEY);
    if (Array.isArray(snapshotOrders)) writeStoredRecords(ORDERS_KEY, orders.slice(0, 500));
    const filtered = getFilteredOrders(orders);
    
    if (!filtered.length) {
        const message = orderDateFilter?.value === 'custom' && !orderCustomDate?.value
            ? 'Choose a date to view orders.'
            : 'No orders found';
        ordersTableBody.innerHTML = `<tr><td colspan="7" class="empty-table-message">${message}</td></tr>`;
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
    orderSearch?.addEventListener('input', () => renderOrders());
    orderStatusFilter?.addEventListener('change', renderOrders);
    orderDateFilter?.addEventListener('change', () => {
        if (orderCustomDate) orderCustomDate.hidden = orderDateFilter.value !== 'custom';
        renderOrders();
    });
    orderCustomDate?.addEventListener('change', renderOrders);
    if (orderCustomDate) orderCustomDate.hidden = orderDateFilter?.value !== 'custom';
    exportOrdersBtn?.addEventListener('click', () => {
        const orders = getFilteredOrders();
        downloadCsv(
            `orders_${new Date().toISOString().split('T')[0]}.csv`,
            ['Order ID', 'Customer', 'Phone', 'Subtotal', 'Tax', 'Total', 'Payment Method', 'Status', 'Date', 'Items'],
            orders.map(order => [
                order.id,
                order.customerName || 'Walk-in customer',
                order.customerPhone || '',
                order.subtotal,
                order.tax,
                order.total,
                order.paymentMethod,
                order.status,
                order.createdAt,
                (order.items || []).map(item => `${item.name || ''}${item.size ? ` (${item.size})` : ''} x${item.quantity}`).join('; ')
            ])
        );
        window.POS_APP_LOG?.('export', 'orders', `${orders.length} order${orders.length === 1 ? '' : 's'} exported`, 'info');
        showToast(`${orders.length} order${orders.length === 1 ? '' : 's'} exported to CSV`, 'success');
    });
    
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
    if (accountRequestsSection) {
        const isAdmin = getUserRole(user) === 'admin';
        accountRequestsSection.hidden = !isAdmin;
        if (isAdmin) renderAccountRequests();
    }
    if (settingsMenuBtn) settingsMenuBtn.hidden = !canAccessPage('settings', user);
    
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
    localStorage.setItem(CUSTOMERS_CACHE_READY_KEY, String(Boolean(window.POS_TEST_DATA?.enabled)));
    
    window.refreshOverview?.();
    
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
            window.refreshOverview?.();
        }),
        window.POS_SUPABASE.subscribeCustomers(customers => {
            renderCustomers(customerSearch?.value || '', customers);
            window.refreshOverview?.();
        }),
        window.POS_SUPABASE.subscribeInventory(products => {
            window.renderPosCatalog?.(products);
            window.setInventoryProducts?.(products);
            window.refreshOverview?.();
        }),
        window.POS_SUPABASE.subscribeAuditLogs(logs => {
    window.renderAuditLogs?.(logs);
    window.renderRecentActivity?.();
})
    ];
    window.flushPendingSales?.();
}

    if (loadCsvTestDataBtn) {
        loadCsvTestDataBtn.hidden = !window.POS_TEST_DATA?.enabled;
        loadCsvTestDataBtn.addEventListener('click', async () => {
            loadCsvTestDataBtn.disabled = true;
            try {
                await window.POS_TEST_DATA.load();
                loadDashboard({
                    uid: 'LOCAL-TEST-ADMIN',
                    email: 'admin@example.test',
                    role: 'admin',
                    user_metadata: { full_name: 'Test Admin', role: 'admin' }
                });
                showToast('Local CSV test data loaded. Firebase remains disconnected.', 'success');
            } catch (error) {
                showToast(error.message || 'Unable to load CSV test data.', 'error');
            } finally {
                loadCsvTestDataBtn.disabled = false;
            }
        });
    }

    if (resetCsvTestDataBtn) {
        resetCsvTestDataBtn.hidden = !window.POS_TEST_DATA?.enabled;
        resetCsvTestDataBtn.addEventListener('click', async () => {
            resetCsvTestDataBtn.disabled = true;
            try {
                await window.POS_TEST_DATA.load({ reset: true });
                await renderAccountRequests();
                showToast('CSV test data reset.', 'success');
            } catch (error) {
                showToast(error.message || 'Unable to reset CSV test data.', 'error');
            } finally {
                resetCsvTestDataBtn.disabled = false;
            }
        });
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
        accountStatusText.textContent = isSupabaseReady()
            ? 'Firebase connected — new accounts require admin approval'
            : window.POS_TEST_DATA?.enabled
                ? 'Local test mode — Firebase is disconnected'
                : 'Firebase connection required for account approval';
        updateSignupRoleAvailability();
    }

    // ---------- UPDATE SIGNUP ROLE ----------
    function updateSignupRoleAvailability() {
        if (!signupRoleSelect) return;
        if (adminRoleOption) adminRoleOption.disabled = false;
        if (signupRoleInfo) signupRoleInfo.textContent = 'An administrator must approve your account and requested role before you can sign in.';
        if (roleAvailabilityAlert) {
            roleAvailabilityAlert.style.display = 'flex';
            roleAvailabilityAlert.className = 'alert-box info';
            roleAvailabilityText.textContent = isSupabaseReady()
                ? 'New accounts stay locked until an administrator approves them.'
                : window.POS_TEST_DATA?.enabled
                    ? 'Local test requests are stored in this browser and require approval.'
                    : 'Account requests require a configured Firebase connection.';
        }
    }

    async function renderAccountRequests() {
        if (!accountRequestsBody) return;
        const isAdmin = getUserRole() === 'admin';
        if (accountRequestsSection) accountRequestsSection.hidden = !isAdmin;
        if (!isAdmin) return;

        accountRequestsStatus.textContent = 'Loading account requests...';
        const result = window.POS_TEST_DATA?.enabled
            ? { data: window.POS_TEST_DATA.readProfiles(), error: null }
            : await supabaseApi.getUsers();
        const { data, error } = result;
        if (error) {
            accountRequestsBody.innerHTML = '<tr><td colspan="5" class="empty-table-message">Unable to load requests.</td></tr>';
            accountRequestsStatus.textContent = error.message || 'Unable to load account requests.';
            return;
        }

        const pending = (Array.isArray(data) ? data : []).filter(profile => profile.status === 'pending');
        if (!pending.length) {
            accountRequestsBody.innerHTML = '<tr><td colspan="5" class="empty-table-message">No pending account requests.</td></tr>';
            accountRequestsStatus.textContent = '';
            return;
        }

        accountRequestsBody.innerHTML = pending.map(profile => {
            const requestedRole = profile.requested_role === 'admin' ? 'admin' : 'cashier';
            const submitted = profile.created_at ? new Date(profile.created_at).toLocaleString() : '—';
            return `<tr data-profile-id="${escapeCustomerText(profile.id)}">
                <td>${escapeCustomerText(profile.full_name || profile.email || 'Unknown')}<br><small>${escapeCustomerText(profile.email || '')}</small></td>
                <td>${requestedRole === 'admin' ? 'Admin' : 'Cashier'}</td>
                <td>${escapeCustomerText(submitted)}</td>
                <td><select class="filter-select account-request-role" aria-label="Role to grant">
                    <option value="cashier"${requestedRole === 'cashier' ? ' selected' : ''}>Cashier</option>
                    <option value="admin"${requestedRole === 'admin' ? ' selected' : ''}>Admin</option>
                </select></td>
                <td><div class="account-request-actions">
                    <button type="button" class="secondary-btn" data-account-action="approve">Approve</button>
                    <button type="button" class="secondary-btn" data-account-action="reject">Reject</button>
                </div></td>
            </tr>`;
        }).join('');
        accountRequestsStatus.textContent = `${pending.length} request${pending.length === 1 ? '' : 's'} awaiting review.`;
    }

    function setupAccountRequestActions() {
        accountRequestsBody?.addEventListener('click', async event => {
            const button = event.target.closest('[data-account-action]');
            if (!button || getUserRole() !== 'admin') return;

            const row = button.closest('tr[data-profile-id]');
            const profileId = row?.dataset.profileId;
            const decision = button.dataset.accountAction;
            if (!profileId || !['approve', 'reject'].includes(decision)) return;

            button.disabled = true;
            const status = decision === 'approve' ? 'approved' : 'rejected';
            const role = row.querySelector('.account-request-role')?.value || 'cashier';
            const localTestMode = window.POS_TEST_DATA?.enabled === true;
            if (status === 'approved' && role === 'admin') {
                const profileResult = localTestMode
                    ? { data: window.POS_TEST_DATA.readProfiles(), error: null }
                    : await supabaseApi.getUsers();
                const { data: profiles, error: profilesError } = profileResult;
                if (profilesError) {
                    button.disabled = false;
                    showToast(profilesError.message || 'Unable to verify administrator limit.', 'error');
                    return;
                }
                const adminCount = (profiles || []).filter(profile =>
                    profile.role === 'admin' && (!profile.status || profile.status === 'approved')
                ).length;
                if (adminCount >= 2) {
                    button.disabled = false;
                    showToast('The maximum of two administrator accounts has been reached.', 'error');
                    return;
                }
            }
            let error = null;
            if (localTestMode) {
                const profiles = window.POS_TEST_DATA.readProfiles();
                const profile = profiles.find(item => String(item.id) === String(profileId));
                if (!profile) {
                    error = new Error('Test account request was not found.');
                } else {
                    profile.status = status;
                    profile.status_updated_at = new Date().toISOString();
                    profile.status_updated_by = currentUser?.uid || '';
                    if (status === 'approved') profile.role = role;
                    window.POS_TEST_DATA.saveProfiles(profiles);

                    const users = getUsers();
                    const localUser = users.find(item => item.email.toLowerCase() === profile.email.toLowerCase());
                    if (localUser && status === 'approved') {
                        localUser.role = role;
                        saveUsers(users);
                    }
                }
            } else {
                ({ error } = await supabaseApi.updateProfileApproval(profileId, status, role));
            }
            if (error) {
                button.disabled = false;
                showToast(error.message || 'Unable to update account request.', 'error');
                return;
            }

            showToast(decision === 'approve' ? 'Account approved.' : 'Account request rejected.', 'success');
            await renderAccountRequests();
        });
    }

    // ---------- SHOW VIEW ----------
    function showView(view) {
        if (signinView) signinView.style.display = 'none';
        if (signupView) signupView.style.display = 'none';
        if (forgotView) forgotView.style.display = 'none';
        if (view) view.style.display = 'block';
        
        // Scroll to top on mobile
        if (isMobile()) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        
        if (view === signupView) {
            updateSignupRoleAvailability();
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

    // ---------- FORM SWITCHING ----------
    const createAccountBtn = document.getElementById('createAccountBtn');
    const backToSignin = document.getElementById('backToSignin');
    const forgotLink = document.getElementById('forgotLink');
    const backToSigninFromForgot = document.getElementById('backToSigninFromForgot');

    if (createAccountBtn) {
        createAccountBtn.addEventListener('click', () => {
            showView(signupView);
            setTimeout(() => {
                const el = document.getElementById('signupFullName');
                if (el) el.focus();
            }, 100);
        });
    }
    
    if (backToSignin) {
        backToSignin.addEventListener('click', () => {
            showView(signinView);
            updateSystemStatus();
        });
    }
    
    if (forgotLink) {
        forgotLink.addEventListener('click', () => {
            showView(forgotView);
            setTimeout(() => {
                const el = document.getElementById('forgotEmail');
                if (el) el.focus();
            }, 100);
        });
    }
    
    if (backToSigninFromForgot) {
        backToSigninFromForgot.addEventListener('click', () => {
            showView(signinView);
            updateSystemStatus();
        });
    }

    // ---------- VALIDATION ----------
    function validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }
    
    function setError(id, msg) {
        const errorEl = document.getElementById(id);
        if (errorEl) {
            errorEl.textContent = msg;
            if (isMobile() && msg) {
                errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }
    
    function clearErrors() {
        document.querySelectorAll('.error-message, .info-message').forEach(el => el.textContent = '');
    }

    // ---------- SIGN IN ----------
    if (signinForm) {
        signinForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearErrors();
            const email = document.getElementById('signinEmail')?.value.trim() || '';
            const password = document.getElementById('signinPassword')?.value || '';
            let valid = true;

            if (!email) { setError('signinEmailError', 'Email is required'); valid = false; }
            else if (!validateEmail(email)) { setError('signinEmailError', 'Invalid email format'); valid = false; }
            if (!password) { setError('signinPasswordError', 'Password is required'); valid = false; }
            else if (password.length < 6) { setError('signinPasswordError', 'Minimum 6 characters'); valid = false; }

            if (!valid) return;

            const btn = document.getElementById('signinSubmitBtn');
            if (btn) {
                btn.classList.add('loading');
                btn.disabled = true;
            }

            try {
                if (getAuthMode() === authMode.supabase) {
                    const { data, error } = await signInWithSupabase(email, password);
                    if (error) throw error;
                    
                    if (data?.user) {
    loadDashboard(data.user);
    // Log the login for owner monitoring.
    window.POS_APP_LOG?.('login', 'auth', `${data.user.user_metadata?.full_name || data.user.email} signed in`, 'info');
    // Close dropdown if open
    if (userDropdownMenu) userDropdownMenu.classList.remove('show');
}
return;
                }

                // Local mode
                await new Promise(r => setTimeout(r, 800));
                const user = findUserByEmail(email);
                if (user && user.password === password) {
                    const profile = window.POS_TEST_DATA?.enabled
                        ? window.POS_TEST_DATA.readProfiles().find(item => item.email.toLowerCase() === user.email.toLowerCase())
                        : null;
                    if (profile?.status === 'pending') {
                        showToast('Your account is awaiting administrator approval.', 'error');
                        return;
                    }
                    if (profile?.status === 'rejected') {
                        showToast('Your account request was not approved. Contact an administrator.', 'error');
                        return;
                    }
                    const role = profile?.role || user.role;
                    showToast(`Welcome back, ${user.name}!`, 'success');
                    loadDashboard({
                        email: user.email,
                        role,
                        user_metadata: { full_name: user.name, role }
                    });
                    window.POS_APP_LOG?.('login', 'auth', `${user.name} signed in`, 'info');
} else if (user) {
    showToast('Incorrect password.', 'error');
} else {
    showToast('No account found with this email.', 'error');
}
            } catch (error) {
                const message = error?.message || 'Unable to sign in.';
                showToast(message, 'error');
            } finally {
                if (btn) {
                    btn.classList.remove('loading');
                    btn.disabled = false;
                }
            }
        });
    }

// ---------- SIGN UP ----------
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors();
        const name = document.getElementById('signupFullName')?.value.trim() || '';
        const email = document.getElementById('signupEmail')?.value.trim() || '';
        const role = document.getElementById('signupRole')?.value || 'cashier';
        const password = document.getElementById('signupPassword')?.value || '';
        const confirm = document.getElementById('signupConfirmPassword')?.value || '';
        const agree = document.getElementById('agreeTerms')?.checked || false;
        let valid = true;

        if (!isSupabaseReady() && !window.POS_TEST_DATA?.enabled) {
            showToast('Account requests require a configured Firebase connection.', 'error');
            return;
        }

        if (!name) { setError('signupFullNameError', 'Your name is required'); valid = false; }
        else if (name.length < 2) { setError('signupFullNameError', 'Minimum 2 characters'); valid = false; }
        if (!email) { setError('signupEmailError', 'Email is required'); valid = false; }
        else if (!validateEmail(email)) { setError('signupEmailError', 'Invalid email format'); valid = false; }
        else if (!isSupabaseReady() && findUserByEmail(email)) {
            setError('signupEmailError', 'Email already registered'); valid = false;
        }
        if (!password) { setError('signupPasswordError', 'Password is required'); valid = false; }
        else if (password.length < 6) { setError('signupPasswordError', 'Minimum 6 characters'); valid = false; }
        if (password !== confirm) { setError('signupConfirmPasswordError', 'Passwords do not match'); valid = false; }
        if (!agree) { setError('termsError', 'You must agree to terms'); valid = false; }

        if (!valid) return;

        const btn = document.getElementById('signupSubmitBtn');
        if (btn) {
            btn.classList.add('loading');
            btn.disabled = true;
        }

        try {
            if (isSupabaseReady()) {
                const { data, error } = await signUpWithSupabase({ fullName: name, email, password, role });
                if (error) throw error;
                if (!data?.pendingApproval) throw new Error('Account request was not saved for review.');
            } else {
                const profiles = window.POS_TEST_DATA.readProfiles();
                profiles.push({
                    id: `LOCAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    email,
                    full_name: name,
                    role: 'cashier',
                    requested_role: role === 'admin' ? 'admin' : 'cashier',
                    status: 'pending',
                    created_at: new Date().toISOString()
                });
                window.POS_TEST_DATA.saveProfiles(profiles);
                addUser({ name, email, password, role: 'cashier' });
            }

            const signinEmail = document.getElementById('signinEmail');
            const signinPassword = document.getElementById('signinPassword');
            if (signinEmail) signinEmail.value = email;
            if (signinPassword) signinPassword.value = '';
            showView(signinView);
            showToast('Request submitted. An administrator must approve your account before you can sign in.', 'success');
        } catch (error) {
            const message = error?.message || 'Unable to create account.';
            showToast(message, 'error');
        } finally {
            if (btn) {
                btn.classList.remove('loading');
                btn.disabled = false;
            }
        }
    });
}

    // ---------- FORGOT PASSWORD ----------
    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearErrors();
            const email = document.getElementById('forgotEmail')?.value.trim() || '';
            let valid = true;

            if (!email) { setError('forgotEmailError', 'Email is required'); valid = false; }
            else if (!validateEmail(email)) { setError('forgotEmailError', 'Invalid email format'); valid = false; }

            if (!valid) return;

            const btn = document.getElementById('forgotSubmitBtn');
            if (btn) {
                btn.classList.add('loading');
                btn.disabled = true;
            }

            try {
                if (getAuthMode() === authMode.supabase) {
                    const { error } = await resetPasswordWithSupabase(email);
                    if (error) throw error;

                    const infoBox = document.getElementById('forgotInfoBox');
                    const infoText = document.getElementById('forgotInfoText');
                    if (infoBox) {
                        infoBox.style.display = 'flex';
                        infoBox.className = 'alert-box success';
                    }
                    if (infoText) {
                        infoText.textContent = `Reset link sent to ${email}. Check your inbox.`;
                    }
                    showToast('Password reset link sent!', 'success');
                    return;
                }

                // Local mode
                await new Promise(r => setTimeout(r, 800));
                const user = findUserByEmail(email);
                const infoBox = document.getElementById('forgotInfoBox');
                const infoText = document.getElementById('forgotInfoText');

                if (infoBox) {
                    infoBox.style.display = 'flex';
                    infoBox.className = user ? 'alert-box success' : 'alert-box error';
                }
                if (infoText) {
                    infoText.textContent = user 
                        ? `Reset link sent to ${user.email}. Check your inbox.`
                        : `No account found with ${email}.`;
                }
                showToast(user ? 'Password reset link sent!' : 'No account found with this email', 
                         user ? 'success' : 'error');
            } catch (error) {
                const infoBox = document.getElementById('forgotInfoBox');
                const infoText = document.getElementById('forgotInfoText');
                if (infoBox) {
                    infoBox.style.display = 'flex';
                    infoBox.className = 'alert-box error';
                }
                if (infoText) {
                    infoText.textContent = error?.message || 'Unable to reset password.';
                }
                showToast(error?.message || 'Unable to reset password.', 'error');
            } finally {
                if (btn) {
                    btn.classList.remove('loading');
                    btn.disabled = false;
                }
            }
        });
    }

    // ---------- LOGOUT ----------
    // ---------- LOGOUT ----------
async function logout() {
        try {
            // Log BEFORE we clear the session so we still know who it was.
            const name = currentUser?.user_metadata?.full_name || currentUser?.email || 'Unknown user';
            window.POS_APP_LOG?.('logout', 'auth', `${name} signed out`, 'info');
            
            if (window._posUnsubscribers) {
                window._posUnsubscribers.forEach(fn => { try { fn(); } catch (e) {} });
                window._posUnsubscribers = null;
            }
            if (getAuthMode() === authMode.supabase) {
                const { error } = await signOutWithSupabase();
                if (error) throw error;
            }
            showLoginView();
        showToast('Logged out successfully', 'success');
        if (userDropdownMenu) userDropdownMenu.classList.remove('show');
    } catch (error) {
        showToast(error?.message || 'Error logging out', 'error');
    }
}

    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    if (sidebarLogoutBtn) sidebarLogoutBtn.addEventListener('click', logout);

    // ---------- USER DROPDOWN TOGGLE ----------
    function closeUserDropdown() {
        userDropdownMenu?.classList.remove('show');
        userDropdownBtn?.setAttribute('aria-expanded', 'false');
    }

    if (userDropdownBtn) {
        userDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = userDropdownMenu?.classList.toggle('show') || false;
            userDropdownBtn.setAttribute('aria-expanded', String(isOpen));
        });
    }

    document.addEventListener('click', () => {
        closeUserDropdown();
    });

    function closeProfileModal() {
        profileModal?.classList.remove('show');
        profileModal?.setAttribute('aria-hidden', 'true');
        userDropdownBtn?.focus();
    }

    profileMenuBtn?.addEventListener('click', () => {
        const name = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'User';
        document.getElementById('profileName').textContent = name;
        document.getElementById('profileEmail').textContent = currentUser?.email || '—';
        document.getElementById('profileRole').textContent = getUserRole().replace(/^./, character => character.toUpperCase());
        document.getElementById('profileSession').textContent = isSupabaseReady() ? 'Approved account' : 'Local test session';
        closeUserDropdown();
        profileModal?.classList.add('show');
        profileModal?.setAttribute('aria-hidden', 'false');
        profileModalClose?.focus();
    });

    settingsMenuBtn?.addEventListener('click', () => {
        closeUserDropdown();
        if (canAccessPage('settings')) window.navigateToPage('settings');
    });

    profileModalClose?.addEventListener('click', closeProfileModal);
    profileModal?.addEventListener('click', event => {
        if (event.target === profileModal) closeProfileModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        closeUserDropdown();
        if (profileModal?.classList.contains('show')) closeProfileModal();
    });

    // ---------- MOBILE SIDEBAR TOGGLE ----------
    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            if (sidebar) sidebar.classList.toggle('open');
        });
    }

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
        if (page === 'settings') renderAccountRequests();
        
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
        window.reloadPosCatalog?.(); // ← ADD
    }
    if (page === 'settings') renderAccountRequests();
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

    // ---------- ROLE CHANGE ----------
    if (signupRoleSelect) {
        signupRoleSelect.addEventListener('change', function() {
            if (roleAvailabilityAlert) {
                roleAvailabilityAlert.style.display = 'flex';
                if (this.value === 'admin') {
                    roleAvailabilityAlert.className = 'alert-box info';
                    if (roleAvailabilityText) {
                        roleAvailabilityText.textContent = 'Admin access is granted only if an administrator approves this request.';
                    }
                } else {
                    roleAvailabilityAlert.className = 'alert-box info';
                    if (roleAvailabilityText) {
                        roleAvailabilityText.textContent = 'Cashier access is granted only after an administrator approves this request.';
                    }
                }
            }
        });
    }

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

    // ---------- CHECK AUTH STATUS ON LOAD ----------
async function checkAuth() {
    // Firebase sessions must be backed by a currently approved profile.
    if (getAuthMode() === authMode.supabase) {
        try {
            const { user, error } = await getCurrentUser();
            if (user) {
                loadDashboard(user);
                return;
            }
            if (error) console.warn('checkAuth: Firebase session was not approved:', error.message);
        } catch (err) {
            console.warn('checkAuth: unable to validate Firebase session', err);
        }

        localStorage.removeItem('pos_current_user');
        showLoginView();
        return;
    }

    // Local demo sessions are only used when Firebase is not configured.
    if (window.POS_TEST_DATA?.enabled && localStorage.getItem('pos_test_data_loaded') !== 'true') {
        localStorage.removeItem('pos_current_user');
        showLoginView();
        return;
    }

    const cached = localStorage.getItem('pos_current_user');
    if (cached) {
        try {
            const user = JSON.parse(cached);
            if (getAuthMode() !== authMode.supabase && user?.email) {
                const stored = findUserByEmail(user.email);
                if (stored) {
                    user.role = stored.role;
                    user.user_metadata = {
                        ...(user.user_metadata || {}),
                        role: stored.role
                    };
                }
            }
            loadDashboard(user);
            return;
        } catch (e) {
            localStorage.removeItem('pos_current_user');
        }
    }

    // Step 3: no session — show login
    showLoginView();
}

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
    setupAccountRequestActions();
window.setupAuditFeatures?.();
window.setupOverview?.();
    
    // Check authentication status
    checkAuth();

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


    init();
    })();

