

# POS & Inventory Management System

A lightweight, single-store Point of Sale (POS) and Inventory Management web application built for **Kirby's Hardware**. It runs in the browser with Firebase for authentication and shared data, plus local caches and a durable same-browser queue for sales awaiting sync.

![Status](https://img.shields.io/badge/status-active-brightgreen)
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-ISC-lightgrey)

---

## ✨ Features

### 🔐 Authentication & Authorization
- Firebase Authentication (Email/Password)
- Role-based access control (Admin / Cashier)
- Admin approval required before new accounts can sign in
- Approval UI limits the store to 2 admin accounts
- Forgot password with email reset link
- Session persistence via Firebase Auth

### 🛒 Point of Sale (POS)
- Searchable product catalog with category icons
- Size variant support per product (e.g., S/M/L, 8oz/16oz)
- Optional stock tracking for each size
- Live cart with quantity adjustment
- Automatic subtotal, tax (8%), and total computation
- Cash and GCash payment methods
- Change calculation for cash payments
- Printable receipt with store details
- Atomic Firestore order creation and stock decrement
- Offline sale queue with retry after reconnect

### 📦 Inventory Management
- Full CRUD (Create, Read, Update, Delete) for products
- Per-size stock breakdown, low-stock status, and CSV export
- Searchable, filterable product table with pagination
- Stock badges: In Stock / Low Stock / Out of Stock / Over Stocked
- **Custom categories** with inline add (no code edits needed)
- Bulk quantity updates
- CSV export

### 📊 Analytics Dashboard
- Live KPI cards: Today's Sales, Orders, Products in Stock, Customers
- Sales — Last 7 Days (line chart)
- Top 5 Products — Last 30 Days (horizontal bar)
- Sales by Category (donut chart)
- Hourly Sales Heatmap (day × hour grid)
- Low Stock Alerts widget
- Live Recent Activity feed (from audit log)

### 📋 Orders & Customers
- Order history with filter by status and date
- Customer records auto-created on sale
- Manual customer add
- Per-customer lifetime totals (orders + spend)

### 🛡️ Audit Trail
- Logs every meaningful action (create / update / delete / login / logout / export)
- Filter by action, module, date
- Search by user / description
- CSV export
- Severity levels: info, warning, critical, error

### 🎨 User Experience
- Dark / Light theme toggle
- Fully responsive (desktop → tablet → mobile)
- Glassmorphism UI with smooth animations
- Toast notifications
- Keyboard-accessible components

---

## 🧰 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Markup** | HTML5 |
| **Styling** | Vanilla CSS + Tailwind CSS (minimal) |
| **Fonts** | Inter (Google Fonts) |
| **Icons** | Font Awesome 6.5 |
| **Charts** | Chart.js 4.4 |
| **Backend** | Firebase 10.12 (Auth + Firestore) |
| **Offline** | Firestore IndexedDB persistence and a local pending-sale queue |
| **Local Storage** | Browser caches for orders, customers, audit, settings, and pending sales |
| **Build** | Tailwind CLI |

---

## 📁 Project Structure

```

POS-WebApplication/
├── index.html              # Main entry — all views & modals
├── style.css               # Full custom stylesheet (themes, layout)
├── tailwind.css            # Compiled Tailwind output
├── firebase.js             # Firebase wrapper (auth, Firestore, offline)
├── inventory.js            # Inventory CRUD + custom categories
├── overview.js             # Overview KPIs, charts, and activity widgets
├── script.js               # Auth, dashboard, navigation, and page logic
├── pos.js                  # POS cart, checkout, receipt
├── firestore.rules         # Firestore account approval and access rules
├── qa-checklist.html       # Manual POS and inventory verification checklist
├── package.json            # Tailwind build scripts
├── package-lock.json       # Dependency lock
├── bg.jpg                  # Background image
├── assets/
│   └── logo.png            # Client logo
└── src/
└── input.css           # Tailwind source

```

---

## 🚀 Getting Started

