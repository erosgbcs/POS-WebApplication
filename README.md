

```markdown
# POS & Inventory Management System

A lightweight, single-store Point of Sale (POS) and Inventory Management web application built for **Kirby's Hardware**. Runs entirely in the browser with Firebase as the backend for authentication and cloud inventory data, and localStorage for high-speed local transaction data.

![Status](https://img.shields.io/badge/status-active-brightgreen)
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-ISC-lightgrey)

---

## ✨ Features

### 🔐 Authentication & Authorization
- Firebase Authentication (Email/Password)
- Role-based access control (Admin / Cashier)
- Maximum of 2 admin accounts per store
- Forgot password with email reset link
- Session persistence via Firebase Auth

### 🛒 Point of Sale (POS)
- Searchable product catalog with category icons
- Size variant support per product (e.g., S/M/L, 8oz/16oz)
- Live cart with quantity adjustment
- Automatic subtotal, tax (8%), and total computation
- Cash and GCash payment methods
- Change calculation for cash payments
- Printable receipt with store details
- Auto-inventory decrement *(planned)*

### 📦 Inventory Management
- Full CRUD (Create, Read, Update, Delete) for products
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
| **Offline** | Firestore IndexedDB persistence |
| **Local Storage** | Browser localStorage (orders, customers, audit, settings) |
| **Build** | Tailwind CLI |

---

## 📁 Project Structure

```

POS-WebApplication/
├── index.html              # Main entry — all views & modals
├── style.css               # Full custom stylesheet (themes, layout)
├── tailwind.css            # Compiled Tailwind output
├── supabase.js             # ⚠️ Legacy file (no longer used)
├── firebase.js             # Firebase wrapper (auth, Firestore, offline)
├── inventory.js            # Inventory CRUD + custom categories
├── script.js               # Auth, dashboard, navigation, audit
├── pos.js                  # POS cart, checkout, receipt
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

2. Configure Firebase

Create a new Firebase project and grab your web config from:
Firebase Console → Project Settings → General → Your apps → Web app

Then paste it into the <script> block near the bottom of index.html:

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
3. Apply these security rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuthenticated() {
      return request.auth != null;
    }

    function myProfile() {
      return get(/databases/$(database)/documents/profiles/$(request.auth.uid)).data;
    }

    function isAdmin() {
      return isAuthenticated()
        && exists(/databases/$(database)/documents/profiles/$(request.auth.uid))
        && myProfile().role == 'admin';
    }

    match /inventory/{productId} {
      allow read: if isAuthenticated();
      allow create, update, delete: if isAdmin();
    }

    match /profiles/{userId} {
      allow read: if isAuthenticated();
      allow create, update: if isAuthenticated()
                            && (request.auth.uid == userId || isAdmin());
      allow delete: if isAdmin() && request.auth.uid != userId;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

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

🧑‍💼 First Run — Create the First Admin

1. On the login screen, click Create Account
2. Fill in name, email, password
3. Select Admin as role
4. Check the Terms box → Submit
5. You'll be auto-signed in and land on the dashboard

Once 2 admins exist, the Admin option is disabled for further signups — only Cashier is offered.

---

📊 Data Model

The application uses hybrid storage: Firestore for shared master data + localStorage for high-speed transactional data.

Firestore Collections

Collection Purpose Key Fields
profiles User accounts & roles id, email, full_name, role, created_at
inventory Product catalog name, sku, category, price, quantity, min_stock, size, supplier

localStorage Keys

Key Shape Purpose
pos_orders Order[] Sales history
pos_customers Customer[] Customer records
pos_audit_logs AuditLog[] Action history
pos_categories string[] Custom category names
pos_settings Settings Store preferences
pos_theme "dark" / "light" Theme
pos_current_user User Local session fallback

Why Hybrid?

· Firestore = shared across devices, cloud-persistent
· localStorage = instant, offline-capable, zero Firebase read/write cost
· Trade-off = orders/customers are NOT synced across terminals (single-store design)

---

🔧 Firebase Read/Write Cost Profile

This app is designed to stay on the Spark (free) tier:

Action Firestore Cost
Login (fetch profile) 1 read
Open Inventory page N reads (N = product count)
Add / Edit / Delete product 1 write
Complete a sale 0 writes (localStorage only)
Dashboard load 0 reads (uses cached inventory)

For a typical single-store day, usage is a tiny fraction of the 50,000 reads / 20,000 writes free quota.

---

🧪 Testing Checklist

After setup, verify:

☐ Sign up as admin → lands on dashboard
☐ Sign out → returns to login
☐ Sign in → session persists across refresh
☐ Create a product with a custom category
☐ Complete a cash sale → receipt prints with ₱ symbol
☐ Complete a GCash sale → receipt shows "Payment: GCash"
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
· 2-column dashboard grid
· KPI visual hierarchy

🚧 Planned

· Real-time sync for orders via Firestore
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
· Developer: Feitan982
· Icons: Font Awesome
· Charts: Chart.js
· Backend: Firebase (Google)

---

📞 Support

For issues or questions, open an issue on GitHub:
https://github.com/Feitan982/POS-WebApplication/issues

---

Built with care for a small business that deserves great tools. 🛠️

```

---

## 📌 Notes

| Section | Why It Matters |
|---------|----------------|
| **Firestore rules** | Without these, nothing reads/writes |
| **First-run steps** | Prevents "why can't I sign up?" confusion |
| **Hybrid storage explanation** | Explains why orders aren't synced across devices |
| **Cost profile** | Reassures that Firebase stays free |
| **Testing checklist** | Lets anyone verify a fresh setup |

