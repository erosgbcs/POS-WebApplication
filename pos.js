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
        // --- GCash QR ---
    const GCASH_NUMBER = '09935917971';
    const GCASH_NAME = 'Gabriel A';
    const GCASH_QR_CONTENT = `GCash: ${GCASH_NUMBER} | ${GCASH_NAME}`;
    const gcashQrGroup = document.getElementById('gcashQrGroup');
    const gcashQrImage = document.getElementById('gcashQrImage');
    const gcashConfirmCheck = document.getElementById('gcashConfirmCheck');
    const gcashAmountToPay = document.getElementById('gcashAmountToPay');
   
   
   
            function showGcashQr() {
        if (!gcashQrImage) return;
        gcashQrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(GCASH_QR_CONTENT)}`;
        
        // Read the total fresh from the modal — never rely on a stale value
        if (gcashAmountToPay) {
            const freshTotalEl = document.getElementById('paymentTotal');
            gcashAmountToPay.textContent = freshTotalEl?.textContent?.trim() || '₱0.00';
        }
        
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

function hasSizeStocks(product) {
    return Boolean(product?.sizeStocks && typeof product.sizeStocks === 'object' && !Array.isArray(product.sizeStocks));
}

function hasBrandStocks(product) {
    return Boolean(product?.brandStocks && typeof product.brandStocks === 'object' && !Array.isArray(product.brandStocks));
}

function hasVariantMatrix(product) {
    return Boolean(product?.variants && typeof product.variants === 'object' && !Array.isArray(product.variants));
}

function getAvailableStock(product, size = '', brand = '') {
    if (!product) return Infinity;
    if (hasVariantMatrix(product)) {
        const v = product.variants[`${size}::${brand}`];
        return Math.max(0, Number(v?.stock) || 0);
    }
    if (hasSizeStocks(product)) return Math.max(0, Number(product.sizeStocks[size]) || 0);
    if (hasBrandStocks(product)) return Math.max(0, Number(product.brandStocks[brand]) || 0);
    return Math.max(0, Number(product.quantity) || 0);
}

function getTotalStock(product) {
    if (hasVariantMatrix(product)) {
        return Object.values(product.variants).reduce((t, v) => t + (Number(v.stock) || 0), 0);
    }
    if (hasSizeStocks(product)) {
        return Object.values(product.sizeStocks).reduce((total, stock) => total + (Number(stock) || 0), 0);
    }
    if (hasBrandStocks(product)) {
        return Object.values(product.brandStocks).reduce((total, stock) => total + (Number(stock) || 0), 0);
    }
    return Math.max(0, Number(product?.quantity) || 0);
}

// Returns the effective price for a (size, brand) combination
function getVariantPrice(product, size = '', brand = '') {
    if (!product) return 0;
    if (hasVariantMatrix(product)) {
        const v = product.variants[`${size}::${brand}`];
        if (!v) return 0;
        return v.price != null ? Number(v.price) : (Number(product.price) || 0);
    }
    return Number(product.price) || 0;
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
    const perSize = hasSizeStocks(product);
    const perBrand = hasBrandStocks(product);
    const perVariant = hasVariantMatrix(product);
    const alreadyAllocated = Object.entries(cart).reduce((total, [cartKey, quantity]) => {
        if (cartKey === currentCartKey) return total;
        const item = parseCartKey(cartKey);
        if (item.name !== name) return total;
        if (perVariant) {
            if (item.size !== size || item.brand !== brand) return total;
        } else {
            if (perSize && item.size !== size) return total;
            if (perBrand && item.brand !== brand) return total;
        }
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
            decrements.set(product.id, { product, quantity: 0, bySize: {}, byBrand: {}, byVariant: {} });
        }
        const decrement = decrements.get(product.id);
        if (hasVariantMatrix(product)) {
            const key = `${item.size}::${item.brand}`;
            decrement.byVariant[key] = (decrement.byVariant[key] || 0) + item.quantity;
        } else if (hasSizeStocks(product) && item.size) {
            decrement.bySize[item.size] = (decrement.bySize[item.size] || 0) + item.quantity;
        } else if (hasBrandStocks(product) && item.brand) {
            decrement.byBrand[item.brand] = (decrement.byBrand[item.brand] || 0) + item.quantity;
        } else {
            decrement.quantity += item.quantity;
        }
    }

    return [...decrements.values()].map(({ product, quantity, bySize, byBrand, byVariant }) => {
        if (hasVariantMatrix(product)) {
            const variants = {};
            for (const [key, v] of Object.entries(product.variants)) {
                variants[key] = { ...v };
            }
            for (const [key, sold] of Object.entries(byVariant)) {
                if (variants[key]) {
                    variants[key].stock = Math.max(0, variants[key].stock - sold);
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
        }
        if (hasSizeStocks(product)) {
            const sizeStocks = { ...product.sizeStocks };
            for (const [size, soldQuantity] of Object.entries(bySize)) {
                sizeStocks[size] = Math.max(0, (Number(sizeStocks[size]) || 0) - soldQuantity);
            }
            return {
                product,
                productId: product.id,
                updates: {
                    sizeStocks,
                    quantity: Object.values(sizeStocks).reduce((total, stock) => total + (Number(stock) || 0), 0)
                }
            };
        }

        if (hasBrandStocks(product)) {
            const brandStocks = { ...product.brandStocks };
            for (const [brand, soldQuantity] of Object.entries(byBrand)) {
                brandStocks[brand] = Math.max(0, (Number(brandStocks[brand]) || 0) - soldQuantity);
            }
            return {
                product,
                productId: product.id,
                updates: {
                    brandStocks,
                    quantity: Object.values(brandStocks).reduce((total, stock) => total + (Number(stock) || 0), 0)
                }
            };
        }

        return {
            product,
            productId: product.id,
            updates: { quantity: Math.max(0, (Number(product.quantity) || 0) - quantity) }
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

    // Keep the full list around — every filter re-render reads from here
    posAllProducts = Array.isArray(products) ? products : [];

    // Build name -> product lookup from the FULL list (cart pricing,
    // stock lookups, decrement logic all depend on this).
    productCache = {};
    posAllProducts.forEach(p => { if (p.name) productCache[p.name] = p; });

    // Sync the dropdown (populates once, preserves selection thereafter)
    populatePosCategoryFilter(posAllProducts);

    // Only render the selected slice
    const visible = posCategoryFilter
        ? posAllProducts.filter(p => (p.category || 'uncategorized') === posCategoryFilter)
        : posAllProducts;

    productGrid.innerHTML = visible.map(product => {
        const qty = getTotalStock(product);
        const sizes = String(product.size || '').split(',').map(s => s.trim()).filter(Boolean);
        const brands = String(product.brand || '').split(',').map(b => b.trim()).filter(Boolean);

        // Stock badge
        let stockClass = 'in-stock';
        let stockLabel = `${qty} in stock`;
        if (qty === 0) {
            stockClass = 'out-of-stock';
            stockLabel = 'Out of stock';
        } else if (qty <= 5) {
            stockClass = 'low-stock';
            stockLabel = `${qty} left`;
        }

        // Meta line: category + SKU
        const category = product.category || 'uncategorized';
        const sku = product.sku || 'N/A';
        const meta = `${escapeHtml(category)} · ${escapeHtml(sku)}`;

        // Size chips
        const sizesHtml = sizes.length ?
            `<div class="product-card-chips">${sizes.map(size => `<span class="size-chip">${escapeHtml(size)}${hasSizeStocks(product) ? ` · ${getAvailableStock(product, size)}` : ''}</span>`).join('')}</div>` :
            '';

        // Brand chips
        const brandsHtml = brands.length ?
            `<div class="product-card-chips">${brands.map(brand => `<span class="size-chip brand-chip"><i class="fas fa-tag"></i> ${escapeHtml(brand)}${hasBrandStocks(product) ? ` · ${getAvailableStock(product, '', brand)}` : ''}</span>`).join('')}</div>` :
            '';

        const sizeOptions = sizes.length ? ` data-size-options="${sizes.map(escapeHtml).join(',')}"` : '';
        const brandOptions = brands.length ? ` data-brand-options="${brands.map(escapeHtml).join(',')}"` : '';
        const variantPricesAttr = hasVariantMatrix(product)
            ? ` data-variant-prices="${escapeHtml(JSON.stringify(product.variants))}"`
            : '';
        const outClass = qty === 0 ? ' is-out-of-stock' : '';

        // Display price: range for matrix, base otherwise
        let displayPrice = formatCurrency(product.price);
        if (hasVariantMatrix(product)) {
            const prices = Object.values(product.variants).map(v => v.price).filter(p => p != null);
            if (prices.length > 0) {
                const min = Math.min(...prices);
                const max = Math.max(...prices);
                displayPrice = min === max
                    ? formatCurrency(min)
                    : `${formatCurrency(min)} – ${formatCurrency(max)}`;
            }
        }

        return `<div class="product-card${outClass}" data-id="${product.id}" data-name="${escapeHtml(product.name)}" data-price="${product.price}" data-category="${escapeHtml(category)}" data-stock="${qty}"${sizeOptions}${brandOptions}${variantPricesAttr}>
            <div class="product-card-header">
                <h4 class="product-card-name">${escapeHtml(product.name)}</h4>
                <span class="product-card-stock ${stockClass}">${stockLabel}</span>
            </div>
            <div class="product-card-meta">${meta}</div>
            ${sizesHtml}
            ${brandsHtml}
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
        const tax = subtotal * 0.08;
        const total = subtotal + tax;

        subtotalEl.textContent = formatCurrency(subtotal);
        taxEl.textContent = formatCurrency(tax);
        totalEl.textContent = formatCurrency(total);
    }
