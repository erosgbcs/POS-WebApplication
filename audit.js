/* audit.js - Audit Trail (owner view) */
(function() {
    // ===================== CONSTANTS =====================
    const AUDIT_KEY = 'pos_audit_logs';
    const DISPLAY_LIMIT = 200;

    // ===================== HELPERS =====================
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function formatCurrency(value) {
        return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
            .format(Number(value) || 0);
    }

    function showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
        toast.innerHTML = `
            <i class="fas ${icon}"></i>
            <span>${message}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
        `;
        container.appendChild(toast);
        const timeout = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
        toast.addEventListener('click', () => {
            clearTimeout(timeout);
            toast.remove();
        });
    }

    function readStoredRecords(key) {
        try {
            const records = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(records) ? records : [];
        } catch { return []; }
    }

    function writeStoredRecords(key, records) {
        try { localStorage.setItem(key, JSON.stringify(records)); } catch {}
    }

    function downloadCsv(filename, headers, rows) {
        const escapeCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv = [headers, ...rows].map(r => r.map(escapeCsv).join(',')).join('\n');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    function getActorName() {
        const user = window.POS_CURRENT_USER;
        if (user) return user.user_metadata?.full_name || user.email || 'Local user';
        try {
            const stored = JSON.parse(localStorage.getItem('pos_current_user') || 'null');
            if (stored) return stored.user_metadata?.full_name || stored.email || 'Local user';
        } catch {}
        return 'Local user';
    }

    function isToday(ts) {
        if (!ts) return false;
        return String(ts).startsWith(new Date().toISOString().split('T')[0]);
    }

    // ===================== OWNER-FRIENDLY TRANSLATIONS =====================
    // Maps action + module → plain-English label + icon + tone
    function humanActivity(action, module) {
        const key = `${action}:${module}`;
        const map = {
            'transaction:pos':    { label: 'Sale',            icon: 'fa-cash-register',      tone: 'success' },
            'create:pos':         { label: 'Sale',            icon: 'fa-cash-register',      tone: 'success' },
            'create:inventory':   { label: 'Added product',   icon: 'fa-plus-circle',        tone: 'success' },
            'update:inventory':   { label: 'Changed product', icon: 'fa-pen',                tone: 'info'    },
            'delete:inventory':   { label: 'Removed product', icon: 'fa-trash',              tone: 'danger'  },
            'create:customers':   { label: 'Added customer',  icon: 'fa-user-plus',          tone: 'success' },
            'delete:customers':   { label: 'Removed customer',icon: 'fa-user-minus',         tone: 'danger'  },
            'delete:orders':      { label: 'Deleted order',   icon: 'fa-receipt',            tone: 'danger'  },
            'update:settings':    { label: 'Updated settings',icon: 'fa-sliders-h',          tone: 'info'    },
            'export:reports':     { label: 'Exported report', icon: 'fa-file-export',        tone: 'info'    },
            'export:inventory':   { label: 'Exported inventory', icon: 'fa-file-export',     tone: 'info'    },
            'export:audit':       { label: 'Exported logs',   icon: 'fa-file-export',        tone: 'info'    },
            'login:auth':         { label: 'Signed in',       icon: 'fa-sign-in-alt',        tone: 'success' },
            'logout:auth':        { label: 'Signed out',      icon: 'fa-sign-out-alt',       tone: 'muted'   }
        };
        return map[key] || {
            label: `${action} ${module}`.replace(/\b\w/g, c => c.toUpperCase()),
            icon: 'fa-info-circle',
            tone: 'info'
        };
    }

    // Clean up a description so it reads naturally
    function humanDescription(log) {
        const desc = String(log.description || '').trim();
        if (!desc) return '—';
        // Replace receipt-id patterns with readable text but keep the id in tooltip
        return desc;
    }

    // Extract money amount from log entry (if it's a transaction)
    function logAmount(log) {
        if (log.txn && Number(log.txn.total) > 0) return Number(log.txn.total);
        // Try to pull ₱X,XXX.XX from description
        const m = String(log.description || '').match(/₱\s?([\d,]+(?:\.\d{1,2})?)/);
        if (m) return parseFloat(m[1].replace(/,/g, ''));
        return null;
    }

    // Relative time — "5 min ago"
    function relativeTime(iso) {
        const then = new Date(iso).getTime();
        if (isNaN(then)) return '';
        const sec = Math.floor((Date.now() - then) / 1000);
        if (sec < 0) return 'just now';
        if (sec < 60) return 'just now';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min} min ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
        const day = Math.floor(hr / 24);
        if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
        return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    }

    // ===================== AUDIT LOG CORE =====================
    function addAuditLog(action, module, description, severity = 'info', meta = null) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            user: (meta?.cashier) || getActorName(),
            action,
            module,
            description,
            ip: 'Client',
            severity
        };
        if (meta && typeof meta === 'object') logEntry.txn = meta;

        const logs = readStoredRecords(AUDIT_KEY);
        logs.unshift({ id: Date.now() + Math.random(), ...logEntry });
        writeStoredRecords(AUDIT_KEY, logs.slice(0, 200));

        // Refresh only if the audit page is visible
        const auditPage = document.getElementById('page-audit');
        if (auditPage?.classList.contains('active')) {
            renderAuditLogs();
        }
        renderActiveUsers();
        renderUserSummary();

        window.POS_SUPABASE?.addAuditLog?.(logEntry).catch(() => {});
    }

    // ===================== FILTER STATE =====================
    const filters = {
        search: '',
        user: '',
        timeRange: '',      // '', 'today', 'yesterday', 'week', 'month'
        category: '',       // '', 'sales', 'inventory', 'customers', 'accounts', 'system'
        what: ''            // '', 'added', 'changed', 'removed', 'signed-in', 'signed-out', 'exported'
    };

    function matchesTimeRange(log, range) {
        if (!range) return true;
        const ts = new Date(log.timestamp).getTime();
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        switch (range) {
            case 'today':     return isToday(log.timestamp);
            case 'yesterday': {
                const y = new Date(); y.setDate(y.getDate() - 1);
                return String(log.timestamp).startsWith(y.toISOString().split('T')[0]);
            }
            case 'week':  return (now - ts) < day * 7;
            case 'month': return (now - ts) < day * 31;
            default: return true;
        }
    }

    function matchesCategory(log, cat) {
        if (!cat) return true;
        const map = {
            sales:     ['pos'],
            inventory: ['inventory'],
            customers: ['customers'],
            accounts:  ['auth'],
            system:    ['settings', 'reports', 'orders', 'audit']
        };
        return map[cat]?.includes(log.module);
    }

    function matchesWhat(log, what) {
        if (!what) return true;
        const a = String(log.action || '').toLowerCase();
        switch (what) {
            case 'added':       return a === 'create' || a === 'transaction';
            case 'changed':     return a === 'update';
            case 'removed':     return a === 'delete';
            case 'signed-in':   return a === 'login';
            case 'signed-out':  return a === 'logout';
            case 'exported':    return a === 'export';
            default: return true;
        }
    }

    // ===================== RENDER TABLE =====================
    async function renderAuditLogs() {
        const tbody = document.getElementById('auditLogTableBodyMain');
        if (!tbody) return;

        let logs = [];
        try {
            const { data, error } = await window.POS_SUPABASE.getAuditLogs(500);
            if (!error && Array.isArray(data)) {
                logs = data;
                writeStoredRecords(AUDIT_KEY, logs.slice(0, 200));
            } else {
                logs = readStoredRecords(AUDIT_KEY);
            }
        } catch {
            logs = readStoredRecords(AUDIT_KEY);
        }

        await populateUserFilter(logs);

        const filtered = logs.filter(log => {
            if (filters.user && log.user !== filters.user) return false;
            if (!matchesTimeRange(log, filters.timeRange)) return false;
            if (!matchesCategory(log, filters.category)) return false;
            if (!matchesWhat(log, filters.what)) return false;
            if (filters.search) {
                const haystack = [
                    log.user, log.action, log.module, log.description,
                    log.txn?.id, log.txn?.customer, log.txn?.payment
                ].filter(Boolean).join(' ').toLowerCase();
                if (!haystack.includes(filters.search)) return false;
            }
            return true;
        });

        const pageLogs = filtered.slice(0, DISPLAY_LIMIT);

        if (pageLogs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center;padding:3rem 1rem;color:var(--text-secondary);">
                        <i class="fas fa-inbox" style="font-size:2rem;opacity:0.4;margin-bottom:8px;display:block;"></i>
                        <span>No activity matches your filters</span>
                    </td>
                </tr>`;
        } else {
            tbody.innerHTML = pageLogs.map(log => {
                const act = humanActivity(log.action, log.module);
                const amount = logAmount(log);
                const desc = humanDescription(log);
                const fullDate = new Date(log.timestamp).toLocaleString();
                const rel = relativeTime(log.timestamp);

                const amountCell = amount !== null
                    ? `<span class="audit-amount">${formatCurrency(amount)}</span>`
                    : `<span class="audit-amount-empty">—</span>`;

                return `<tr class="audit-row audit-row-${act.tone}">
                    <td class="audit-cell-when">
                        <span title="${escapeHtml(fullDate)}">${escapeHtml(rel)}</span>
                    </td>
                    <td class="audit-cell-who">
                        <span class="audit-user">${escapeHtml(log.user || 'Unknown')}</span>
                    </td>
                    <td class="audit-cell-activity">
                        <span class="audit-badge audit-badge-${act.tone}">
                            <i class="fas ${act.icon}"></i>
                            ${escapeHtml(act.label)}
                        </span>
                    </td>
                    <td class="audit-cell-desc">
                        <span title="${escapeHtml(desc)}">${escapeHtml(desc)}</span>
                    </td>
                    <td class="audit-cell-amount">
                        ${amountCell}
                    </td>
                </tr>`;
            }).join('');
        }

        updateAuditStats(filtered);
    }

    // ===================== STAT CARDS =====================
    function updateAuditStats(logs) {
        const setText = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        // Sales today
        const todaySales = logs.filter(l =>
            l.txn && isToday(l.timestamp)
        );
        const salesTotal = todaySales.reduce((s, l) => s + (Number(l.txn.total) || 0), 0);
        setText('auditSalesToday', formatCurrency(salesTotal));
        setText('auditSalesTodayCount',
            todaySales.length === 0
                ? 'No sales yet today'
                : `${todaySales.length} sale${todaySales.length === 1 ? '' : 's'}`);

        // Deletions this week
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const deletions = logs.filter(l =>
            l.action === 'delete' && new Date(l.timestamp).getTime() >= weekAgo
        );
        setText('auditDeletions', deletions.length);
        setText('auditDeletionsSub',
            deletions.length === 0 ? 'All clear' : 'Review these');

        // Staff activity today
        const todayLogs = logs.filter(l => isToday(l.timestamp));
        const uniqueUsers = new Set(todayLogs.map(l => l.user).filter(Boolean));
        setText('auditStaffToday', uniqueUsers.size);
        setText('auditStaffSub',
            uniqueUsers.size === 0
                ? 'No activity yet'
                : [...uniqueUsers].slice(0, 2).join(', ') + (uniqueUsers.size > 2 ? '…' : ''));

        // Last activity
        if (logs.length > 0) {
            setText('auditLastActivity', relativeTime(logs[0].timestamp));
            setText('auditLastActivitySub', logs[0].user || '');
        } else {
            setText('auditLastActivity', '—');
            setText('auditLastActivitySub', 'No activity yet');
        }
    }

        // ===================== USER FILTER (from logs + profiles) =====================
    async function populateUserFilter(logs) {
        const select = document.getElementById('auditUserFilter');
        if (!select) return;
        
        const current = select.value;
        
        // 1. Collect users who appear in the audit log
        const fromLogs = new Set(
            (logs || []).map(l => l.user).filter(Boolean)
        );
        
        // 2. Merge with every user from the profiles collection (Firestore)
        //    Uses the same 60s cache as renderActiveUsers to avoid Firestore spam.
        try {
            const users = await fetchProfileUsers();
            users.forEach(u => {
                const name = u.full_name || u.email;
                if (name) fromLogs.add(name);
            });
        } catch (e) {
            console.warn('[AUDIT] populateUserFilter profile merge failed:', e);
        }
        
        // 3. Build sorted option list
        const names = [...fromLogs].sort((a, b) => a.localeCompare(b));
        
        select.innerHTML = '<option value="">All staff</option>' +
            names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
        
        // Preserve previous selection if it still exists
        if (current && names.includes(current)) select.value = current;
    }

       // ===================== ACTIVE USERS =====================
    // Shows real "online" users derived from auth events.
    // Falls back to registered users from the profiles collection
    // when there are no auth events in the log (e.g., after a wipe).
    let _profileFallbackCache = { ts: 0, users: [] };
    
    async function fetchProfileUsers() {
        // Cache profile lookups for 60s so we don't hammer Firestore
        const now = Date.now();
        if (now - _profileFallbackCache.ts < 60000) return _profileFallbackCache.users;
        try {
            const { data } = await window.POS_SUPABASE.getUsers();
            const users = Array.isArray(data) ? data : [];
            _profileFallbackCache = { ts: now, users };
            return users;
        } catch (e) {
            console.warn('[AUDIT] Profile fallback fetch failed:', e);
            return _profileFallbackCache.users || [];
        }
    }
    
    async function renderActiveUsers() {
        const list = document.getElementById('activeUsersList');
        if (!list) return;
        
        const logs = readStoredRecords(AUDIT_KEY);
        const now = Date.now();
        const ACTIVE_WINDOW = 12 * 60 * 60 * 1000;
        const byUser = {};
        
        // 1. Derive state from auth events
        [...logs].reverse().forEach(log => {
            if (log.module !== 'auth') return;
            if (log.action !== 'login' && log.action !== 'logout') return;
            const ts = new Date(log.timestamp).getTime();
            if (isNaN(ts) || now - ts > ACTIVE_WINDOW) return;
            byUser[log.user] = { state: log.action, ts: log.timestamp };
        });
        
        let active = Object.entries(byUser)
            .filter(([, v]) => v.state === 'login')
            .sort((a, b) => new Date(b[1].ts) - new Date(a[1].ts));
        
        // 2. Fallback: no auth events → show registered users from profiles
        let fromProfiles = false;
        if (active.length === 0) {
            const users = await fetchProfileUsers();
            if (users.length > 0) {
                active = users.map(u => [
                    u.full_name || u.email || 'Unknown',
                    {
                        state: 'login',
                        ts: u.created_at || new Date().toISOString(),
                        role: u.role || 'cashier',
                        fromProfile: true
                    }
                ]);
                fromProfiles = true;
            }
        }
        
        const countEl = document.getElementById('activeUsersCount');
        if (countEl) {
            countEl.textContent = fromProfiles ?
                `${active.length} registered` :
                `${active.length} online`;
        }
        
        if (active.length === 0) {
            list.innerHTML = `
                <div class="activity-item" style="justify-content:center;color:var(--text-secondary);font-size:14px;padding:1.5rem 0;">
                    <span>No users found</span>
                </div>`;
            return;
        }
        
        list.innerHTML = active.map(([name, info]) => {
            if (info.fromProfile) {
                const roleLabel = info.role ? ` · ${info.role}` : '';
                return `
                    <div class="activity-item">
                        <div class="activity-icon green"><i class="fas fa-user-circle"></i></div>
                        <div class="activity-content" style="flex:1;">
                            <p><strong>${escapeHtml(name)}</strong></p>
                            <span class="activity-time">Registered account${roleLabel}</span>
                        </div>
                        <span class="stock-badge">Registered</span>
                    </div>`;
            }
            const actionsToday = logs.filter(l =>
                l.user === name && isToday(l.timestamp) && l.action !== 'login'
            ).length;
            return `
                <div class="activity-item">
                    <div class="activity-icon green"><i class="fas fa-user-circle"></i></div>
                    <div class="activity-content" style="flex:1;">
                        <p><strong>${escapeHtml(name)}</strong> is signed in</p>
                        <span class="activity-time">Since ${relativeTime(info.ts)} · ${actionsToday} action${actionsToday === 1 ? '' : 's'} today</span>
                    </div>
                    <span class="stock-badge in-stock">Active</span>
                </div>`;
        }).join('');
    }

        // ===================== PER-USER SUMMARY =====================
    async function renderUserSummary() {
        const list = document.getElementById('userSummaryList');
        if (!list) return;
        
        const logs = readStoredRecords(AUDIT_KEY);
        const today = logs.filter(l => isToday(l.timestamp));
        const byUser = {};
        
        today.forEach(log => {
            const u = log.user || 'Unknown';
            if (!byUser[u]) byUser[u] = { sales: 0, salesTotal: 0, deletions: 0, actions: 0 };
            byUser[u].actions++;
            if (log.action === 'transaction' || (log.action === 'create' && log.module === 'pos')) {
                byUser[u].sales++;
                byUser[u].salesTotal += Number(log.txn?.total) || 0;
            }
            if (log.action === 'delete') byUser[u].deletions++;
        });
        
        let entries = Object.entries(byUser).sort((a, b) => b[1].actions - a[1].actions);
        
        // Fallback: no activity today → show registered users with zero stats
        let fromProfiles = false;
        if (entries.length === 0) {
            const users = await fetchProfileUsers();
            if (users.length > 0) {
                entries = users.map(u => [
                    u.full_name || u.email || 'Unknown',
                    { sales: 0, salesTotal: 0, deletions: 0, actions: 0, role: u.role || 'cashier' }
                ]);
                fromProfiles = true;
            }
        }
        
        const subtitle = document.getElementById('userSummarySubtitle');
        if (subtitle) {
            subtitle.textContent = fromProfiles ?
                `${entries.length} registered user${entries.length === 1 ? '' : 's'} — no activity today` :
                `${entries.length} user${entries.length === 1 ? '' : 's'} active today`;
        }
        
        if (entries.length === 0) {
            list.innerHTML = `
                <div class="activity-item" style="justify-content:center;color:var(--text-secondary);font-size:14px;padding:1.5rem 0;">
                    <span>No users found</span>
                </div>`;
            return;
        }
        
        list.innerHTML = entries.map(([name, s]) => {
            if (fromProfiles) {
                return `
                    <div class="activity-item">
                        <div class="activity-icon blue"><i class="fas fa-user"></i></div>
                        <div class="activity-content" style="flex:1;">
                            <p><strong>${escapeHtml(name)}</strong></p>
                            <span class="activity-time">${s.role ? s.role : 'user'} · no actions today</span>
                        </div>
                    </div>`;
            }
            const warn = s.deletions > 0 ?
                `<span class="stock-badge low-stock" style="margin-left:6px;">${s.deletions} deletion${s.deletions === 1 ? '' : 's'}</span>` :
                '';
            return `
                <div class="activity-item">
                    <div class="activity-icon blue"><i class="fas fa-user"></i></div>
                    <div class="activity-content" style="flex:1;">
                        <p><strong>${escapeHtml(name)}</strong></p>
                        <span class="activity-time">
                            ${s.actions} action${s.actions === 1 ? '' : 's'} ·
                            ${s.sales} sale${s.sales === 1 ? '' : 's'} (${formatCurrency(s.salesTotal)})
                            ${warn}
                        </span>
                    </div>
                </div>`;
        }).join('');
    }

    // ===================== SETUP =====================
    function setupAuditFeatures() {
        // Search
        document.getElementById('auditSearch')?.addEventListener('input', (e) => {
            filters.search = e.target.value.toLowerCase();
            renderAuditLogs();
        });
        // User
        document.getElementById('auditUserFilter')?.addEventListener('change', (e) => {
            filters.user = e.target.value;
            renderAuditLogs();
        });
        // Time range
        document.getElementById('auditTimeRange')?.addEventListener('change', (e) => {
            filters.timeRange = e.target.value;
            renderAuditLogs();
        });
        // Category
        document.getElementById('auditCategoryFilter')?.addEventListener('change', (e) => {
            filters.category = e.target.value;
            renderAuditLogs();
        });
        // What happened
        document.getElementById('auditWhatFilter')?.addEventListener('change', (e) => {
            filters.what = e.target.value;
            renderAuditLogs();
        });
        // Clear filters
        document.getElementById('clearAuditFilters')?.addEventListener('click', () => {
            filters.search = filters.user = filters.timeRange = filters.category = filters.what = '';
            ['auditSearch','auditUserFilter','auditTimeRange','auditCategoryFilter','auditWhatFilter'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            renderAuditLogs();
        });

        // Export
        document.getElementById('exportAuditLogs')?.addEventListener('click', () => {
            const logs = readStoredRecords(AUDIT_KEY);
            downloadCsv(
                `activity_log_${new Date().toISOString().split('T')[0]}.csv`,
                ['When', 'Who', 'Activity', 'What happened', 'Amount', 'Category'],
                logs.map(log => {
                    const act = humanActivity(log.action, log.module);
                    return [
                        new Date(log.timestamp).toLocaleString(),
                        log.user,
                        act.label,
                        log.description,
                        logAmount(log) ?? '',
                        log.module
                    ];
                })
            );
            addAuditLog('export', 'audit', 'Activity log exported', 'info');
        });

        // Clear all
        document.getElementById('clearAllLogs')?.addEventListener('click', async () => {
            if (!window.confirm('Clear ALL activity history? This cannot be undone.')) return;
            const { error } = await window.POS_SUPABASE.clearAuditLogs();
            if (error) { showToast(error.message, 'error'); return; }
            writeStoredRecords(AUDIT_KEY, []);
            renderAuditLogs();
            renderActiveUsers();
            renderUserSummary();
            showToast('Activity history cleared', 'success');
        });

        renderAuditLogs();
        renderActiveUsers();
        renderUserSummary();

        if (window._auditTick) clearInterval(window._auditTick);
        window._auditTick = setInterval(() => {
            renderActiveUsers();
            renderUserSummary();
        }, 60000);
    }

    // ===================== PUBLIC API =====================
    window.addAuditLog = addAuditLog;
    window.POS_APP_LOG = addAuditLog;
    window.renderAuditLogs = renderAuditLogs;
    window.renderActiveUsers = renderActiveUsers;
    window.renderUserSummary = renderUserSummary;
    window.setupAuditFeatures = setupAuditFeatures;
    window.AUDIT_KEY = AUDIT_KEY;
})();