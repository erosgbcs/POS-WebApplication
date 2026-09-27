// firebase.js - Firebase integration replacing supabase.js
(function() {
    const DEFAULT_CONFIG = {
        enabled: true,
        projectId: 'basedpos-inventory',
        profilesTable: 'profiles',
        inventoryTable: 'inventory'
    };

    const state = {
        config: { ...DEFAULT_CONFIG },
        currentUser: null,
        fb: null
    };

    // ---------- FIREBASE INITIALIZATION ----------
    // Resolves once the SDK is loaded and initialized.
    // Every exported function awaits this via getFirebase().
    const firebaseReady = (async () => {
        try {
            if (!window.FIREBASE_CONFIG) {
                console.warn('window.FIREBASE_CONFIG is missing. Firebase cannot initialize.');
                return null;
            }

            const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
const {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    getFirestore
} = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');

const app = initializeApp(window.FIREBASE_CONFIG);

// Initialize Firestore with offline persistence (multi-tab safe).
// Falls back to in-memory cache if IndexedDB is unavailable.
let db;
try {
    db = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultiTabManager()
        })
    });
    console.log('✅ Firestore initialized with offline persistence (multi-tab)');
} catch (err) {
    console.warn('⚠️ Offline persistence unavailable — using default cache:', err?.code || err?.message);
    db = getFirestore(app);
}

state.fb = {
    app,
    db,
    auth: getAuth(app)
};
console.log('✅ Firebase initialized');
return state.fb;
        } catch (error) {
            console.error('❌ Firebase initialization failed:', error);
            return null;
        }
    })();

    // Async helper — waits for Firebase to be ready before returning.
    async function getFirebase() {
        if (state.fb) return state.fb;
        return await firebaseReady;
    }

    function isConfigured() {
        // We can't know synchronously whether Firebase has finished loading.
        // As long as config exists, report true and let async functions handle readiness.
        return Boolean(window.FIREBASE_CONFIG);
    }

    // Supabase-compatible shim so script.js's existing auth calls keep working.
    function getClient() {
        if (!state.fb) return null;
        return {
            auth: {
                resetPasswordForEmail: async (email) => {
                    try {
                        const { sendPasswordResetEmail } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
                        await sendPasswordResetEmail(state.fb.auth, email);
                        return { data: {}, error: null };
                    } catch (error) {
                        return { data: null, error };
                    }
                },
                getUser: async () => {
                    const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
                    return new Promise((resolve) => {
                        const unsub = onAuthStateChanged(state.fb.auth, (user) => {
                            unsub();
                            resolve({ data: { user }, error: null });
                        });
                    });
                }
            }
        };
    }

    // ---------- AUTHENTICATION ----------
    async function signUpUser({ fullName, email, password, role = 'cashier' }) {
        const fb = await getFirebase();
        if (!fb) return { data: null, error: new Error('Firebase is not configured.') };

        try {
            const { createUserWithEmailAndPassword, updateProfile } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
            const userCredential = await createUserWithEmailAndPassword(fb.auth, email, password);
            const user = userCredential.user;

            await updateProfile(user, { displayName: fullName });

            const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
            await setDoc(doc(fb.db, 'profiles', user.uid), {
                id: user.uid,
                email,
                full_name: fullName,
                role,
                created_at: new Date().toISOString()
            });

            return { data: { user }, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    async function signInUser({ email, password }) {
        const fb = await getFirebase();
        if (!fb) return { data: null, error: new Error('Firebase is not configured.') };

        try {
            const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
            const userCredential = await signInWithEmailAndPassword(fb.auth, email, password);
            const user = userCredential.user;

            const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
            const profileDoc = await getDoc(doc(fb.db, 'profiles', user.uid));
            const profile = profileDoc.exists() ? profileDoc.data() : null;

            if (profile) {
                user.role = profile.role;
                user.user_metadata = {
                    ...(user.user_metadata || {}),
                    full_name: profile.full_name,
                    role: profile.role
                };
            }

            state.currentUser = user;
            return { data: { user }, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    async function signOutUser() {
        const fb = await getFirebase();
        if (!fb) return { error: new Error('Firebase is not configured.') };

        try {
            const { signOut: fbSignOut } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
            await fbSignOut(fb.auth);
            state.currentUser = null;
            return { error: null };
        } catch (error) {
            return { error };
        }
    }

    async function getCurrentUser() {
        const fb = await getFirebase();
        if (!fb) return { user: null, error: new Error('Firebase is not configured.') };

        if (state.currentUser) {
            return { user: state.currentUser, error: null };
        }

        try {
            const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');

            return await new Promise((resolve) => {
                const unsubscribe = onAuthStateChanged(fb.auth, async (user) => {
                    unsubscribe();
                    if (!user) {
                        resolve({ user: null, error: null });
                        return;
                    }

                    try {
                        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
                        const profileDoc = await getDoc(doc(fb.db, 'profiles', user.uid));
                        const profile = profileDoc.exists() ? profileDoc.data() : null;

                        if (profile) {
                            user.role = profile.role;
                            user.user_metadata = {
                                ...(user.user_metadata || {}),
                                full_name: profile.full_name,
                                role: profile.role
                            };
                        }

                        state.currentUser = user;
                        resolve({ user, error: null });
                    } catch (error) {
                        resolve({ user, error });
                    }
                });
            });
        } catch (error) {
            return { user: null, error };
        }
    }

    async function resetPassword(email) {
        const fb = await getFirebase();
        if (!fb) return { error: new Error('Firebase is not configured.') };

        try {
            const { sendPasswordResetEmail } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
            await sendPasswordResetEmail(fb.auth, email);
            return { error: null };
        } catch (error) {
            return { error };
        }
    }

    async function getUsers() {
        const fb = await getFirebase();
        if (!fb) return { data: [], error: new Error('Firebase is not configured.') };

        try {
            const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
            const querySnapshot = await getDocs(collection(fb.db, 'profiles'));
            const users = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return { data: users, error: null };
        } catch (error) {
            return { data: [], error };
        }
    }

    async function upsertProfile(profileData) {
        const fb = await getFirebase();
        if (!fb) return { data: null, error: new Error('Firebase is not configured.') };

        try {
            const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
            const id = profileData.id;
            if (!id) return { data: null, error: new Error('Profile id is required') };
            const { id: _omit, ...data } = profileData;
            await setDoc(doc(fb.db, 'profiles', id), data, { merge: true });
            return { data: [profileData], error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    // ---------- INVENTORY MANAGEMENT ----------
   async function getInventoryProducts() {
    const fb = await getFirebase();
    if (!fb) return { data: [], error: new Error('Firebase is not configured.') };
    
    try {
        const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const querySnapshot = await getDocs(collection(fb.db, 'inventory'));
        const products = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Client-side sort — safe against missing created_at
        products.sort((a, b) => {
            const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
            const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
            return bTime - aTime;
        });
        return { data: products, error: null };
    } catch (error) {
        return { data: [], error };
    }
}

    async function getInventoryProduct(productId) {
        const fb = await getFirebase();
        if (!fb) return { data: null, error: new Error('Firebase is not configured.') };

        try {
            const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
            const docSnap = await getDoc(doc(fb.db, 'inventory', String(productId)));
            if (!docSnap.exists()) return { data: null, error: new Error('Product not found') };
            return { data: { id: docSnap.id, ...docSnap.data() }, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    async function addInventoryProduct(productData) {
        const fb = await getFirebase();
        if (!fb) return { data: null, error: new Error('Firebase is not configured.') };

        try {
            const { collection, addDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
            const product = {
                ...productData,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            const docRef = await addDoc(collection(fb.db, 'inventory'), product);
            return { data: [{ id: docRef.id, ...product }], error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    async function updateInventoryProduct(productId, updates) {
        const fb = await getFirebase();
        if (!fb) return { data: null, error: new Error('Firebase is not configured.') };

        try {
            const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
            const updateData = {
                ...updates,
                updated_at: new Date().toISOString()
            };
            await updateDoc(doc(fb.db, 'inventory', String(productId)), updateData);
            return { data: [{ id: productId, ...updateData }], error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    async function deleteInventoryProduct(productId) {
        const fb = await getFirebase();
        if (!fb) return { data: null, error: new Error('Firebase is not configured.') };

        try {
            const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
            await deleteDoc(doc(fb.db, 'inventory', String(productId)));
            return { data: null, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    async function upsertInventoryProduct(productData) {
        const fb = await getFirebase();
        if (!fb) return { data: null, error: new Error('Firebase is not configured.') };

        try {
            const { collection, getDocs, query, where, doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
            const sku = productData.sku;
            if (!sku) return { data: null, error: new Error('Product SKU is required') };

            const q = query(collection(fb.db, 'inventory'), where('sku', '==', sku));
            const snap = await getDocs(q);
            const data = { ...productData, updated_at: new Date().toISOString() };
            delete data.id;

            if (snap.empty) {
                const ref = doc(collection(fb.db, 'inventory'));
                await setDoc(ref, { ...data, created_at: new Date().toISOString() });
                return { data: [{ id: ref.id, ...data }], error: null };
            } else {
                const existingId = snap.docs[0].id;
                await setDoc(doc(fb.db, 'inventory', existingId), data, { merge: true });
                return { data: [{ id: existingId, ...data }], error: null };
            }
        } catch (error) {
            return { data: null, error };
        }
    }

    async function searchInventoryProducts(searchTerm) {
        const { data: products, error } = await getInventoryProducts();
        if (error) return { data: [], error };

        const term = String(searchTerm || '').toLowerCase();
        const filtered = products.filter(p =>
            (p.name || '').toLowerCase().includes(term) ||
            (p.sku || '').toLowerCase().includes(term) ||
            (p.supplier || '').toLowerCase().includes(term)
        );
        return { data: filtered, error: null };
    }

    async function filterInventoryByCategory(category) {
        const { data: products, error } = await getInventoryProducts();
        if (error) return { data: [], error };
        return { data: products.filter(p => p.category === category), error: null };
    }

    async function filterInventoryByStock(minQuantity, maxQuantity) {
        const { data: products, error } = await getInventoryProducts();
        if (error) return { data: [], error };
        return {
            data: products.filter(p => {
                const q = Number(p.quantity) || 0;
                if (minQuantity !== undefined && q < minQuantity) return false;
                if (maxQuantity !== undefined && q > maxQuantity) return false;
                return true;
            }),
            error: null
        };
    }

    async function getInventoryStats() {
        const { data: products, error } = await getInventoryProducts();
        if (error) return { data: null, error };

        const stats = {
            totalProducts: products.length,
            inStock: products.filter(p => p.quantity > (p.min_stock || 0)).length,
            lowStock: products.filter(p => p.quantity > 0 && p.quantity <= (p.min_stock || 0)).length,
            outOfStock: products.filter(p => p.quantity === 0).length,
            totalValue: products.reduce((sum, p) => sum + (p.quantity * (p.price || 0)), 0)
        };
        return { data: stats, error: null };
    }

    async function bulkUpdateInventory(products) {
        const fb = await getFirebase();
        if (!fb) return { data: null, error: new Error('Firebase is not configured.') };

        try {
            const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
            const updates = products.map(p => {
                const { id, ...data } = p;
                return updateDoc(doc(fb.db, 'inventory', String(id)), {
                    ...data,
                    updated_at: new Date().toISOString()
                });
            });
            await Promise.all(updates);
            return { data: products, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    async function getInventoryCategories() {
        const { data: products, error } = await getInventoryProducts();
        if (error) return { data: [], error };
        const categories = [...new Set(products.map(p => p.category).filter(Boolean))];
        return { data: categories.map(c => ({ category: c })), error: null };
    }

    async function getLowStockProducts(threshold) {
        const { data: products, error } = await getInventoryProducts();
        if (error) return { data: [], error };
        return { data: products.filter(p => p.quantity <= threshold && p.quantity > 0), error: null };
    }

    async function getOutOfStockProducts() {
        const { data: products, error } = await getInventoryProducts();
        if (error) return { data: [], error };
        return { data: products.filter(p => p.quantity === 0), error: null };
    }
// ---------- ORDERS ----------
async function addOrder(orderData) {
    const fb = await getFirebase();
    if (!fb) return { data: null, error: new Error('Firebase is not configured.') };
    try {
        const { doc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const id = orderData.id || `ORD-${Date.now()}`;
        const payload = { ...orderData, id, syncedAt: serverTimestamp() };
        await setDoc(doc(fb.db, 'orders', id), payload);
        return { data: [{ ...orderData, id }], error: null };
    } catch (error) {
        return { data: null, error };
    }
}

async function getOrders() {
    const fb = await getFirebase();
    if (!fb) return { data: [], error: new Error('Firebase is not configured.') };
    
    try {
        const { collection, getDocs, limit, query } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const q = query(collection(fb.db, 'orders'), limit(500));
        const snap = await getDocs(q);
        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Client-side sort
        orders.sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bTime - aTime;
        });
        return { data: orders, error: null };
    } catch (error) {
        return { data: [], error };
    }
}

async function deleteOrder(orderId) {
    const fb = await getFirebase();
    if (!fb) return { data: null, error: new Error('Firebase is not configured.') };
    try {
        const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        await deleteDoc(doc(fb.db, 'orders', String(orderId)));
        return { data: null, error: null };
    } catch (error) {
        return { data: null, error };
    }
}

function subscribeOrders(callback) {
    let unsubscribe = () => {};
    (async () => {
        const fb = await getFirebase();
        if (!fb) return;
        const { collection, onSnapshot, limit, query } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const q = query(collection(fb.db, 'orders'), limit(500));
        unsubscribe = onSnapshot(q, snap => {
            const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            orders.sort((a, b) => {
                const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return bTime - aTime;
            });
            callback(orders);
        }, err => console.warn('Orders subscription error:', err.message));
    })();
    return () => unsubscribe();
}

// ---------- CUSTOMERS ----------
async function getCustomers() {
    const fb = await getFirebase();
    if (!fb) return { data: [], error: new Error('Firebase is not configured.') };
    try {
        const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const snap = await getDocs(collection(fb.db, 'customers'));
        const customers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        customers.sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bTime - aTime;
        });
        return { data: customers, error: null };
    } catch (error) {
        return { data: [], error };
    }
}

async function addCustomer(customerData) {
    const fb = await getFirebase();
    if (!fb) return { data: null, error: new Error('Firebase is not configured.') };
    try {
        const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const payload = {
            ...customerData,
            orders: customerData.orders ?? 0,
            totalSpent: customerData.totalSpent ?? 0,
            createdAt: customerData.createdAt || new Date().toISOString(),
            syncedAt: serverTimestamp()
        };
        const ref = await addDoc(collection(fb.db, 'customers'), payload);
        return { data: [{ id: ref.id, ...payload }], error: null };
    } catch (error) {
        return { data: null, error };
    }
}

async function updateCustomer(customerId, updates) {
    const fb = await getFirebase();
    if (!fb) return { data: null, error: new Error('Firebase is not configured.') };
    try {
        const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        await updateDoc(doc(fb.db, 'customers', String(customerId)), updates);
        return { data: [{ id: customerId, ...updates }], error: null };
    } catch (error) {
        return { data: null, error };
    }
}

async function deleteCustomer(customerId) {
    const fb = await getFirebase();
    if (!fb) return { data: null, error: new Error('Firebase is not configured.') };
    try {
        const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        await deleteDoc(doc(fb.db, 'customers', String(customerId)));
        return { data: null, error: null };
    } catch (error) {
        return { data: null, error };
    }
}

function subscribeCustomers(callback) {
    let unsubscribe = () => {};
    (async () => {
        const fb = await getFirebase();
        if (!fb) return;
        const { collection, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        unsubscribe = onSnapshot(collection(fb.db, 'customers'), snap => {
            const customers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            customers.sort((a, b) => {
                const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return bTime - aTime;
            });
            callback(customers);
        }, err => console.warn('Customers subscription error:', err.message));
    })();
    return () => unsubscribe();
}

// ---------- AUDIT LOGS ----------
async function addAuditLog(logData) {
    const fb = await getFirebase();
    if (!fb) return { data: null, error: new Error('Firebase is not configured.') };
    try {
        const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const payload = {
            timestamp: logData.timestamp || new Date().toISOString(),
            user: logData.user || 'Unknown',
            action: logData.action || 'info',
            module: logData.module || 'system',
            description: logData.description || '',
            ip: logData.ip || 'Client',
            severity: logData.severity || 'info',
            syncedAt: serverTimestamp()
        };
        const ref = await addDoc(collection(fb.db, 'audit_logs'), payload);
        return { data: [{ id: ref.id, ...payload }], error: null };
    } catch (error) {
        return { data: null, error };
    }
}

async function getAuditLogs(maxRecords = 500) {
    const fb = await getFirebase();
    if (!fb) return { data: [], error: new Error('Firebase is not configured.') };
    try {
        const { collection, getDocs, limit, query } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const q = query(collection(fb.db, 'audit_logs'), limit(maxRecords));
        const snap = await getDocs(q);
        const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        logs.sort((a, b) => {
            const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return bTime - aTime;
        });
        return { data: logs, error: null };
    } catch (error) {
        return { data: [], error };
    }
}

async function clearAuditLogs() {
    const fb = await getFirebase();
    if (!fb) return { data: null, error: new Error('Firebase is not configured.') };
    try {
        const { collection, getDocs, doc, deleteDoc, writeBatch } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const snap = await getDocs(collection(fb.db, 'audit_logs'));
        const batches = [];
        let batch = writeBatch(fb.db);
        let count = 0;
        for (const d of snap.docs) {
            batch.delete(doc(fb.db, 'audit_logs', d.id));
            count++;
            if (count === 400) {
                batches.push(batch.commit());
                batch = writeBatch(fb.db);
                count = 0;
            }
        }
        if (count > 0) batches.push(batch.commit());
        await Promise.all(batches);
        return { data: null, error: null };
    } catch (error) {
        return { data: null, error };
    }
}

function subscribeAuditLogs(callback) {
    let unsubscribe = () => {};
    (async () => {
        const fb = await getFirebase();
        if (!fb) return;
        const { collection, onSnapshot, limit, query } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const q = query(collection(fb.db, 'audit_logs'), limit(500));
        unsubscribe = onSnapshot(q, snap => {
            const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            logs.sort((a, b) => {
                const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return bTime - aTime;
            });
            callback(logs);
        }, err => console.warn('Audit subscription error:', err.message));
    })();
    return () => unsubscribe();
}

// ---------- CONFIG (Settings & Categories) ----------
async function getSettings() {
    const fb = await getFirebase();
    if (!fb) return { data: null, error: new Error('Firebase is not configured.') };
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const snap = await getDoc(doc(fb.db, 'config', 'settings'));
        return { data: snap.exists() ? snap.data() : null, error: null };
    } catch (error) {
        return { data: null, error };
    }
}

async function saveSettings(settings) {
    const fb = await getFirebase();
    if (!fb) return { data: null, error: new Error('Firebase is not configured.') };
    try {
        const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        await setDoc(doc(fb.db, 'config', 'settings'), settings, { merge: true });
        return { data: settings, error: null };
    } catch (error) {
        return { data: null, error };
    }
}

async function getCategories() {
    const fb = await getFirebase();
    if (!fb) return { data: null, error: new Error('Firebase is not configured.') };
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const snap = await getDoc(doc(fb.db, 'config', 'categories'));
        return { data: snap.exists() ? snap.data().list : null, error: null };
    } catch (error) {
        return { data: null, error };
    }
}

async function saveCategories(list) {
    const fb = await getFirebase();
    if (!fb) return { data: null, error: new Error('Firebase is not configured.') };
    try {
        const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        await setDoc(doc(fb.db, 'config', 'categories'), { list }, { merge: true });
        return { data: list, error: null };
    } catch (error) {
        return { data: null, error };
    }
}

// ---------- REALTIME INVENTORY ----------
function subscribeInventory(callback) {
    let unsubscribe = () => {};
    (async () => {
        const fb = await getFirebase();
        if (!fb) return;
        const { collection, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        unsubscribe = onSnapshot(collection(fb.db, 'inventory'), snap => {
            const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            products.sort((a, b) => {
                const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
                const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
                return bTime - aTime;
            });
            callback(products);
        }, err => console.warn('Inventory subscription error:', err.message));
    })();
    return () => unsubscribe();
}
    // ---------- EXPORT ----------
    window.POS_FIREBASE = {
        DEFAULT_CONFIG,
        config: state.config,
        isConfigured,
        getClient,
        getFirebase,
        // Auth
        signUpUser,
        signInUser,
        signOut: signOutUser,
        getCurrentUser,
        resetPassword,
        getUsers,
        upsertProfile,
        // Inventory
        getInventoryProducts,
        getInventoryProduct,
        addInventoryProduct,
        updateInventoryProduct,
        deleteInventoryProduct,
        upsertInventoryProduct,
        searchInventoryProducts,
        filterInventoryByCategory,
        filterInventoryByStock,
        getInventoryStats,
        bulkUpdateInventory,
        getInventoryCategories,
        getLowStockProducts,
        getOutOfStockProducts,
        subscribeInventory,
        // Orders (NEW)
        addOrder,
        getOrders,
        deleteOrder,
        subscribeOrders,
        // Customers (NEW)
        getCustomers,
        addCustomer,
        updateCustomer,
        deleteCustomer,
        subscribeCustomers,
        // Audit Logs (NEW)
        addAuditLog,
        getAuditLogs,
        clearAuditLogs,
        subscribeAuditLogs,
        // Config (NEW)
        getSettings,
        saveSettings,
        getCategories,
        saveCategories
    };
    
    // Alias for backward compatibility
    window.POS_SUPABASE = window.POS_FIREBASE;
    })();