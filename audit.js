/* audit.js - Audit Trail & System Logs (single-user / owner-only) */
/* Extracted from script.js for modularity, following the same pattern as pos.js. */
(function() {
    // ===================== CONSTANTS =====================
    const AUDIT_KEY = 'pos_audit_logs';
    const DISPLAY_LIMIT = 100; // most-recent logs shown without pagination

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
        const filtered = search
            ? logs.filter(log => `${log.user} ${log.action} ${log.module} ${log.description}`
                .toLowerCase().includes(search))
            : logs;

        const pageLogs = filtered.slice(0, DISPLAY_LIMIT);

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
        // Search box (only live filter)
        document.getElementById('auditSearch')?.addEventListener('input', renderAuditLogs);

        // Export visible logs to CSV
        document.getElementById('exportAuditLogs')?.addEventListener('click', () => {
            const logs = readStoredRecords(AUDIT_KEY);
            downloadCsv(
                `audit_logs_${new Date().toISOString().split('T')[0]}.csv`,
                ['Timestamp', 'User', 'Action', 'Module', 'Description', 'IP Address', 'Severity'],
                logs.map(log => [log.timestamp, log.user, log.action, log.module, log.description, log.ip, log.severity])
            );
            addAuditLog('export', 'audit', 'Audit log exported', 'info');
        });

        // Clear all logs
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

        renderAuditLogs();
    }

    // ===================== PUBLIC API =====================
    window.addAuditLog = addAuditLog;
    window.POS_APP_LOG = addAuditLog;          // consumed by inventory.js and pos.js
    window.renderAuditLogs = renderAuditLogs;
    window.setupAuditFeatures = setupAuditFeatures;
    window.AUDIT_KEY = AUDIT_KEY;
})();