# POS Data Model ERD

This document shows the logical relationships and the physical Firebase/Firestore layout used by the application.

## Logical ERD

```mermaid
erDiagram
    FIREBASE_AUTH_USER ||--|| USER_PROFILE : "profile keyed by uid"
    PRODUCT ||--o{ PRODUCT_VARIANT : "optionally has"
    PRODUCT ||--o{ ORDER_ITEM : "referenced by"
    PRODUCT_VARIANT o|--o{ ORDER_ITEM : "optional size selection"
    SALES_ORDER ||--|{ ORDER_ITEM : contains
    CUSTOMER o|--o{ SALES_ORDER : "soft match by name"
    USER_PROFILE o|--o{ AUDIT_LOG : "actor label only"

    FIREBASE_AUTH_USER {
        string uid PK
        string email
    }
    USER_PROFILE {
        string uid PK, FK
        string full_name
        string role
        string created_at
    }
    PRODUCT {
        string product_id PK
        string sku UK
        string name
        string category
        number price
        number total_quantity
        number min_stock
    }
    PRODUCT_VARIANT {
        string product_id PK, FK
        string size PK
        number available_quantity
    }
    SALES_ORDER {
        string receipt_id PK
        string customer_name
        string customer_phone
        number subtotal
        number tax
        number total
        string payment_method
        string status
        string created_at
    }
    ORDER_ITEM {
        string receipt_id PK, FK
        number line_number PK
        string product_id FK
        string size
        number quantity
        number unit_price
    }
    CUSTOMER {
        string customer_id PK
        string name
        string phone
        number orders
        number total_spent
    }
    AUDIT_LOG {
        string log_id PK
        string user_label
        string action
        string module
        string timestamp
    }
```

`PRODUCT_VARIANT` is a logical entity. In Firestore, variants are embedded in an optional `sizeStocks` map on the product document. `ORDER_ITEM` records are embedded in the order document; `line_number` is a conceptual key, not a stored field.

The customer-to-order and profile-to-audit relationships are soft associations, not enforced foreign keys. Orders store `customerName` and audit logs store a user label; neither currently stores a stable customer/profile document ID.

## Physical Firestore Model

```mermaid
flowchart LR
    Auth["Firebase Authentication<br/>account uid"]
    Profile["profiles/{uid}<br/>email, full_name, role, created_at"]
    Product["inventory/{productId}<br/>name, sku, category, price<br/>quantity, min_stock, size, sizeMode<br/>sizeStocks: {size: quantity}<br/>supplier, description, timestamps"]
    Order["orders/{receiptId}<br/>createdAt, customerName, customerPhone<br/>items: [{productId, name, size, quantity, price}]<br/>subtotal, tax, total, paymentMethod, status, syncedAt"]
    Customer["customers/{autoId}<br/>name, email, phone, orders, totalSpent<br/>createdAt, syncedAt"]
    Audit["audit_logs/{autoId}<br/>timestamp, user, action, module<br/>description, ip, severity, syncedAt"]
    Settings["config/settings<br/>store settings document"]
    Categories["config/categories<br/>list: string[]"]
    Queue["Browser localStorage<br/>pos_order_queue: pending orders<br/>pos_order_queue_error: last sync error"]

    Auth -->|uid| Profile
    Order -->|items[].productId| Product
    Order -.->|customerName text; no FK| Customer
    Auth -.->|display name only| Audit
    Queue -.->|retried after reconnect/sign-in| Order
```

### Collection Details

| Path | Document ID | Notes |
| --- | --- | --- |
| `profiles/{uid}` | Firebase Auth UID | The profile is keyed by the corresponding auth account. |
| `inventory/{productId}` | Firestore-generated ID | `quantity` is the total stock. When `sizeStocks` exists, it maps each size label to its available integer quantity and `quantity` is kept as the sum. Legacy products without the map use shared stock. |
| `orders/{receiptId}` | Receipt ID | Order items are embedded. Each item stores a product document ID, a size label (possibly empty), quantity, and unit price. |
| `customers/{autoId}` | Firestore-generated ID | Customer statistics are stored on the customer document; orders associate by name only. |
| `audit_logs/{autoId}` | Firestore-generated ID | The `user` field is a display label, not a profile foreign key. |
| `config/settings` | Fixed ID `settings` | Store settings singleton. |
| `config/categories` | Fixed ID `categories` | Custom categories are stored in a `list` array. |

A sale transaction reads its receipt and affected inventory documents, validates current stock, then atomically updates inventory and creates the order. If the transaction cannot commit, the order is retained in the browser outbox and retried later with the same receipt ID. The outbox is local to that browser until committed and is not a Firestore collection.
