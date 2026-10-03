(function() {
    const ORDERS_KEY = "pos_orders";
    const CUSTOMERS_KEY = "pos_customers";
    const AUDIT_KEY = "pos_audit_logs";

    function readStoredRecords(key) {
        try {
            const records = JSON.parse(localStorage.getItem(key) || "[]");
            return Array.isArray(records) ? records : [];
        } catch { return []; }
    }

    function formatAppCurrency(value) {
        return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value) || 0);
    }

    function escapeCustomerText(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "\x27": "&#39;"
        }[character]));
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

// ---------- OVERVIEW: SALES BY CATEGORY CHART ----------
let ovCategoryChartInstance = null;

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

function renderSalesByCategoryChart() {
    const canvas = document.getElementById('ovCategoryChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const orders = readOrdersFromStorage();
    const products = window.getInventorySnapshot?.() || [];

    // Build name → category lookup from current inventory
    const nameToCategory = {};
    products.forEach(p => {
        if (p.name) nameToCategory[String(p.name).toLowerCase()] = p.category || 'uncategorized';
    });

    // Aggregate revenue per category from all historical orders
    const revenueByCategory = {};
    orders.forEach(order => {
        (order.items || []).forEach(item => {
            const cat = nameToCategory[String(item.name || '').toLowerCase()] || 'uncategorized';
            const revenue = (Number(item.price) || 0) * (Number(item.quantity) || 0);
            revenueByCategory[cat] = (revenueByCategory[cat] || 0) + revenue;
        });
    });

    const sorted = Object.entries(revenueByCategory)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

    const labels = sorted.map(([cat]) => formatCategoryLabel(cat));
    const data = sorted.map(([, v]) => v);
    const colors = sorted.map(([cat], i) => getCategoryColor(cat, i));
    const total = data.reduce((s, v) => s + v, 0);

    const subtitleEl = document.getElementById('ovCategorySubtitle');
    if (subtitleEl) {
        subtitleEl.textContent = total > 0
            ? `${sorted.length} categor${sorted.length === 1 ? 'y' : 'ies'} · ${formatAppCurrency(total)} total`
            : 'No sales recorded yet';
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




function refreshOverview() {
    refreshOverviewStats();
    renderSalesChart();
    renderTopProductsChart();
    renderSalesByCategoryChart();
    renderLowStockWidget();
    renderHourlyHeatmap();
    renderRecentActivity();
}

function setupOverview() {
    setupSalesPeriodControls();
    setupTopProductsPeriodControls();
    window.addEventListener("pos-order-created", refreshOverview);
    window.addEventListener("inventory-products-loaded", refreshOverview);
}

window.refreshOverview = refreshOverview;
window.renderRecentActivity = renderRecentActivity;
window.setupOverview = setupOverview;
})();
