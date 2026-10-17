/* ai.js — Client wrapper for the POS chatbot backend.
 *
 * Backend endpoints (Python on Vercel):
 *   POST /api/chat      { message, history } -> { success, intent, source, response, data }
 *   POST /api/forecast  { type }             -> { success, type, data }
 *   GET  /api/health
 *
 * Requires a Firebase ID token in the Authorization header. The token
 * is fetched lazily from window.POS_FIREBASE.getIdToken(). If Firebase
 * has not exposed that helper yet, the request proceeds without the
 * header and the backend responds with 401 — the UI shows the error.
 */
(function () {
    'use strict';

    const CHAT_URL = '/api/chat';
    const FORECAST_URL = '/api/forecast';

    const CACHE_PREFIX = 'pos_ai_cache_';
    const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

    // ------------------------------------------------------------
    // Cache helpers (kept from the original implementation)
    // ------------------------------------------------------------
    function readCache(key) {
        try {
            const raw = localStorage.getItem(CACHE_PREFIX + key);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (!entry || !entry.ts || Date.now() - entry.ts > CACHE_TTL_MS) return null;
            return entry.data;
        } catch (e) { return null; }
    }

    function writeCache(key, data) {
        try {
            localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
        } catch (e) {}
    }

    function clearCache(key) {
        try {
            if (!key) {
                Object.keys(localStorage)
                    .filter(k => k.startsWith(CACHE_PREFIX))
                    .forEach(k => localStorage.removeItem(k));
                return;
            }
            localStorage.removeItem(CACHE_PREFIX + key);
        } catch (e) {}
    }

    // Forecasts depend on orders; restock rankings depend on inventory.
    window.addEventListener('pos-order-created', () => clearCache());
    window.addEventListener('inventory-products-changed', () => clearCache('restock_priority'));

    const OFFLINE_REPLY = 'I am offline right now. I can still answer basic stock and sales questions from the data saved on this device.';

    function getOfflineInventory() {
        return (window.getInventorySnapshot?.() || []).map(product => ({
            name: String(product.name || ''),
            quantity: Number(product.quantity ?? product.stock ?? 0),
            minStock: Number(product.minStock ?? product.min_stock ?? 0)
        })).filter(product => product.name);
    }

    function getOfflineOrders() {
        try {
            const orders = JSON.parse(localStorage.getItem('pos_orders') || '[]');
            return Array.isArray(orders) ? orders : [];
        } catch (e) {
            return [];
        }
    }

    function formatOfflineCurrency(value) {
        return 'PHP ' + Number(value || 0).toLocaleString('en-PH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function offlineOrderDate(order) {
        const date = new Date(order.createdAt || '');
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function offlineOrdersForQuestion(question) {
        const orders = getOfflineOrders().filter(order => {
            const status = String(order.status || '').toLowerCase();
            return !['cancelled', 'canceled', 'void', 'voided'].includes(status);
        });
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let start = today;
        if (/\b(this week|weekly|linggo)\b/.test(question)) {
            start = new Date(today);
            start.setDate(today.getDate() - today.getDay() + 1);
        } else if (/\b(this month|monthly|buwan)\b/.test(question)) {
            start = new Date(today.getFullYear(), today.getMonth(), 1);
        } else if (/\b(last 30 days|30 days)\b/.test(question)) {
            start = new Date(today);
            start.setDate(today.getDate() - 29);
        } else if (/\b(yesterday|kahapon)\b/.test(question)) {
            start = new Date(today);
            start.setDate(today.getDate() - 1);
        }
        const end = new Date(start);
        if (/\b(yesterday|kahapon)\b/.test(question)) end.setDate(end.getDate() + 1);
        else end.setDate(today.getDate() + 1);
        return orders.filter(order => {
            const date = offlineOrderDate(order);
            return date && date >= start && date < end;
        });
    }

    function offlineAssistantAnswer(question) {
        const normalized = String(question || '').toLowerCase().trim();
        const inventory = getOfflineInventory();

        if (/^(hi|hello|hey|kumusta|kamusta)\b/.test(normalized)) {
            return 'Hi! I am Kirby in offline mode. I can check saved stock and sales data on this device.';
        }
        if (/\b(help|what can you do|ano ang kaya mo)\b/.test(normalized)) {
            return 'Offline Kirby can check saved stock quantities, low-stock items, out-of-stock items, and today\'s saved sales.';
        }
        if (/\b(low stock|restock|running low|paubos)\b/.test(normalized)) {
            const items = inventory.filter(product => product.quantity <= product.minStock || product.quantity <= 0);
            return items.length
                ? `Saved low-stock items: ${items.slice(0, 8).map(product => `${product.name} (${product.quantity})`).join(', ')}.`
                : 'No low-stock items were found in the saved inventory.';
        }
        if (/\b(out of stock|sold out|no stock|ubos)\b/.test(normalized)) {
            const items = inventory.filter(product => product.quantity <= 0);
            return items.length
                ? `Saved out-of-stock items: ${items.slice(0, 8).map(product => product.name).join(', ')}.`
                : 'No out-of-stock items were found in the saved inventory.';
        }

        if (/\b(best|top|most sold|popular|mabenta)\b/.test(normalized)) {
            const counts = new Map();
            offlineOrdersForQuestion(normalized).forEach(order => {
                (Array.isArray(order.items) ? order.items : []).forEach(item => {
                    const name = String(item.name || 'Unknown item');
                    counts.set(name, (counts.get(name) || 0) + (Number(item.quantity) || 0));
                });
            });
            const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
            return top.length
                ? `Top saved sellers: ${top.map(([name, quantity]) => `${name} (${quantity})`).join(', ')}.`
                : 'There are no saved sales for that period.';
        }

        if (/\b(recent|latest|transaction|order|resibo|transaksyon)\b/.test(normalized)) {
            const recent = getOfflineOrders().filter(order => !['cancelled', 'canceled', 'void', 'voided'].includes(String(order.status || '').toLowerCase())).slice(0, 5);
            return recent.length
                ? `Recent saved orders: ${recent.map(order => `${order.id || 'order'} (${formatOfflineCurrency(order.total)})`).join(', ')}.`
                : 'There are no saved orders on this device.';
        }

        if (/\b(top customers|best customers|customers|customer|suki)\b/.test(normalized)) {
            try {
                const customers = JSON.parse(localStorage.getItem('pos_customers') || '[]');
                const top = (Array.isArray(customers) ? customers : [])
                    .sort((a, b) => (Number(b.totalSpent) || 0) - (Number(a.totalSpent) || 0))
                    .slice(0, 5);
                return top.length
                    ? `Top saved customers: ${top.map(customer => `${customer.name} (${formatOfflineCurrency(customer.totalSpent)})`).join(', ')}.`
                    : 'There are no saved customer records on this device.';
            } catch (e) {
                return 'There are no saved customer records on this device.';
            }
        }

        const matchedProduct = inventory.find(product => normalized.includes(product.name.toLowerCase()));
        if (matchedProduct && /\b(stock|left|quantity|many|ilan|natira|available)\b/.test(normalized)) {
            return `${matchedProduct.name} has ${matchedProduct.quantity} in saved stock.`;
        }

        if (/\b(today|today's|yesterday|this week|this month|last 30 days|sales|benta|revenue|kita)\b/.test(normalized)) {
            const periodOrders = offlineOrdersForQuestion(normalized);
            const total = periodOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
            const label = /\byesterday\b/.test(normalized) ? 'yesterday' : /\b(this week|linggo)\b/.test(normalized) ? 'this week' : /\b(this month|buwan)\b/.test(normalized) ? 'this month' : 'today';
            return `Saved sales for ${label}: ${formatOfflineCurrency(total)} across ${periodOrders.length} order${periodOrders.length === 1 ? '' : 's'}.`;
        }

        return OFFLINE_REPLY;
    }

    // ------------------------------------------------------------
    // Auth token
    // ------------------------------------------------------------
    async function getAuthToken() {
        try {
            const helper = window.POS_FIREBASE?.getIdToken;
            if (typeof helper === 'function') {
                let token = await helper();
                if (token) return token;

                // Firebase may still be restoring browser persistence when
                // the dashboard first opens. Wait for the auth observer
                // before concluding that the user has no token.
                const getCurrentUser = window.POS_FIREBASE?.getCurrentUser;
                if (typeof getCurrentUser === 'function') {
                    const session = await getCurrentUser();
                    if (session?.user) {
                        token = await helper();
                        if (token) return token;
                    }
                }
            }
            // Fallback: reach through the client SDK directly.
            const fb = await window.POS_FIREBASE?.getFirebase?.();
            const user = fb?.auth?.currentUser;
            if (user && typeof user.getIdToken === 'function') {
                return await user.getIdToken();
            }
        } catch (e) {
            console.warn('[AI] Could not obtain Firebase ID token:', e);
        }
        return null;
    }

    // ------------------------------------------------------------
    // Generic POST helper
    // ------------------------------------------------------------
    async function postJson(url, body) {
        const token = await getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        let payload = null;
        try { payload = await res.json(); } catch (e) {}

        if (!res.ok) {
            const msg = payload?.error || (
                res.status === 401
                    ? 'Kirby needs an active signed-in session. Sign in again and retry.'
                    : 'I could not reach Kirby right now. Please check your connection and try again.'
            );
            throw new Error(msg);
        }
        if (!payload || payload.success !== true) {
            throw new Error(payload?.error || 'AI proxy returned an unexpected response.');
        }
        return payload;
    }

    // ------------------------------------------------------------
    // FORECAST — GET /api/forecast { type: 'sales' }
    // ------------------------------------------------------------
    let __forecastInflight = null;

    async function forecastSales({ forceRefresh = false } = {}) {
        const cacheKey = 'forecast_14d';
        if (!forceRefresh) {
            const cached = readCache(cacheKey);
            if (cached) return cached;
        }
        if (__forecastInflight) return __forecastInflight;

        __forecastInflight = (async () => {
            try {
                const json = await postJson(FORECAST_URL, { type: 'sales' });
                const data = json.data || {};

                // Shape the Python payload into what the overview cards expect.
                const list = Array.isArray(data.forecast) ? data.forecast : [];
                const shaped = list.map(d => ({
                    date: d.date,
                    revenue: Number(d.predicted_revenue) || 0,
                    lower: d.lower != null ? Number(d.lower) : null,
                    upper: d.upper != null ? Number(d.upper) : null,
                    confidence: 'medium'
                }));

                let summary = data.message || '';
                if (!summary && data.available === false) {
                    summary = 'Not enough sales history yet to produce a reliable forecast.';
                }
                const trend = (() => {
                    if (!data.available || shaped.length < 2) return 'stable';
                    const first = shaped[0].revenue;
                    const last = shaped[shaped.length - 1].revenue;
                    if (last > first * 1.05) return 'up';
                    if (last < first * 0.95) return 'down';
                    return 'stable';
                })();

                const result = { forecast: shaped, summary, trend, _raw: data };
                writeCache(cacheKey, result);
                return result;
            } finally {
                __forecastInflight = null;
            }
        })();

        return __forecastInflight;
    }

    // ------------------------------------------------------------
    // RESTOCK — GET /api/forecast { type: 'restock' }
    // ------------------------------------------------------------
    let __restockInflight = null;

    async function restockPriority({ forceRefresh = false } = {}) {
        const cacheKey = 'restock_priority';
        if (!forceRefresh) {
            const cached = readCache(cacheKey);
            if (cached) return cached;
        }
        if (__restockInflight) return __restockInflight;

        __restockInflight = (async () => {
            try {
                const json = await postJson(FORECAST_URL, { type: 'restock' });
                const data = json.data || {};
                const items = Array.isArray(data.items) ? data.items : [];
                const result = {
                    items: items.map(i => ({
                        name: i.name,
                        label: i.label || '',
                        size: i.size || '',
                        brand: i.brand || '',
                        urgency: i.urgency || 'low',
                        daysLeft: i.days_left != null ? Number(i.days_left) : null,
                        recommendedOrder: i.recommended_order != null ? Number(i.recommended_order) : 0,
                        stock: i.stock != null ? Number(i.stock) : null,
                        minStock: i.min_stock != null ? Number(i.min_stock) : null,
                        reason: i.reason || ''
                    })),
                    summary: json.response || ''
                };
                writeCache(cacheKey, result);
                return result;
            } finally {
                __restockInflight = null;
            }
        })();

        return __restockInflight;
    }

    // ------------------------------------------------------------
    // CHAT — POST /api/chat { message, history }
    // ------------------------------------------------------------
    async function askQuestion(question, history = []) {
        const trimmed = String(question || '').trim();
        if (!trimmed) return { answer: 'Please type a question.' };

        if (navigator.onLine === false) {
            return { answer: offlineAssistantAnswer(trimmed), intent: 'offline_local', source: 'offline', data: {} };
        }

        const payload = {
            message: trimmed,
            history: Array.isArray(history)
                ? history.slice(-8).map(m => ({
                    role: m.role === 'user' ? 'user' : 'ai',
                    text: String(m.text || '').slice(0, 300)
                }))
                : []
        };

        try {
            const json = await postJson(CHAT_URL, payload);
            return {
                answer: json.response || 'AI returned an unexpected response.',
                intent: json.intent,
                source: json.source,
                data: json.data || {}
            };
        } catch (err) {
            return {
                answer: offlineAssistantAnswer(trimmed),
                intent: 'offline_local',
                source: 'offline',
                data: {}
            };
        }
    }

    // ------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------
    window.POS_AI = {
        forecastSales,
        restockPriority,
        askQuestion,
        clearCache,
        _getAuthToken: getAuthToken
    };
})();