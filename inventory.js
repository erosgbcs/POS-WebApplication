/* inventory.js — Inventory management with unified 0/1/2 option groups */
(function () {
    'use strict';

    /* ============================================================
       STATE
       ============================================================ */
    const inventoryState = {
        products: [],
        filteredProducts: [],
        currentPage: 1,
        itemsPerPage: 10,
        searchTerm: '',
        categoryFilter: '',
        stockFilter: '',
        editingProductId: null,
        deletingProductId: null,
        productsLoaded: false,
        initialized: false
    };

    let productImageDraft = null;
    let optionGroupsDraft = [];     // [{ name, values: [] }]
    let variantsDraft = {};         // { "v1::v2": { price, stock } }
    let inventoryProductsLoadPromise = null;

    /* ============================================================
       CONSTANTS
       ============================================================ */
    const CATEGORIES_KEY = 'pos_categories';
    const DEFAULT_CATEGORIES = [
        'tools', 'hardware', 'electrical', 'plumbing', 'paint',
        'garden', 'building', 'fasteners', 'safety'
    ];
    const AUTO_SKU_PATTERN = /^PRD-(\d+)$/;
    const OPTION_NAME_CHOICES = [
        'Size', 'Weight', 'Volume', 'Rating', 'Dimension',
        'Color', 'Pack Size', 'Variant', 'Specification'
    ];
    const MAX_OPTION_GROUPS = 2;

    const supabaseApi = window.POS_SUPABASE;

    /* ============================================================
       SMALL HELPERS
       ============================================================ */
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function formatCurrency(value) {
        return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
            .format(Number(value) || 0);
    }

    function titleCase(value) {
        return String(value || '').split(/[\s_]+/).filter(Boolean)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    function showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
        toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span><button class="toast-close" type="button">&times;</button>`;
        container.appendChild(toast);
        toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    function specIconClass(spec) {
        const s = String(spec || '').trim().toLowerCase();
        if (!s) return 'fas fa-ruler';
        if (/\d+\s*(kg|kgs|g|lb|lbs|oz|ton|tonne)\b/.test(s)) return 'fas fa-weight-hanging';
        if (/\d+\s*(v|vac|a|amp|amps|w|watt|watts|volt|volts|awg)\b/.test(s)) return 'fas fa-bolt';
        if (/\d+\s*(l|ml|gal|gallon|liter|litre|liters|litres)\b/.test(s)) return 'fas fa-flask';
        if (/\d+\s*(pc|pcs|set|sets|unit|units|pack|packs|pair|pairs)\b/.test(s)) return 'fas fa-list-ol';
        if (/\d+\s*[x×]\s*\d+/.test(s)) return 'fas fa-ruler-combined';
        if (/\d+\s*(mm|cm|in|inch|inches|ft|foot|feet|meter|meters)\b/.test(s)) return 'fas fa-ruler-combined';
        return 'fas fa-ruler';
    }

    /* ============================================================
       PRODUCT SHAPE — normalize + key helpers
       ============================================================ */

    function hasOptions(product) {
        return Array.isArray(product?.options) && product.options.length > 0;
    }

    function makeVariantKey(values) {
        return (Array.isArray(values) ? values : []).filter(Boolean).join('::');
    }

    function parseVariantKey(key) {
        return String(key || '').split('::').filter(Boolean);
    }

    function computeTotalStock(p) {
        if (!hasOptions(p)) return Number(p.quantity) || 0;
        const variants = p.variants && typeof p.variants === 'object' ? p.variants : {};
        return Object.values(variants).reduce((t, v) => t + (Number(v?.stock) || 0), 0);
    }

    function getStockForSelection(product, selectedValues) {
        if (!hasOptions(product)) return Number(product.quantity) || 0;
        const key = makeVariantKey(selectedValues);
        const v = (product.variants || {})[key];
        return Math.max(0, Number(v?.stock) || 0);
    }

    function getPriceForSelection(product, selectedValues) {
        if (!product) return 0;
        if (!hasOptions(product)) return Number(product.price) || 0;
        const key = makeVariantKey(selectedValues);
        const v = (product.variants || {})[key];
        if (!v || v.price == null) return Number(product.price) || 0;
        return Number(v.price) || 0;
    }

    /**
     * Convert legacy shapes to the new { options, variants } model.
     * Idempotent — new-shape documents pass through untouched.
     */
    function normalizeProduct(raw) {
        if (!raw || typeof raw !== 'object') return raw;

        // Already new shape
        if (raw.options !== undefined) {
            return {
                ...raw,
                options: Array.isArray(raw.options) && raw.options.length ? raw.options : null,
                variants: (raw.variants && typeof raw.variants === 'object') ? raw.variants : null,
                quantity: computeTotalStock(raw)
            };
        }

        // Legacy size/brand matrix (variants with `::` keys, plus size/brand strings)
        if (raw.variants && typeof raw.variants === 'object' && Object.keys(raw.variants).length) {
            const keys = Object.keys(raw.variants);
            const isMatrix = keys.some(k => String(k).includes('::'));
            let options;
            if (isMatrix) {
                const sizesSet = new Set();
                const brandsSet = new Set();
                keys.forEach(k => {
                    const [s, b] = String(k).split('::');
                    if (s) sizesSet.add(s);
                    if (b) brandsSet.add(b);
                });
                options = [];
                if (sizesSet.size) options.push({ name: 'Size', values: [...sizesSet] });
                if (brandsSet.size) options.push({ name: 'Brand', values: [...brandsSet] });
            } else {
                options = [{ name: raw.size && raw.size.includes(',') ? 'Size' : 'Variant', values: keys }];
            }
            const variants = {};
            for (const [k, v] of Object.entries(raw.variants)) {
                variants[k] = {
                    price: v && v.price != null && Number.isFinite(Number(v.price)) ? Number(v.price) : null,
                    stock: Math.max(0, Math.floor(Number(v?.stock) || 0))
                };
            }
            const out = { ...raw, options, variants };
            out.quantity = computeTotalStock(out);
            return out;
        }

        // Legacy sizeStocks
        if (raw.sizeStocks && typeof raw.sizeStocks === 'object' && Object.keys(raw.sizeStocks).length) {
            const values = Object.keys(raw.sizeStocks);
            const variants = {};
            values.forEach(v => {
                variants[v] = { price: null, stock: Math.max(0, Math.floor(Number(raw.sizeStocks[v]) || 0)) };
            });
            const out = { ...raw, options: [{ name: 'Size', values }], variants };
            out.quantity = computeTotalStock(out);
            return out;
        }

        // Legacy brandStocks
        if (raw.brandStocks && typeof raw.brandStocks === 'object' && Object.keys(raw.brandStocks).length) {
            const values = Object.keys(raw.brandStocks);
            const variants = {};
            values.forEach(v => {
                variants[v] = { price: null, stock: Math.max(0, Math.floor(Number(raw.brandStocks[v]) || 0)) };
            });
            const out = { ...raw, options: [{ name: 'Brand', values }], variants };
            out.quantity = computeTotalStock(out);
            return out;
        }

        // Simple product (no options)
        return {
            ...raw,
            options: null,
            variants: null,
            quantity: Number(raw.quantity) || 0
        };
    }

    function mapProduct(raw) {
        const p = normalizeProduct(raw);
        return {
            ...p,
            spec: String(p.spec || p.size || '').trim(),
            minStock: Number(p.minStock ?? p.min_stock ?? 0) || 0,
            quantity: computeTotalStock(p),
            lastUpdated: p.lastUpdated || p.updated_at || p.created_at || ''
        };
    }

    /* ============================================================
       PRODUCT IMAGE
       ============================================================ */
    function resizeImageFile(file, maxSize = 400, quality = 0.78) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type || !file.type.startsWith('image/')) {
                reject(new Error('Please choose an image file (JPG, PNG, or WebP).'));
                return;
            }
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read the file.'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('Could not load the image.'));
                img.onload = () => {
                    try {
                        const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
                        const w = Math.max(1, Math.round(img.width * ratio));
                        const h = Math.max(1, Math.round(img.height * ratio));
                        const canvas = document.createElement('canvas');
                        canvas.width = w;
                        canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, w, h);
                        ctx.drawImage(img, 0, 0, w, h);
                        resolve(canvas.toDataURL('image/jpeg', quality));
                    } catch (e) {
                        reject(new Error('Could not process the image.'));
                    }
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function renderProductImagePreview() {
        const previewEl = document.getElementById('productImagePreview');
        const removeBtn = document.getElementById('productImageRemove');
        if (!previewEl || !removeBtn) return;
        if (productImageDraft) {
            previewEl.classList.add('has-image');
            previewEl.innerHTML = `<img src="${productImageDraft}" alt="Product image preview">`;
            removeBtn.hidden = false;
        } else {
            previewEl.classList.remove('has-image');
            previewEl.innerHTML = '<i class="fas fa-image"></i><span>No image</span>';
            removeBtn.hidden = true;
        }
    }

    /* ============================================================
       CATEGORIES
       ============================================================ */
    let categoriesCache = null;

    function getCategoriesLocal() {
        try {
            const stored = JSON.parse(localStorage.getItem(CATEGORIES_KEY) || 'null');
            if (Array.isArray(stored) && stored.length > 0) return stored;
        } catch (e) {}
        return [...DEFAULT_CATEGORIES];
    }

    function saveCategoriesLocal(list) {
        try { localStorage.setItem(CATEGORIES_KEY, JSON.stringify(list)); } catch (e) {}
    }

    async function loadCategoriesFromCloud() {
        try {
            const { data, error } = await window.POS_SUPABASE.getCategories();
            if (!error && Array.isArray(data) && data.length > 0) {
                categoriesCache = data;
                saveCategoriesLocal(data);
            } else if (!categoriesCache) {
                categoriesCache = getCategoriesLocal();
                if (!error && (!data || data.length === 0)) {
                    await window.POS_SUPABASE.saveCategories(categoriesCache).catch(() => {});
                }
            }
        } catch (e) {
            categoriesCache = getCategoriesLocal();
        }
        renderCategoryOptions();
    }

    function getCategories() {
        return categoriesCache || getCategoriesLocal();
    }

    async function saveCategories(list) {
        categoriesCache = list;
        saveCategoriesLocal(list);
        try { await window.POS_SUPABASE.saveCategories(list); } catch (e) {}
    }

    function renderCategoryOptions() {
        const list = getCategories();
        const optionsHtml = list.map(c =>
            `<option value="${escapeHtml(c)}">${escapeHtml(titleCase(c))}</option>`
        ).join('');

        const filterSel = document.getElementById('categoryFilter');
        if (filterSel) {
            const current = filterSel.value;
            filterSel.innerHTML = `<option value="">All Categories</option>${optionsHtml}`;
            if (current && list.includes(current)) filterSel.value = current;
        }

        const formSel = document.getElementById('productCategory');
        if (formSel) {
            const current = formSel.value;
            formSel.innerHTML = `<option value="">Select category</option>${optionsHtml}`;
            if (current && list.includes(current)) formSel.value = current;
        }
    }

    async function addCategoryPrompt() {
        const name = window.prompt('New category name:')?.trim();
        if (!name) return;
        const normalized = name.toLowerCase();
        const list = getCategories();
        if (list.some(c => c.toLowerCase() === normalized)) {
            showToast('Category already exists', 'error');
            return;
        }
        list.push(normalized);
        await saveCategories(list);
        renderCategoryOptions();
        const formSel = document.getElementById('productCategory');
        if (formSel) formSel.value = normalized;
        window.POS_APP_LOG?.('create', 'inventory', `Category "${name}" added`, 'info');
        showToast(`Category "${name}" added`, 'success');
    }

    /* ============================================================
       SKU + DEDUP
       ============================================================ */
    function generateNextSku() {
        let max = 0;
        for (const p of inventoryState.products) {
            const m = AUTO_SKU_PATTERN.exec(String(p.sku || '').trim());
            if (m) {
                const n = parseInt(m[1], 10);
                if (Number.isFinite(n) && n > max) max = n;
            }
        }
        return `PRD-${String(max + 1).padStart(3, '0')}`;
    }

    function findProductByName(name) {
        const needle = String(name || '').trim().toLowerCase();
        if (!needle) return null;
        return inventoryState.products.find(p =>
            String(p.name || '').trim().toLowerCase() === needle
        ) || null;
    }

    /* ============================================================
       STOCK STATUS
       ============================================================ */
    function getStockStatus(quantity, minStock) {
        if (quantity === 0) return 'out_of_stock';
        if (quantity <= minStock) return 'low_stock';
        if (quantity > minStock * 2) return 'over_stock';
        return 'in_stock';
    }

    function getProductStockStatus(product) {
        const minStock = Number(product.minStock) || 0;
        if (!hasOptions(product)) {
            return getStockStatus(Number(product.quantity) || 0, minStock);
        }
        const slices = Object.values(product.variants || {}).map(v => Number(v?.stock) || 0);
        if (!slices.length || slices.every(s => s === 0)) return 'out_of_stock';
        if (slices.some(s => s <= minStock)) return 'low_stock';
        const total = slices.reduce((t, s) => t + s, 0);
        if (total > minStock * 2) return 'over_stock';
        return 'in_stock';
    }

    function getStockBadge(status) {
        const badges = {
            in_stock: '<span class="stock-badge in-stock"><i class="fas fa-check-circle"></i> In Stock</span>',
            low_stock: '<span class="stock-badge low-stock"><i class="fas fa-exclamation-triangle"></i> Low Stock</span>',
            out_of_stock: '<span class="stock-badge out-of-stock"><i class="fas fa-times-circle"></i> Out of Stock</span>',
            over_stock: '<span class="stock-badge over-stock"><i class="fas fa-arrow-up"></i> Over Stocked</span>'
        };
        return badges[status] || badges.in_stock;
    }

    function syncFilterCards() {
        const current = inventoryState.stockFilter || '';
        document.querySelectorAll('.inv-filter-card').forEach(card => {
            const filter = card.dataset.stockFilter || '';
            card.classList.toggle('active', filter === current);
        });
    }

    function updateInventoryStats() {
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        setText('totalProducts', inventoryState.products.length);
        setText('overStockProducts', inventoryState.products.filter(p => getProductStockStatus(p) === 'over_stock').length);
        setText('lowStockProducts', inventoryState.products.filter(p => getProductStockStatus(p) === 'low_stock').length);
        setText('outOfStockProducts', inventoryState.products.filter(p => getProductStockStatus(p) === 'out_of_stock').length);
    }

    /* ============================================================
       FILTER + RENDER
       ============================================================ */
    function filterProducts() {
        const { searchTerm, categoryFilter, stockFilter } = inventoryState;
        const search = searchTerm.toLowerCase();
        inventoryState.filteredProducts = inventoryState.products.filter(product => {
            const matchesSearch = !search
                || product.name.toLowerCase().includes(search)
                || (product.sku || '').toLowerCase().includes(search)
                || (product.supplier || '').toLowerCase().includes(search);
            const matchesCategory = !categoryFilter || product.category === categoryFilter;
            const matchesStock = !stockFilter || getProductStockStatus(product) === stockFilter;
            return matchesSearch && matchesCategory && matchesStock;
        });
        inventoryState.currentPage = 1;
        renderInventoryTable();
        renderPagination();
    }

    function renderQuantityCell(product) {
        if (!hasOptions(product)) {
            return `<input type="number" class="quantity-input" value="${Number(product.quantity) || 0}" min="0" data-product-id="${product.id}" onchange="updateQuantity('${product.id}', this.value)">`;
        }
        const variants = product.variants || {};
        const rows = Object.entries(variants).map(([key, v]) => {
            const stock = Number(v?.stock) || 0;
            const cls = stock === 0 ? 'out-of-stock' : (stock <= product.minStock ? 'low-stock' : '');
            return `<div><span>${escapeHtml(key.replace(/::/g, ' · '))}</span><strong class="size-stock-count ${cls}">${stock}</strong></div>`;
        }).join('');
        return `<div class="size-stock-summary">${rows}<strong class="size-stock-total">Total: ${computeTotalStock(product)}</strong></div>`;
    }

    function renderPriceCell(product) {
        if (!hasOptions(product)) return formatCurrency(product.price);
        const prices = Object.values(product.variants || {})
            .map(v => v && v.price != null ? Number(v.price) : null)
            .filter(p => p != null);
        if (!prices.length) return formatCurrency(product.price);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        return min === max ? formatCurrency(min) : `${formatCurrency(min)} – ${formatCurrency(max)}`;
    }

    function renderInventoryTable() {
        const tbody = document.getElementById('inventoryTableBody');
        const table = document.getElementById('inventoryTable');
        const emptyState = document.getElementById('inventoryEmpty');
        const loading = document.getElementById('inventoryLoading');
        if (!tbody) return;
        if (loading) loading.style.display = 'none';
        if (table) table.style.display = 'table';

        const products = inventoryState.filteredProducts;
        if (!products.length) {
            if (emptyState) emptyState.style.display = 'block';
            if (table) table.style.display = 'none';
            tbody.innerHTML = '';
            return;
        }
        if (emptyState) emptyState.style.display = 'none';

        const start = (inventoryState.currentPage - 1) * inventoryState.itemsPerPage;
        const pageProducts = products.slice(start, start + inventoryState.itemsPerPage);

        tbody.innerHTML = pageProducts.map(product => {
            const status = getProductStockStatus(product);
            const specLabel = product.spec
                ? `<span class="product-sku"><i class="${specIconClass(product.spec)}"></i> ${escapeHtml(product.spec)}</span>`
                : '';
            const optionHint = hasOptions(product)
                ? `<span class="product-sku"><i class="fas fa-layer-group"></i> ${product.options.map(o => escapeHtml(o.name)).join(' · ')}</span>`
                : '';
            const thumbHtml = product.image
                ? `<img class="inventory-thumb" src="${product.image}" alt="">`
                : `<div class="inventory-thumb inventory-thumb-empty"><i class="fas fa-box"></i></div>`;

            // Compact timestamp — "Oct 12, 9:48 PM" instead of the full ISO string.
            const updatedRaw = product.lastUpdated;
            let updatedDisplay = '—';
            if (updatedRaw) {
                const d = new Date(updatedRaw);
                if (!isNaN(d.getTime())) {
                    updatedDisplay = d.toLocaleString('en-PH', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                    });
                } else {
                    updatedDisplay = String(updatedRaw).slice(0, 16).replace('T', ' ');
                }
            }

            return `<tr>
                <td>
                    <div class="product-info">
                        ${thumbHtml}
                        <div class="product-details">
                            <p class="product-name">${escapeHtml(product.name)}</p>
                            ${specLabel}
                            ${optionHint}
                            <span class="product-sku">Product Code: ${escapeHtml(product.sku || '')}</span>
                        </div>
                    </div>
                </td>
                <td>${escapeHtml(product.category || '')}</td>
                <td>${renderPriceCell(product)}</td>
                <td>${renderQuantityCell(product)}</td>
                <td>${getStockBadge(status)}</td>
                <td title="${escapeHtml(updatedRaw || '')}">${escapeHtml(updatedDisplay)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon edit" type="button" onclick="editProduct('${product.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon delete" type="button" onclick="showDeleteModal('${product.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    function renderPagination() {
        const pagination = document.getElementById('inventoryPagination');
        if (!pagination) return;
        const totalPages = Math.ceil(inventoryState.filteredProducts.length / inventoryState.itemsPerPage);
        if (totalPages <= 1) { pagination.innerHTML = ''; return; }
        let html = `<button class="page-btn" type="button" onclick="changePage(${inventoryState.currentPage - 1})" ${inventoryState.currentPage === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;
        for (let page = 1; page <= totalPages; page++) {
            html += `<button class="page-btn ${inventoryState.currentPage === page ? 'active' : ''}" type="button" onclick="changePage(${page})">${page}</button>`;
        }
        html += `<button class="page-btn" type="button" onclick="changePage(${inventoryState.currentPage + 1})" ${inventoryState.currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
        pagination.innerHTML = html;
    }

    /* ============================================================
       MODAL — open / close
       ============================================================ */
    function openProductModal(productId = null) {
        inventoryState.editingProductId = productId;
        const modal = document.getElementById('productModal');
        const title = document.getElementById('productModalTitle');
        const form = document.getElementById('productForm');
        if (!modal || !title || !form) return;

        form.reset();
        optionGroupsDraft = [];
        variantsDraft = {};
        productImageDraft = null;

        const hasOptionsCb = document.getElementById('productHasOptions');

        if (productId) {
            const product = inventoryState.products.find(p => p.id === productId);
            if (product) {
                title.textContent = 'Edit Product';
                document.getElementById('productName').value = product.name || '';
                document.getElementById('productSKU').value = product.sku || '';
                document.getElementById('productCategory').value = product.category || '';
                document.getElementById('productPrice').value = product.price ?? '';
                document.getElementById('productQuantity').value = product.quantity ?? 0;
                document.getElementById('productMinStock').value = product.minStock ?? 1;
                document.getElementById('productSupplier').value = product.supplier || '';
                document.getElementById('productSpec').value = product.spec || '';

                if (hasOptions(product)) {
                    hasOptionsCb.checked = true;
                    optionGroupsDraft = product.options.map(o => ({ name: o.name, values: [...o.values] }));
                    variantsDraft = JSON.parse(JSON.stringify(product.variants || {}));
                } else {
                    hasOptionsCb.checked = false;
                }

                productImageDraft = product.image || null;
            }
        } else {
            title.textContent = 'Add Product';
            const skuInput = document.getElementById('productSKU');
            if (skuInput) skuInput.value = generateNextSku();
            hasOptionsCb.checked = false;
        }

        renderProductImagePreview();
        updateOptionsUI();
        modal.classList.add('active');
    }

    function closeProductModal() {
        document.getElementById('productModal')?.classList.remove('active');
        inventoryState.editingProductId = null;
        optionGroupsDraft = [];
        variantsDraft = {};
    }

    /* ============================================================
       MODAL — options editor
       ============================================================ */
    function updateOptionsUI() {
        const hasOptions = document.getElementById('productHasOptions')?.checked || false;
        const editor = document.getElementById('productOptionsEditor');
        const variantsEditor = document.getElementById('productVariantsEditor');
        const sharedQty = document.getElementById('sharedQuantityGroup');
        const specGroup = document.getElementById('productSpecGroup');
        const qtyInput = document.getElementById('productQuantity');

        if (!hasOptions) {
            if (editor) editor.style.display = 'none';
            if (variantsEditor) variantsEditor.style.display = 'none';
            if (sharedQty) sharedQty.style.display = '';
            if (specGroup) specGroup.style.display = '';
            if (qtyInput) qtyInput.required = true;
            return;
        }

        if (editor) editor.style.display = '';
        if (variantsEditor) variantsEditor.style.display = '';
        if (sharedQty) sharedQty.style.display = 'none';
        if (specGroup) specGroup.style.display = 'none';
        if (qtyInput) qtyInput.required = false;

        if (optionGroupsDraft.length === 0) {
            optionGroupsDraft.push({ name: 'Size', values: [] });
        }
        renderOptionGroups();
        renderVariantsEditor();
    }

    function renderOptionGroups() {
        const container = document.getElementById('optionGroupsContainer');
        const addBtn = document.getElementById('addOptionGroupBtn');
        if (!container) return;

        container.innerHTML = optionGroupsDraft.map((group, idx) => {
            const nameOptions = OPTION_NAME_CHOICES
                .map(n => `<option value="${escapeHtml(n)}" ${n === group.name ? 'selected' : ''}>${escapeHtml(n)}</option>`)
                .join('');
            const chips = group.values.length
                ? group.values.map(v => `<span class="size-chip">${escapeHtml(v)}</span>`).join('')
                : '';
            return `
                <div class="option-group" data-option-index="${idx}">
                    <div class="option-group-header">
                        <span class="option-group-label">Option ${idx + 1}</span>
                        <select class="option-name-select" data-option-index="${idx}">
                            ${nameOptions}
                        </select>
                        ${idx > 0 ? `<button type="button" class="option-remove-btn" data-remove-option="${idx}"><i class="fas fa-times"></i> Remove</button>` : ''}
                    </div>
                    <input type="text" class="option-values-input" data-option-index="${idx}"
                           placeholder="Comma-separated, e.g., 2 in, 4 in, 6 in"
                           value="${escapeHtml(group.values.join(', '))}">
                    <div class="option-values-preview">${chips}</div>
                </div>
            `;
        }).join('');

        if (addBtn) {
            addBtn.style.display = optionGroupsDraft.length >= MAX_OPTION_GROUPS ? 'none' : '';
        }
    }

    function renderVariantsEditor() {
        const body = document.getElementById('variantsEditorBody');
        const summary = document.getElementById('variantsEditorSummary');
        if (!body) return;

        const groups = optionGroupsDraft.filter(g => g.values.length > 0);
        if (groups.length === 0) {
            body.innerHTML = '<p class="form-hint">Type at least one option value above to see the stock editor.</p>';
            if (summary) summary.innerHTML = '';
            return;
        }

        if (groups.length === 1) {
            renderVariantList(body, summary, groups[0]);
        } else {
            renderVariantMatrix(body, summary, groups[0], groups[1]);
        }
    }

    function renderVariantList(body, summary, group) {
        const basePrice = parseFloat(document.getElementById('productPrice')?.value) || 0;
        body.innerHTML = `<div class="variant-list">${group.values.map(v => {
            const vd = variantsDraft[v] || {};
            const price = vd.price != null ? vd.price : '';
            const stock = vd.stock != null ? vd.stock : '';
            return `
                <div class="variant-row">
                    <div class="variant-row-label">${escapeHtml(v)}</div>
                    <input type="number" min="0" step="1" placeholder="stock"
                           data-variant-key="${escapeHtml(v)}" data-variant-field="stock"
                           value="${escapeHtml(stock)}">
                    <input type="number" min="0" step="0.01" placeholder="${basePrice || 'price'}"
                           data-variant-key="${escapeHtml(v)}" data-variant-field="price"
                           value="${escapeHtml(price)}">
                </div>`;
        }).join('')}</div>`;
        updateVariantsSummary(summary);
    }

    function renderVariantMatrix(body, summary, g1, g2) {
        const basePrice = parseFloat(document.getElementById('productPrice')?.value) || 0;
        const header = `<tr><th class="matrix-row-label">${escapeHtml(g1.name)}</th>`
            + g2.values.map(v => `<th>${escapeHtml(v)}</th>`).join('') + '</tr>';
        const rows = g1.values.map(v1 => {
            const cells = g2.values.map(v2 => {
                const key = `${v1}::${v2}`;
                const vd = variantsDraft[key] || {};
                const price = vd.price != null ? vd.price : '';
                const stock = vd.stock != null ? vd.stock : '';
                return `<td><div class="variant-cell-input">
                    <input class="matrix-stock" type="number" min="0" step="1" placeholder="stock"
                           data-variant-key="${escapeHtml(key)}" data-variant-field="stock"
                           value="${escapeHtml(stock)}">
                    <input class="matrix-price" type="number" min="0" step="0.01" placeholder="₱"
                           data-variant-key="${escapeHtml(key)}" data-variant-field="price"
                           value="${escapeHtml(price)}">
                </div></td>`;
            }).join('');
            return `<tr><th class="matrix-row-label">${escapeHtml(v1)}</th>${cells}</tr>`;
        }).join('');
        body.innerHTML = `<div class="matrix-wrap"><table class="matrix-table">
            <thead>${header}</thead>
            <tbody>${rows}</tbody>
        </table></div>`;
        updateVariantsSummary(summary);
    }

    function updateVariantsSummary(summaryEl) {
        if (!summaryEl) return;
        const keys = getAllVariantKeys();
        let count = 0, totalStock = 0;
        let minPrice = Infinity, maxPrice = -Infinity;
        keys.forEach(k => {
            const vd = variantsDraft[k] || {};
            const stock = Number(vd.stock);
            if (Number.isFinite(stock) && stock >= 0) {
                count++;
                totalStock += stock;
                if (vd.price != null && Number.isFinite(Number(vd.price))) {
                    const p = Number(vd.price);
                    if (p < minPrice) minPrice = p;
                    if (p > maxPrice) maxPrice = p;
                }
            }
        });
        const rangeStr = count === 0 || !Number.isFinite(minPrice)
            ? '—'
            : (minPrice === maxPrice ? formatCurrency(minPrice) : `${formatCurrency(minPrice)} – ${formatCurrency(maxPrice)}`);
        summaryEl.innerHTML = `
            <span>Variants:<strong>${count}</strong></span>
            <span>Total stock:<strong>${totalStock}</strong></span>
            <span>Price range:<strong>${rangeStr}</strong></span>
        `;
    }

    function getAllVariantKeys() {
        const groups = optionGroupsDraft.filter(g => g.values.length > 0);
        if (groups.length === 0) return [];
        if (groups.length === 1) return [...groups[0].values];
        const keys = [];
        for (const v1 of groups[0].values) {
            for (const v2 of groups[1].values) keys.push(`${v1}::${v2}`);
        }
        return keys;
    }

    function syncVariantsDraftFromDOM() {
        document.querySelectorAll('[data-variant-key]').forEach(input => {
            const key = input.dataset.variantKey;
            const field = input.dataset.variantField;
            if (!variantsDraft[key]) variantsDraft[key] = { price: null, stock: null };
            const raw = input.value.trim();
            variantsDraft[key][field] = raw === '' ? null : Number(raw);
        });
    }

    function pruneVariantsDraft() {
        const valid = new Set(getAllVariantKeys());
        for (const k of Object.keys(variantsDraft)) {
            if (!valid.has(k)) delete variantsDraft[k];
        }
    }

    /* ============================================================
       MODAL — save
       ============================================================ */
    async function saveProduct(event) {
        event.preventDefault();

        // Guard: block re-entry while a save is already in flight. Prevents
        // a fast double-click from creating two Firestore documents.
        const saveBtn = document.getElementById('saveProductBtn');
        if (saveBtn?.dataset.saving === '1') return;
        const originalBtnHtml = saveBtn?.innerHTML;
        if (saveBtn) {
            saveBtn.dataset.saving = '1';
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
        }

        const restoreSaveBtn = () => {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalBtnHtml || '<i class="fas fa-save"></i> Save Product';
                delete saveBtn.dataset.saving;
            }
        };

        try {
            await _saveProductInner(event);
        } finally {
            restoreSaveBtn();
        }
    }

    async function _saveProductInner(event) {
        syncVariantsDraftFromDOM();
        pruneVariantsDraft();

        const name = document.getElementById('productName').value.trim();
        const sku = document.getElementById('productSKU').value.trim();
        const category = document.getElementById('productCategory').value;
        const price = parseFloat(document.getElementById('productPrice').value);
        const minStock = parseInt(document.getElementById('productMinStock').value, 10);
        const supplier = document.getElementById('productSupplier').value.trim();
        const description = document.getElementById('productDescription').value.trim();
        const spec = document.getElementById('productSpec').value.trim();
        const hasOptionsCb = document.getElementById('productHasOptions').checked;

        if (!name) { showToast('Product name is required', 'error'); return; }
        if (!category) { showToast('Category is required', 'error'); return; }
        if (!Number.isFinite(price) || price < 0) { showToast('Enter a valid price', 'error'); return; }
        if (!Number.isFinite(minStock) || minStock < 1) { showToast('Minimum stock level is required', 'error'); return; }

        let options = null;
        let variants = null;
        let quantity;

        if (!hasOptionsCb) {
            quantity = parseInt(document.getElementById('productQuantity').value, 10);
            if (!Number.isFinite(quantity) || quantity < 0) {
                showToast('Enter a valid initial quantity', 'error');
                return;
            }
        } else {
            const groups = optionGroupsDraft.filter(g => g.values.length > 0);
            if (groups.length === 0) {
                showToast('Add at least one option value', 'error');
                return;
            }
            options = groups.map(g => ({ name: g.name || 'Option', values: [...g.values] }));
            variants = {};
            let total = 0;
            const keys = getAllVariantKeys();
            for (const key of keys) {
                const vd = variantsDraft[key] || {};
                const stock = Number(vd.stock);
                if (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock)) {
                    showToast(`Enter a whole-number stock for "${key.replace(/::/g, ' · ')}"`, 'error');
                    return;
                }
                let vPrice = null;
                if (vd.price != null && vd.price !== '') {
                    const p = Number(vd.price);
                    if (!Number.isFinite(p) || p < 0) {
                        showToast(`Enter a valid price for "${key.replace(/::/g, ' · ')}" or leave blank`, 'error');
                        return;
                    }
                    vPrice = p;
                }
                variants[key] = { price: vPrice, stock };
                total += stock;
            }
            if (Object.keys(variants).length === 0) {
                showToast('Add at least one variant with stock', 'error');
                return;
            }
            quantity = total;
        }

        const productData = {
            name, sku, category, price, quantity, minStock, supplier, spec,
            description, image: productImageDraft || null,
            options, variants
        };

        // ---------- Name dedup (new products only) ----------
        if (!inventoryState.editingProductId) {
            const existing = findProductByName(name);
            if (existing) {
                showToast(`A product named "${existing.name}" already exists. Edit that one instead.`, 'error');
                return;
            }
        }

        // ---------- SKU uniqueness ----------
        if (sku) {
            const conflict = inventoryState.products.some(
                p => p.sku === sku && p.id !== inventoryState.editingProductId
            );
            if (conflict) {
                // Previously the "new product" path silently replaced the
                // user's SKU with an auto-generated one. That's surprising
                // and inconsistent with the edit path. Surface the error.
                showToast(`Product code "${sku}" already exists. Use a different code.`, 'error');
                return;
            }
        } else if (!inventoryState.editingProductId) {
            productData.sku = generateNextSku();
        }

        const payload = { ...productData, min_stock: productData.minStock };
        delete payload.minStock;
        // Persist explicit nulls so Firestore stores the shape consistently
        payload.options = productData.options;
        payload.variants = productData.variants;

        let result;
        if (inventoryState.editingProductId) {
            result = await supabaseApi.updateInventoryProduct(inventoryState.editingProductId, payload);
            const idx = inventoryState.products.findIndex(p => p.id === inventoryState.editingProductId);
            if (!result.error && idx !== -1) {
                inventoryState.products[idx] = mapProduct({
                    ...inventoryState.products[idx],
                    ...productData,
                    min_stock: productData.minStock,
                    id: inventoryState.editingProductId
                });
            }
            window.POS_APP_LOG?.('update', 'inventory', `Product ${name} updated`, 'info');
            showToast(result.error ? result.error.message : 'Product updated successfully', result.error ? 'error' : 'success');
        } else {
            result = await supabaseApi.addInventoryProduct(payload);
            if (!result.error && result.data?.[0]) {
                // Guard against a race with the Firestore onSnapshot subscription:
                // the snapshot can fire before addDoc() resolves and already
                // inserted the new product into inventoryState.products.
                // If the id already exists, skip the local unshift.
                const newProduct = mapProduct(result.data[0]);
                const alreadyPresent = inventoryState.products.some(p => String(p.id) === String(newProduct.id));
                if (!alreadyPresent) {
                    inventoryState.products.unshift(newProduct);
                }
            }
            window.POS_APP_LOG?.('create', 'inventory', `Product ${name} added`, 'info');
            showToast(result.error ? result.error.message : 'Product added successfully', result.error ? 'error' : 'success');
        }
        if (result.error) return;

        productImageDraft = null;
        optionGroupsDraft = [];
        variantsDraft = {};
        updateInventoryStats();
        filterProducts();
        closeProductModal();
        window.dispatchEvent(new CustomEvent('inventory-products-loaded', { detail: inventoryState.products }));
        window.dispatchEvent(new CustomEvent('inventory-products-changed'));
    }

    /* ============================================================
       DELETE + EXPORT
       ============================================================ */
    function closeDeleteModal() {
        document.getElementById('deleteModal')?.classList.remove('active');
        inventoryState.deletingProductId = null;
    }

    async function confirmDelete() {
        if (!inventoryState.deletingProductId) return;
        const result = await supabaseApi.deleteInventoryProduct(inventoryState.deletingProductId);
        if (result.error) { showToast(result.error.message, 'error'); return; }
        inventoryState.products = inventoryState.products.filter(p => p.id !== inventoryState.deletingProductId);
        updateInventoryStats();
        filterProducts();
        window.dispatchEvent(new CustomEvent('inventory-products-loaded', { detail: inventoryState.products }));
        window.dispatchEvent(new CustomEvent('inventory-products-changed'));
        window.POS_APP_LOG?.('delete', 'inventory', `Product ${inventoryState.deletingProductId} deleted`, 'warning');
        showToast('Product deleted successfully', 'success');
        closeDeleteModal();
    }

    function exportInventory() {
        if (!inventoryState.products.length) { showToast('No products to export', 'error'); return; }
        const headers = ['ID', 'Name', 'Product Code', 'Category', 'Price', 'Total Stock', 'Min Stock', 'Supplier', 'Spec', 'Options', 'Variants', 'Description', 'Last Updated'];
        const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = inventoryState.products.map(p => [
            p.id, p.name, p.sku, p.category, p.price, p.quantity, p.minStock, p.supplier,
            p.spec || '',
            p.options ? p.options.map(o => `${o.name}: ${o.values.join('/')}`).join(' | ') : '',
            p.variants ? JSON.stringify(p.variants) : '',
            p.description, p.lastUpdated
        ]);
        const blob = new Blob([[headers, ...rows].map(r => r.map(escapeCsv).join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url; link.download = `inventory_${new Date().toISOString().split('T')[0]}.csv`; link.click(); URL.revokeObjectURL(url);
        window.POS_APP_LOG?.('export', 'inventory', 'Inventory CSV exported', 'info');
        showToast('Inventory exported successfully', 'success');
    }

    /* ============================================================
       EVENT LISTENERS
       ============================================================ */
    function setupInventoryEventListeners() {
        if (inventoryState.initialized) return;
        inventoryState.initialized = true;

        document.getElementById('addProductBtn')?.addEventListener('click', () => openProductModal());

        // Has options toggle
        document.getElementById('productHasOptions')?.addEventListener('change', updateOptionsUI);

        // Add second option group
        document.getElementById('addOptionGroupBtn')?.addEventListener('click', () => {
            if (optionGroupsDraft.length >= MAX_OPTION_GROUPS) return;
            optionGroupsDraft.push({ name: 'Brand', values: [] });
            renderOptionGroups();
            renderVariantsEditor();
        });

        // Option groups — delegation
        const optionsContainer = document.getElementById('optionGroupsContainer');
        if (optionsContainer) {
            optionsContainer.addEventListener('input', (e) => {
                const idx = Number(e.target.dataset.optionIndex);
                if (!Number.isFinite(idx) || !optionGroupsDraft[idx]) return;

                if (e.target.matches('.option-values-input')) {
                    const values = [...new Set(
                        e.target.value.split(',').map(v => v.trim()).filter(Boolean)
                    )];
                    optionGroupsDraft[idx].values = values;
                    renderVariantsEditor();
                }
            });
            optionsContainer.addEventListener('change', (e) => {
                const idx = Number(e.target.dataset.optionIndex);
                if (!Number.isFinite(idx) || !optionGroupsDraft[idx]) return;
                if (e.target.matches('.option-name-select')) {
                    optionGroupsDraft[idx].name = e.target.value;
                    renderVariantsEditor();
                }
            });
            optionsContainer.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('[data-remove-option]');
                if (!removeBtn) return;
                const idx = Number(removeBtn.dataset.removeOption);
                if (!Number.isFinite(idx) || idx <= 0) return;
                optionGroupsDraft.splice(idx, 1);
                pruneVariantsDraft();
                renderOptionGroups();
                renderVariantsEditor();
            });
        }

        // Variants editor — capture input into draft, re-render summary
        const variantsBody = document.getElementById('variantsEditorBody');
        if (variantsBody) {
            variantsBody.addEventListener('input', (e) => {
                if (!e.target.matches('[data-variant-key]')) return;
                const key = e.target.dataset.variantKey;
                const field = e.target.dataset.variantField;
                if (!variantsDraft[key]) variantsDraft[key] = { price: null, stock: null };
                const raw = e.target.value.trim();
                variantsDraft[key][field] = raw === '' ? null : Number(raw);
                updateVariantsSummary(document.getElementById('variantsEditorSummary'));
            });
        }

        // Category
        document.getElementById('addCategoryBtn')?.addEventListener('click', addCategoryPrompt);

        // Product image
        document.getElementById('productImageInput')?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                productImageDraft = await resizeImageFile(file);
                renderProductImagePreview();
            } catch (err) {
                showToast(err.message || 'Could not load image', 'error');
            } finally {
                e.target.value = '';
            }
        });
        document.getElementById('productImageRemove')?.addEventListener('click', () => {
            productImageDraft = null;
            renderProductImagePreview();
        });

        // Export
        document.getElementById('exportInventoryBtn')?.addEventListener('click', exportInventory);

        // Search + filters
        (() => {
            const searchEl = document.getElementById('inventorySearch');
            if (!searchEl) return;
            let t = null;
            searchEl.addEventListener('input', (event) => {
                inventoryState.searchTerm = event.target.value;
                clearTimeout(t);
                t = setTimeout(() => filterProducts(), 150);
            });
        })();
        document.getElementById('categoryFilter')?.addEventListener('change', e => {
            inventoryState.categoryFilter = e.target.value; filterProducts();
        });
        document.getElementById('stockFilter')?.addEventListener('change', e => {
            inventoryState.stockFilter = e.target.value; syncFilterCards(); filterProducts();
        });

        // Filter cards
        document.querySelectorAll('.inv-filter-card').forEach(card => {
            const apply = () => {
                const filter = card.dataset.stockFilter || '';
                inventoryState.stockFilter = filter;
                const select = document.getElementById('stockFilter');
                if (select) select.value = filter;
                syncFilterCards();
                filterProducts();
            };
            card.addEventListener('click', apply);
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(); }
            });
        });

        // Modal close
        document.getElementById('closeProductModal')?.addEventListener('click', closeProductModal);
        document.getElementById('cancelProductBtn')?.addEventListener('click', closeProductModal);
        document.getElementById('productForm')?.addEventListener('submit', saveProduct);

        // Delete modal
        document.getElementById('closeDeleteModal')?.addEventListener('click', closeDeleteModal);
        document.getElementById('cancelDeleteBtn')?.addEventListener('click', closeDeleteModal);
        document.getElementById('confirmDeleteBtn')?.addEventListener('click', confirmDelete);

        // Outside click
        window.addEventListener('click', event => {
            if (event.target === document.getElementById('productModal')) closeProductModal();
            if (event.target === document.getElementById('deleteModal')) closeDeleteModal();
        });
    }

    /* ============================================================
       PUBLIC API
       ============================================================ */
    window.initInventory = function () {
        if (categoriesCache === null) loadCategoriesFromCloud();

        if (!supabaseApi?.isConfigured?.()) {
            inventoryState.products = [];
            inventoryState.productsLoaded = true;
            showToast('Firebase is not configured', 'error');
            renderCategoryOptions();
            updateInventoryStats();
            filterProducts();
            setupInventoryEventListeners();
            return;
        }
        if (!inventoryState.productsLoaded && !inventoryProductsLoadPromise) {
            inventoryProductsLoadPromise = supabaseApi.getInventoryProducts().then(result => {
                if (result.error) {
                    showToast(result.error.message, 'error');
                    inventoryState.products = [];
                } else {
                    inventoryState.products = (result.data || []).map(mapProduct);
                }
                inventoryState.productsLoaded = true;
                renderCategoryOptions();
                updateInventoryStats();
                filterProducts();
                setupInventoryEventListeners();
                window.dispatchEvent(new CustomEvent('inventory-products-loaded', { detail: inventoryState.products }));
            }).finally(() => { inventoryProductsLoadPromise = null; });
        }
        updateInventoryStats();
        filterProducts();
        setupInventoryEventListeners();
    };

    window.setInventoryProducts = function (products) {
        inventoryState.products = (products || []).map(mapProduct);
        inventoryState.productsLoaded = true;
        renderCategoryOptions();
        updateInventoryStats();
        filterProducts();
        window.dispatchEvent(new CustomEvent('inventory-products-loaded', { detail: inventoryState.products }));
    };

    window.filterInventoryByStock = function (stockFilter) {
        inventoryState.stockFilter = stockFilter || '';
        const sel = document.getElementById('stockFilter');
        if (sel) sel.value = inventoryState.stockFilter;
        filterProducts();
    };

    window.getInventorySnapshot = function () {
        return inventoryState.products.map(p => ({ ...p }));
    };

    window.changePage = function (page) {
        const total = Math.ceil(inventoryState.filteredProducts.length / inventoryState.itemsPerPage);
        if (page < 1 || page > total) return;
        inventoryState.currentPage = page;
        renderInventoryTable();
        renderPagination();
    };

    window.updateQuantity = function (productId, newQuantity) {
        const quantity = parseInt(newQuantity, 10);
        if (Number.isNaN(quantity) || quantity < 0) return;
        const product = inventoryState.products.find(p => p.id === productId);
        if (!product || hasOptions(product)) return;
        product.quantity = quantity;
        product.lastUpdated = new Date().toISOString();
        supabaseApi.updateInventoryProduct(productId, { quantity }).then(result => {
            if (result.error) { showToast(result.error.message, 'error'); return; }
            updateInventoryStats();
            filterProducts();
            window.dispatchEvent(new CustomEvent('inventory-products-loaded', { detail: inventoryState.products }));
            window.dispatchEvent(new CustomEvent('inventory-products-changed'));
            window.POS_APP_LOG?.('update', 'inventory', `Quantity updated for product ${productId}`, 'info');
            showToast('Quantity updated successfully', 'success');
        });
    };

    window.editProduct = openProductModal;

    window.showDeleteModal = function (productId) {
        inventoryState.deletingProductId = productId;
        const product = inventoryState.products.find(p => p.id === productId);
        const name = document.getElementById('deleteProductName');
        if (product && name) name.textContent = `${product.name} (${product.sku})`;
        document.getElementById('deleteModal')?.classList.add('active');
    };
})();