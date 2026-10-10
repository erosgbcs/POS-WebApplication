/* inventory.js - Inventory management functionality */
(function() {
    let inventoryState = {
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
let variantStockDraft = {};
let brandStockDraft = {};
let inventoryProductsLoadPromise = null;

const supabaseApi = window.POS_SUPABASE; // ← ADD THIS LINE

// ---------- CATEGORIES MANAGEMENT (Firestore-backed) ----------
const CATEGORIES_KEY = 'pos_categories';
const DEFAULT_CATEGORIES = [
    'tools', 'hardware', 'electrical', 'plumbing', 'paint',
    'garden', 'building', 'fasteners', 'safety'
];

let categoriesCache = null;

function getCategoriesLocal() {
    try {
        const stored = JSON.parse(localStorage.getItem(CATEGORIES_KEY) || 'null');
        if (Array.isArray(stored) && stored.length > 0) return stored;
    } catch (e) {}
    return [...DEFAULT_CATEGORIES];
}

function saveCategoriesLocal(list) {
    try {
        localStorage.setItem(CATEGORIES_KEY, JSON.stringify(list));
    } catch (e) {
        console.error('Unable to save categories locally', e);
    }
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
    try {
        await window.POS_SUPABASE.saveCategories(list);
    } catch (e) {
        console.warn('Categories cloud sync failed:', e);
    }
}

function titleCase(value) {
    return String(value || '')
        .split(/[\s_]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
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
    const formatCurrency = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0);

    function mapProduct(product) {
    const rawSize = String(product.size || '').trim();
    let inferredMode = product.sizeMode;
    if (!inferredMode) {
        inferredMode = rawSize.includes(',') ? 'variants' : 'spec';
    }
    const sizeStocks = product.sizeStocks && typeof product.sizeStocks === 'object' && !Array.isArray(product.sizeStocks)
        ? Object.fromEntries(Object.entries(product.sizeStocks).map(([size, value]) => {
            const stock = Number(value);
            return [size, Number.isFinite(stock) && stock >= 0 ? Math.floor(stock) : 0];
        }))
        : null;

    const rawBrand = String(product.brand || '').trim();
    let brandMode = product.brandMode;
    if (!brandMode) {
        brandMode = rawBrand.includes(',') ? 'variants' : 'single';
    }
    const brandStocks = product.brandStocks && typeof product.brandStocks === 'object' && !Array.isArray(product.brandStocks)
        ? Object.fromEntries(Object.entries(product.brandStocks).map(([brand, value]) => {
            const stock = Number(value);
            return [brand, Number.isFinite(stock) && stock >= 0 ? Math.floor(stock) : 0];
        }))
        : null;

    // NEW: Size × Brand matrix (per-variant price + stock)
    let variants = null;
    if (product.variants && typeof product.variants === 'object' && !Array.isArray(product.variants)) {
        variants = {};
        for (const [key, val] of Object.entries(product.variants)) {
            if (!val || typeof val !== 'object') continue;
            const stock = Number(val.stock);
            if (!Number.isFinite(stock) || stock < 0) continue;
            const rawPrice = val.price;
            const price = rawPrice == null || rawPrice === ''
                ? null                                // null = fall back to base price
                : Number(rawPrice);
            variants[key] = {
                price: Number.isFinite(price) ? price : null,
                stock: Math.floor(stock)
            };
        }
        if (Object.keys(variants).length === 0) variants = null;
    }

    // Total quantity: variants > sizeStocks > brandStocks > shared quantity
    let quantity;
    if (variants) {
        quantity = Object.values(variants).reduce((t, v) => t + v.stock, 0);
    } else if (sizeStocks) {
        quantity = Object.values(sizeStocks).reduce((t, s) => t + s, 0);
    } else if (brandStocks) {
        quantity = Object.values(brandStocks).reduce((t, s) => t + s, 0);
    } else {
        quantity = Number(product.quantity) || 0;
    }

    return {
        ...product,
        size: rawSize,
        sizeMode: inferredMode,
        sizeStocks,
        brand: rawBrand,
        brandMode,
        brandStocks,
        variants,
        quantity,
        minStock: product.minStock ?? product.min_stock ?? 0,
        lastUpdated: product.lastUpdated || product.updated_at || product.created_at || ''
    };
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

    function getStockStatus(quantity, minStock) {
        if (quantity === 0) return 'out_of_stock';
        if (quantity <= minStock) return 'low_stock';
        if (quantity > minStock * 2) return 'over_stock';
        return 'in_stock';
    }

    function getProductStockStatus(product) {
        // Matrix wins if present
        if (product.variants) {
            const stocks = Object.values(product.variants).map(v => v.stock);
            if (!stocks.length || stocks.every(s => s === 0)) return 'out_of_stock';
            if (stocks.some(s => s <= product.minStock)) return 'low_stock';
            if (product.quantity > product.minStock * 2) return 'over_stock';
            return 'in_stock';
        }
        if (product.sizeStocks) {
            const stocks = Object.values(product.sizeStocks).map(q => Number(q) || 0);
            if (!stocks.length || stocks.every(q => q === 0)) return 'out_of_stock';
            if (stocks.some(q => q <= product.minStock)) return 'low_stock';
            if (product.quantity > product.minStock * 2) return 'over_stock';
            return 'in_stock';
        }
        if (product.brandStocks) {
            const stocks = Object.values(product.brandStocks).map(q => Number(q) || 0);
            if (!stocks.length || stocks.every(q => q === 0)) return 'out_of_stock';
            if (stocks.some(q => q <= product.minStock)) return 'low_stock';
            if (product.quantity > product.minStock * 2) return 'over_stock';
            return 'in_stock';
        }
        return getStockStatus(product.quantity, product.minStock);
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
        else console.warn(`[INV] updateInventoryStats: missing #${id}`);
    };
    setText('totalProducts', inventoryState.products.length);
    setText('overStockProducts', inventoryState.products.filter(p => getProductStockStatus(p) === 'over_stock').length);
    setText('lowStockProducts', inventoryState.products.filter(p => getProductStockStatus(p) === 'low_stock').length);
    setText('outOfStockProducts', inventoryState.products.filter(p => getProductStockStatus(p) === 'out_of_stock').length);
}

    function filterProducts() {
        const { searchTerm, categoryFilter, stockFilter } = inventoryState;
        const search = searchTerm.toLowerCase();
        inventoryState.filteredProducts = inventoryState.products.filter(product => {
            const matchesSearch = !search || product.name.toLowerCase().includes(search) || product.sku.toLowerCase().includes(search) || (product.supplier || '').toLowerCase().includes(search);
            const matchesCategory = !categoryFilter || product.category === categoryFilter;
            const matchesStock = !stockFilter || getProductStockStatus(product) === stockFilter;
            return matchesSearch && matchesCategory && matchesStock;
        });
        inventoryState.currentPage = 1;
        renderInventoryTable();
        renderPagination();
    }

    function renderInventoryTable() {
    const tbody = document.getElementById('inventoryTableBody');
    const table = document.getElementById('inventoryTable');
    const emptyState = document.getElementById('inventoryEmpty');
    const loading = document.getElementById('inventoryLoading');
    if (!tbody) return;
    if (loading) loading.style.display = 'none';
    if (table) table.style.display = 'table';

    {
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
            const sizeLabel = product.size ? `<span class="product-sku"><i class="${specIconClass(product.size)}"></i> ${escapeHtml(product.size)}</span>` : '';
            const brandLabel = product.brand ? `<span class="product-sku"><i class="fas fa-tag"></i> ${escapeHtml(product.brand)}</span>` : '';
            const quantityCell = product.variants
                ? `<div class="size-stock-summary"><div><span>${Object.keys(product.variants).length} variants</span><strong class="size-stock-total" style="border:none;padding:0;">Total: ${product.quantity}</strong></div></div>`
                : product.sizeStocks
                    ? `<div class="size-stock-summary">${Object.entries(product.sizeStocks).map(([size, quantity]) => `<div><span>${escapeHtml(size)}</span><strong class="size-stock-count ${quantity === 0 ? 'out-of-stock' : quantity <= product.minStock ? 'low-stock' : ''}">${quantity}</strong></div>`).join('')}<strong class="size-stock-total">Total: ${product.quantity}</strong></div>`
                    : product.brandStocks
                        ? `<div class="size-stock-summary">${Object.entries(product.brandStocks).map(([brand, quantity]) => `<div><span>${escapeHtml(brand)}</span><strong class="size-stock-count ${quantity === 0 ? 'out-of-stock' : quantity <= product.minStock ? 'low-stock' : ''}">${quantity}</strong></div>`).join('')}<strong class="size-stock-total">Total: ${product.quantity}</strong></div>`
                        : `<input type="number" class="quantity-input" value="${product.quantity}" min="0" data-product-id="${product.id}" onchange="updateQuantity('${product.id}', this.value)">`;
            return `<tr>
                <td>
                    <div class="product-info">
                        <div class="product-details">
                            <p class="product-name">${product.name}</p>
                            ${sizeLabel}
                            ${brandLabel}
                            <span class="product-sku">Product Code: ${product.sku}</span>
                        </div>
                    </div>
                </td>
                <td>${product.category}</td>
                <td>${product.variants ? (() => {
                    const prices = Object.values(product.variants).map(v => v.price).filter(p => p != null);
                    if (prices.length === 0) return formatCurrency(product.price);
                    const min = Math.min(...prices);
                    const max = Math.max(...prices);
                    return min === max ? formatCurrency(min) : `${formatCurrency(min)} – ${formatCurrency(max)}`;
                })() : formatCurrency(product.price)}</td>
                <td>${quantityCell}</td>
                <td>${getStockBadge(status)}</td>
                <td>${product.lastUpdated}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon edit" type="button" onclick="editProduct('${product.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon delete" type="button" onclick="showDeleteModal('${product.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }
}

    function renderPagination() {
        const pagination = document.getElementById('inventoryPagination');
        if (!pagination) return;
        const totalPages = Math.ceil(inventoryState.filteredProducts.length / inventoryState.itemsPerPage);
        if (totalPages <= 1) { pagination.innerHTML = ''; return; }
        let html = `<button class="page-btn" type="button" onclick="changePage(${inventoryState.currentPage - 1})" ${inventoryState.currentPage === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;
        for (let page = 1; page <= totalPages; page++) html += `<button class="page-btn ${inventoryState.currentPage === page ? 'active' : ''}" type="button" onclick="changePage(${page})">${page}</button>`;
        html += `<button class="page-btn" type="button" onclick="changePage(${inventoryState.currentPage + 1})" ${inventoryState.currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
        pagination.innerHTML = html;
    }

    function openProductModal(productId = null) {
        inventoryState.editingProductId = productId;
        const modal = document.getElementById('productModal');
        const title = document.getElementById('productModalTitle');
        const form = document.getElementById('productForm');
        if (!modal || !title || !form) return;
        form.reset();
        variantStockDraft = {};
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
                const trackSizeStock = document.getElementById('trackSizeStock');
                if (trackSizeStock) trackSizeStock.checked = Boolean(product.sizeStocks);
                variantStockDraft = product.sizeStocks ? { ...product.sizeStocks } : {};
                document.getElementById('productSize').value = product.size || '';
const mode = product.sizeMode || 'spec';
const modeRadio = document.querySelector(`input[name="sizeMode"][value="${mode}"]`);
if (modeRadio) modeRadio.checked = true;
updateSizePreview();

                // Brand fields
                document.getElementById('productBrand').value = product.brand || '';
                const brandMode = product.brandMode || 'single';
                const brandRadio = document.querySelector(`input[name="brandMode"][value="${brandMode}"]`);
                if (brandRadio) brandRadio.checked = true;
                const trackBrandStock = document.getElementById('trackBrandStock');
                if (trackBrandStock) trackBrandStock.checked = Boolean(product.brandStocks);
                brandStockDraft = product.brandStocks ? { ...product.brandStocks } : {};

                // Seed the matrix draft from any existing variants
                matrixDraft = product.variants ? { ...product.variants } : {};

                updateBrandPreview();
                renderVariantMatrix();
                document.getElementById('productDescription').value = product.description || '';
            }
        } else {
    title.textContent = 'Add Product';
    const trackSizeStock = document.getElementById('trackSizeStock');
    if (trackSizeStock) trackSizeStock.checked = true;
    const specRadio = document.querySelector('input[name="sizeMode"][value="spec"]');
    if (specRadio) specRadio.checked = true;
    updateSizePreview();

    const trackBrandStock = document.getElementById('trackBrandStock');
    if (trackBrandStock) trackBrandStock.checked = true;
    const brandSingleRadio = document.querySelector('input[name="brandMode"][value="single"]');
    if (brandSingleRadio) brandSingleRadio.checked = true;
    brandStockDraft = {};
    matrixDraft = {};
    updateBrandPreview();
    renderVariantMatrix();
}
modal.classList.add('active');
    }

    function closeProductModal() {
        document.getElementById('productModal')?.classList.remove('active');
        inventoryState.editingProductId = null;
    }

    async function saveProduct(event) {
        event.preventDefault();

        // ---------- Size ----------
        const sizeMode = document.querySelector('input[name="sizeMode"]:checked')?.value || 'spec';
        const rawSize = document.getElementById('productSize').value.trim();
        const normalizedSize = sizeMode === 'spec'
            ? rawSize
            : [...new Set(rawSize.split(',').map(v => v.trim()).filter(Boolean))].join(',');
        const tracksSizeStock = sizeMode === 'variants' && document.getElementById('trackSizeStock').checked;

        // ---------- Brand ----------
        const brandMode = document.querySelector('input[name="brandMode"]:checked')?.value || 'single';
        const rawBrand = document.getElementById('productBrand').value.trim();
        const normalizedBrand = brandMode === 'single'
            ? rawBrand
            : [...new Set(rawBrand.split(',').map(v => v.trim()).filter(Boolean))].join(',');
        const tracksBrandStock = brandMode === 'variants' && document.getElementById('trackBrandStock').checked;

        // ---------- Matrix mode ----------
        const useMatrix = sizeMode === 'variants' && brandMode === 'variants';
        let variants = null;

        if (useMatrix) {
            const readResult = readVariantMatrix();
            if (readResult.error) {
                showToast(readResult.error, 'error');
                return;
            }
            variants = readResult.variants;
        } else {
            // Old guard — only one dimension can track stock
            if (tracksSizeStock && tracksBrandStock) {
                showToast('Only one dimension (size or brand) can track stock per product', 'error');
                return;
            }
        }

        // ---------- Size stocks (only when not using matrix) ----------
        const sizes = normalizedSize.split(',').map(s => s.trim()).filter(Boolean);
        let sizeStocks = null;
        if (!useMatrix && tracksSizeStock) {
            if (!sizes.length) {
                showToast('Add at least one size before setting stock', 'error');
                return;
            }
            const existingProduct = inventoryState.products.find(p => p.id === inventoryState.editingProductId);
            const removedStockedSize = Object.entries(existingProduct?.sizeStocks || {})
                .some(([size, stock]) => !sizes.includes(size) && stock > 0);
            if (removedStockedSize) {
                showToast('Set removed size stock to zero before removing that size', 'error');
                return;
            }
            sizeStocks = {};
            for (const size of sizes) {
                const input = [...document.querySelectorAll('[data-size-stock]')].find(f => f.dataset.sizeStock === size);
                const value = input?.value.trim() || '';
                const stock = Number(value);
                if (value === '' || !Number.isInteger(stock) || stock < 0) {
                    showToast(`Enter a whole stock quantity for size ${size}`, 'error');
                    input?.focus();
                    return;
                }
                sizeStocks[size] = stock;
            }
        }

        // ---------- Brand stocks (only when not using matrix) ----------
        const brands = normalizedBrand.split(',').map(b => b.trim()).filter(Boolean);
        let brandStocks = null;
        if (!useMatrix && tracksBrandStock) {
            if (!brands.length) {
                showToast('Add at least one brand before setting stock', 'error');
                return;
            }
            const existingProduct = inventoryState.products.find(p => p.id === inventoryState.editingProductId);
            const removedStockedBrand = Object.entries(existingProduct?.brandStocks || {})
                .some(([brand, stock]) => !brands.includes(brand) && stock > 0);
            if (removedStockedBrand) {
                showToast('Set removed brand stock to zero before removing that brand', 'error');
                return;
            }
            brandStocks = {};
            for (const brand of brands) {
                const input = [...document.querySelectorAll('[data-brand-stock]')].find(f => f.dataset.brandStock === brand);
                const value = input?.value.trim() || '';
                const stock = Number(value);
                if (value === '' || !Number.isInteger(stock) || stock < 0) {
                    showToast(`Enter a whole stock quantity for brand ${brand}`, 'error');
                    input?.focus();
                    return;
                }
                brandStocks[brand] = stock;
            }
        }

        // ---------- Total quantity ----------
        let quantity;
        if (variants) quantity = Object.values(variants).reduce((t, v) => t + v.stock, 0);
        else if (sizeStocks) quantity = Object.values(sizeStocks).reduce((t, s) => t + s, 0);
        else if (brandStocks) quantity = Object.values(brandStocks).reduce((t, s) => t + s, 0);
        else quantity = parseInt(document.getElementById('productQuantity').value, 10);

        const productData = {
            name: document.getElementById('productName').value.trim(),
            sku: document.getElementById('productSKU').value.trim(),
            category: document.getElementById('productCategory').value,
            price: parseFloat(document.getElementById('productPrice').value),
            quantity,
            minStock: parseInt(document.getElementById('productMinStock').value),
            supplier: document.getElementById('productSupplier').value.trim(),
            size: normalizedSize,
            sizeMode: sizeMode,
            brand: normalizedBrand,
            brandMode: brandMode,
            description: document.getElementById('productDescription').value.trim()
        };

        const existingProduct = inventoryState.products.find(p => p.id === inventoryState.editingProductId);

        // Matrix replaces both stocks — write variants and clear the old shapes
        if (variants) {
            productData.variants = variants;
            productData.sizeStocks = null;
            productData.brandStocks = null;
        } else {
            if (sizeStocks) productData.sizeStocks = sizeStocks;
            else if (existingProduct?.sizeStocks) productData.sizeStocks = null;

            if (brandStocks) productData.brandStocks = brandStocks;
            else if (existingProduct?.brandStocks) productData.brandStocks = null;

            // Clear any leftover variants from a previous edit
            if (existingProduct?.variants) productData.variants = null;
        }

        const skuExists = inventoryState.products.some(p => p.sku === productData.sku && p.id !== inventoryState.editingProductId);
        if (skuExists) { showToast('Product code already exists', 'error'); return; }

        const payload = { ...productData, min_stock: productData.minStock };
        delete payload.minStock;

        let result;
        if (inventoryState.editingProductId) {
            result = await supabaseApi.updateInventoryProduct(inventoryState.editingProductId, payload);
            const index = inventoryState.products.findIndex(p => p.id === inventoryState.editingProductId);
            if (!result.error && index !== -1) inventoryState.products[index] = mapProduct(result.data?.[0] || { ...inventoryState.products[index], ...productData });
            window.POS_APP_LOG?.('update', 'inventory', `Product ${productData.name} updated`, 'info');
            showToast(result.error ? result.error.message : 'Product updated successfully', result.error ? 'error' : 'success');
        } else {
            result = await supabaseApi.addInventoryProduct(payload);
            if (!result.error && result.data?.[0]) inventoryState.products.unshift(mapProduct(result.data[0]));
            window.POS_APP_LOG?.('create', 'inventory', `Product ${productData.name} added`, 'info');
            showToast(result.error ? result.error.message : 'Product added successfully', result.error ? 'error' : 'success');
        }
        if (result.error) return;
        matrixDraft = {};
        updateInventoryStats(); filterProducts(); closeProductModal();
        window.dispatchEvent(new CustomEvent('inventory-products-loaded', { detail: inventoryState.products }));
    }

    function closeDeleteModal() {
        document.getElementById('deleteModal')?.classList.remove('active');
        inventoryState.deletingProductId = null;
    }

    async function confirmDelete() {
        if (inventoryState.deletingProductId) {
            const result = await supabaseApi.deleteInventoryProduct(inventoryState.deletingProductId);
            if (result.error) {
                showToast(result.error.message, 'error');
                return;
            }
            inventoryState.products = inventoryState.products.filter(p => p.id !== inventoryState.deletingProductId);
            updateInventoryStats(); filterProducts();
            window.dispatchEvent(new CustomEvent('inventory-products-loaded', { detail: inventoryState.products }));
            window.POS_APP_LOG?.('delete', 'inventory', `Product ${inventoryState.deletingProductId} deleted`, 'warning');
            showToast('Product deleted successfully', 'success');
        }
        closeDeleteModal();
    }

    function exportInventory() {
        if (!inventoryState.products.length) { showToast('No products to export', 'error'); return; }
        const headers = ['ID', 'Name', 'Product Code', 'Category', 'Price', 'Quantity', 'Min Stock', 'Supplier', 'Size', 'Stock by Size', 'Description', 'Last Updated'];
        const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = inventoryState.products.map(product => [product.id, product.name, product.sku, product.category, product.price, product.quantity, product.minStock, product.supplier, product.size || '', product.sizeStocks ? JSON.stringify(product.sizeStocks) : '', product.description, product.lastUpdated]);
        const blob = new Blob([[headers, ...rows].map(row => row.map(escapeCsv).join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url; link.download = `inventory_${new Date().toISOString().split('T')[0]}.csv`; link.click(); URL.revokeObjectURL(url);
        window.POS_APP_LOG?.('export', 'inventory', 'Inventory CSV exported', 'info');
        showToast('Inventory exported successfully', 'success');
    }

function updateSizePreview() {
    const previewEl = document.getElementById('sizePreview');
    const inputEl = document.getElementById('productSize');
    const labelEl = document.getElementById('productSizeLabel');
    const mode = document.querySelector('input[name="sizeMode"]:checked')?.value || 'spec';

    if (!previewEl || !inputEl || !labelEl) return;

    if (mode === 'spec') {
        labelEl.textContent = 'Specification (optional)';
        inputEl.placeholder = 'e.g., 2 in, 40 kg, 20 A, or leave blank';
        previewEl.style.display = 'none';
        previewEl.innerHTML = '';
        renderVariantStockControls();
        return;
    }

    labelEl.textContent = 'Variants (separated by comma)';
    inputEl.placeholder = 'e.g., S, M, L, XL';

    const raw = inputEl.value.trim();
    const parts = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];

    if (parts.length === 0) {
        previewEl.style.display = 'none';
        previewEl.innerHTML = '';
        renderVariantStockControls();
        return;
    }

    previewEl.style.display = 'flex';
    previewEl.innerHTML =
        '<span class="size-preview-label">Preview:</span> ' +
        parts.map(p => `<span class="size-chip">${escapeHtml(p)}</span>`).join('');
    renderVariantStockControls();
}
function updateBrandPreview() {
    const previewEl = document.getElementById('brandPreview');
    const inputEl = document.getElementById('productBrand');
    const labelEl = document.getElementById('productBrandLabel');
    const mode = document.querySelector('input[name="brandMode"]:checked')?.value || 'single';

    if (!previewEl || !inputEl || !labelEl) return;

    if (mode === 'single') {
        labelEl.textContent = 'Brand (optional)';
        inputEl.placeholder = 'e.g., Bosny, Stanley, Boysen';
        previewEl.style.display = 'none';
        previewEl.innerHTML = '';
        renderBrandStockControls();
        return;
    }

    labelEl.textContent = 'Brands (separated by comma)';
    inputEl.placeholder = 'e.g., Bosny, Boysen, Davies';

    const raw = inputEl.value.trim();
    const parts = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];

    if (parts.length === 0) {
        previewEl.style.display = 'none';
        previewEl.innerHTML = '';
        renderBrandStockControls();
        return;
    }

    previewEl.style.display = 'flex';
    previewEl.innerHTML =
        '<span class="size-preview-label">Preview:</span> ' +
        parts.map(p => `<span class="size-chip">${escapeHtml(p)}</span>`).join('');
    renderBrandStockControls();
}

function renderBrandStockControls() {
    const mode = document.querySelector('input[name="brandMode"]:checked')?.value || 'single';
    const group = document.getElementById('brandStockGroup');
    const inputContainer = document.getElementById('brandStockInputs');
    const trackBrandStock = document.getElementById('trackBrandStock');
    if (!group || !inputContainer || !trackBrandStock) return;

    const enabled = mode === 'variants' && trackBrandStock.checked;
    group.style.display = mode === 'variants' ? '' : 'none';

    const currentValues = {};
    inputContainer.querySelectorAll('[data-brand-stock]').forEach(input => {
        currentValues[input.dataset.brandStock] = input.value;
    });
    brandStockDraft = { ...brandStockDraft, ...currentValues };

    if (!enabled) {
        inputContainer.innerHTML = '';
        // Re-show the shared quantity field if neither dimension tracks stock
        const sharedQty = document.getElementById('sharedQuantityGroup');
        const sizeTracks = document.querySelector('input[name="sizeMode"]:checked')?.value === 'variants'
            && document.getElementById('trackSizeStock')?.checked;
        if (sharedQty) sharedQty.style.display = sizeTracks ? 'none' : '';
        return;
    }

    const brands = [...new Set(document.getElementById('productBrand').value.split(',').map(b => b.trim()).filter(Boolean))];
    inputContainer.innerHTML = brands.map(brand => {
        const value = Object.hasOwn(brandStockDraft, brand) ? brandStockDraft[brand] : '';
        return `<label class="size-stock-row"><span>${escapeHtml(brand)}</span><input class="quantity-input" type="number" min="0" step="1" required data-brand-stock="${escapeHtml(brand)}" value="${escapeHtml(value)}" aria-label="Stock for ${escapeHtml(brand)}"></label>`;
    }).join('');

    // Hide the shared quantity field while brand stock tracking is active
    const sharedQty = document.getElementById('sharedQuantityGroup');
    if (sharedQty) sharedQty.style.display = 'none';
}

/* ============================================================
   SIZE × BRAND MATRIX
   ============================================================ */

function shouldShowMatrix() {
    const sizeMode = document.querySelector('input[name="sizeMode"]:checked')?.value;
    const brandMode = document.querySelector('input[name="brandMode"]:checked')?.value;
    return sizeMode === 'variants' && brandMode === 'variants';
}

// In-memory draft so values survive re-renders when the user edits
// sizes or brands while the modal is open.
let matrixDraft = {};

function renderVariantMatrix() {
    const group = document.getElementById('variantMatrixGroup');
    const head = document.getElementById('variantMatrixHead');
    const body = document.getElementById('variantMatrixBody');
    if (!group || !head || !body) return;

    if (!shouldShowMatrix()) {
        group.style.display = 'none';
        // Hide the two alternate stock panels while the matrix is visible
        document.getElementById('variantStockGroup')?.style.setProperty('display', 'none');
        document.getElementById('brandStockGroup')?.style.setProperty('display', 'none');
        return;
    }

    // Hide the two alternative stock panels — the matrix replaces them
    document.getElementById('variantStockGroup')?.style.setProperty('display', 'none');
    document.getElementById('brandStockGroup')?.style.setProperty('display', 'none');
    const sharedQty = document.getElementById('sharedQuantityGroup');
    if (sharedQty) sharedQty.style.display = 'none';

    group.style.display = '';

    const sizes = [...new Set(
        document.getElementById('productSize').value
            .split(',').map(s => s.trim()).filter(Boolean)
    )];
    const brands = [...new Set(
        document.getElementById('productBrand').value
            .split(',').map(b => b.trim()).filter(Boolean)
    )];

    if (sizes.length === 0 || brands.length === 0) {
        head.innerHTML = '';
        body.innerHTML = '<tr><td style="text-align:center;padding:14px;color:var(--text-muted);">Add sizes and brands above to see the matrix</td></tr>';
        updateMatrixSummary();
        return;
    }

    // Preserve any values already typed in the current DOM
    body.querySelectorAll('[data-variant-key]').forEach(input => {
        const key = input.dataset.variantKey;
        const field = input.dataset.variantField;
        if (!matrixDraft[key]) matrixDraft[key] = {};
        matrixDraft[key][field] = input.value;
    });

    head.innerHTML = '<tr><th class="matrix-row-label">Size</th>'
        + brands.map(b => `<th>${escapeHtml(b)}</th>`).join('')
        + '</tr>';

    body.innerHTML = sizes.map(size => {
        const cells = brands.map(brand => {
            const key = `${size}::${brand}`;
            const draft = matrixDraft[key] || {};
            const price = draft.price ?? '';
            const stock = draft.stock ?? '';
            return `<td>
                <div class="variant-cell-input">
                    <input class="matrix-price" type="number" min="0" step="0.01" placeholder="₱"
                        data-variant-key="${escapeHtml(key)}" data-variant-field="price"
                        value="${escapeHtml(price)}"
                        aria-label="Price for ${escapeHtml(size)} ${escapeHtml(brand)}">
                    <input class="matrix-stock" type="number" min="0" step="1" placeholder="stock"
                        data-variant-key="${escapeHtml(key)}" data-variant-field="stock"
                        value="${escapeHtml(stock)}"
                        aria-label="Stock for ${escapeHtml(size)} ${escapeHtml(brand)}">
                </div>
            </td>`;
        }).join('');
        return `<tr><th class="matrix-row-label">${escapeHtml(size)}</th>${cells}</tr>`;
    }).join('');

    updateMatrixSummary();
}

function updateMatrixSummary() {
    const body = document.getElementById('variantMatrixBody');
    if (!body) return;

    let count = 0, totalStock = 0;
    let minPrice = Infinity, maxPrice = -Infinity;

    body.querySelectorAll('[data-variant-field="stock"]').forEach(stockInput => {
        const key = stockInput.dataset.variantKey;
        const priceInput = body.querySelector(`[data-variant-field="price"][data-variant-key="${CSS.escape(key)}"]`);
        const stock = parseInt(stockInput.value, 10);
        const priceRaw = priceInput?.value?.trim() || '';
        const price = priceRaw === '' ? null : parseFloat(priceRaw);

        if (Number.isInteger(stock) && stock >= 0) {
            count++;
            totalStock += stock;
            if (price !== null && Number.isFinite(price)) {
                if (price < minPrice) minPrice = price;
                if (price > maxPrice) maxPrice = price;
            }
        }
    });

    const countEl = document.getElementById('matrixVariantCount');
    const stockEl = document.getElementById('matrixTotalStock');
    const rangeEl = document.getElementById('matrixPriceRange');

    if (countEl) countEl.textContent = count;
    if (stockEl) stockEl.textContent = totalStock;
    if (rangeEl) {
        if (count === 0 || !Number.isFinite(minPrice)) {
            rangeEl.textContent = '—';
        } else if (minPrice === maxPrice) {
            rangeEl.textContent = formatCurrency(minPrice);
        } else {
            rangeEl.textContent = `${formatCurrency(minPrice)} – ${formatCurrency(maxPrice)}`;
        }
    }
}

function readVariantMatrix() {
    const body = document.getElementById('variantMatrixBody');
    if (!body) return { error: 'Matrix not found' };

    const pairs = {};
    body.querySelectorAll('[data-variant-key]').forEach(input => {
        const key = input.dataset.variantKey;
        const field = input.dataset.variantField;
        if (!pairs[key]) pairs[key] = {};
        pairs[key][field] = input.value.trim();
    });

    const out = {};
    for (const [key, val] of Object.entries(pairs)) {
        const stockRaw = val.stock ?? '';
        const priceRaw = val.price ?? '';

        // Fully empty cell → combination doesn't exist, skip
        if (stockRaw === '' && priceRaw === '') continue;

        if (stockRaw === '') {
            return { error: `Enter stock for ${key} (or leave price blank to skip this combination)` };
        }

        const stock = Number(stockRaw);
        if (!Number.isInteger(stock) || stock < 0) {
            return { error: `Enter a whole-number stock for ${key}` };
        }

        let price = null;
        if (priceRaw !== '') {
            const p = Number(priceRaw);
            if (!Number.isFinite(p) || p < 0) {
                return { error: `Enter a valid price for ${key}, or leave blank to use base price` };
            }
            price = p;
        }

        out[key] = { price, stock };
    }

    if (Object.keys(out).length === 0) {
        return { error: 'Add at least one variant with stock' };
    }

    return { variants: out };
}


function renderVariantStockControls() {
    const mode = document.querySelector('input[name="sizeMode"]:checked')?.value || 'spec';
    const group = document.getElementById('variantStockGroup');
    const inputContainer = document.getElementById('variantStockInputs');
    const sharedQuantityGroup = document.getElementById('sharedQuantityGroup');
    const trackSizeStock = document.getElementById('trackSizeStock');
    const sharedQuantityInput = document.getElementById('productQuantity');
    if (!group || !inputContainer || !sharedQuantityGroup || !trackSizeStock || !sharedQuantityInput) return;

    const enabled = mode === 'variants' && trackSizeStock.checked;
    group.style.display = mode === 'variants' ? '' : 'none';
    sharedQuantityGroup.style.display = enabled ? 'none' : '';
    sharedQuantityInput.required = !enabled;

    const currentValues = {};
    inputContainer.querySelectorAll('[data-size-stock]').forEach(input => {
        currentValues[input.dataset.sizeStock] = input.value;
    });
    variantStockDraft = { ...variantStockDraft, ...currentValues };

    if (!enabled) {
        inputContainer.innerHTML = '';
        return;
    }

    const sizes = [...new Set(document.getElementById('productSize').value.split(',').map(size => size.trim()).filter(Boolean))];
    inputContainer.innerHTML = sizes.map(size => {
        const value = Object.hasOwn(variantStockDraft, size) ? variantStockDraft[size] : '';
        return `<label class="size-stock-row"><span>${escapeHtml(size)}</span><input class="quantity-input" type="number" min="0" step="1" required data-size-stock="${escapeHtml(size)}" value="${escapeHtml(value)}" aria-label="Stock for ${escapeHtml(size)}"></label>`;
    }).join('');
}

function setupInventoryEventListeners() {
    if (inventoryState.initialized) return;
    inventoryState.initialized = true;

    document.getElementById('addProductBtn')?.addEventListener('click', () => openProductModal());

    // Size mode radios + live preview
    document.querySelectorAll('input[name="sizeMode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateSizePreview();
            renderVariantMatrix();
        });
    });
    document.getElementById('productSize')?.addEventListener('input', () => {
        updateSizePreview();
        renderVariantMatrix();
    });
    document.getElementById('trackSizeStock')?.addEventListener('change', renderVariantStockControls);
    document.getElementById('variantStockInputs')?.addEventListener('input', () => {
        const inputs = [...document.querySelectorAll('[data-size-stock]')];
        const values = inputs.map(input => input.value.trim());
        if (!inputs.length || values.some(value => value === '' || !Number.isInteger(Number(value)) || Number(value) < 0)) return;
        document.getElementById('productQuantity').value = values.reduce((total, value) => total + Number(value), 0);
    });

    // Brand mode radios + live preview
    document.querySelectorAll('input[name="brandMode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateBrandPreview();
            renderVariantMatrix();
        });
    });
    document.getElementById('productBrand')?.addEventListener('input', () => {
        updateBrandPreview();
        renderVariantMatrix();
    });
    document.getElementById('trackBrandStock')?.addEventListener('change', renderBrandStockControls);
    document.getElementById('brandStockInputs')?.addEventListener('input', () => {
        const inputs = [...document.querySelectorAll('[data-brand-stock]')];
        const values = inputs.map(input => input.value.trim());
        if (!inputs.length || values.some(value => value === '' || !Number.isInteger(Number(value)) || Number(value) < 0)) return;
        document.getElementById('productQuantity').value = values.reduce((total, value) => total + Number(value), 0);
    });

    // Matrix live updates — recalc footer summary on cell edit
    document.getElementById('variantMatrixBody')?.addEventListener('input', (e) => {
        if (e.target.matches('[data-variant-key]')) {
            updateMatrixSummary();
        }
    });

    document.getElementById('addCategoryBtn')?.addEventListener('click', addCategoryPrompt);

    document.getElementById('exportInventoryBtn')?.addEventListener('click', exportInventory);
    (() => {
        const searchEl = document.getElementById('inventorySearch');
        if (!searchEl) return;
        let __invSearchTimer = null;
        searchEl.addEventListener('input', (event) => {
            inventoryState.searchTerm = event.target.value;
            clearTimeout(__invSearchTimer);
            __invSearchTimer = setTimeout(() => filterProducts(), 150);
        });
    })();
    document.getElementById('categoryFilter')?.addEventListener('change', event => { inventoryState.categoryFilter = event.target.value; filterProducts(); });
    document.getElementById('stockFilter')?.addEventListener('change', event => {
    inventoryState.stockFilter = event.target.value;
    syncFilterCards();
    filterProducts();
});

// Filter cards — click / keyboard to filter inventory
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
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            apply();
        }
    });
});
    document.getElementById('closeProductModal')?.addEventListener('click', closeProductModal);
    document.getElementById('cancelProductBtn')?.addEventListener('click', closeProductModal);
    document.getElementById('productForm')?.addEventListener('submit', saveProduct);
    document.getElementById('closeDeleteModal')?.addEventListener('click', closeDeleteModal);
    document.getElementById('cancelDeleteBtn')?.addEventListener('click', closeDeleteModal);
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', confirmDelete);
    window.addEventListener('click', event => {
        if (event.target === document.getElementById('productModal')) closeProductModal();
        if (event.target === document.getElementById('deleteModal')) closeDeleteModal();
    });
}


    window.initInventory = function() {
    // Always load categories from cloud (realtime-safe)
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
        }).finally(() => {
            inventoryProductsLoadPromise = null;
        });
    }
    updateInventoryStats();
    filterProducts();
    setupInventoryEventListeners();
};

    window.setInventoryProducts = function(products) {
        inventoryState.products = (products || []).map(mapProduct);
        inventoryState.productsLoaded = true;
        renderCategoryOptions();
        updateInventoryStats();
        filterProducts();
        window.dispatchEvent(new CustomEvent('inventory-products-loaded', { detail: inventoryState.products }));
    };

    window.filterInventoryByStock = function(stockFilter) {
        inventoryState.stockFilter = stockFilter || '';
        const stockFilterSelect = document.getElementById('stockFilter');
        if (stockFilterSelect) stockFilterSelect.value = inventoryState.stockFilter;
        filterProducts();
    };
    window.getInventorySnapshot = function() {
        return inventoryState.products.map(product => ({ ...product }));
    };
    window.changePage = function(page) {
        const totalPages = Math.ceil(inventoryState.filteredProducts.length / inventoryState.itemsPerPage);
        if (page < 1 || page > totalPages) return;
        inventoryState.currentPage = page; renderInventoryTable(); renderPagination();
    };
    window.updateQuantity = function(productId, newQuantity) {
        const quantity = parseInt(newQuantity);
        if (Number.isNaN(quantity) || quantity < 0) return;
        const product = inventoryState.products.find(p => p.id === productId);
        if (!product) return;
        product.quantity = quantity; product.lastUpdated = new Date().toISOString().split('T')[0];
        supabaseApi.updateInventoryProduct(productId, { quantity }).then(result => {
            if (result.error) { showToast(result.error.message, 'error'); return; }
            product.lastUpdated = new Date().toISOString();
            updateInventoryStats(); filterProducts();
            window.dispatchEvent(new CustomEvent('inventory-products-loaded', { detail: inventoryState.products }));
            window.POS_APP_LOG?.('update', 'inventory', `Quantity updated for product ${productId}`, 'info');
            showToast('Quantity updated successfully', 'success');
        });
    };
    window.editProduct = openProductModal;
    window.showDeleteModal = function(productId) {
        inventoryState.deletingProductId = productId;
        const product = inventoryState.products.find(p => p.id === productId);
        const name = document.getElementById('deleteProductName');
        if (product && name) name.textContent = `${product.name} (${product.sku})`;
        document.getElementById('deleteModal')?.classList.add('active');
    };
})();