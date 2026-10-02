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
        // Legacy: comma present -> treat as variants
        inferredMode = rawSize.includes(',') ? 'variants' : 'spec';
    }
    const sizeStocks = product.sizeStocks && typeof product.sizeStocks === 'object' && !Array.isArray(product.sizeStocks)
        ? Object.fromEntries(Object.entries(product.sizeStocks).map(([size, value]) => {
            const stock = Number(value);
            return [size, Number.isFinite(stock) && stock >= 0 ? Math.floor(stock) : 0];
        }))
        : null;
    const quantity = sizeStocks
        ? Object.values(sizeStocks).reduce((total, stock) => total + stock, 0)
        : Number(product.quantity) || 0;

    return {
        ...product,
        size: rawSize,
        sizeMode: inferredMode,
        sizeStocks,
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
        if (!product.sizeStocks) return getStockStatus(product.quantity, product.minStock);
        const stocks = Object.values(product.sizeStocks).map(quantity => Number(quantity) || 0);
        if (!stocks.length || stocks.every(quantity => quantity === 0)) return 'out_of_stock';
        if (stocks.some(quantity => quantity <= product.minStock)) return 'low_stock';
        if (product.quantity > product.minStock * 2) return 'over_stock';
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
    if (loading) loading.style.display = 'block';
    if (table) table.style.display = 'none';
    setTimeout(() => {
        if (loading) loading.style.display = 'none';
        const products = inventoryState.filteredProducts;
        if (!products.length) {
            if (emptyState) emptyState.style.display = 'block';
            return;
        }
        if (emptyState) emptyState.style.display = 'none';
        if (table) table.style.display = 'table';
        const start = (inventoryState.currentPage - 1) * inventoryState.itemsPerPage;
        const pageProducts = products.slice(start, start + inventoryState.itemsPerPage);
        tbody.innerHTML = pageProducts.map(product => {
            const status = getProductStockStatus(product);
            const sizeLabel = product.size ? `<span class="product-sku"><i class="${specIconClass(product.size)}"></i> ${escapeHtml(product.size)}</span>` : '';
            const quantityCell = product.sizeStocks
                ? `<div class="size-stock-summary">${Object.entries(product.sizeStocks).map(([size, quantity]) => `<div><span>${escapeHtml(size)}</span><strong class="size-stock-count ${quantity === 0 ? 'out-of-stock' : quantity <= product.minStock ? 'low-stock' : ''}">${quantity}</strong></div>`).join('')}<strong class="size-stock-total">Total: ${product.quantity}</strong></div>`
                : `<input type="number" class="quantity-input" value="${product.quantity}" min="0" data-product-id="${product.id}" onchange="updateQuantity('${product.id}', this.value)">`;
            return `<tr>
                <td>
                    <div class="product-info">
                        <div class="product-details">
                            <p class="product-name">${product.name}</p>
                            ${sizeLabel}
                            <span class="product-sku">Product Code: ${product.sku}</span>
                        </div>
                    </div>
                </td>
                <td>${product.category}</td>
                <td>${formatCurrency(product.price)}</td>
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
    }, 300);
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
                document.getElementById('productDescription').value = product.description || '';
            }
        } else {
    title.textContent = 'Add Product';
    const trackSizeStock = document.getElementById('trackSizeStock');
    if (trackSizeStock) trackSizeStock.checked = true;
    const specRadio = document.querySelector('input[name="sizeMode"][value="spec"]');
    if (specRadio) specRadio.checked = true;
    updateSizePreview();
}
modal.classList.add('active');
    }

    function closeProductModal() {
        document.getElementById('productModal')?.classList.remove('active');
        inventoryState.editingProductId = null;
    }

    async function saveProduct(event) {
        event.preventDefault();
        const sizeMode = document.querySelector('input[name="sizeMode"]:checked')?.value || 'spec';
const rawSize = document.getElementById('productSize').value.trim();
const normalizedSize = sizeMode === 'spec' ?
    rawSize :
    [...new Set(rawSize.split(',').map(v => v.trim()).filter(Boolean))].join(',');
        const tracksSizeStock = sizeMode === 'variants' && document.getElementById('trackSizeStock').checked;
        const sizes = normalizedSize.split(',').map(size => size.trim()).filter(Boolean);
        let sizeStocks = null;
        let quantity;

        if (tracksSizeStock) {
            if (!sizes.length) {
                showToast('Add at least one size before setting stock', 'error');
                return;
            }

            const existingProduct = inventoryState.products.find(product => product.id === inventoryState.editingProductId);
            const removedStockedSize = Object.entries(existingProduct?.sizeStocks || {}).some(([size, stock]) => !sizes.includes(size) && stock > 0);
            if (removedStockedSize) {
                showToast('Set removed size stock to zero before removing that size', 'error');
                return;
            }

            sizeStocks = {};
            for (const size of sizes) {
                const input = [...document.querySelectorAll('[data-size-stock]')].find(field => field.dataset.sizeStock === size);
                const value = input?.value.trim() || '';
                const stock = Number(value);
                if (value === '' || !Number.isInteger(stock) || stock < 0) {
                    showToast(`Enter a whole stock quantity for ${size}`, 'error');
                    input?.focus();
                    return;
                }
                sizeStocks[size] = stock;
            }
            quantity = Object.values(sizeStocks).reduce((total, stock) => total + stock, 0);
        } else {
            quantity = parseInt(document.getElementById('productQuantity').value, 10);
        }

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
    description: document.getElementById('productDescription').value.trim()
        };
        const existingProduct = inventoryState.products.find(product => product.id === inventoryState.editingProductId);
        if (tracksSizeStock) productData.sizeStocks = sizeStocks;
        else if (existingProduct?.sizeStocks) productData.sizeStocks = null;
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
        radio.addEventListener('change', updateSizePreview);
    });
    document.getElementById('productSize')?.addEventListener('input', updateSizePreview);
    document.getElementById('trackSizeStock')?.addEventListener('change', renderVariantStockControls);
    document.getElementById('variantStockInputs')?.addEventListener('input', () => {
        const inputs = [...document.querySelectorAll('[data-size-stock]')];
        const values = inputs.map(input => input.value.trim());
        if (!inputs.length || values.some(value => value === '' || !Number.isInteger(Number(value)) || Number(value) < 0)) return;
        document.getElementById('productQuantity').value = values.reduce((total, value) => total + Number(value), 0);
    });

    document.getElementById('addCategoryBtn')?.addEventListener('click', addCategoryPrompt);

    document.getElementById('exportInventoryBtn')?.addEventListener('click', exportInventory);
    document.getElementById('inventorySearch')?.addEventListener('input', event => { inventoryState.searchTerm = event.target.value; filterProducts(); });
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