/* auth.js — Authentication: sign in, forgot password, sign out, admin user creation */
(function () {
    'use strict';

    // ---------- BACKEND BRIDGE ----------
    const supabaseApi = window.POS_SUPABASE || {};

    const authMode = { local: 'local', supabase: 'supabase' };

    function isSupabaseReady() {
        return !!(supabaseApi && typeof supabaseApi.isConfigured === 'function' && supabaseApi.isConfigured());
    }

    function getAuthMode() {
        return isSupabaseReady() ? authMode.supabase : authMode.local;
    }

    async function signInWithSupabase(email, password) {
        if (!isSupabaseReady()) return { data: null, error: new Error('Backend is not configured.') };
        return supabaseApi.signInUser({ email, password });
    }

    async function signUpWithSupabase({ fullName, email, password, role }) {
        if (!isSupabaseReady()) return { data: null, error: new Error('Backend is not configured.') };
        return supabaseApi.signUpUser({ fullName, email, password, role });
    }

    async function resetPasswordWithSupabase(email) {
        if (!isSupabaseReady()) return { data: null, error: new Error('Backend is not configured.') };
        return supabaseApi.getClient().auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin || window.location.href
        });
    }

    async function signOutWithSupabase() {
        if (!isSupabaseReady()) return { error: new Error('Backend is not configured.') };
        return supabaseApi.signOut();
    }

    async function getCurrentUserFromBackend() {
        if (!isSupabaseReady()) return { user: null, error: new Error('Backend is not configured.') };
        return supabaseApi.getCurrentUser();
    }

    // ---------- LOCAL USER STORE (fallback when Firebase isn't set up) ----------
    const USERS_KEY = 'pos_users_pro_v2';
    const ADMIN_CREATED_KEY = 'pos_admin_account_created';
    const ADMIN_COUNT_KEY = 'pos_admin_account_count';
    const MAX_ADMIN_ACCOUNTS = 2;

    function getUsers() {
        try {
            const stored = localStorage.getItem(USERS_KEY);
            if (stored) {
                const users = JSON.parse(stored);
                return Array.isArray(users) ? users : [];
            }
        } catch (e) { console.error('Error reading users:', e); }
        return [];
    }

    function saveUsers(users) {
        try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }
        catch (e) { console.error('Error saving users:', e); }
    }

    function findUserByEmail(email) {
        return getUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
    }

    function addUser(user) {
        const users = getUsers();
        users.push(user);
        saveUsers(users);
    }

    function getAdminAccountCount() {
        const localAdminCount = getUsers().filter(user => user.role === 'admin').length;
        const storedAdminCount = Number.parseInt(localStorage.getItem(ADMIN_COUNT_KEY), 10);
        const legacyAdminCount = localStorage.getItem(ADMIN_CREATED_KEY) === 'true' ? 1 : 0;
        return Math.max(localAdminCount, Number.isNaN(storedAdminCount) ? legacyAdminCount : storedAdminCount);
    }

    async function refreshAdminAvailability() {
        if (!isSupabaseReady()) return;
        const { data, error } = await supabaseApi.getUsers();
        if (error) {
            console.warn('Unable to check existing admin accounts:', error.message);
            return;
        }
        if (Array.isArray(data)) {
            const adminCount = data.filter(user => user.role === 'admin').length;
            localStorage.setItem(ADMIN_COUNT_KEY, String(adminCount));
            if (adminCount > 0) localStorage.setItem(ADMIN_CREATED_KEY, 'true');
        }
    }

    // ---------- HELPERS ----------
    function validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function setError(id, msg) {
        const errorEl = document.getElementById(id);
        if (errorEl) {
            errorEl.textContent = msg;
            if (window.innerWidth < 768 && msg) {
                errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    function clearErrors() {
        document.querySelectorAll('.error-message, .info-message').forEach(el => el.textContent = '');
    }

    function toast(message, type) {
        if (typeof window.showToast === 'function') window.showToast(message, type);
        else console.log(`[toast:${type || 'success'}]`, message);
    }

    // ---------- PUBLIC API: INIT ----------
    function initAuth() {
        const signinForm = document.getElementById('signinForm');
        const forgotForm = document.getElementById('forgotForm');
        const forgotLink = document.getElementById('forgotLink');
        const backToSigninFromForgot = document.getElementById('backToSigninFromForgot');

        // --- Forgot-password view routing ---
        if (forgotLink) {
            forgotLink.addEventListener('click', () => {
                window.showView?.(document.getElementById('forgotView'));
                setTimeout(() => document.getElementById('forgotEmail')?.focus(), 100);
            });
        }

        if (backToSigninFromForgot) {
            backToSigninFromForgot.addEventListener('click', () => {
                window.showView?.(document.getElementById('signinView'));
                window.updateSystemStatus?.();
            });
        }

        // --- Sign in ---
        if (signinForm) {
            signinForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                clearErrors();

                const email = document.getElementById('signinEmail')?.value.trim() || '';
                const password = document.getElementById('signinPassword')?.value || '';
                let valid = true;

                if (!email) { setError('signinEmailError', 'Email is required'); valid = false; }
                else if (!validateEmail(email)) { setError('signinEmailError', 'Invalid email format'); valid = false; }
                if (!password) { setError('signinPasswordError', 'Password is required'); valid = false; }
                else if (password.length < 6) { setError('signinPasswordError', 'Minimum 6 characters'); valid = false; }

                if (!valid) return;

                const btn = document.getElementById('signinSubmitBtn');
                if (btn) { btn.classList.add('loading'); btn.disabled = true; }

                try {
                    if (getAuthMode() === authMode.supabase) {
                        const { data, error } = await signInWithSupabase(email, password);
                        if (error) throw error;

                        if (data?.user) {
                            window.loadDashboard?.(data.user);
                            window.POS_APP_LOG?.(
                                'login', 'auth',
                                `${data.user.user_metadata?.full_name || data.user.email} signed in`,
                                'info'
                            );
                            document.getElementById('userDropdownMenu')?.classList.remove('show');
                        }
                        return;
                    }

                    // Local mode
                    await new Promise(r => setTimeout(r, 800));
                    const user = findUserByEmail(email);
                    if (user && user.password === password) {
                        toast(`Welcome back, ${user.name}!`, 'success');
                        window.loadDashboard?.({
                            email: user.email,
                            role: user.role,
                            user_metadata: { full_name: user.name, role: user.role }
                        });
                        window.POS_APP_LOG?.('login', 'auth', `${user.name} signed in`, 'info');
                    } else if (user) {
                        toast('Incorrect password.', 'error');
                    } else {
                        toast('No account found with this email.', 'error');
                    }
                } catch (error) {
                    toast(error?.message || 'Unable to sign in.', 'error');
                } finally {
                    if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
                }
            });
        }

        // --- Forgot password ---
        if (forgotForm) {
            forgotForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                clearErrors();

                const email = document.getElementById('forgotEmail')?.value.trim() || '';
                let valid = true;

                if (!email) { setError('forgotEmailError', 'Email is required'); valid = false; }
                else if (!validateEmail(email)) { setError('forgotEmailError', 'Invalid email format'); valid = false; }

                if (!valid) return;

                const btn = document.getElementById('forgotSubmitBtn');
                if (btn) { btn.classList.add('loading'); btn.disabled = true; }

                try {
                    if (getAuthMode() === authMode.supabase) {
                        const { error } = await resetPasswordWithSupabase(email);
                        if (error) throw error;

                        const infoBox = document.getElementById('forgotInfoBox');
                        const infoText = document.getElementById('forgotInfoText');
                        if (infoBox) { infoBox.style.display = 'flex'; infoBox.className = 'alert-box success'; }
                        if (infoText) infoText.textContent = `Reset link sent to ${email}. Check your inbox.`;
                        toast('Password reset link sent!', 'success');
                        return;
                    }

                    // Local mode
                    await new Promise(r => setTimeout(r, 800));
                    const user = findUserByEmail(email);
                    const infoBox = document.getElementById('forgotInfoBox');
                    const infoText = document.getElementById('forgotInfoText');

                    if (infoBox) {
                        infoBox.style.display = 'flex';
                        infoBox.className = user ? 'alert-box success' : 'alert-box error';
                    }
                    if (infoText) {
                        infoText.textContent = user
                            ? `Reset link sent to ${user.email}. Check your inbox.`
                            : `No account found with ${email}.`;
                    }
                    toast(user ? 'Password reset link sent!' : 'No account found with this email',
                          user ? 'success' : 'error');
                } catch (error) {
                    const infoBox = document.getElementById('forgotInfoBox');
                    const infoText = document.getElementById('forgotInfoText');
                    if (infoBox) { infoBox.style.display = 'flex'; infoBox.className = 'alert-box error'; }
                    if (infoText) infoText.textContent = error?.message || 'Unable to reset password.';
                    toast(error?.message || 'Unable to reset password.', 'error');
                } finally {
                    if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
                }
            });
        }

        // --- Logout ---
        async function logout() {
            try {
                const user = window.POS_CURRENT_USER;
                const name = user?.user_metadata?.full_name || user?.email || 'Unknown user';
                window.POS_APP_LOG?.('logout', 'auth', `${name} signed out`, 'info');

                if (window._posUnsubscribers) {
                    window._posUnsubscribers.forEach(fn => { try { fn(); } catch (e) {} });
                    window._posUnsubscribers = null;
                }
                if (getAuthMode() === authMode.supabase) {
                    const { error } = await signOutWithSupabase();
                    if (error) throw error;
                }
                window.showLoginView?.();
                toast('Logged out successfully', 'success');
                document.getElementById('userDropdownMenu')?.classList.remove('show');
            } catch (error) {
                toast(error?.message || 'Error logging out', 'error');
            }
        }

        document.getElementById('logoutBtn')?.addEventListener('click', logout);
        document.getElementById('sidebarLogoutBtn')?.addEventListener('click', logout);

        // --- Check auth status on load ---
        checkAuth();

        // --- Admin availability sync (used by the User Management page) ---
        refreshAdminAvailability();
    }

    // ---------- AUTH CHECK ----------
    async function checkAuth() {
        if (getAuthMode() === authMode.supabase) {
            try {
                const { user } = await getCurrentUserFromBackend();
                if (user) { window.loadDashboard?.(user); return; }
            } catch (err) {
                console.warn('checkAuth: getCurrentUser failed, falling back to cache', err);
            }
        }

        const cached = localStorage.getItem('pos_current_user');
        if (cached) {
            try {
                const user = JSON.parse(cached);
                if (getAuthMode() !== authMode.supabase && user?.email) {
                    const stored = findUserByEmail(user.email);
                    if (stored) {
                        user.role = stored.role;
                        user.user_metadata = { ...(user.user_metadata || {}), role: stored.role };
                    }
                }
                window.loadDashboard?.(user);
                return;
            } catch (e) {
                localStorage.removeItem('pos_current_user');
            }
        }

        window.showLoginView?.();
    }

    // ---------- ADMIN: CREATE USER FROM DASHBOARD ----------
    async function renderUsers(snapshotUsers = null) {
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;

        let users = snapshotUsers;
        if (!Array.isArray(users)) {
            if (!window.POS_SUPABASE?.getUsers) return;
            const { data, error } = await window.POS_SUPABASE.getUsers();
            if (error) {
                tbody.innerHTML = `
                    <tr><td colspan="4" style="text-align:center;padding:2rem;color:#f87171;">
                        <i class="fas fa-exclamation-triangle"></i> ${String(error.message || 'Failed to load users')}
                    </td></tr>`;
                return;
            }
            users = data || [];
        }

        const adminCount = users.filter(u => (u.role || '').toLowerCase() === 'admin').length;
        const cashierCount = users.filter(u => (u.role || '').toLowerCase() === 'cashier').length;
        const totalEl = document.getElementById('usersTotalCount');
        const adminEl = document.getElementById('usersAdminCount');
        const cashierEl = document.getElementById('usersCashierCount');
        if (totalEl) totalEl.textContent = users.length;
        if (adminEl) adminEl.textContent = adminCount;
        if (cashierEl) cashierEl.textContent = cashierCount;

        const adminOption = document.getElementById('newUserAdminOption');
        if (adminOption) {
            const limitReached = adminCount >= MAX_ADMIN_ACCOUNTS;
            adminOption.disabled = limitReached;
            adminOption.textContent = limitReached
                ? `Admin (limit reached — max ${MAX_ADMIN_ACCOUNTS})`
                : 'Admin';
        }

        if (users.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="4" style="text-align:center;padding:3rem;color:var(--text-secondary);">
                    <i class="fas fa-users" style="font-size:2rem;opacity:0.4;display:block;margin-bottom:8px;"></i>
                    No users found
                </td></tr>`;
            return;
        }

        users.sort((a, b) => {
            const aRole = (a.role || '').toLowerCase();
            const bRole = (b.role || '').toLowerCase();
            if (aRole !== bRole) return aRole === 'admin' ? -1 : 1;
            return String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || ''));
        });

        const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

        tbody.innerHTML = users.map(u => {
            const name = u.full_name || u.email || 'Unknown';
            const email = u.email || '—';
            const role = (u.role || 'cashier').toLowerCase();
            const roleBadge = role === 'admin'
                ? '<span class="stock-badge in-stock"><i class="fas fa-user-shield"></i> Admin</span>'
                : '<span class="stock-badge" style="background:rgba(168,85,247,0.12);color:#c084fc;border:1px solid rgba(168,85,247,0.2);"><i class="fas fa-user"></i> Cashier</span>';
            const created = u.created_at
                ? new Date(u.created_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
                : '—';
            const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4F46E5&color=fff`;
            return `<tr>
                <td>
                    <div class="product-info">
                        <img src="${avatar}" alt="" width="32" height="32" style="border-radius:50%;">
                        <div class="product-details">
                            <p class="product-name">${esc(name)}</p>
                        </div>
                    </div>
                </td>
                <td>${esc(email)}</td>
                <td>${roleBadge}</td>
                <td>${esc(created)}</td>
            </tr>`;
        }).join('');
    }

    function openUserModal() {
        const modal = document.getElementById('userModal');
        const form = document.getElementById('userForm');
        if (!modal || !form) return;

        form.reset();

        const reauthGroup = document.getElementById('adminReauthGroup');
        const reauthInput = document.getElementById('adminReauthPassword');
        const useFirebase = isSupabaseReady();
        if (reauthGroup) reauthGroup.style.display = useFirebase ? '' : 'none';
        if (reauthInput) { reauthInput.required = useFirebase; reauthInput.value = ''; }

        renderUsers().catch(() => {});
        modal.classList.add('active');
    }

    function closeUserModal() {
        document.getElementById('userModal')?.classList.remove('active');
        document.getElementById('userForm')?.reset();
    }

    async function createUserFromDashboard(event) {
        event.preventDefault();

        const name = document.getElementById('newUserFullName')?.value.trim() || '';
        const email = document.getElementById('newUserEmail')?.value.trim() || '';
        const password = document.getElementById('newUserPassword')?.value || '';
        const role = document.getElementById('newUserRole')?.value || 'cashier';
        const adminPassword = document.getElementById('adminReauthPassword')?.value || '';

        if (!name) { toast('Full name is required', 'error'); return; }
        if (!email || !validateEmail(email)) { toast('A valid email is required', 'error'); return; }
        if (password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }

        if (role === 'admin' && getAdminAccountCount() >= MAX_ADMIN_ACCOUNTS) {
            toast(`Maximum of ${MAX_ADMIN_ACCOUNTS} admin accounts reached. Create a Cashier instead.`, 'error');
            return;
        }

        const btn = document.getElementById('saveUserBtn');
        const originalHtml = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...'; }

        try {
            if (isSupabaseReady()) {
                if (!adminPassword) { toast('Please enter your admin password to continue.', 'error'); return; }

                const adminEmail = window.POS_CURRENT_USER?.email;
                if (!adminEmail) throw new Error('Admin session not found.');

                const { error: createError } = await signUpWithSupabase({ fullName: name, email, password, role });
                if (createError) throw createError;

                await supabaseApi.signOut();

                const { data: signInData, error: signInError } = await supabaseApi.signInUser({
                    email: adminEmail,
                    password: adminPassword
                });
                if (signInError) {
                    localStorage.removeItem('pos_current_user');
                    window.showLoginView?.();
                    throw new Error('Account created, but your session could not be restored. Please sign in again.');
                }

                if (signInData?.user) {
                    window.POS_CURRENT_USER = signInData.user;
                }

                if (role === 'admin') refreshAdminAvailability();
                window.POS_APP_LOG?.('create', 'auth', `User ${name} (${role}) created by admin`, 'info');
                toast(`User ${name} created successfully`, 'success');
            } else {
                if (findUserByEmail(email)) { toast('An account with that email already exists.', 'error'); return; }
                addUser({ name, email, password, role });
                if (role === 'admin') localStorage.setItem(ADMIN_CREATED_KEY, 'true');
                window.updateSystemStatus?.();
                toast(`User ${name} created successfully`, 'success');
            }

            closeUserModal();
            await renderUsers();
        } catch (err) {
            toast(err?.message || 'Failed to create user', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml || '<i class="fas fa-user-plus"></i> Create User';
            }
        }
    }

    function setupUserManagement() {
        document.getElementById('addUserBtn')?.addEventListener('click', openUserModal);
        document.getElementById('closeUserModal')?.addEventListener('click', closeUserModal);
        document.getElementById('cancelUserBtn')?.addEventListener('click', closeUserModal);
        document.getElementById('userForm')?.addEventListener('submit', createUserFromDashboard);
        document.getElementById('refreshUsersBtn')?.addEventListener('click', () => renderUsers());

        document.getElementById('userModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'userModal') closeUserModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('userModal')?.classList.contains('active')) {
                closeUserModal();
            }
        });
    }

    // ---------- EXPORTS ----------
    window.AUTH = {
        isSupabaseReady,
        getAuthMode,
        signInWithSupabase,
        signUpWithSupabase,
        resetPasswordWithSupabase,
        signOutWithSupabase,
        getCurrentUserFromBackend,
        getUsers,
        saveUsers,
        findUserByEmail,
        addUser,
        getAdminAccountCount,
        refreshAdminAvailability,
        validateEmail,
        setError,
        clearErrors,
        MAX_ADMIN_ACCOUNTS,
        ADMIN_CREATED_KEY,
        initAuth,
        checkAuth,
        renderUsers,
        openUserModal,
        closeUserModal,
        createUserFromDashboard,
        setupUserManagement
    };

    // Backward-compat: some modules already reference these globals.
    window.renderUsers = renderUsers;
    window.refreshAdminAvailability = refreshAdminAvailability;
    window.getAdminAccountCount = getAdminAccountCount;
    window.MAX_ADMIN_ACCOUNTS = MAX_ADMIN_ACCOUNTS;
    window.ADMIN_CREATED_KEY = ADMIN_CREATED_KEY;
    window.findUserByEmail = findUserByEmail;
})();