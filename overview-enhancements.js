/* overview-enhancements.js
   Adds tab switching, the "needs attention" strip, and syncs the
   single Analytics period/compare controls down to the three legacy
   selects that script.js already drives.
   Does NOT modify any other file. */
(function () {
    'use strict';

    /* ============================================================
       1) ANALYTICS TABS
       ============================================================ */
    const analyticsTabs  = document.querySelectorAll('.ov-analytics .ov-tab[data-ov-pane]');
    const analyticsPanes = document.querySelectorAll('.ov-analytics .ov-pane[data-ov-pane]');

    const RENDER_BY_PANE = {
        trend:      () => window.__ovRenderSales?.(),
        products:   () => window.__ovRenderTopProducts?.(),
        categories: () => window.__ovRenderCategories?.(),
        hours:      () => window.__ovRenderHeatmap?.()
    };

    // Map pane → the hidden select that drives its chart
    const PANE_SELECT = {
        trend:      'ovSalesPeriod',
        products:   'ovTopProductsPeriod',
        categories: 'ovCategoryPeriod'
    };

    function switchAnalyticsPane(pane) {
        analyticsTabs.forEach(t => {
            const on = t.dataset.ovPane === pane;
            t.classList.toggle('active', on);
            t.setAttribute('aria-selected', String(on));
        });
        analyticsPanes.forEach(p => {
            p.classList.toggle('active', p.dataset.ovPane === pane);
        });

        // Force the hidden chart to re-render at its correct size.
        // Charts inside a display:none parent render at 0×0 — this kicks
        // them into a proper re-layout on the next frame.
        requestAnimationFrame(() => {
            const sel = document.getElementById(PANE_SELECT[pane]);
            if (sel) {
                sel.dispatchEvent(new Event('change'));
            } else if (pane === 'hours') {
                RENDER_BY_PANE.hours?.();
                window.dispatchEvent(new CustomEvent('ov-hourly-rerender'));
            }
        });
    }

    analyticsTabs.forEach(tab => {
        tab.addEventListener('click', () => switchAnalyticsPane(tab.dataset.ovPane));
    });

    /* ============================================================
       2) SYNC ANALYTICS CONTROLS → LEGACY SELECTS
       ============================================================ */
    const masterPeriod  = document.getElementById('ovAnalyticsPeriod');
    const masterCompare = document.getElementById('ovAnalyticsCompare');
    const PERIOD_KEY    = 'pos_sales_period';        // the key script.js already uses

    const HIDDEN_PERIODS  = ['ovSalesPeriod', 'ovTopProductsPeriod', 'ovCategoryPeriod'];
    const HIDDEN_COMPARES = ['ovSalesCompare', 'ovTopProductsCompare', 'ovCategoryCompare'];

    // Restore saved period
    if (masterPeriod) {
        try {
            const saved = localStorage.getItem(PERIOD_KEY);
            if (saved && masterPeriod.querySelector(`option[value="${saved}"]`)) {
                masterPeriod.value = saved;
            }
        } catch (e) {}
    }

    function pushToHidden() {
        if (masterPeriod) {
            const v = masterPeriod.value;
            HIDDEN_PERIODS.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                el.value = v;
                el.dispatchEvent(new Event('change'));
            });
        }
        if (masterCompare) {
            const checked = masterCompare.checked;
            HIDDEN_COMPARES.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                el.checked = checked;
                el.dispatchEvent(new Event('change'));
            });
        }
    }

    masterPeriod?.addEventListener('change', () => {
        try { localStorage.setItem(PERIOD_KEY, masterPeriod.value); } catch (e) {}
        pushToHidden();
    });

    masterCompare?.addEventListener('change', pushToHidden);

    // Push initial values into the hidden selects after script.js attaches
    // its own listeners. Wait one frame so its setup completes first.
    requestAnimationFrame(() => requestAnimationFrame(pushToHidden));

    /* ============================================================
       3) AI INSIGHTS TABS
       ============================================================ */
    const aiTabs  = document.querySelectorAll('.ov-ai-card .ov-tab[data-ai-pane]');
    const aiPanes = document.querySelectorAll('.ov-ai-card .ov-ai-pane[data-ai-pane]');

    aiTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const pane = tab.dataset.aiPane;
            aiTabs.forEach(t => {
                const on = t.dataset.aiPane === pane;
                t.classList.toggle('active', on);
                t.setAttribute('aria-selected', String(on));
            });
            aiPanes.forEach(p => {
                p.classList.toggle('active', p.dataset.aiPane === pane);
            });
        });
    });

    /* ============================================================
       4) NEEDS ATTENTION STRIP
       ============================================================ */
    const strip     = document.getElementById('ovAttentionStrip');
    const stripTitle= document.getElementById('ovAttentionTitle');
    const stripMeta = document.getElementById('ovAttentionMeta');

    function pendingOfflineCount() {
        try {
            const q = JSON.parse(localStorage.getItem('pos_order_queue') || '[]');
            return Array.isArray(q) ? q.length : 0;
        } catch (e) { return 0; }
    }

    function refreshAttentionStrip() {
        if (!strip) return;

        const products = window.getInventorySnapshot?.() || [];
        const outOfStock = products.filter(p => (Number(p.quantity) || 0) === 0).length;
        const lowStock   = products.filter(p => {
            const q   = Number(p.quantity) || 0;
            const min = Number(p.minStock ?? p.min_stock ?? 0) || 0;
            return q > 0 && q <= min;
        }).length;
        const offline = pendingOfflineCount();

        const total = outOfStock + lowStock + offline;

        if (total === 0) {
            strip.hidden = true;
            return;
        }

        strip.hidden = false;
        stripTitle.textContent =
            total === 1 ? '1 thing needs your attention'
                        : `${total} things need your attention`;

        const parts = [];
        if (outOfStock > 0) parts.push(
            `<span><i class="fas fa-times-circle" style="color:#f87171"></i> ${outOfStock} out of stock</span>`
        );
        if (lowStock > 0) parts.push(
            `<span><i class="fas fa-exclamation-triangle" style="color:#fb923c"></i> ${lowStock} low stock</span>`
        );
        if (offline > 0) parts.push(
            `<span><i class="fas fa-cloud-arrow-up" style="color:#60a5fa"></i> ${offline} sale${offline === 1 ? '' : 's'} queued offline</span>`
        );
        stripMeta.innerHTML = parts.join('');
    }

    function handleStripClick() {
        const offline = pendingOfflineCount();
        const products = window.getInventorySnapshot?.() || [];
        const hasStockIssue = products.some(p => {
            const q = Number(p.quantity) || 0;
            const min = Number(p.minStock ?? p.min_stock ?? 0) || 0;
            return q === 0 || (q > 0 && q <= min);
        });

        if (hasStockIssue) window.navigateToPage?.('inventory');
        else if (offline > 0) window.navigateToPage?.('pos');
    }

    strip?.addEventListener('click', handleStripClick);
    strip?.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleStripClick();
        }
    });

    // Live update hooks
    window.addEventListener('inventory-products-loaded', refreshAttentionStrip);
    window.addEventListener('pos-queue-changed',          refreshAttentionStrip);
    window.addEventListener('pos-order-created',          refreshAttentionStrip);
    window.addEventListener('online',                     refreshAttentionStrip);
    window.addEventListener('offline',                    refreshAttentionStrip);
    setInterval(refreshAttentionStrip, 20000);

    // First paint
    requestAnimationFrame(() => requestAnimationFrame(refreshAttentionStrip));

    // Expose so script.js's refreshOverview can nudge it if ever needed
    window.refreshAttentionStrip = refreshAttentionStrip;

    /* ============================================================
       5) HOOK: pick up newly-created analytics charts
       ============================================================ */
    // script.js destroys and recreates charts on every refresh, so
    // after it runs we need to make sure the currently-visible pane
    // is the one that got resized. Hook the events it fires.
    window.addEventListener('pos-order-created', () => {
        const active = document.querySelector('.ov-analytics .ov-tab.active')?.dataset.ovPane;
        if (active) requestAnimationFrame(() => switchAnalyticsPane(active));
    });

})();