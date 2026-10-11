/* pos.js - Point of Sale functionality */
(function() {
    
    
    
    // ===================== POS CART & PAYMENT =====================

    // --- DOM elements ---
    const productGrid = document.getElementById('productGrid');
    
    const cartItems = document.getElementById('cartItems');
    const subtotalEl = document.getElementById('subtotal');
    const taxEl = document.getElementById('tax');
    const totalEl = document.getElementById('total');
    const checkoutBtn = document.getElementById('checkoutBtn');
    const clearCartBtn = document.getElementById('clearCartBtn');
    const productSearch = document.getElementById('productSearch');
    const paymentModal = document.getElementById('paymentModal');
    const paymentClose = document.getElementById('paymentClose');
    const receiptModal = document.getElementById('receiptModal');
    const receiptContent = document.getElementById('receiptContent');
    const receiptClose = document.getElementById('receiptClose');
    const receiptDoneBtn = document.getElementById('receiptDoneBtn');
    const printReceiptBtn = document.getElementById('printReceiptBtn');
    const paymentTotal = document.getElementById('paymentTotal');
    const customerName = document.getElementById('customerName');
    const customerPhone = document.getElementById('customerPhone');
    const paymentMethods = document.querySelectorAll('.payment-method');
    const cashInputGroup = document.getElementById('cashInputGroup');
    const cashReceived = document.getElementById('cashReceived');
    const changeAmount = document.getElementById('changeAmount');
    const confirmPaymentBtn = document.getElementById('confirmPaymentBtn');
        // --- GCash QR (values resolved from Settings at render time) ---
    function getGcashSettings() {
        const s = window.POS_SETTINGS?.get?.() || {};
        return {
            number: s.gcashNumber || '0993 591 7971',
            name: s.gcashName || 'Gabriel A'
        };
    }

    function getTaxRatePercent() {
        const s = window.POS_SETTINGS?.get?.() || {};
        const raw = Number(s.taxRate);
        return Number.isFinite(raw) && raw >= 0 ? raw : 8;
    }
    const gcashQrGroup = document.getElementById('gcashQrGroup');
    const gcashQrImage = document.getElementById('gcashQrImage');
    const gcashConfirmCheck = document.getElementById('gcashConfirmCheck');
    const gcashAmountToPay = document.getElementById('gcashAmountToPay');
   
   
   
        function showGcashQr() {
    if (!gcashQrImage) return;
    const { number, name } = getGcashSettings();
    const qrContent = `GCash: ${number} | ${name}`;
    gcashQrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrContent)}`;

    // Refresh the visible Number / Name rows from live settings
    const numEl = document.getElementById('gcashNumberDisplay');
    const nameEl = document.getElementById('gcashNameDisplay');
    if (numEl) numEl.textContent = number;
    if (nameEl) nameEl.textContent = name;

    // Read the total fresh from the modal — never rely on a stale value
    if (gcashAmountToPay) {
        const freshTotalEl = document.getElementById('paymentTotal');
        gcashAmountToPay.textContent = freshTotalEl?.textContent?.trim() || '₱0.00';
    }

    // Reset the reference field and its error
    if (gcashReference) gcashReference.value = '';
    if (gcashReferenceError) gcashReferenceError.style.display = 'none';

    if (gcashQrGroup) gcashQrGroup.style.display = 'block';
    if (gcashConfirmCheck) gcashConfirmCheck.checked = false;
    if (confirmPaymentBtn) confirmPaymentBtn.disabled = true;
}
    
    function hideGcashQr() {
        if (gcashQrGroup) gcashQrGroup.style.display = 'none';
        if (gcashConfirmCheck) gcashConfirmCheck.checked = false;
        if (confirmPaymentBtn) confirmPaymentBtn.disabled = false;
    }
        // --- State ---
    let cart = {}; // { productName: quantity }
    let selectedPaymentMethod = 'cash';
    let receiptClearTimer = null; // fix: cancellable timer for receipt cleanup

    // POS catalog filter state — keeps the grid from rendering
    // the entire product list at once.
    let posCategoryFilter = '';
    let posAllProducts = [];
    let posCategoryInitialized = false;
    
    
    
    const formatCurrency = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0);

    function escapeHtml(value) {
        return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
    }


let productCache = {};
let productCatalogLoaded = false;
let productCatalogLoadPromise = null;

/* ============================================================
   UNIFIED OPTION HANDLING (0/1/2 option groups)
   ============================================================ */

function hasOptions(product) {
    return !!(product && Array.isArray(product.options) && product.options.length > 0);
}

function makeVariantKey(values) {
    return (Array.isArray(values) ? values : []).filter(Boolean).join('::');
}

/**
 * Normalize legacy Firestore shapes (sizeStocks / brandStocks /
 * legacy variants without options) to the new { options, variants }
 * shape. Safe to call repeatedly.
 */
function normalizeProductForPos(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    if (raw.options !== undefined) return raw;

    if (raw.variants && typeof raw.variants === 'object' && Object.keys(raw.variants).length) {
        const keys = Object.keys(raw.variants);
        const isMatrix = keys.some(k => String(k).includes('::'));
        let options;
        if (isMatrix) {
            const s = new Set(), b = new Set();
            keys.forEach(k => { const [a, c] = String(k).split('::'); if (a) s.add(a); if (c) b.add(c); });
            options = [];
            if (s.size) options.push({ name: 'Size', values: [...s] });
            if (b.size) options.push({ name: 'Brand', values: [...b] });
        } else {
            options = [{ name: 'Variant', values: keys }];
        }
        return { ...raw, options, variants: raw.variants };
    }
    if (raw.sizeStocks && Object.keys(raw.sizeStocks).length) {
        const variants = {};
        Object.entries(raw.sizeStocks).forEach(([v, s]) => {
            variants[v] = { price: null, stock: Math.max(0, Number(s) || 0) };
        });
        return { ...raw, options: [{ name: 'Size', values: Object.keys(raw.sizeStocks) }], variants };
    }
    if (raw.brandStocks && Object.keys(raw.brandStocks).length) {
        const variants = {};
        Object.entries(raw.brandStocks).forEach(([v, s]) => {
            variants[v] = { price: null, stock: Math.max(0, Number(s) || 0) };
        });
        return { ...raw, options: [{ name: 'Brand', values: Object.keys(raw.brandStocks) }], variants };
    }
    return { ...raw, options: null, variants: null };
}

function getAvailableStock(product, size = '', brand = '') {
    if (!product) return Infinity;
    if (!hasOptions(product)) return Math.max(0, Number(product.quantity) || 0);
    const key = makeVariantKey([size, brand]);
    const v = (product.variants || {})[key];
    return Math.max(0, Number(v?.stock) || 0);
}

function getTotalStock(product) {
    if (!product) return 0;
    if (!hasOptions(product)) return Math.max(0, Number(product.quantity) || 0);
    return Object.values(product.variants || {}).reduce((t, v) => t + (Number(v?.stock) || 0), 0);
}

function getVariantPrice(product, size = '', brand = '') {
    if (!product) return 0;
    if (!hasOptions(product)) return Number(product.price) || 0;
    const key = makeVariantKey([size, brand]);
    const v = (product.variants || {})[key];
    if (!v || v.price == null) return Number(product.price) || 0;
    return Number(v.price) || 0;
}

function getOptionGroup(product, index) {
    if (!hasOptions(product)) return null;
    return product.options[index] || null;
}

const PENDING_SALES_KEY = 'pos_order_queue';
let pendingSalesFlushPromise = null;

function getPendingSales() {
    try {
        const pendingSales = JSON.parse(localStorage.getItem(PENDING_SALES_KEY) || '[]');
        return Array.isArray(pendingSales) ? pendingSales : [];
    } catch (error) {
        console.warn('Unable to read pending sales:', error);
        return [];
    }
}

function savePendingSales(pendingSales) {
    try {
        localStorage.setItem(PENDING_SALES_KEY, JSON.stringify(pendingSales));
        window.dispatchEvent(new CustomEvent('pos-queue-changed'));
    } catch (error) {
        console.error('Unable to persist pending sale:', error);
        showToast('Sale could not be queued locally. Keep this receipt for reconciliation.', 'error');
    }
}

function setPendingSalesError(error) {
    try {
        if (error) localStorage.setItem('pos_order_queue_error', String(error.message || error));
        else localStorage.removeItem('pos_order_queue_error');
    } catch (storageError) {
        console.warn('Unable to save pending sale status:', storageError);
    }
    window.updateOfflineIndicator?.();
}

function enqueuePendingSale(order) {
    const pendingSales = getPendingSales();
    if (!pendingSales.some(pending => pending.id === order.id)) {
        pendingSales.push(order);
        savePendingSales(pendingSales);
    }
}

async function syncSaleCustomer(order) {
    if (!order.customerName) return;

    try {
        const customersCacheReady = localStorage.getItem('pos_customers_cache_ready') === 'true';
        let customers = JSON.parse(localStorage.getItem('pos_customers') || '[]');
        if (!customersCacheReady) {
            const result = await window.POS_SUPABASE.getCustomers();
            if (!result.error && Array.isArray(result.data)) {
                customers = result.data;
                localStorage.setItem('pos_customers', JSON.stringify(customers));
                localStorage.setItem('pos_customers_cache_ready', 'true');
            }
        }

        const existing = customers.find(customer =>
            customer.name?.toLowerCase() === order.customerName.toLowerCase()
        );
        if (existing) {
            await window.POS_SUPABASE.updateCustomer(existing.id, {
                orders: (Number(existing.orders) || 0) + 1,
                totalSpent: (Number(existing.totalSpent) || 0) + order.total,
                ...(order.customerPhone ? { phone: order.customerPhone } : {})
            });
        } else {
            await window.POS_SUPABASE.addCustomer({
                name: order.customerName,
                email: '',
                phone: order.customerPhone || '',
                orders: 1,
                totalSpent: order.total
            });
        }

        const localExisting = customers.find(customer =>
            customer.name?.toLowerCase() === order.customerName.toLowerCase()
        );
        if (localExisting) {
            localExisting.orders = (Number(localExisting.orders) || 0) + 1;
            localExisting.totalSpent = (Number(localExisting.totalSpent) || 0) + order.total;
            if (order.customerPhone) localExisting.phone = order.customerPhone;
        } else {
            customers.push({
                id: Date.now(),
                name: order.customerName,
                email: '',
                phone: order.customerPhone || '',
                orders: 1,
                totalSpent: order.total
            });
        }
        localStorage.setItem('pos_customers', JSON.stringify(customers));
    } catch (error) {
        console.warn('Customer sync failed:', error);
    }
}

async function flushPendingSales() {
    if (!navigator.onLine || !window.POS_CURRENT_USER || pendingSalesFlushPromise || !window.POS_SUPABASE?.commitSale) return;

    pendingSalesFlushPromise = (async () => {
        const pendingSales = getPendingSales();
        while (pendingSales.length && navigator.onLine) {
            const order = pendingSales[0];
            const result = await window.POS_SUPABASE.commitSale(order);
            if (result.error) {
                console.warn('Pending sale sync failed:', result.error);
                setPendingSalesError(result.error);
                break;
            }

            pendingSales.shift();
            savePendingSales(pendingSales);
            setPendingSalesError(null);
            await syncSaleCustomer(order);
        }
    })().finally(() => {
        pendingSalesFlushPromise = null;
    });

    return pendingSalesFlushPromise;
}

window.flushPendingSales = flushPendingSales;
window.addEventListener('pos-queue-flush-request', flushPendingSales);

function getCartMax(name, size, brand, currentCartKey = '') {
    const product = productCache[name];
    const available = getAvailableStock(product, size, brand);
    const alreadyAllocated = Object.entries(cart).reduce((total, [cartKey, quantity]) => {
        if (cartKey === currentCartKey) return total;
        const item = parseCartKey(cartKey);
        if (item.name !== name) return total;
        if (item.size !== size || item.brand !== brand) return total;
        return total + quantity;
    }, 0);
    return Math.max(0, available - alreadyAllocated);
}

function buildStockUpdates(items) {
    const decrements = new Map();
    for (const item of items) {
        const product = productCache[item.name];
        if (!product?.id) continue;
        if (!decrements.has(product.id)) {
            decrements.set(product.id, { product, sharedQty: 0, byVariant: {} });
        }
        const dec = decrements.get(product.id);
        if (!hasOptions(product)) {
            dec.sharedQty += item.quantity;
        } else {
            const key = makeVariantKey([item.size, item.brand]);
            dec.byVariant[key] = (dec.byVariant[key] || 0) + item.quantity;
        }
    }

    return [...decrements.values()].map(({ product, sharedQty, byVariant }) => {
        if (!hasOptions(product)) {
            return {
                product,
                productId: product.id,
                updates: { quantity: Math.max(0, (Number(product.quantity) || 0) - sharedQty) }
            };
        }
        const variants = {};
        for (const [key, v] of Object.entries(product.variants || {})) {
            variants[key] = { ...v };
        }
        for (const [key, sold] of Object.entries(byVariant)) {
            if (variants[key]) {
                variants[key].stock = Math.max(0, (Number(variants[key].stock) || 0) - sold);
            }
        }
        return {
            product,
            productId: product.id,
            updates: {
                variants,
                quantity: Object.values(variants).reduce((t, v) => t + (Number(v.stock) || 0), 0)
            }
        };
    });
}

/* ============================================================
   POS CATEGORY FILTER
   Renders only the selected category's products to reduce
   DOM node count. productCache is still built from the FULL
   list so cart/stock lookups keep working across categories.
   ============================================================ */
function titleCasePos(value) {
    return String(value || '')
        .split(/[\s_]+/).filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function populatePosCategoryFilter(products) {
    const select = document.getElementById('posCategoryFilter');
    if (!select) return;

    const categories = [...new Set(
        (products || []).map(p => p.category).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    // If the selected category disappeared (deleted / renamed), reset to "All"
    if (posCategoryFilter && !categories.includes(posCategoryFilter)) {
        posCategoryFilter = '';
    }

    // First load — auto-select the first category so we never
    // paint the whole catalog at once. Users can still pick "All".
    if (!posCategoryInitialized && !posCategoryFilter && categories.length > 0) {
        posCategoryFilter = categories[0];
        posCategoryInitialized = true;
    }

    const current = posCategoryFilter;
    select.innerHTML = '<option value="">All Categories</option>' +
        categories.map(c =>
            `<option value="${escapeHtml(c)}">${escapeHtml(titleCasePos(c))}</option>`
        ).join('');
    select.value = current;
}

function renderProductCatalog(products) {
    if (!productGrid) return;
    productCatalogLoaded = true;

    posAllProducts = (Array.isArray(products) ? products : []).map(normalizeProductForPos);

    productCache = {};
    posAllProducts.forEach(p => { if (p.name) productCache[p.name] = p; });

    populatePosCategoryFilter(posAllProducts);

    const visible = posCategoryFilter
        ? posAllProducts.filter(p => (p.category || 'uncategorized') === posCategoryFilter)
        : posAllProducts;

    productGrid.innerHTML = visible.map(product => {
        const qty = getTotalStock(product);
        const opts = Array.isArray(product.options) ? product.options : [];

        const imageHtml = product.image
            ? `<div class="product-card-image"><img src="${product.image}" alt="${escapeHtml(product.name)}" loading="lazy"></div>`
            : '';

        let stockClass = 'in-stock';
        let stockLabel = `${qty} in stock`;
        if (qty === 0) { stockClass = 'out-of-stock'; stockLabel = 'Out of stock'; }
        else if (qty <= 5) { stockClass = 'low-stock'; stockLabel = `${qty} left`; }

        const category = product.category || 'uncategorized';
        const sku = product.sku || 'N/A';
        const meta = `${escapeHtml(category)} · ${escapeHtml(sku)}`;

        let chipsHtml = '';
        if (opts.length === 1) {
            chipsHtml = `<div class="product-card-chips">${(opts[0].values || []).map(v => {
                const s = getAvailableStock(product, v, '');
                const cls = s <= 0 ? ' size-chip-out' : '';
                const stockBit = s > 0 ? ` · ${s}` : ' · 0';
                return `<span class="size-chip${cls}">${escapeHtml(v)}${stockBit}</span>`;
            }).join('')}</div>`;
        } else if (opts.length >= 2) {
            chipsHtml =
                `<div class="product-card-chips">${(opts[0].values || []).map(v =>
                    `<span class="size-chip">${escapeHtml(v)}</span>`).join('')}</div>` +
                `<div class="product-card-chips">${(opts[1].values || []).map(v =>
                    `<span class="size-chip brand-chip"><i class="fas fa-tag"></i> ${escapeHtml(v)}</span>`).join('')}</div>`;
        }

        const optionsAttr = opts.length ? ` data-options="${escapeHtml(JSON.stringify(opts))}"` : '';
        const outClass = qty === 0 ? ' is-out-of-stock' : '';

        let displayPrice = formatCurrency(product.price);
        if (hasOptions(product)) {
            const prices = Object.values(product.variants || {})
                .map(v => v && v.price != null ? Number(v.price) : null)
                .filter(p => p != null);
            if (prices.length > 0) {
                const min = Math.min(...prices);
                const max = Math.max(...prices);
                displayPrice = min === max ? formatCurrency(min) : `${formatCurrency(min)} – ${formatCurrency(max)}`;
            }
        }

        return `<div class="product-card${outClass}" data-id="${product.id}" data-name="${escapeHtml(product.name)}" data-price="${product.price}" data-category="${escapeHtml(category)}" data-stock="${qty}"${optionsAttr}>
            ${imageHtml}
            <div class="product-card-header">
                <h4 class="product-card-name">${escapeHtml(product.name)}</h4>
                <span class="product-card-stock ${stockClass}">${stockLabel}</span>
            </div>
            <div class="product-card-meta">${meta}</div>
            ${chipsHtml}
            <div class="product-card-price">${displayPrice}</div>
        </div>`;
    }).join('');
}
    async function loadProductCatalog() {
    const supabaseApi = window.POS_SUPABASE;
    if (!supabaseApi?.isConfigured?.()) {
        renderProductCatalog([]);
        return;
    }

    const result = await supabaseApi.getInventoryProducts();
    if (result.error) {
        renderProductCatalog([]);

        // Silent on permission errors — they occur on the login screen
        // before the user authenticates and Firestore rules block the read.
        const msg = (result.error.message || '').toLowerCase();
        const isPermissionError = msg.includes('permission')
                               || msg.includes('insufficient');

        if (!isPermissionError) {
            showToast(result.error.message || 'Failed to load products', 'error');
        }
        return;
    }

    renderProductCatalog(result.data || []);
}

    // --- Helper: show toast (using existing toast container) ---
    function showToast(message, type = 'success', options = {}) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}${options.cartUpdate ? ' cart-toast' : ''}`;
        const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
        toast.innerHTML = `
            <i class="fas ${icon}"></i>
            <span>${message}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
        `;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
        }, options.cartUpdate ? 1600 : 4000);
    }

    // --- Get product price from data attribute ---
    function getProductPrice(card) {
        return parseFloat(card.dataset.price) || 0;
    }

    // --- Cart operations ---
    // Cart key format: name::size::brand (both may be empty strings)
    function getCartKey(name, size = '', brand = '') {
        return `${name}::${size}::${brand}`;
    }

    function parseCartKey(cartKey) {
        const parts = String(cartKey).split('::');
        return {
            name: parts[0] || '',
            size: parts[1] || '',
            brand: parts[2] || ''
        };
    }
      // cartPrices tracks the effective price per cart line, so
    // matrix variants can have different prices from the same product.
    const cartPrices = {};

    function addToCart(name, price, size = '', brand = '') {
        const cartKey = getCartKey(name, size, brand);
        const maxStock = getCartMax(name, size, brand, cartKey);
        const currentQty = cart[cartKey] || 0;

        if (currentQty >= maxStock) {
            showToast(`Only ${maxStock} left in stock`, 'error');
            return;
        }

        // Resolve the actual price: variant override > caller-supplied price
        const product = productCache[name];
        const resolved = getVariantPrice(product, size, brand) || price;

        cart[cartKey] = currentQty + 1;
        cartPrices[cartKey] = resolved;
        updateCartDisplay();

        const bits = [name];
        if (size) bits.push(`(${size})`);
        if (brand) bits.push(`· ${brand}`);
        showToast(`Added ${bits.join(' ')} to cart (Qty: ${cart[cartKey]})`, 'success');
    }

    function updateQuantity(cartKey, delta) {
        if (!cart[cartKey]) return;

        // Guard the increase case — cap at available stock
        if (delta > 0) {
            const { name, size, brand } = parseCartKey(cartKey);
            const maxStock = getCartMax(name, size, brand, cartKey);
            if (cart[cartKey] + delta > maxStock) {
                showToast(`Only ${maxStock} left in stock`, 'error');
                return;
            }
        }

        const newQty = cart[cartKey] + delta;

        // Rare path — row being removed → full re-render
        if (newQty <= 0) {
            delete cart[cartKey];
            updateCartDisplay();
            return;
        }

        cart[cartKey] = newQty;

        // Fast path — update only this row + totals
        const row = cartItems.querySelector(`.cart-item-qty-input[data-cart-key="${CSS.escape(cartKey)}"]`)?.closest('.cart-item');
        if (row) {
            const { name, size, brand } = parseCartKey(cartKey);
            const price = getProductPriceByName(name, cartKey);
            const qtyInput = row.querySelector('.cart-item-qty-input');
            const lineTotalEl = row.querySelector('strong');

            if (qtyInput) {
                qtyInput.value = newQty;
                qtyInput.max = getCartMax(name, size, brand, cartKey);
            }
            if (lineTotalEl) lineTotalEl.textContent = formatCurrency(price * newQty);

            updateCartTotals();
        } else {
            updateCartDisplay();
        }
    }
    // --- Phone number formatter (11 digits, auto-spaces: 0917 123 4567) ---
    function formatPhoneInput(rawValue) {
        // Strip everything except digits
        const digits = String(rawValue || '').replace(/\D/g, '').slice(0, 11);
        if (digits.length <= 4) return digits;
        if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
        return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
    }
    
    function isValidPhone(value) {
        const digits = String(value || '').replace(/\D/g, '');
        // Allow empty (optional field). If given, must be exactly 11 digits.
        return digits.length === 0 || digits.length === 11;
    }
    function clearCart() {
        cart = {};
        updateCartDisplay();
        showToast('Cart cleared', 'success');
    }
    // --- Customer phone: live format + validation ---
    const customerPhoneError = document.getElementById('customerPhoneError');
    if (customerPhone) {
        customerPhone.addEventListener('input', () => {
            const caretPos = customerPhone.selectionStart;
            const before = customerPhone.value.length;
            customerPhone.value = formatPhoneInput(customerPhone.value);
            const after = customerPhone.value.length;
            // Keep caret roughly in place when spaces are added
            const delta = after - before;
            try {
                customerPhone.setSelectionRange(caretPos + delta, caretPos + delta);
            } catch (e) {}
            
            // Live validation feedback
            if (customerPhoneError) {
                const digits = customerPhone.value.replace(/\D/g, '');
                const showError = digits.length > 0 && digits.length < 11;
                customerPhoneError.style.display = showError ? 'block' : 'none';
            }
        });
        
        customerPhone.addEventListener('blur', () => {
            const digits = customerPhone.value.replace(/\D/g, '');
            if (digits.length > 0 && digits.length < 11 && customerPhoneError) {
                customerPhoneError.style.display = 'block';
            }
        });
    }
    function updateCartDisplay() {
        // Render cart items
        if (Object.keys(cart).length === 0) {
            cartItems.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); padding: 2rem;">
                    <i class="fas fa-shopping-cart" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                    <p>Cart is empty</p>
                    <p style="font-size: 0.9rem;">Click on products to add them</p>
                </div>
            `;
        } else {
            cartItems.innerHTML = '';
for (const [cartKey, qty] of Object.entries(cart)) {
    const { name, size, brand } = parseCartKey(cartKey);
    const price = getProductPriceByName(name, cartKey);
    const bits = [name];
    if (size) bits.push(`(${size})`);
    if (brand) bits.push(`· ${brand}`);
    const displayName = bits.join(' ');
    const maxStock = getCartMax(name, size, brand, cartKey);
    const itemDiv = document.createElement('div');
    itemDiv.className = 'cart-item';
    itemDiv.innerHTML = `
        <div class="cart-item-info">
            <span class="cart-item-name">${displayName}</span>
            <span class="cart-item-qty">${formatCurrency(price)} each</span>
        </div>
        <div class="cart-item-actions">
            <button class="qty-btn" data-action="decrease" data-cart-key="${cartKey}">
                <i class="fas fa-minus"></i>
            </button>
            <input type="number"
                   class="cart-item-qty-input"
                   value="${qty}"
                   min="1"
                   max="${maxStock}"
                   step="1"
                   data-cart-key="${cartKey}"
                   inputmode="numeric"
                   aria-label="Quantity for ${escapeHtml(displayName)}">
            <button class="qty-btn" data-action="increase" data-cart-key="${cartKey}">
                <i class="fas fa-plus"></i>
            </button>
        </div>
        <strong style="min-width: 80px; text-align: right;">${formatCurrency(price * qty)}</strong>
        <button class="cart-item-remove" data-cart-key="${cartKey}" type="button"
                title="Remove item" aria-label="Remove ${escapeHtml(displayName)} from cart">
            <i class="fas fa-trash"></i>
        </button>
    `;
    cartItems.appendChild(itemDiv);
}
        }

        // Calculate totals
        let subtotal = 0;
        for (const [cartKey, qty] of Object.entries(cart)) {
            const { name } = parseCartKey(cartKey);
            const price = getProductPriceByName(name, cartKey);
            subtotal += price * qty;
        }
        const tax = subtotal * (getTaxRatePercent() / 100);
        const total = subtotal + tax;

        subtotalEl.textContent = formatCurrency(subtotal);
        taxEl.textContent = formatCurrency(tax);
        totalEl.textContent = formatCurrency(total);

        const taxLabel = document.getElementById('taxRateLabel');
        if (taxLabel) taxLabel.textContent = `Tax (${getTaxRatePercent()}%):`;
    }
function updateCartTotals() {
    let subtotal = 0;
    for (const [cartKey, qty] of Object.entries(cart)) {
        const { name } = parseCartKey(cartKey);
        const price = getProductPriceByName(name, cartKey);
        subtotal += price * qty;
    }
    const tax = subtotal * (getTaxRatePercent() / 100);
    const total = subtotal + tax;
    subtotalEl.textContent = formatCurrency(subtotal);
    taxEl.textContent = formatCurrency(tax);
    totalEl.textContent = formatCurrency(total);
}

function commitCartQuantity(cartKey, rawValue) {
    if (!cart[cartKey]) return;
    const { name, size, brand } = parseCartKey(cartKey);
    const maxStock = getCartMax(name, size, brand, cartKey);
    
    // Product went out of stock while in the cart — remove it instead of setting qty to 0
    if (maxStock <= 0) {
        delete cart[cartKey];
        updateCartDisplay();
        showToast('Item is out of stock and was removed from the cart', 'error');
        return;
    }
    
    let newQty = parseInt(rawValue, 10);
    if (Number.isNaN(newQty) || newQty < 1) newQty = 1;
    if (newQty > maxStock) {
        newQty = maxStock;
        showToast(`Only ${maxStock} left in stock`, 'error');
    }
    
    cart[cartKey] = newQty;
    updateCartDisplay();
}

function getProductPriceByName(name, cartKey = '') {
    // Prefer the price stored for this specific cart line (matrix variants differ)
    if (cartKey && cartPrices[cartKey] != null) return Number(cartPrices[cartKey]) || 0;
    const cached = productCache[name];
    if (cached && cached.price != null) return Number(cached.price) || 0;
    const card = productGrid?.querySelector(`.product-card[data-name="${CSS.escape(name)}"]`);
    return card ? parseFloat(card.dataset.price) : 0;
}

function removeFromCart(cartKey) {
    if (!cart[cartKey]) return;
    const { name, size, brand } = parseCartKey(cartKey);
    delete cart[cartKey];
    delete cartPrices[cartKey];
    updateCartDisplay();
    const bits = [name];
    if (size) bits.push(`(${size})`);
    if (brand) bits.push(`· ${brand}`);
    showToast(`Removed ${bits.join(' ')} from cart`, 'success');
}

    // --- Event delegation for product cards (click to add) ---

    /**
     * Opens an inline <select> on the card so the cashier can pick
     * the option value. `chain` is the array of values already chosen
     * for earlier option groups. `groupIndex` identifies which group
     * this selector is for.
     */
    function showOptionSelector(card, name, price, group, groupIndex, chain) {
        card.querySelector('.pos-option-selector')?.remove();

        const selector = document.createElement('select');
        selector.className = 'pos-size-selector pos-option-selector';
        selector.setAttribute('aria-label', `Choose ${group.name} for ${name}`);
        const label = groupIndex === 0 ? `Choose ${group.name}` : `${groupIndex + 1}. ${group.name}`;
        selector.innerHTML = `<option value="">${escapeHtml(label)}</option>` + (group.values || [])
            .map(v => {
                const testChain = [...chain, v];
                const stock = getAvailableStock(productCache[name], testChain[0] || '', testChain[1] || '');
                const disabled = stock <= 0 ? ' disabled' : '';
                const suffix = stock > 0 ? ` (${stock} left)` : ' (0)';
                return `<option value="${escapeHtml(v)}"${disabled}>${escapeHtml(v)}${suffix}</option>`;
            })
            .join('');

        selector.addEventListener('change', () => {
            if (!selector.value) return;
            const chosen = selector.value;
            const nextChain = [...chain, chosen];
            selector.remove();

            const product = productCache[name];
            const nextGroup = getOptionGroup(product, groupIndex + 1);
            if (nextGroup) {
                showOptionSelector(card, name, price, nextGroup, groupIndex + 1, nextChain);
            } else {
                addToCart(name, price, nextChain[0] || '', nextChain[1] || '');
            }
        });

        card.appendChild(selector);
        selector.focus();
    }

    if (productGrid) {
        productGrid.addEventListener('click', (e) => {
            if (e.target.closest('.pos-option-selector')) return;
            const card = e.target.closest('.product-card');
            if (!card) return;

            const name = card.dataset.name;
            const price = parseFloat(card.dataset.price) || 0;
            let options = [];
            try { options = JSON.parse(card.dataset.options || '[]'); } catch (err) { options = []; }

            if (options.length === 0) {
                addToCart(name, price);
                return;
            }
            showOptionSelector(card, name, price, options[0], 0, []);
        });
    }

// Allow the inventory snapshot to populate POS without another Firestore read.
// Coalesce rapid calls into one render per animation frame.
let __pendingCatalogProducts = null;
let __catalogRenderScheduled = false;
function scheduleRenderProductCatalog(products) {
    __pendingCatalogProducts = products;
    if (__catalogRenderScheduled) return;
    __catalogRenderScheduled = true;
    requestAnimationFrame(() => {
        __catalogRenderScheduled = false;
        if (__pendingCatalogProducts) renderProductCatalog(__pendingCatalogProducts);
        __pendingCatalogProducts = null;
    });
}
window.renderPosCatalog = scheduleRenderProductCatalog;
window.reloadPosCatalog = () => {
    if (productCatalogLoaded) return Promise.resolve();
    if (!productCatalogLoadPromise) {
        productCatalogLoadPromise = loadProductCatalog().finally(() => {
            productCatalogLoadPromise = null;
        });
    }
    return productCatalogLoadPromise;
};

    // --- Category filter: re-render only the selected category ---
    const posCategoryFilterEl = document.getElementById('posCategoryFilter');
    if (posCategoryFilterEl) {
        posCategoryFilterEl.addEventListener('change', () => {
            posCategoryFilter = posCategoryFilterEl.value;
            // Clear search so the new category shows all its items
            if (productSearch) productSearch.value = '';
            renderProductCatalog(posAllProducts);
        });
    }

    // --- Product search filter (debounced + diff-aware) ---
    if (productSearch) {
        let __posSearchTimer = null;
        productSearch.addEventListener('input', (e) => {
            clearTimeout(__posSearchTimer);
            const searchTerm = e.target.value.trim().toLowerCase();
            __posSearchTimer = setTimeout(() => {
                const cards = productGrid.querySelectorAll('.product-card');
                for (const card of cards) {
                    const name = card.dataset.name.toLowerCase();
                    const category = card.dataset.category.toLowerCase();
                    const match = !searchTerm || name.includes(searchTerm) || category.includes(searchTerm);
                    const next = match ? '' : 'none';
                    // Only touch style if it actually changed — avoids layout thrash
                    if (card.style.display !== next) card.style.display = next;
                }
            }, 120);
        });
    }

// --- Cart item quantity buttons + qty input (event delegation) ---
if (cartItems) {
    // +/− button clicks and per-line remove
    cartItems.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.cart-item-remove');
        if (removeBtn) {
            const key = removeBtn.dataset.cartKey;
            if (key) removeFromCart(key);
            return;
        }

        const btn = e.target.closest('.qty-btn');
        if (!btn) return;
        const cartKey = btn.dataset.cartKey;
        const action = btn.dataset.action;
        if (!cartKey) return;
        if (action === 'increase') {
            updateQuantity(cartKey, 1);
        } else if (action === 'decrease') {
            updateQuantity(cartKey, -1);
        }
    });
    
    // Live update while typing — clamps to stock, keeps focus
    cartItems.addEventListener('input', (e) => {
        const input = e.target.closest('.cart-item-qty-input');
        if (!input) return;
        const cartKey = input.dataset.cartKey;
        if (!cart[cartKey]) return;
        
        const rawValue = parseInt(input.value, 10);
        if (Number.isNaN(rawValue) || rawValue < 1) return;
        
        const { name, size, brand } = parseCartKey(cartKey);
        const maxStock = getCartMax(name, size, brand, cartKey);
        const price = getProductPriceByName(name, cartKey);
        
        // Guard rail: product went out of stock mid-cart
        if (maxStock <= 0) {
            delete cart[cartKey];
            updateCartDisplay();
            showToast('Item is out of stock and was removed from the cart', 'error');
            return;
        }
        
        // Clamp what actually goes into the cart — never exceed stock
        const clampedValue = Math.min(rawValue, maxStock);
        cart[cartKey] = clampedValue;
        
        // Visual warning if the typed value is over the limit
        if (rawValue > maxStock) {
            input.classList.add('over-stock');
            input.title = `Max ${maxStock} in stock`;
        } else {
            input.classList.remove('over-stock');
            input.removeAttribute('title');
        }
        
        // Update row total + grand totals using the CLAMPED value
        const row = input.closest('.cart-item');
        const lineTotalEl = row?.querySelector('strong');
        if (lineTotalEl) {
            lineTotalEl.textContent = formatCurrency(price * clampedValue);
        }
        
        updateCartTotals();
    });
    
    // Commit on blur — clamps to stock and re-renders
    cartItems.addEventListener('change', (e) => {
        const input = e.target.closest('.cart-item-qty-input');
        if (!input) return;
        commitCartQuantity(input.dataset.cartKey, input.value);
    });
    
    // Enter should blur (which triggers 'change' above)
    cartItems.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.classList.contains('cart-item-qty-input')) {
            e.preventDefault();
            e.target.blur();
        }
    });
}
    // --- Clear cart button ---
    if (clearCartBtn) {
        clearCartBtn.addEventListener('click', clearCart);
    }

    // --- Checkout button: open payment modal ---
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', () => {
            if (Object.keys(cart).length === 0) {
                showToast('Cart is empty', 'error');
                return;
            }
            // Compute total
            let subtotal = 0;
            for (const [cartKey, qty] of Object.entries(cart)) {
                const { name } = parseCartKey(cartKey);
                const price = getProductPriceByName(name, cartKey);
                subtotal += price * qty;
            }
            const tax = subtotal * (getTaxRatePercent() / 100);
            const total = subtotal + tax;

            // Set modal total
            if (paymentTotal) paymentTotal.textContent = formatCurrency(total);

            // Reset payment method to cash (default)
            selectedPaymentMethod = 'cash';
            paymentMethods.forEach(m => m.classList.remove('selected'));
            document.querySelector('.payment-method[data-method="cash"]').classList.add('selected');
            if (cashInputGroup) cashInputGroup.style.display = 'block';
            if (cashReceived) cashReceived.value = '';
            if (changeAmount) changeAmount.textContent = formatCurrency(0);
            hideGcashQr();

            // Clear required stars + flags left over from a previous GCash sale
            document.querySelectorAll(
                'label[for="customerName"] .required-star, ' +
                'label[for="customerPhone"] .required-star'
            ).forEach(el => el.remove());
            if (customerName) customerName.required = false;
            if (customerPhone) customerPhone.required = false;

            // Reset the customer-info heading back to "Optional"
            const heading = document.getElementById('customerInfoHeading');
            if (heading) heading.textContent = 'Customer Information (Optional)';

            // Clear customer info fields
            if (customerName) customerName.value = '';
            if (customerPhone) customerPhone.value = '';

            // Show modal
            paymentModal.classList.add('show');
        });
    }

    // --- Close payment modal ---
    if (paymentClose) {
        paymentClose.addEventListener('click', () => {
            paymentModal.classList.remove('show');
        });
    }

    // Also close when clicking outside modal content
    if (paymentModal) {
        paymentModal.addEventListener('click', (e) => {
            if (e.target === paymentModal) {
                paymentModal.classList.remove('show');
            }
        });
    }

    function createReceiptNumber() {
        const now = new Date();
        const datePart = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
            .map(value => String(value).padStart(2, '0')).join('');
        const timePart = [now.getHours(), now.getMinutes(), now.getSeconds()]
            .map(value => String(value).padStart(2, '0')).join('');
        const randomPart = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `REC-${datePart}-${timePart}-${randomPart}`;
    }

                 function showReceipt(receiptNumber, items, subtotal, tax, total, name, phone, paymentMethod, cash, change, createdAt) {
                     // ---- FIX: cancel any pending clear-timer from a previous close ----
                     if (receiptClearTimer) {
                         clearTimeout(receiptClearTimer);
                         receiptClearTimer = null;
                     }
                     
                     if (receiptContent) {
                         receiptContent.innerHTML = '';
                         receiptContent.scrollTop = 0;
                     }
            
            const itemRows = items.map(item => {
                const bits = [escapeHtml(item.name)];
                if (item.size) bits.push(`(${escapeHtml(item.size)})`);
                if (item.brand) bits.push(`· ${escapeHtml(item.brand)}`);
                return `
        <div class="receipt-line">
            <span>${bits.join(' ')} x${item.quantity}</span>
            <strong>${formatCurrency(item.price * item.quantity)}</strong>
        </div>
    `;
            }).join('');
            const customer = [name, phone].filter(Boolean).map(escapeHtml).join(' | ');
            const paymentLabel = paymentMethod === 'gcash' ? 'GCash' : 'Cash';
            const receiptDate = new Intl.DateTimeFormat('en-PH', {
                dateStyle: 'medium',
                timeStyle: 'short'
            }).format(new Date(createdAt));
            const currentUser = window.POS_CURRENT_USER;
            const cashierName = currentUser?.user_metadata?.full_name ||
                currentUser?.displayName ||
                currentUser?.email?.split('@')[0] ||
                'Unknown';
            
            const storeCfg = window.POS_SETTINGS?.get?.() || {};
            const storeName = storeCfg.storeName || "Kirby's Hardware";
            const storeAddress = storeCfg.storeAddress || '';
            const storeContact = storeCfg.storeContact || '';
            const receiptFooter = storeCfg.receiptFooter || '';
            const taxRate = getTaxRatePercent();

            receiptContent.innerHTML = `
        <div class="receipt-store-name">${escapeHtml(storeName)}</div>
        <div class="receipt-heading">POS TRANSACTION</div>
        <div class="receipt-number">Receipt No: ${escapeHtml(receiptNumber)}</div>
        <div class="receipt-store-details">
            ${storeAddress ? `<div>${escapeHtml(storeAddress)}</div>` : ''}
            ${storeContact ? `<div>Contact: ${escapeHtml(storeContact)}</div>` : ''}
        </div>
        ${customer ? `<div class="receipt-meta">Customer: ${customer}</div>` : ''}
        <div class="receipt-items">${itemRows}</div>
        <div class="receipt-total-line"><span>Subtotal</span><span>${formatCurrency(subtotal)}</span></div>
        <div class="receipt-total-line"><span>Tax (${taxRate}%)</span><span>${formatCurrency(tax)}</span></div>
        <div class="receipt-total-line receipt-grand-total"><strong>Total</strong><strong>${formatCurrency(total)}</strong></div>
        <div class="receipt-meta">Payment: ${paymentLabel}</div>
        ${paymentMethod === 'cash'
            ? `<div class="receipt-total-line"><span>Cash received</span><span>${formatCurrency(cash)}</span></div><div class="receipt-total-line"><span>Change</span><span>${formatCurrency(change)}</span></div>`
            : ''}
        ${paymentMethod === 'gcash' && window.__lastGcashRef
            ? `<div class="receipt-total-line"><span>GCash Ref No.</span><span style="font-family:monospace;">${escapeHtml(window.__lastGcashRef)}</span></div>`
            : ''}
        <div class="receipt-meta">Date: ${escapeHtml(receiptDate)}</div>
        <div class="receipt-meta">Cashier: ${escapeHtml(cashierName)}</div>
        ${receiptFooter ? `<div class="receipt-footer">${escapeHtml(receiptFooter)}</div>` : ''}
    `;
            receiptModal.classList.add('show');
        
        }
    function printReceipt() {
        const printWindow = window.open('', '_blank', 'width=420,height=700');
        if (!printWindow) {
            showToast('Allow pop-ups to print the receipt', 'error');
            return;
        }
        printWindow.document.write(`<!doctype html><html><head><title>POS Receipt</title><style>
            body { font-family: Arial, sans-serif; width: 300px; margin: 20px auto; color: #111; }
            h1 { font-size: 18px; text-align: center; margin: 0 0 16px; }
            .receipt-line, .receipt-total-line { display: flex; justify-content: space-between; gap: 12px; margin: 8px 0; }
            .receipt-items { border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: 8px 0; margin: 12px 0; }
            .receipt-grand-total { border-top: 1px solid #111; padding-top: 8px; font-size: 16px; }
            .receipt-meta { font-size: 12px; margin: 8px 0; }
            .receipt-heading, .receipt-store-name, .receipt-store-details { text-align: center; }
            .receipt-store-name { font-size: 18px; font-weight: bold; margin-bottom: 4px; }
            .receipt-heading { font-weight: bold; margin-bottom: 4px; }
            .receipt-store-details { font-size: 11px; line-height: 1.5; margin-bottom: 12px; }
        </style></head><body>${receiptContent.innerHTML}</body></html>`);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
    }

                // ---- FIX: tracked clear-timer so showReceipt() can cancel it ----
        function scheduleReceiptClear() {
            if (receiptClearTimer) clearTimeout(receiptClearTimer);
            receiptClearTimer = setTimeout(() => {
                if (receiptContent) receiptContent.innerHTML = '';
                receiptClearTimer = null;
            }, 300);
        }
        
                [receiptClose, receiptDoneBtn].forEach(button => {
            if (button) button.addEventListener('click', () => {
                receiptModal.classList.remove('show');
                scheduleReceiptClear();
            });
        });
        
        if (receiptModal) {
            receiptModal.addEventListener('click', event => {
                if (event.target === receiptModal) {
                    receiptModal.classList.remove('show');
                    scheduleReceiptClear();
                }
            });
        }

        
      if (printReceiptBtn) printReceiptBtn.addEventListener('click', printReceipt);



    // --- Payment method selection ---
        paymentMethods.forEach(method => {
    method.addEventListener('click', () => {
        paymentMethods.forEach(m => m.classList.remove('selected'));
        method.classList.add('selected');
        selectedPaymentMethod = method.dataset.method;

        // Update heading to reflect what's required for this method
        const heading = document.getElementById('customerInfoHeading');
        if (heading) {
            heading.textContent = selectedPaymentMethod === 'gcash'
                ? 'Customer Information (Required for GCash)'
                : 'Customer Information (Optional)';
        }

        // Show/hide cash input
        if (cashInputGroup) {
            cashInputGroup.style.display = selectedPaymentMethod === 'cash' ? 'block' : 'none';
        }

        // Toggle required attributes on customer fields based on method
        const nameInput = document.getElementById('customerName');
        const phoneInput = document.getElementById('customerPhone');


        if (selectedPaymentMethod === 'gcash') {
            if (nameInput) nameInput.required = true;
            if (phoneInput) phoneInput.required = true;

            // Mark the customer name label with a required star
            const nameLabel = document.querySelector('label[for="customerName"]');
            if (nameLabel && !nameLabel.querySelector('.required-star')) {
                nameLabel.insertAdjacentHTML('beforeend', ' <span class="required-star">*</span>');
            }
            if (phoneInput) {
                const phoneLabel = document.querySelector('label[for="customerPhone"]');
                if (phoneLabel && !phoneLabel.querySelector('.required-star')) {
                    phoneLabel.insertAdjacentHTML('beforeend', ' <span class="required-star">*</span>');
                }
            }
        } else {
            if (nameInput) nameInput.required = false;
            if (phoneInput) phoneInput.required = false;
            document.querySelectorAll('label[for="customerName"] .required-star, label[for="customerPhone"] .required-star')
                .forEach(el => el.remove());
        }

        // Show/hide GCash QR + confirmation gate
        if (selectedPaymentMethod === 'gcash') {
            showGcashQr();
        } else {
            hideGcashQr();
        }
    });
});

    // --- Cash received input: calculate change ---
    if (cashReceived) {
        cashReceived.addEventListener('input', (e) => {
            const cash = parseFloat(e.target.value) || 0;
            // Get total from modal
            const totalText = paymentTotal.textContent.replace(/[^\d.-]/g, '');
            const total = parseFloat(totalText) || 0;
            const change = cash - total;
            if (changeAmount) {
                changeAmount.textContent = change >= 0 ? formatCurrency(change) : 'Insufficient amount';
            }
        });
    }

        /* ============================================================
   GCash reference number — live formatting + validation
   ============================================================ */
const gcashReference = document.getElementById('gcashReference');
const gcashReferenceError = document.getElementById('gcashReferenceError');

function validateGcashReference(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return { ok: false, reason: 'Reference number is required.' };
    if (digits.length !== 13) return { ok: false, reason: `Reference must be exactly 13 digits (you entered ${digits.length}).` };
    return { ok: true, normalized: digits };
}

if (gcashReference) {
    // Strip non-digits as the user types — GCash refs are always numeric
    gcashReference.addEventListener('input', () => {
        const before = gcashReference.value.length;
        gcashReference.value = gcashReference.value.replace(/\D/g, '').slice(0, 13);
        const after = gcashReference.value.length;
        if (before !== after) {
            try {
                const pos = gcashReference.selectionStart + (after - before);
                gcashReference.setSelectionRange(pos, pos);
            } catch (e) {}
        }

        // Live error feedback
        if (gcashReferenceError) {
            const v = validateGcashReference(gcashReference.value);
            if (gcashReference.value.length === 0) {
                gcashReferenceError.style.display = 'none';
            } else if (!v.ok) {
                gcashReferenceError.textContent = v.reason;
                gcashReferenceError.style.display = 'block';
            } else {
                gcashReferenceError.style.display = 'none';
            }
        }
    });

    gcashReference.addEventListener('blur', () => {
        if (!gcashReference.value) return;
        const v = validateGcashReference(gcashReference.value);
        if (!v.ok && gcashReferenceError) {
            gcashReferenceError.textContent = v.reason;
            gcashReferenceError.style.display = 'block';
        }
    });
}

if (gcashConfirmCheck) {
    gcashConfirmCheck.addEventListener('change', () => {
        if (confirmPaymentBtn) confirmPaymentBtn.disabled = !gcashConfirmCheck.checked;
    });
}
    // --- Confirm payment ---
if (confirmPaymentBtn) {
    confirmPaymentBtn.addEventListener('click', async () => {
                    // ---- FIX: block double-submit ----
                    if (confirmPaymentBtn.disabled) return;
                    confirmPaymentBtn.disabled = true;
                    const __origBtnHtml = confirmPaymentBtn.innerHTML;
                    confirmPaymentBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
                    // -----------------------------------
                    
                    const totalText = paymentTotal.textContent.replace(/[^\d.-]/g, '');
        const total = parseFloat(totalText) || 0;
       const name = customerName ? customerName.value.trim() : '';
const rawPhone = customerPhone ? customerPhone.value.trim() : '';
let gcashRefDigits = '';

// ---- GCash-specific validation ----
if (selectedPaymentMethod === 'gcash') {
    // Full name required
    if (!name) {
        showToast('Customer full name is required for GCash payments.', 'error');
        customerName?.focus();
        confirmPaymentBtn.innerHTML = __origBtnHtml;
        confirmPaymentBtn.disabled = false;
        return;
    }

    // Phone required + valid
    const phoneDigits = rawPhone.replace(/\D/g, '');
    if (!phoneDigits) {
        showToast('Contact number is required for GCash payments.', 'error');
        if (customerPhoneError) {
            customerPhoneError.textContent = 'Contact number is required for GCash.';
            customerPhoneError.style.display = 'block';
        }
        customerPhone?.focus();
        confirmPaymentBtn.innerHTML = __origBtnHtml;
        confirmPaymentBtn.disabled = false;
        return;
    }
    if (phoneDigits.length !== 11) {
        showToast('Phone must be exactly 11 digits (e.g., 0917 123 4567)', 'error');
        if (customerPhoneError) {
            customerPhoneError.textContent = 'Phone must be 11 digits (e.g., 0917 123 4567)';
            customerPhoneError.style.display = 'block';
        }
        customerPhone?.focus();
        confirmPaymentBtn.innerHTML = __origBtnHtml;
        confirmPaymentBtn.disabled = false;
        return;
    }

    // Reference number required + 13 digits
    const refInput = document.getElementById('gcashReference');
    const refCheck = validateGcashReference(refInput?.value || '');
    if (!refCheck.ok) {
        showToast(refCheck.reason, 'error');
        if (gcashReferenceError) {
            gcashReferenceError.textContent = refCheck.reason;
            gcashReferenceError.style.display = 'block';
        }
        refInput?.focus();
        confirmPaymentBtn.innerHTML = __origBtnHtml;
        confirmPaymentBtn.disabled = false;
        return;
    }
    gcashRefDigits = refCheck.normalized;
} else {
    // ---- Cash payment: phone is optional but must be valid if provided ----
    if (rawPhone && !isValidPhone(rawPhone)) {
        showToast('Phone must be exactly 11 digits (e.g., 0917 123 4567)', 'error');
        if (customerPhoneError) customerPhoneError.style.display = 'block';
        if (customerPhone) customerPhone.focus();
        confirmPaymentBtn.innerHTML = __origBtnHtml;
        confirmPaymentBtn.disabled = false;
        return;
    }
}

// Normalize: strip spaces before saving to the order
const phone = rawPhone.replace(/\D/g, '');
        
        
        
        const items = Object.entries(cart).map(([cartKey, quantity]) => {
    const { name: itemName, size, brand } = parseCartKey(cartKey);
    const product = productCache[itemName];
    return {
        name: itemName,
        productId: product?.id || '',
        category: product?.category || '',
        size,
        brand,
        quantity,
        price: getProductPriceByName(itemName, cartKey)
    };
});
        const requestedStock = new Map();
        for (const item of items) {
            const product = productCache[item.name];
            if (!product) continue;
            const stockKey = hasOptions(product)
                ? JSON.stringify([product.id || item.name, item.size, item.brand])
                : JSON.stringify([product.id || item.name, '', '']);
            const requested = requestedStock.get(stockKey) || {
                product,
                size: item.size,
                brand: item.brand,
                quantity: 0
            };
            requested.quantity += item.quantity;
            requestedStock.set(stockKey, requested);
        }

        const insufficientStock = [...requestedStock.values()].some(requested =>
            requested.quantity > getAvailableStock(requested.product, requested.size, requested.brand)
        );
        if (insufficientStock) {
            showToast('Cart quantity exceeds available stock. Adjust the cart before completing payment.', 'error');
            confirmPaymentBtn.innerHTML = __origBtnHtml;
            confirmPaymentBtn.disabled = false;
            return;
        }
        const stockUpdates = buildStockUpdates(items);
        const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const tax = subtotal * (getTaxRatePercent() / 100);
        const receiptNumber = createReceiptNumber();
        let cash = 0;
        let change = 0;

                if (selectedPaymentMethod === 'cash') {
            cash = parseFloat(cashReceived.value) || 0;
            if (cash < total) {
                showToast('Insufficient cash amount', 'error');
                confirmPaymentBtn.innerHTML = __origBtnHtml;
                confirmPaymentBtn.disabled = false;
                return;
            }
            change = cash - total;
            let message = `Payment successful! Change: ${formatCurrency(change)}`;
            if (name) message += ` | Customer: ${name}`;
            showToast(message, 'success');
        } else {
            let message = 'GCash payment processed successfully!';
            if (name) message += ` | Customer: ${name}`;
            showToast(message, 'success');
        }

        const order = {
    id: receiptNumber,
    createdAt: new Date().toISOString(),
    customerName: name,
    customerPhone: phone,
    items,
    subtotal,
    tax,
    total,
    paymentMethod: selectedPaymentMethod,
    status: 'Completed',
    // Only set for GCash — undefined for cash keeps Firestore docs clean
    ...(selectedPaymentMethod === 'gcash' && gcashRefDigits ? {
        gcashReference: gcashRefDigits
    } : {})
};

        // ============================================================
        // FIX: show the receipt IMMEDIATELY — before any network calls.
        // The receipt only needs local data (items, totals, customer).
        // Network sync happens in the background afterwards.
        // ============================================================
                cart = {};
        updateCartDisplay();
                stockUpdates.forEach(({ product, updates }) => Object.assign(product, updates));
                renderProductCatalog(Object.values(productCache));
                window.setInventoryProducts?.(Object.values(productCache));
        paymentModal.classList.remove('show');
        hideGcashQr();
        
        // Restore button for the next sale right away
        confirmPaymentBtn.innerHTML = __origBtnHtml;
        confirmPaymentBtn.disabled = false;
        
        // ---- FIX: yield to the browser so it can paint the payment
        // modal's removal FIRST, then show the receipt on the next
        // animation frame. Prevents the Chromium backdrop-filter
        // compositing bug where two blur layers toggle in one tick
        // and the second one is never painted until the next click.
        // Stash the GCash reference so the receipt template can render it.
        window.__lastGcashRef = order.gcashReference || '';

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                showReceipt(receiptNumber, items, subtotal, tax, total, name, phone, selectedPaymentMethod, cash, change, order.createdAt);
            });
        });

        // ---------- LOCAL CACHE (instant UI) ----------
        try {
            const orders = JSON.parse(localStorage.getItem('pos_orders') || '[]');
            orders.unshift(order);
            localStorage.setItem('pos_orders', JSON.stringify(orders.slice(0, 500)));
        } catch (e) {
            console.warn('Local order cache failed:', e);
        }

        // ---------- FIRE OFF BACKGROUND SYNC (no awaits block the UI) ----------
        (async () => {
            let saleCommitted = false;
            try {
                const result = await window.POS_SUPABASE?.commitSale?.(order);
                if (result?.error || !result) {
                    const error = result?.error || new Error('Sale sync is unavailable.');
                    enqueuePendingSale(order);
                    if (navigator.onLine) setPendingSalesError(error);
                    console.warn('Sale queued for sync:', error);
                    showToast('Sale saved locally and queued to sync.', 'success');
                } else {
                    saleCommitted = true;
                    window.dispatchEvent(new CustomEvent('inventory-products-loaded', {
                        detail: Object.values(productCache)
                    }));
                }
            } catch (err) {
                enqueuePendingSale(order);
                if (navigator.onLine) setPendingSalesError(err);
                console.warn('Sale queued for sync:', err);
                showToast('Sale saved locally and queued to sync.', 'success');
            }

            if (saleCommitted) await syncSaleCustomer(order);

            const payLabel = selectedPaymentMethod === 'gcash'
    ? `GCash (Ref ${order.gcashReference})`
    : 'Cash';
const txnDesc = `Sale ${receiptNumber} · ${formatCurrency(total)} · ${payLabel} · ${items.length} item${items.length === 1 ? '' : 's'}`;
            window.POS_APP_LOG?.('transaction', 'pos', txnDesc, 'info', {
                id: receiptNumber,
                items: items.length,
                total,
                payment: selectedPaymentMethod,
                cashReceived: cash,
                change,
                customer: name || ''
            });
            window.dispatchEvent(new CustomEvent('pos-order-created'));
        })();
// ----------------------------------------------
});
}
    
    // Refresh the visible tax-rate label whenever Settings change.
    window.addEventListener('pos-settings-updated', () => {
        const taxLabel = document.getElementById('taxRateLabel');
        if (taxLabel) taxLabel.textContent = `Tax (${getTaxRatePercent()}%):`;
        updateCartDisplay();
    });

    // Initialize cart display
    updateCartDisplay();
    })();
    
    