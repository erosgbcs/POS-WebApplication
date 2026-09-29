/* audit.js - Audit Trail & System Logs (owner monitoring) */
/* Extracted from script.js for modularity, following the same pattern as pos.js. */
(function() {
    // ===================== CONSTANTS =====================
    const AUDIT_KEY = 'pos_audit_logs';
    const DISPLAY_LIMIT = 100;
    const ACTIVE_WINDOW_MS = 12 * 60 * 60 * 1000;   // user considered "active" for 12 h after login
    const OFF_HOURS_START = 22;                     // 10 PM
    const OFF_HOURS_END = 6;                        // 6 AM
    const LARGE_TXN_THRESHOLD = 5000;               // ₱5,000+ flagged

    // ===================== HELPERS =====================
    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[character]));
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
        const toastTimeout = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
        toast.style.cursor = 'pointer';
        toast.addEventListener('click', () => {
            clearTimeout(toastTimeout);
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
        });
    }

    function readStoredRecords(key) {
        try {
            const records = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(records) ? records : [];
        } catch (error) {
            return [];
        }
    }

    function writeStoredRecords(key, records) {
        try {
            localStorage.setItem(key, JSON.stringify(records));
        } catch (e) {}
    }

    function downloadCsv(filename, headers, rows) {
        const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const csv = [headers, ...rows].map(row => row.map(escapeCsv).join(',')).join('\n');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    function getActorName() {
        const user = window.POS_CURRENT_USER;
        if (user) {
            return user.user_metadata?.full_name || user.email || 'Local user';
        }
        try {
            const stored = JSON.parse(localStorage.getItem('pos_current_user') || 'null');
            if (stored) {
                return stored.user_metadata?.full_name || stored.email || 'Local user';
            }
        } catch (e) {}
        return 'Local user';
    }

    function isToday(ts) {
        if (!ts) return false;
        return String(ts).startsWith(new Date().toISOString().split('T')[0]);
    }

    function isSuspicious(log) {
        // Off-hours activity (10 PM – 6 AM)
        const hour = new Date(log.timestamp).getHours();
        if (hour >= OFF_HOURS_START || hour < OFF_HOURS_END) return 'off-hours';
        // Destructive actions
        if (log.action === 'delete') return 'destructive';
        // Large transactions
        if (log.txn && Number(log.txn.total) >= LARGE_TXN_THRESHOLD) return 'large-txn';
        // Critical severity
        if (log.severity === 'critical' || log.severity === 'error') return 'critical';
        return null;
    }

    function relativeTime(iso) {
        const then = new Date(iso).getTime();
        if (isNaN(then)) return '';
        const sec = Math.floor((Date.now() - then) / 1000);
        if (sec < 60) return 'just now';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min}m ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr}h ago`;
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
        if (meta && typeof meta === 'object') {
            logEntry.txn = meta;
        }

        const logs = readStoredRecords(AUDIT_KEY);
        logs.unshift({ id: Date.now() + Math.random(), ...logEntry });
        writeStoredRecords(AUDIT_KEY, logs.slice(0, 100));

        renderAuditLogs();
        renderActiveUsers();
        renderUserSummary();

        window.POS_SUPABASE?.addAuditLog?.(logEntry).catch(() => {});
    }

    // ===================== FILTER OPTIONS =====================
    function populateUserFilter(logs) {
        const select = document.getElementById('auditUserFilter');
        if (!select) return;
        const current = select.value;
        const names = [...new Set(logs.map(l => l.user).filter(Boolean))].sort();
        select.innerHTML = '<option value="">All users</option>' +
            names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
        if (current && names.includes(current)) select.value = current;
    }

    // ===================== TABLE =====================
    async function renderAuditLogs() {
        const tbody = document.getElementById('auditLogTableBodyMain');
        if (!tbody) return;

        let logs = [];
        try {
            const { data, error } = await window.POS_SUPABASE.getAuditLogs(500);
            if (!error && Array.isArray(data)) {
                logs = data;
                writeStoredRecords(AUDIT_KEY, logs.slice(0, 100));
            } else {
                logs = readStoredRecords(AUDIT_KEY);
            }
        } catch {
            logs = readStoredRecords(AUDIT_KEY);
        }

        populateUserFilter(logs);

        const search = (document.getElementById('auditSearch')?.value || '').toLowerCase();
        const userFilter = document.getElementById('auditUserFilter')?.value || '';
        const actionFilter = document.getElementById('auditActionFilter')?.value || '';

        const filtered = logs.filter(log => {
            if (userFilter && log.user !== userFilter) return false;
            if (actionFilter && log.action !== actionFilter) return false;
            if (!search) return true;
            const haystack = [
                log.user, log.action, log.module, log.description,
                log.txn?.id, log.txn?.customer, log.txn?.payment
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(search);
        });

        const pageLogs = filtered.slice(0, DISPLAY_LIMIT);

        tbody.innerHTML = pageLogs.length ?
            pageLogs.map(log => {
                const flag = isSuspicious(log);
                const flagBadge = flag
                    ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:4px;font-size:10px;background:rgba(239,68,68,0.15);color:#f87171;">⚠ ${escapeHtml(flag)}</span>`
                    : '';
                const txn = log.txn;
                const txnBadge = txn
                    ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:4px;font-size:10px;background:rgba(34,197,94,0.15);color:#4ade80;">${escapeHtml(txn.payment === 'gcash' ? 'GCash' : 'Cash')} · ₱${Number(txn.total || 0).toFixed(2)}</span>`
                    : '';
                return `<tr>
                    <td>${new Date(log.timestamp).toLocaleString()}</td>
                    <td><strong>${escapeHtml(log.user)}</strong></td>
                    <td>${escapeHtml(log.action)}</td>
                    <td>${escapeHtml(log.module)}</td>
                    <td>${escapeHtml(log.description)}${txnBadge}${flagBadge}</td>
                    <td>${escapeHtml(log.ip)}</td>
                    <td>${escapeHtml(log.severity)}</td>
                </tr>`;
            }).join('') :
            '<tr><td colspan="7" class="empty-table-message">No audit records found</td></tr>';

        const today = new Date().toISOString().split('T')[0];
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        setText('totalLogs', filtered.length);
        setText('todayLogs', filtered.filter(log => (log.timestamp || '').startsWith(today)).length);
        setText('criticalLogs', filtered.filter(log => log.severity === 'critical' || log.severity === 'error').length);
        setText('dataChanges', filtered.filter(log => ['create', 'update', 'delete'].includes(log.action)).length);
    }

    // ===================== ACTIVE USERS PANEL =====================
    function renderActiveUsers() {
        const list = document.getElementById('activeUsersList');
        if (!list) return;

        const logs = readStoredRecords(AUDIT_KEY);
        const now = Date.now();

        // For each user, find their last login/logout within the active window.
        const byUser = {};
        // iterate oldest → newest so we can track the last state
        [...logs].reverse().forEach(log => {
            if (log.module !== 'auth') return;
            if (log.action !== 'login' && log.action !== 'logout') return;
            const ts = new Date(log.timestamp).getTime();
            if (isNaN(ts) || now - ts > ACTIVE_WINDOW_MS) return;
            byUser[log.user] = { state: log.action, ts: log.timestamp };
        });

        const active = Object.entries(byUser)
            .filter(([, v]) => v.state === 'login')
            .sort((a, b) => new Date(b[1].ts) - new Date(a[1].ts));

        const countEl = document.getElementById('activeUsersCount');
        if (countEl) countEl.textContent = `${active.length} online`;

        if (!active.length) {
            list.innerHTML = `
                <div class="activity-item" style="justify-content: center; color: var(--text-secondary); font-size: 14px; padding: 1.5rem 0;">
                    <span>No users currently signed in</span>
                </div>`;
            return;
        }

        list.innerHTML = active.map(([name, info]) => {
            // Count today's actions for this user.
            const actionsToday = logs.filter(l =>
                l.user === name && isToday(l.timestamp) && l.action !== 'login'
            ).length;
            return `
                <div class="activity-item">
                    <div class="activity-icon green">
                        <i class="fas fa-user-circle"></i>
                    </div>
                    <div class="activity-content" style="flex: 1;">
                        <p><strong>${escapeHtml(name)}</strong> is signed in</p>
                        <span class="activity-time">Since ${relativeTime(info.ts)} · ${actionsToday} actions today</span>
                    </div>
                    <span class="stock-badge in-stock">Active</span>
                </div>`;
        }).join('');
    }

    // ===================== PER-USER TODAY SUMMARY =====================
    function renderUserSummary() {
        const list = document.getElementById('userSummaryList');
        if (!list) return;

        const logs = readStoredRecords(AUDIT_KEY);
        const today = logs.filter(l => isToday(l.timestamp));
        const byUser = {};

        today.forEach(log => {
            const u = log.user || 'Unknown';
            if (!byUser[u]) byUser[u] = {
                sales: 0, salesTotal: 0, deletions: 0, logins: 0, actions: 0
            };
            byUser[u].actions++;
            if (log.action === 'transaction') {
                byUser[u].sales++;
                byUser[u].salesTotal += Number(log.txn?.total) || 0;
            }
            if (log.action === 'delete') byUser[u].deletions++;
            if (log.action === 'login') byUser[u].logins++;
        });

        const entries = Object.entries(byUser)
            .sort((a, b) => b[1].actions - a[1].actions);

        const subtitle = document.getElementById('userSummarySubtitle');
        if (subtitle) subtitle.textContent = `${entries.length} user${entries.length === 1 ? '' : 's'} active today`;

        if (!entries.length) {
            list.innerHTML = `
                <div class="activity-item" style="justify-content: center; color: var(--text-secondary); font-size: 14px; padding: 1.5rem 0;">
                    <span>No activity recorded today</span>
                </div>`;
            return;
        }

        list.innerHTML = entries.map(([name, s]) => {
            const warning = s.deletions > 0
                ? `<span class="stock-badge low-stock" style="margin-left:6px;">${s.deletions} deletion${s.deletions === 1 ? '' : 's'}</span>`
                : '';
            return `
                <div class="activity-item">
                    <div class="activity-icon blue">
                        <i class="fas fa-user"></i>
                    </div>
                    <div class="activity-content" style="flex: 1;">
                        <p><strong>${escapeHtml(name)}</strong></p>
                        <span class="activity-time">
                            ${s.actions} action${s.actions === 1 ? '' : 's'} ·
                            ${s.sales} sale${s.sales === 1 ? '' : 's'} (₱${s.salesTotal.toFixed(2)})
                            ${warning}
                        </span>
                    </div>
                </div>`;
        }).join('');
    }

    // ===================== SETUP =====================
    function setupAuditFeatures() {
        document.getElementById('auditSearch')?.addEventListener('input', renderAuditLogs);
        document.getElementById('auditUserFilter')?.addEventListener('change', renderAuditLogs);
        document.getElementById('auditActionFilter')?.addEventListener('change', renderAuditLogs);

        document.getElementById('exportAuditLogs')?.addEventListener('click', () => {
            const logs = readStoredRecords(AUDIT_KEY);
            downloadCsv(
                `audit_logs_${new Date().toISOString().split('T')[0]}.csv`,
                ['Timestamp', 'User', 'Action', 'Module', 'Description', 'IP', 'Severity',
                 'Txn ID', 'Txn Items', 'Txn Total', 'Txn Payment', 'Txn Customer'],
                logs.map(log => [
                    log.timestamp, log.user, log.action, log.module, log.description, log.ip, log.severity,
                    log.txn?.id || '', log.txn?.items ?? '', log.txn?.total ?? '',
                    log.txn?.payment || '', log.txn?.customer || ''
                ])
            );
            addAuditLog('export', 'audit', 'Audit log exported', 'info');
        });

        document.getElementById('clearAllLogs')?.addEventListener('click', async () => {
            if (!window.confirm('Clear all audit logs?')) return;
            const { error } = await window.POS_SUPABASE.clearAuditLogs();
            if (error) { showToast(error.message, 'error'); return; }
            writeStoredRecords(AUDIT_KEY, []);
            renderAuditLogs();
            renderActiveUsers();
            renderUserSummary();
            showToast('Audit logs cleared', 'success');
        });

        renderAuditLogs();
        renderActiveUsers();
        renderUserSummary();

        // Refresh active users + summary every 60 seconds (clock ticks for "Xm ago").
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