function updateCartTotals() {
    let subtotal = 0;
    for (const [cartKey, qty] of Object.entries(cart)) {
        const { name } = parseCartKey(cartKey);
        const price = getProductPriceByName(name, cartKey);
        subtotal += price * qty;
    }
    const tax = subtotal * 0.08;
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

    // --- Event delegation for product cards (click to add) ---
    function showSizeSelector(card, name, price, sizeOptions, preselectedBrand) {
        card.querySelector('.pos-size-selector')?.remove();
        card.querySelector('.pos-brand-selector')?.remove();
        const selector = document.createElement('select');
        selector.className = 'pos-size-selector';
        selector.setAttribute('aria-label', `Choose a size for ${name}`);
        selector.innerHTML = '<option value="">Choose size</option>' + sizeOptions
            .map(size => {
                const available = getAvailableStock(productCache[name], size, preselectedBrand);
                const stockLabel = hasSizeStocks(productCache[name]) ? ` (${available} left)` : '';
                return `<option value="${escapeHtml(size)}" ${available <= 0 ? 'disabled' : ''}>${escapeHtml(size)}${stockLabel}</option>`;
            })
            .join('');
        selector.addEventListener('change', () => {
            if (!selector.value) return;
            addToCart(name, price, selector.value, preselectedBrand);
            selector.remove();
        });
        card.appendChild(selector);
        selector.focus();
    }

    function showBrandSelector(card, name, price, brandOptions, preselectedSize) {
        card.querySelector('.pos-size-selector')?.remove();
        card.querySelector('.pos-brand-selector')?.remove();
        const selector = document.createElement('select');
        selector.className = 'pos-size-selector pos-brand-selector';
        selector.setAttribute('aria-label', `Choose a brand for ${name}`);
        selector.innerHTML = '<option value="">Choose brand</option>' + brandOptions
            .map(brand => {
                const available = getAvailableStock(productCache[name], preselectedSize, brand);
                const stockLabel = hasBrandStocks(productCache[name]) ? ` (${available} left)` : '';
                return `<option value="${escapeHtml(brand)}" ${available <= 0 ? 'disabled' : ''}>${escapeHtml(brand)}${stockLabel}</option>`;
            })
            .join('');
        selector.addEventListener('change', () => {
            if (!selector.value) return;
            addToCart(name, price, preselectedSize, selector.value);
            selector.remove();
        });
        card.appendChild(selector);
        selector.focus();
    }

    if (productGrid) {
        productGrid.addEventListener('click', (e) => {
            if (e.target.closest('.pos-size-selector')) return;
            if (e.target.closest('.pos-brand-selector')) return;
            const card = e.target.closest('.product-card');
            if (!card) return;

            const name = card.dataset.name;
            const price = parseFloat(card.dataset.price);
            const sizeOptions = (card.dataset.sizeOptions || '')
                .split(',').map(s => s.trim()).filter(Boolean);
            const brandOptions = (card.dataset.brandOptions || '')
                .split(',').map(b => b.trim()).filter(Boolean);

            // Two-step selection when BOTH dimensions exist
            if (sizeOptions.length > 0 && brandOptions.length > 0) {
                card.querySelector('.pos-size-selector')?.remove();
                card.querySelector('.pos-brand-selector')?.remove();
                const sizeSel = document.createElement('select');
                sizeSel.className = 'pos-size-selector';
                sizeSel.setAttribute('aria-label', `Step 1: choose a size for ${name}`);
                sizeSel.innerHTML = '<option value="">1. Size</option>' + sizeOptions
                    .map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
                sizeSel.addEventListener('change', () => {
                    if (!sizeSel.value) return;
                    const chosenSize = sizeSel.value;
                    sizeSel.remove();
                    showBrandSelector(card, name, price, brandOptions, chosenSize);
                });
                card.appendChild(sizeSel);
                sizeSel.focus();
                return;
            }

            if (sizeOptions.length > 0) {
                showSizeSelector(card, name, price, sizeOptions, '');
                return;
            }

            if (brandOptions.length > 0) {
                showBrandSelector(card, name, price, brandOptions, '');
                return;
            }

            addToCart(name, price);
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
    // +/− button clicks
    cartItems.addEventListener('click', (e) => {
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
            const tax = subtotal * 0.08;
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
            
            receiptContent.innerHTML = `
        <div class="receipt-store-name">Kirby's Hardware</div>
        <div class="receipt-heading">POS TRANSACTION</div>
        <div class="receipt-number">Receipt No: ${escapeHtml(receiptNumber)}</div>
        <div class="receipt-store-details">
            <div>Gimeno Bldg, Gungon St</div>
            <div>Santa Maria, 3022 Bulacan</div>
            <div>Contact: 0935 491 9766</div>
        </div>
        ${customer ? `<div class="receipt-meta">Customer: ${customer}</div>` : ''}
        <div class="receipt-items">${itemRows}</div>
        <div class="receipt-total-line"><span>Subtotal</span><span>${formatCurrency(subtotal)}</span></div>
        <div class="receipt-total-line"><span>Tax (8%)</span><span>${formatCurrency(tax)}</span></div>
        <div class="receipt-total-line receipt-grand-total"><strong>Total</strong><strong>${formatCurrency(total)}</strong></div>
        <div class="receipt-meta">Payment: ${paymentLabel}</div>
        ${paymentMethod === 'cash' ? `<div class="receipt-total-line"><span>Cash received</span><span>${formatCurrency(cash)}</span></div><div class="receipt-total-line"><span>Change</span><span>${formatCurrency(change)}</span></div>` : ''}
        <div class="receipt-meta">Date: ${escapeHtml(receiptDate)}</div>
        <div class="receipt-meta">Cashier: ${escapeHtml(cashierName)}</div>
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
            
            // Show/hide cash input
            if (cashInputGroup) {
                cashInputGroup.style.display = selectedPaymentMethod === 'cash' ? 'block' : 'none';
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
        
        // Guard rail: phone must be exactly 11 digits if provided
            if (rawPhone && !isValidPhone(rawPhone)) {
            showToast('Phone must be exactly 11 digits (e.g., 0917 123 4567)', 'error');
            if (customerPhoneError) customerPhoneError.style.display = 'block';
            if (customerPhone) customerPhone.focus();
            confirmPaymentBtn.innerHTML = __origBtnHtml;
            confirmPaymentBtn.disabled = false;
            return;
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
            const stockSize = hasSizeStocks(product) ? item.size : '';
            const stockBrand = hasBrandStocks(product) ? item.brand : '';
            const stockKey = JSON.stringify([product.id || item.name, stockSize, stockBrand]);
            const requested = requestedStock.get(stockKey) || { product, size: stockSize, brand: stockBrand, quantity: 0 };
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
        const tax = subtotal * 0.08;
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
            status: 'Completed'
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

            const txnDesc = `Sale ${receiptNumber} · ${formatCurrency(total)} · ${selectedPaymentMethod === 'gcash' ? 'GCash' : 'Cash'} · ${items.length} item${items.length === 1 ? '' : 's'}`;
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
    
    // Initialize cart display
    updateCartDisplay();
    })();
    
    