### Prerequisites
- A modern browser (Chrome, Edge, Firefox, Safari)
- A Firebase project ([create one free](https://console.firebase.google.com/))
- Node.js 18+ (only for Tailwind build)

### 1. Clone the Repository
```bash
git clone https://github.com/Feitan982/POS-WebApplication.git
cd POS-WebApplication
```

2. Configure Firebase (optional for local UI testing)

This `test` branch intentionally sets `window.FIREBASE_CONFIG = null` in `index.html`, so it does not connect to Firestore or Firebase Authentication. Keep it null for no-cloud testing. If backend testing is needed, create a separate Firebase project and use only that project's web configuration here; never use the production/main project's configuration.

Create a new Firebase project and grab your web config from:
Firebase Console → Project Settings → General → Your apps → Web app

For an isolated test project only, place that test project's configuration in the script block near the bottom of `index.html`:

```html
<script>
    window.FIREBASE_CONFIG = {
        apiKey: "YOUR_API_KEY",
        authDomain: "YOUR_PROJECT.firebaseapp.com",
        projectId: "YOUR_PROJECT_ID",
        storageBucket: "YOUR_PROJECT.appspot.com",
        messagingSenderId: "YOUR_SENDER_ID",
        appId: "YOUR_APP_ID",
        measurementId: "YOUR_MEASUREMENT_ID"
    };
</script>
```

3. Enable Firebase Services

Authentication:

1. Firebase Console → Authentication → Sign-in method
2. Enable Email/Password

Firestore Database:

1. Firebase Console → Firestore Database
2. Click Create database → Production mode
3. Deploy this repository's rules before opening the app to users:

```bash
firebase deploy --only firestore:rules --project YOUR_PROJECT_ID
```

The rules allow approved profiles to access app data and allow a pending user to read only their own request. Existing profiles without a `status` field remain approved for migration compatibility. New public signups are always created as pending; their selected role is only a request.

For a new project, provision the first administrator through Firebase Console using a trusted process: create the Auth user, then create `profiles/{AUTH_UID}` with matching `id`, `email`, `full_name`, `role: "admin"`, and `status: "approved"`. Do not use public signup to bootstrap the first admin, because self-created requests cannot approve themselves. The approval UI caps admin grants at two; role/status changes are restricted by Firestore rules to existing admins.

4. Build Tailwind (optional — only if you edit src/input.css)

```bash
npm install
npm run build:styles
```

5. Run the App

Open index.html in your browser — or serve it via any static server:

```bash
# Option A: Python
python -m http.server 8000

# Option B: Node
npx serve
```

Then visit http://localhost:8000.

---

## First Admin Setup

Provision the first Admin through Firebase Console as described in the Firebase setup above. Self-service signup only creates a pending request; no one can approve their own account. Firestore rules must be deployed before enabling public signup.

---

## Data Model

The app uses Firestore for shared data and localStorage for fast UI caches and the same-browser pending-sale queue.

See the [logical and physical ERD](docs/erd.md) for entity relationships and Firestore document structure.

### Firestore Collections

| Collection | Purpose | Key fields |
| --- | --- | --- |
| `profiles` | User accounts and roles | `email`, `full_name`, `role`, `requested_role`, `status`, `created_at` |
| `inventory` | Product catalog and stock | `name`, `sku`, `price`, `quantity`, `size`, optional `sizeStocks`, `min_stock` |
| `orders` | Completed sales | receipt ID, items, totals, payment method, status |
| `customers` | Customer records and totals | name, phone, order count, total spent |
| `audit_logs` | Activity history | user, action, module, timestamp |
| `config` | Store settings and categories | settings document and category list |

For products with size-level tracking, `sizeStocks` maps each size label to its available quantity. The product-level `quantity` is the sum of those values. Existing products without `sizeStocks` continue using their shared quantity.

### Local Storage

| Key | Purpose |
| --- | --- |
| `pos_orders` | Local order cache, including sales awaiting sync |
| `pos_order_queue` | Durable same-browser queue of sales not yet committed to Firestore |
| `pos_order_queue_error` | Most recent pending-sale sync error shown in the offline banner |
| `pos_customers` | Local customer cache |
| `pos_audit_logs` | Local audit cache |
| `pos_categories` | Custom category names |
| `pos_settings` | Store preferences |
| `pos_theme` | Theme preference |
| `pos_current_user` | Local session fallback |

### Offline behavior

- Firestore is the shared source of truth when online. A sale writes its order and stock changes in one transaction.
- If that transaction fails, the sale is kept in `pos_order_queue` and retried after reconnect or the next sign-in.
- Pending sales are stored only in that browser until sync succeeds; clearing browser storage before sync can lose the local queue.
- If stock changed while a sale was offline, the sale remains pending and the banner reports the sync error for manual review.

---

## Firebase Read/Write Cost Profile

Usage depends on collection sizes, active clients, and how often records change. The UI reuses listener snapshots for rendering rather than fetching the same collections again for each refresh.

| Action | Firestore activity |
| --- | --- |
| Sign in | Reads the signed-in user's profile |
| Start a dashboard session | Initial snapshots read matching order, customer, inventory, and audit documents; listeners then receive changed documents |
| Complete a sale online | A transaction reads the receipt and affected inventory documents, then writes the order and changed inventory documents; named customers and audit logging can add reads/writes |
| Complete a sale offline | Queues locally; transaction reads/writes occur when the queue retries |
| Add or edit a product | Writes the affected inventory document |

Firestore transactions and listeners are billable. Check the Firebase Console for actual usage; do not assume the project will remain within the Spark quota, especially with multiple signed-in terminals or large collections.

---

🧪 Testing Checklist

After setup, verify:

☐ Sign up as admin → lands on dashboard
☐ Sign out → returns to login
☐ Sign in → session persists across refresh
☐ Create a product with a custom category
☐ Create a variant product with separate counts per size
☐ Sell one size and verify only that size's stock decreases
☐ Complete a cash sale → receipt prints with ₱ symbol
☐ Complete a GCash sale → receipt shows "Payment: GCash"
☐ Complete a sale while offline → queue appears, then syncs after reconnect
☐ Retry a queued sale → verify the order and stock are not duplicated
☐ Dashboard charts update after sale
☐ Low Stock widget reflects inventory
☐ Theme toggle re-colors all charts
☐ Audit log captures every action

---

🗺️ Roadmap

✅ Done

· Firebase migration (from Supabase)
· Live dashboard with 4 charts
· Custom categories
· Cash + GCash payment support
· Offline persistence
· Atomic order and inventory transactions with an offline sale queue
· Live order, customer, inventory, and audit synchronization
· 2-column dashboard grid
· KPI visual hierarchy

🚧 Planned

· Refunds / voids
· Hold / recall sale
· Barcode scanner input
· Email receipts
· Product cost tracking (for profit/margin)
· Multi-terminal support

---

🤝 Contributing

This is a private project for Kirby's Hardware. Contributions are limited to authorized team members.

---

📄 License

ISC License — see package.json for details.

---

👥 Credits

· Client: Kirby's Hardware (Santa Maria, Bulacan)
· Developer: Erosgbcs, Feitan982
· Icons: Font Awesome
· Charts: Chart.js
· Backend: Firebase (Google)

---

📞 Support

For issues or questions, open an issue on GitHub:
https://github.com/Feitan982/POS-WebApplication/issues

---

Built with care for a small business that deserves great tools. 🛠️

---

## 📌 Notes

| Section | Why It Matters |
|---------|----------------|
| **Firestore rules** | Without these, nothing reads/writes |
| **First-run steps** | Prevents "why can't I sign up?" confusion |
| **Hybrid storage explanation** | Explains why orders aren't synced across devices |
| **Cost profile** | Reassures that Firebase stays free |
| **Testing checklist** | Lets anyone verify a fresh setup |

