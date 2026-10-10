# Updated README


# POS & Inventory Management System

A lightweight, single-store Point of Sale (POS) and Inventory Management web application built for **Kirby's Hardware**. It runs in the browser with Firebase for authentication and shared data, plus local caches and a durable same-browser queue for sales awaiting sync. An AI assistant (Gemini primary, Groq fallback) provides sales forecasts, restock recommendations, and a natural-language chat over your own store data.

![Status](https://img.shields.io/badge/status-active-brightgreen)
![Version](https://img.shields.io/badge/version-1.1.0-blue)
![License](https://img.shields.io/badge/license-ISC-lightgrey)

---

## ✨ Features

### 🔐 Authentication & Authorization
- Firebase Authentication (Email/Password)
- Role-based access control (Admin / Cashier)
- Maximum of 2 admin accounts per store
- Forgot password with email reset link
- Session persistence via Firebase Auth
- Admin-managed user creation with re-authentication before role changes

### 🛒 Point of Sale (POS)
- Searchable product catalog with category icons
- **Size variants** per product (e.g., S/M/L, 8oz/16oz)
- **Brand variants** per product (e.g., Bosny / Boysen / Davies)
- Optional stock tracking for each size **or** brand (one dimension per product)
- Live cart with quantity adjustment
- Automatic subtotal, tax (8%), and total computation
- Cash and GCash payment methods
- Change calculation for cash payments
- Printable receipt with store details and per-line brand/size
- Atomic Firestore order creation and stock decrement
- Offline sale queue with retry after reconnect

### 📦 Inventory Management
- Full CRUD (Create, Read, Update, Delete) for products
- Per-size **and** per-brand stock breakdown
- Low-stock status and CSV export
- Searchable, filterable product table with pagination
- Clickable stat cards that filter inventory by stock level
- Stock badges: In Stock / Low Stock / Out of Stock / Over Stocked
- **Custom categories** with inline add (no code edits needed)
- Bulk quantity updates

### 📊 Overview Dashboard
- Live KPI cards with count-up animations:
  Today's Sales · Orders Today · Products in Stock · Active Customers
- "Needs attention" strip that surfaces low/out-of-stock and offline queue at a glance
- **Tabbed Analytics card** — one period selector drives all views:
  - **Trend** — line chart of sales over the selected period
  - **Products** — top 5 products (horizontal bar)
  - **Categories** — sales by category (donut)
  - **Hours** — hourly sales heatmap (day × hour grid)
- Optional compare overlay vs. the previous period
- **AI Insights card** — tabbed Forecast / Restock panels
- Low Stock Alerts widget
- Live Recent Activity feed (from audit log)
- Quick Actions in the page header

### 🤖 AI Assistant
- **Gemini-powered** proxy with **Groq fallback** when Gemini is unavailable
- Floating action button (FAB) → slide-out chat panel
- **Conversation memory** — follow-up questions resolve against prior turns
- **Quick-prompt chips** for common questions ("What sold best today?", "What should I restock?")
- **14-day sales forecast** with per-day confidence
- **Priority restock list** — ranked by urgency with days-left estimates
- Chat answers with real numbers (PHP amounts, counts) from your data
- 6-hour response cache to keep quota usage low
- Serverless proxy keeps API keys off the client

### 📋 Orders & Customers
- Order history with filter by status and date
- Compact clickable items cell → order details modal
- Customer records auto-created on sale
- Manual customer add
- Per-customer lifetime totals (orders + spend)

### 🛡️ Audit Trail
- Logs every meaningful action (create / update / delete / login / logout / export)
- Filter by action, module, date, user
- Search by user / description / receipt
- CSV export
- Severity levels: info, warning, critical, error
- Owner-friendly translations ("Sale", "Added product", "Removed customer")

### 🎨 User Experience
- Dark / Light theme toggle (warm-yellow dark mode, warm-ivory light mode)
- **Fully responsive** — desktop → tablet → mobile
  - Orders, Customers, Inventory, and User Management tables convert to stacked cards below 768px
  - Tools bars stack; header buttons stretch; pagination shrinks
  - Long names wrap gracefully instead of clipping
- Glassmorphism UI with smooth animations
- Toast notifications
- Keyboard-accessible components
- Collapsible sidebar (desktop) / slide-out drawer (mobile)

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
| **AI (primary)** | Google Gemini via serverless proxy |
| **AI (fallback)** | Groq (Llama / GPT-OSS models) |
| **Proxy runtime** | Vercel Serverless Functions |
| **Offline** | Firestore IndexedDB persistence and a local pending-sale queue |
| **Local Storage** | Browser caches for orders, customers, audit, settings, categories, AI thread, and pending sales |
| **PWA** | Service worker + manifest |

---

## 📁 Project Structure

```
POS-WebApplication/
├── index.html               # Main entry — all views & modals
├── style.css                # Full custom stylesheet (themes, layout, responsive)
├── tailwind.css             # Compiled Tailwind output
├── manifest.json            # PWA manifest
├── sw.js                    # Service worker for offline shell
│
├── firebase.js              # Firebase wrapper (auth, Firestore, subscriptions, offline)
├── auth.js                  # Sign in / forgot / logout + user management
├── script.js                # Dashboard, navigation, KPIs, overview wiring
├── pos.js                   # POS cart, checkout, receipt, stock decrement
├── inventory.js             # Inventory CRUD, size + brand variants, categories
├── audit.js                 # Audit trail, active users, per-user summary
├── ai.js                    # AI client (forecast, restock, chat, caching)
├── overview-enhancements.js # Tab switching, attention strip, analytics sync
│
├── api/
│   └── ai.js                # Serverless AI proxy (Gemini + Groq fallback)
│
├── seed.html                # One-time admin tool to seed/wipe demo data
├── qa-checklist.html        # Manual POS and inventory verification checklist
├── package.json             # Tailwind build scripts
├── package-lock.json        # Dependency lock
├── bg.jpg                   # Background image
├── assets/
│   └── logo.png             # Client logo
└── src/
    └── input.css            # Tailwind source
```

---

## 🚀 Getting Started

### Prerequisites
- A modern browser (Chrome, Edge, Firefox, Safari)
- A Firebase project ([create one free](https://console.firebase.google.com/))
- Node.js 18+ (only for Tailwind build)
- Optional: a Vercel account if you want AI features (or any Node host that runs the `api/ai.js` function)

### 1. Clone the Repository
```bash
git clone https://github.com/Feitan982/POS-WebApplication.git
cd POS-WebApplication
```

### 2. Configure Firebase

Create a new Firebase project and grab your web config from:
Firebase Console → Project Settings → General → Your apps → Web app

Then paste it into the `<script>` block near the bottom of `index.html`:

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

### 3. Enable Firebase Services

**Authentication:**
1. Firebase Console → Authentication → Sign-in method
2. Enable Email/Password

**Firestore Database:**
1. Firebase Console → Firestore Database
2. Click Create database → Production mode
3. Configure and test Firestore Security Rules before connecting real data. This repository does not include a reviewed rules file. Client-side role checks are not authorization: the app creates profiles and runs sale transactions from the browser. In particular, do not allow users to update their own role, and do not use open/test-mode rules. The first admin should be provisioned through a trusted setup process.

### 4. Configure AI (optional)

The AI features call `/api/ai`. To enable them:

1. Deploy to Vercel (or any host that runs Node functions)
2. Add two environment variables in **Settings → Environment Variables**:

| Name | Value |
|------|-------|
| `GEMINI_API_KEY` | Your Google AI Studio key — [get one](https://aistudio.google.com/apikey) |
| `GROQ_API_KEY` | Your Groq key — [get one](https://console.groq.com/keys) |

Enable both for **Production**, **Preview**, and **Development**, then redeploy.

The proxy tries Gemini first. If Gemini returns any error (429, 503, timeout, etc.), it automatically falls back to Groq. If you only set one key, the app uses that one provider and fails cleanly when it's unavailable.

If you skip this step, the rest of the app still works — only the AI chat, forecast, and restock cards will show "AI service not configured".

### 5. Build Tailwind (optional — only if you edit `src/input.css`)

```bash
npm install
npm run build:styles
```

### 6. Run the App

Open `index.html` in your browser — or serve it via any static server:

```bash
# Option A: Python
python -m http.server 8000

# Option B: Node
npx serve
```

Then visit http://localhost:8000.

If you want AI features while running locally, use `vercel dev` instead and add a `.env.local` file with your API keys.

---

## First Admin Setup

The signup screen offers an initial Admin role, but that client-side limit is not a security boundary. For production, provision the first Admin through a trusted setup process and secure role assignment before enabling public signup. The app currently does not include a trusted bootstrap function or reviewed Firestore rules.

---

## Data Model

The app uses Firestore for shared data and localStorage for fast UI caches and the same-browser pending-sale queue.

### Firestore Collections

| Collection | Purpose | Key fields |
| --- | --- | --- |
| `profiles` | User accounts and roles | `email`, `full_name`, `role`, `active`, `created_at`, `lastLoginAt` |
| `inventory` | Product catalog and stock | `name`, `sku`, `price`, `quantity`, `size`, `sizeMode`, optional `sizeStocks`, `brand`, `brandMode`, optional `brandStocks`, `min_stock`, `category`, `supplier` |
| `orders` | Completed sales | receipt ID, `items`, `subtotal`, `tax`, `total`, `paymentMethod`, `status`, `customerName`, `customerPhone`, `createdAt` |
| `customers` | Customer records and totals | `name`, `phone`, `orders`, `totalSpent` |
| `audit_logs` | Activity history | `user`, `action`, `module`, `description`, `timestamp`, `severity` |
| `config` | Store settings and categories | `settings` document and `categories.list` |

### Variant Dimensions

Both **size** and **brand** support two modes:

- `spec` / `single` — a plain label (e.g., `2 in`, `Bosny`)
- `variants` — comma-separated labels with optional per-variant stock

When variant mode is active **and** per-variant tracking is enabled, the object `sizeStocks` or `brandStocks` maps each label to its available quantity. The product-level `quantity` field is the sum of those values.

**Only one dimension can own tracked stock per product.** A product can have size variants OR brand variants with `sizeStocks` / `brandStocks` — not both. The other dimension still displays, but does not carry stock.

Legacy products without any variant fields continue to use their shared `quantity` value.

### Local Storage

| Key | Purpose |
| --- | --- |
| `pos_orders` | Local order cache, including sales awaiting sync |
| `pos_order_queue` | Durable same-browser queue of sales not yet committed to Firestore |
| `pos_order_queue_error` | Most recent pending-sale sync error shown in the offline banner |
| `pos_customers` | Local customer cache |
| `pos_customers_cache_ready` | Marks whether the customer cache has been hydrated |
| `pos_audit_logs` | Local audit cache |
| `pos_categories` | Custom category names |
| `pos_settings` | Store preferences |
| `pos_theme` | Theme preference |
| `pos_current_user` | Local session fallback |
| `pos_user_profile_<uid>` | Cached profile for offline role hydration |
| `pos_ai_thread` | AI chat history (last 20 turns) |
| `pos_ai_cache_*` | Cached AI responses (6-hour TTL) |
| `pos_sidebar_collapsed` | Sidebar collapse state |

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

## AI Cost Profile

The AI features route through `/api/ai`. Both providers used have generous free tiers:

| Provider | Free tier |
|----------|-----------|
| Gemini | ~15 requests/min, 1,500 requests/day |
| Groq | ~30 requests/min, 1,000+ requests/day |

To stay comfortably inside both, the client:

- **Deduplicates in-flight requests** — a burst of concurrent forecast/restock calls shares one network request
- **Caches responses for 6 hours** — `pos_ai_cache_*` in localStorage
- **Skips AI when the Overview page is not visible** — background refreshes don't trigger AI calls
- **Invalidates only the affected key** on manual refresh — the Forecast ↻ button doesn't wipe the Restock cache
- **Trims the chat payload** — last 15 orders + 40 products + last 8 chat turns

If you hit rate limits anyway, check:

1. **Multiple tabs** — each open tab fires its own AI calls
2. **Preview deployments** — disable them in `vercel.json` if you don't need per-branch previews
3. **Service worker caching old code** — hard-refresh (Ctrl+Shift+R) if a deployed fix doesn't seem to apply

---

## 🧪 Testing Checklist

After setup, verify:

### Auth & Roles
- [ ] Sign up as admin → lands on dashboard
- [ ] Sign out → returns to login
- [ ] Sign in → session persists across refresh
- [ ] Sign in on mobile → layout fits, no horizontal scroll

### Inventory
- [ ] Create a product with a custom category
- [ ] Create a size-variant product with separate counts per size
- [ ] Create a brand-variant product with separate counts per brand
- [ ] Sell one size and verify only that size's stock decreases
- [ ] Sell one brand and verify only that brand's stock decreases
- [ ] Edit a product — verify size and brand fields populate correctly
- [ ] Filter inventory by clicking the "Low Stock" stat card

### POS
- [ ] Click a size-variant card → size selector appears
- [ ] Click a brand-variant card → brand selector appears
- [ ] Click a size+brand card → two-step selector (size → brand)
- [ ] Complete a cash sale → receipt prints with ₱ symbol
- [ ] Complete a GCash sale → receipt shows "Payment: GCash"
- [ ] Receipt shows brand next to size for variant items
- [ ] Complete a sale while offline → queue appears, then syncs after reconnect
- [ ] Retry a queued sale → verify the order and stock are not duplicated

### Dashboard
- [ ] KPI cards show correct values and animate on change
- [ ] "Needs attention" strip appears when items are low/out of stock
- [ ] Analytics tabs switch between Trend / Products / Categories / Hours
- [ ] Period selector drives all four analytics tabs
- [ ] Compare toggle overlays the previous period
- [ ] Dashboard charts update after sale
- [ ] Low Stock widget reflects inventory
- [ ] Theme toggle re-colors all charts

### AI
- [ ] Forecast tab shows 14 bars (or "not enough data" if fewer than 7 days)
- [ ] Restock tab lists products by urgency
- [ ] Chat answers a simple question with real numbers
- [ ] Chat follow-up ("and last week?") resolves from history
- [ ] Quick-prompt chips fill the input and submit
- [ ] Clearing the thread resets the chat
- [ ] When the AI key is missing, the app still works — only AI cards fail

### Mobile (≤ 768px)
- [ ] Orders page shows rows as cards, no horizontal scroll
- [ ] Customers page hides Email/Phone columns
- [ ] Inventory page shows cards with size/brand breakdown
- [ ] User Management shows action buttons on their own row
- [ ] Activity items wrap long names without clipping

### Audit
- [ ] Log captures every create/update/delete/login/export
- [ ] Filters narrow the list correctly
- [ ] CSV export produces a valid file

---

## 🗺️ Roadmap

### ✅ Done

- Firebase migration (from Supabase)
- Live dashboard with 4 charts
- Custom categories
- Cash + GCash payment support
- Offline persistence
- Atomic order and inventory transactions with an offline sale queue
- Live order, customer, inventory, and audit synchronization
- 2-column dashboard grid
- KPI visual hierarchy
- **Size variants with optional per-size stock**
- **Brand variants with optional per-brand stock**
- **AI assistant (Gemini + Groq fallback) with forecast, restock, and chat**
- **AI conversation memory and quick-prompt chips**
- **Tabbed Overview analytics and AI Insights**
- **Mobile responsive tables (cards below 768px)**
- **Warm-yellow dark mode / warm-ivory light mode**
- **Seed tool for demo data**

### 🚧 Planned

- Refunds / voids
- Hold / recall sale
- Barcode scanner input
- Email receipts
- Product cost tracking (for profit/margin)
- Multi-terminal support
- Per-user permission scopes

---

## 🤝 Contributing

This is a private project for Kirby's Hardware. Contributions are limited to authorized team members.

---

## 📄 License

ISC License — see `package.json` for details.

---

## 👥 Credits

- **Client:** Kirby's Hardware (Santa Maria, Bulacan)
- **Developer:** Erosgbcs, Feitan982
- **Icons:** Font Awesome
- **Charts:** Chart.js
- **Backend:** Firebase (Google)
- **AI:** Google Gemini + Groq

---

## 📞 Support

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
| **AI env vars** | Explains why AI cards stay empty on a fresh deploy |
| **Hybrid storage explanation** | Explains why orders aren't synced across devices before the queue retries |
| **Cost profile** | Reassures that Firebase and AI stay free at small-store volume |
| **Testing checklist** | Lets anyone verify a fresh setup end to end |
```

---

## What changed vs. your original

| Section | Change |
|---|---|
| Version badge | `1.0.0` → `1.1.0` |
| Intro | Mentions AI assistant + brand variants |
| Auth features | Added admin-managed user creation |
| POS features | Added brand variants alongside size |
| Inventory | Added brand breakdown, clickable filter cards |
| Overview Dashboard | Renamed from "Analytics Dashboard"; describes tabbed structure + attention strip + AI Insights |
| **AI Assistant** | **New section** — Gemini + Groq, chat memory, prompt chips, forecasts, cost notes |
| User Experience | Added explicit mobile-responsive sub-bullets |
| Tech Stack | Added Gemini, Groq, Vercel, PWA |
| Project Structure | Added `auth.js`, `audit.js`, `ai.js`, `overview-enhancements.js`, `api/ai.js`, `seed.html`, `sw.js`, `manifest.json` |
| Getting Started | Added Step 4 for AI env vars with a link to get each key |
| Data Model | Added `brandMode`, `brandStocks`, `sizeMode`; added "one dimension per product" rule |
| Local Storage | Added AI thread, AI cache, user profile cache, sidebar state |
| Firebase cost profile | Unchanged |
| **AI cost profile** | **New section** — free tiers, dedup, caching, troubleshooting |
| Testing Checklist | Reorganized into Auth / Inventory / POS / Dashboard / AI / Mobile / Audit; added brand, AI, and mobile tests |
| Roadmap | Moved size variants, brand variants, AI, tabs, mobile, themes, seed tool into Done |
| Credits | Added "AI: Google Gemini + Groq" |
| Notes | Added AI env var and hybrid storage rows |
