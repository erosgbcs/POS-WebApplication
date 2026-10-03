(function() {
    const TEST_MODE = window.POS_TEST_MODE === true && !window.POS_SUPABASE?.isConfigured?.();
    const KEYS = {
        products: 'pos_test_products',
        customers: 'pos_customers',
        orders: 'pos_orders',
        audit: 'pos_audit_logs',
        profiles: 'pos_test_profiles'
    };

    async function readCsv(path) {
        const response = await fetch(path, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Unable to load ${path} (${response.status}).`);
        if (!window.Papa) throw new Error('The CSV parser did not load. Check your internet connection and reload.');

        const result = window.Papa.parse(await response.text(), {
            header: true,
            skipEmptyLines: 'greedy'
        });
        if (result.errors.length) throw new Error(`Invalid CSV in ${path}: ${result.errors[0].message}`);
        return result.data;
    }

    function number(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function jsonCell(value, fallback) {
        if (!value) return fallback;
        try { return JSON.parse(value); } catch { return fallback; }
    }

    function readProfiles() {
        try {
            const profiles = JSON.parse(localStorage.getItem(KEYS.profiles) || '[]');
            return Array.isArray(profiles) ? profiles : [];
        } catch { return []; }
    }

    function saveProfiles(profiles) {
        localStorage.setItem(KEYS.profiles, JSON.stringify(profiles));
    }

    async function load({ reset = false } = {}) {
        if (!TEST_MODE) throw new Error('CSV test data is available only when Firebase is disabled in test mode.');

        if (!reset && localStorage.getItem('pos_test_data_loaded') === 'true') {
            const readArray = key => {
                try {
                    const value = JSON.parse(localStorage.getItem(key) || '[]');
                    return Array.isArray(value) ? value : [];
                } catch { return []; }
            };
            const data = {
                products: readArray(KEYS.products),
                orders: readArray(KEYS.orders),
                customers: readArray(KEYS.customers),
                auditLogs: readArray(KEYS.audit),
                profiles: readProfiles()
            };
            window.setInventoryProducts?.(data.products);
            window.renderPosCatalog?.(data.products);
            window.renderAuditLogs?.(data.auditLogs);
            window.refreshOverview?.();
            return data;
        }

        const [productRows, orderRows, customerRows, auditRows, profileRows] = await Promise.all([
            readCsv('test-data/products.csv'),
            readCsv('test-data/orders.csv'),
            readCsv('test-data/customers.csv'),
            readCsv('test-data/audit_logs.csv'),
            readCsv('test-data/profiles.csv')
        ]);

        const products = productRows.map(row => ({
            ...row,
            price: number(row.price),
            quantity: number(row.quantity),
            min_stock: number(row.min_stock),
            sizeStocks: jsonCell(row.sizeStocks, null)
        }));
        const orders = orderRows.map(row => ({
            ...row,
            subtotal: number(row.subtotal),
            tax: number(row.tax),
            total: number(row.total),
            items: jsonCell(row.items, [])
        }));
        const customers = customerRows.map(row => ({
            ...row,
            orders: number(row.orders),
            totalSpent: number(row.totalSpent)
        }));
        const auditLogs = auditRows.map(row => ({ ...row }));
        const profiles = profileRows.map(row => ({ ...row }));
        const categories = [...new Set(products.map(product => product.category).filter(Boolean))];

        localStorage.setItem(KEYS.products, JSON.stringify(products));
        localStorage.setItem(KEYS.orders, JSON.stringify(orders));
        localStorage.setItem(KEYS.customers, JSON.stringify(customers));
        localStorage.setItem(KEYS.audit, JSON.stringify(auditLogs));
        localStorage.setItem(KEYS.profiles, JSON.stringify(profiles));
        localStorage.setItem('pos_test_data_loaded', 'true');
        localStorage.setItem('pos_customers_cache_ready', 'true');
        localStorage.setItem('pos_categories', JSON.stringify(categories));
        localStorage.setItem('pos_users_pro_v2', '[]');

        window.setInventoryProducts?.(products);
        window.renderPosCatalog?.(products);
        window.renderAuditLogs?.(auditLogs);
        window.refreshOverview?.();
        window.dispatchEvent(new CustomEvent('pos-order-created'));

        return { products, orders, customers, auditLogs, profiles };
    }

    window.POS_TEST_DATA = { enabled: TEST_MODE, load, readProfiles, saveProfiles };
})();
