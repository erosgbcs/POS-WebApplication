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
    let cart = {};          // { productName: quantity }
    let selectedPaymentMethod = 'cash';
    const formatCurrency = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0);

    function escapeHtml(value) {
        return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
    }


let productCache = {};

function renderProductCatalog(products) {
    if (!productGrid) return;
    
    // Build name -> product lookup for inventory decrement
    productCache = {};
    products.forEach(p => { if (p.name) productCache[p.name] = p; });
    
    productGrid.innerHTML = products.map(product => {
        const qty = Number(product.quantity) || 0;
        const sizes = String(product.size || '').split(',').map(s => s.trim()).filter(Boolean);
        
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
            `<div class="product-card-chips">${sizes.map(s => `<span class="size-chip">${escapeHtml(s)}</span>`).join('')}</div>` :
            '';
        
        const sizeOptions = sizes.length ? ` data-size-options="${sizes.map(escapeHtml).join(',')}"` : '';
        const outClass = qty === 0 ? ' is-out-of-stock' : '';
        
        return `<div class="product-card${outClass}" data-id="${product.id}" data-name="${escapeHtml(product.name)}" data-price="${product.price}" data-category="${escapeHtml(category)}" data-stock="${qty}"${sizeOptions}>
            <div class="product-card-header">
                <h4 class="product-card-name">${escapeHtml(product.name)}</h4>
                <span class="product-card-stock ${stockClass}">${stockLabel}</span>
            </div>
            <div class="product-card-meta">${meta}</div>
            ${sizesHtml}
            <div class="product-card-price">${formatCurrency(product.price)}</div>
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
    function getCartKey(name, size = '') {
        return size ? `${name}::${size}` : name;
    }

    function parseCartKey(cartKey) {
        const separatorIndex = cartKey.indexOf('::');
        if (separatorIndex === -1) {
            return { name: cartKey, size: '' };
        }
        return {
            name: cartKey.slice(0, separatorIndex),
            size: cartKey.slice(separatorIndex + 2)
        };
    }

        function addToCart(name, price, size = '') {
        const cartKey = getCartKey(name, size);
        const product = productCache[name];
        const maxStock = product ? (Number(product.quantity) || 0) : Infinity;
        const currentQty = cart[cartKey] || 0;
        
        if (currentQty >= maxStock) {
            showToast(`Only ${maxStock} left in stock`, 'error');
            return;
        }
        
        cart[cartKey] = currentQty + 1;
        updateCartDisplay();
        const label = size ? `${name} (${size})` : name;
        showToast(`Added ${label} to cart (Qty: ${cart[cartKey]})`, 'success');
    }

        function updateQuantity(cartKey, delta) {
        if (!cart[cartKey]) return;
        
        // Guard the increase case — cap at available stock
        if (delta > 0) {
            const { name } = parseCartKey(cartKey);
            const product = productCache[name];
            const maxStock = product ? (Number(product.quantity) || 0) : Infinity;
            if (cart[cartKey] + delta > maxStock) {
                showToast(`Only ${maxStock} left in stock`, 'error');
                return;
            }
        }
        
        cart[cartKey] += delta;
        if (cart[cartKey] <= 0) {
            delete cart[cartKey];
        }
        updateCartDisplay();
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
    const { name, size } = parseCartKey(cartKey);
    const price = getProductPriceByName(name);
    const displayName = size ? `${name} (${size})` : name;
    const product = productCache[name];
    const maxStock = product ? (Number(product.quantity) || 0) : 999;
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
            const price = getProductPriceByName(name);
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
        const price = getProductPriceByName(name);
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
    const { name } = parseCartKey(cartKey);
    const product = productCache[name];
    const maxStock = product ? (Number(product.quantity) || 0) : Infinity;
    
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

function getProductPriceByName(name) {
    // Find the product card with that name and get its data-price
    const card = document.querySelector(`.product-card[data-name="${name}"]`);
    return card ? parseFloat(card.dataset.price) : 0;
}

    // --- Event delegation for product cards (click to add) ---
    if (productGrid) {
        productGrid.addEventListener('click', (e) => {
            if (e.target.closest('.pos-size-selector')) return;
            const card = e.target.closest('.product-card');
            if (card) {
                const name = card.dataset.name;
                const price = parseFloat(card.dataset.price);
                const sizeOptions = (card.dataset.sizeOptions || '')
                    .split(',')
                    .map(item => item.trim())
                    .filter(Boolean);

                if (sizeOptions.length > 0) {
                    card.querySelector('.pos-size-selector')?.remove();
                    const selector = document.createElement('select');
                    selector.className = 'pos-size-selector';
                    selector.setAttribute('aria-label', `Choose a size for ${name}`);
                    selector.innerHTML = '<option value="">Choose size</option>' + sizeOptions
                        .map(size => `<option value="${escapeHtml(size)}">${escapeHtml(size)}</option>`)
                        .join('');
                    selector.addEventListener('change', () => {
                        if (!selector.value) return;
                        addToCart(name, price, selector.value);
                        selector.remove();
                    });
                    card.appendChild(selector);
                    selector.focus();
                    return;
                }

                addToCart(name, price);
            }
        });
    }

    loadProductCatalog();
window.addEventListener('inventory-products-loaded', event => renderProductCatalog(event.detail || []));

// Allow script.js to refresh the catalog after login or on POS navigation
window.reloadPosCatalog = loadProductCatalog;

    // --- Product search filter ---
    if (productSearch) {
        productSearch.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            document.querySelectorAll('.product-card').forEach(card => {
                const name = card.dataset.name.toLowerCase();
                const category = card.dataset.category.toLowerCase();
                if (name.includes(searchTerm) || category.includes(searchTerm)) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
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
        
        const { name } = parseCartKey(cartKey);
        const product = productCache[name];
        const maxStock = product ? (Number(product.quantity) || 0) : Infinity;
        const price = getProductPriceByName(name);
        
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
                const price = getProductPriceByName(name);
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

    function showReceipt(receiptNumber, items, subtotal, tax, total, name, phone, paymentMethod, cash, change) {
    const itemRows = items.map(item => `
        <div class="receipt-line">
            <span>${escapeHtml(item.name)} x${item.quantity}</span>
            <strong>${formatCurrency(item.price * item.quantity)}</strong>
        </div>
    `).join('');
    const customer = [name, phone].filter(Boolean).map(escapeHtml).join(' | ');
    const paymentLabel = paymentMethod === 'gcash' ? 'GCash' : 'Cash';
    
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

    [receiptClose, receiptDoneBtn].forEach(button => {
        if (button) button.addEventListener('click', () => receiptModal.classList.remove('show'));
    });

    if (receiptModal) {
        receiptModal.addEventListener('click', event => {
            if (event.target === receiptModal) receiptModal.classList.remove('show');
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
        const totalText = paymentTotal.textContent.replace(/[^\d.-]/g, '');
        const total = parseFloat(totalText) || 0;
                const name = customerName ? customerName.value.trim() : '';
        const rawPhone = customerPhone ? customerPhone.value.trim() : '';
        
        // Guard rail: phone must be exactly 11 digits if provided
        if (rawPhone && !isValidPhone(rawPhone)) {
            showToast('Phone must be exactly 11 digits (e.g., 0917 123 4567)', 'error');
            if (customerPhoneError) customerPhoneError.style.display = 'block';
            if (customerPhone) customerPhone.focus();
            return;
        }
        // Normalize: strip spaces before saving to the order
        const phone = rawPhone.replace(/\D/g, '');
        
        
        
        const items = Object.entries(cart).map(([cartKey, quantity]) => {
            const { name: itemName, size } = parseCartKey(cartKey);
            return {
                name: itemName,
                size,
                quantity,
                price: getProductPriceByName(itemName)
            };
        });
        const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const tax = subtotal * 0.08;
        const receiptNumber = createReceiptNumber();
        let cash = 0;
        let change = 0;

        if (selectedPaymentMethod === 'cash') {
            cash = parseFloat(cashReceived.value) || 0;
            if (cash < total) {
                showToast('Insufficient cash amount', 'error');
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

        // ---------- LOCAL CACHE (instant UI) ----------
        try {
            const orders = JSON.parse(localStorage.getItem('pos_orders') || '[]');
            orders.unshift(order);
            localStorage.setItem('pos_orders', JSON.stringify(orders.slice(0, 500)));
        } catch (e) {
            console.warn('Local order cache failed:', e);
        }

        // ---------- FIRESTORE SYNC (cross-device) ----------
        try {
            await window.POS_SUPABASE?.addOrder?.(order);
        } catch (err) {
            console.warn('Order sync to cloud failed:', err);
            showToast('Order saved locally. Will retry when online.', 'error');
        }

        // ---------- CUSTOMER UPSERT (Firestore + local cache) ----------
        if (name) {
            try {
                const { data } = await window.POS_SUPABASE.getCustomers();
                const existing = (data || []).find(c =>
                    c.name?.toLowerCase() === name.toLowerCase()
                );

                if (existing) {
                    await window.POS_SUPABASE.updateCustomer(existing.id, {
                        orders: (Number(existing.orders) || 0) + 1,
                        totalSpent: (Number(existing.totalSpent) || 0) + total,
                        ...(phone ? { phone } : {})
                    });
                } else {
                    await window.POS_SUPABASE.addCustomer({
                        name, email: '', phone, orders: 1, totalSpent: total
                    });
                }

                // Keep local customer cache in sync
                const customers = JSON.parse(localStorage.getItem('pos_customers') || '[]');
                const localExisting = customers.find(c =>
                    c.name?.toLowerCase() === name.toLowerCase()
                );
                if (localExisting) {
                    localExisting.orders = (Number(localExisting.orders) || 0) + 1;
                    localExisting.totalSpent = (Number(localExisting.totalSpent) || 0) + total;
                    if (phone) localExisting.phone = phone;
                } else {
                    customers.push({ id: Date.now(), name, email: '', phone, orders: 1, totalSpent: total });
                }
                localStorage.setItem('pos_customers', JSON.stringify(customers));
            } catch (err) {
                console.warn('Customer sync failed:', err);
            }
        }
// ---------- DECREMENT INVENTORY ----------
try {
    const decrements = {};
    for (const item of items) {
        const product = productCache[item.name];
        if (!product?.id) continue;
        decrements[product.id] = (decrements[product.id] || 0) + item.quantity;
    }

    for (const [productId, soldQty] of Object.entries(decrements)) {
        const product = Object.values(productCache).find(p => p.id === productId);
        if (!product) continue;

        const currentQty = Number(product.quantity) || 0;
        const newQty = Math.max(0, currentQty - soldQty);

        if (currentQty < soldQty) {
            console.warn(`Oversold ${product.name}: sold ${soldQty}, had ${currentQty}`);
        }

        const result = await window.POS_SUPABASE.updateInventoryProduct(productId, {
            quantity: newQty
        });

        if (result?.error) {
            console.warn('Inventory decrement failed for', product.name, result.error);
        } else {
            product.quantity = newQty;
        }
    }

    if (typeof window.reloadPosCatalog === 'function') {
        window.reloadPosCatalog();
    }

    window.dispatchEvent(new CustomEvent('inventory-products-loaded', {
        detail: Object.values(productCache)
    }));
} catch (err) {
    console.warn('Inventory decrement error:', err);
}

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

// Reset GCash gate after successful payment
hideGcashQr();

cart = {};
updateCartDisplay();
paymentModal.classList.remove('show');
showReceipt(receiptNumber, items, subtotal, tax, total, name, phone, selectedPaymentMethod, cash, change);
    });
    }
    
    // Initialize cart display
    updateCartDisplay();
    })();