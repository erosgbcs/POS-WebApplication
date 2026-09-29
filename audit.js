/* audit.js - Audit Trail & System Logs */
/* Extracted from script.js for modularity, following the same pattern as pos.js. */
(function() {
    // ===================== CONSTANTS =====================
    const AUDIT_KEY = 'pos_audit_logs';
    const AUDIT_PAGE_SIZE = 10;

    // ===================== STATE =====================
    let auditPage = 1;

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
        // Prefer the current user exposed by script.js (set in loadDashboard).
        const user = window.POS_CURRENT_USER;
        if (user) {
            return user.user_metadata?.full_name || user.email || 'Local user';
        }
        // Fallback: local session snapshot (local mode).
        try {
            const stored = JSON.parse(localStorage.getItem('pos_current_user') || 'null');
            if (stored) {
                return stored.user_metadata?.full_name || stored.email || 'Local user';
            }
        } catch (e) {}
        return 'Local user';
    }

    // ===================== AUDIT LOG CORE =====================
    function addAuditLog(action, module, description, severity = 'info') {
        const logEntry = {
            timestamp: new Date().toISOString(),
            user: getActorName(),
            action,
            module,
            description,
            ip: 'Client',
            severity
        };

        // Local cache — instant UI + offline resilience.
        const logs = readStoredRecords(AUDIT_KEY);
        logs.unshift({ id: Date.now() + Math.random(), ...logEntry });
        writeStoredRecords(AUDIT_KEY, logs.slice(0, 100));

        // Refresh the audit table.
        renderAuditLogs();

        // Firestore sync — cross-device.
        window.POS_SUPABASE?.addAuditLog?.(logEntry).catch(() => {});
    }

    function getFilteredAuditLogs() {
        const search = (document.getElementById('auditSearch')?.value || '').toLowerCase();
        const action = document.getElementById('auditActionFilter')?.value || '';
        const module = document.getElementById('auditModuleFilter')?.value || '';
        const date = document.getElementById('auditDateFilter')?.value || '';
        return readStoredRecords(AUDIT_KEY).filter(log => {
            const haystack = `${log.user} ${log.action} ${log.module} ${log.description}`.toLowerCase();
            return (!search || haystack.includes(search)) &&
                (!action || log.action === action) &&
                (!module || log.module === module) &&
                (!date || (log.timestamp || '').startsWith(date));
        });
    }

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

        const search = (document.getElementById('auditSearch')?.value || '').toLowerCase();
        const action = document.getElementById('auditActionFilter')?.value || '';
        const module = document.getElementById('auditModuleFilter')?.value || '';
        const date = document.getElementById('auditDateFilter')?.value || '';

        const filtered = logs.filter(log => {
            const haystack = `${log.user} ${log.action} ${log.module} ${log.description}`.toLowerCase();
            return (!search || haystack.includes(search)) &&
                (!action || log.action === action) &&
                (!module || log.module === module) &&
                (!date || (log.timestamp || '').startsWith(date));
        });

        const start = (auditPage - 1) * AUDIT_PAGE_SIZE;
        const pageLogs = filtered.slice(start, start + AUDIT_PAGE_SIZE);

        tbody.innerHTML = pageLogs.length ?
            pageLogs.map(log => `<tr>
                <td>${new Date(log.timestamp).toLocaleString()}</td>
                <td>${escapeHtml(log.user)}</td>
                <td>${escapeHtml(log.action)}</td>
                <td>${escapeHtml(log.module)}</td>
                <td>${escapeHtml(log.description)}</td>
                <td>${escapeHtml(log.ip)}</td>
                <td>${escapeHtml(log.severity)}</td>
            </tr>`).join('') :
            '<tr><td colspan="7" class="empty-table-message">No audit records found</td></tr>';

        const pagination = document.getElementById('auditPaginationMain');
        const pages = Math.ceil(filtered.length / AUDIT_PAGE_SIZE);
        if (pagination) {
            pagination.innerHTML = pages > 1 ?
                Array.from({ length: pages }, (_, index) =>
                    `<button class="page-btn ${index + 1 === auditPage ? 'active' : ''}" type="button" data-audit-page="${index + 1}">${index + 1}</button>`
                ).join('') :
                '';
        }

        const today = new Date().toISOString().split('T')[0];
        const setText = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        };
        setText('totalLogs', filtered.length);
        setText('todayLogs', filtered.filter(log => (log.timestamp || '').startsWith(today)).length);
        setText('criticalLogs', filtered.filter(log => log.severity === 'critical' || log.severity === 'error').length);
        setText('dataChanges', filtered.filter(log => ['create', 'update', 'delete'].includes(log.action)).length);
    }

    function setupAuditFeatures() {
        const search = document.getElementById('auditSearch');
        const actionFilter = document.getElementById('auditActionFilter');
        const moduleFilter = document.getElementById('auditModuleFilter');
        const dateFilter = document.getElementById('auditDateFilter');

        [search, actionFilter, moduleFilter, dateFilter].forEach(control => {
            control?.addEventListener('input', () => {
                auditPage = 1;
                renderAuditLogs();
            });
        });

        document.getElementById('clearAuditFilters')?.addEventListener('click', () => {
            [search, actionFilter, moduleFilter, dateFilter].forEach(control => {
                if (control) control.value = '';
            });
            auditPage = 1;
            renderAuditLogs();
        });

        document.getElementById('exportAuditLogs')?.addEventListener('click', () => {
            const logs = getFilteredAuditLogs();
            downloadCsv(
                `audit_logs_${new Date().toISOString().split('T')[0]}.csv`,
                ['Timestamp', 'User', 'Action', 'Module', 'Description', 'IP Address', 'Severity'],
                logs.map(log => [log.timestamp, log.user, log.action, log.module, log.description, log.ip, log.severity])
            );
            addAuditLog('export', 'audit', 'Audit log exported', 'info');
        });

        document.getElementById('clearAllLogs')?.addEventListener('click', async () => {
            if (!window.confirm('Clear all audit logs?')) return;
            const { error } = await window.POS_SUPABASE.clearAuditLogs();
            if (error) {
                showToast(error.message, 'error');
                return;
            }
            writeStoredRecords(AUDIT_KEY, []);
            renderAuditLogs();
            showToast('Audit logs cleared', 'success');
        });

        document.getElementById('auditPaginationMain')?.addEventListener('click', event => {
            const button = event.target.closest('[data-audit-page]');
            if (!button) return;
            auditPage = Number(button.dataset.auditPage);
            renderAuditLogs();
        });

        renderAuditLogs();
    }

    // ===================== PUBLIC API =====================
    window.addAuditLog = addAuditLog;
    window.POS_APP_LOG = addAuditLog;          // consumed by inventory.js and pos.js
    window.renderAuditLogs = renderAuditLogs;
    window.setupAuditFeatures = setupAuditFeatures;
    window.AUDIT_KEY = AUDIT_KEY;
})();