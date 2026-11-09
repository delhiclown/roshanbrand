<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/29d744aa-58e5-4984-afcc-c6959631f205

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Set `DATABASE_URL` in `.env` to a PostgreSQL connection string (Render Postgres or Supabase; include `sslmode=require` if required).
4. Run the app:
   `npm run dev`

Orders receive a private access key. Save it from the order confirmation if you need to view delivered credentials on another device. On the same browser, the key is kept in an HttpOnly cookie rather than browser-accessible storage. The public order lookup shows status only and never returns credentials. Orders created before access keys were introduced need support assistance to recover.

## Admin Access

Set `ADMIN_PASSWORD` and `ADMIN_RECOVERY_KEY` in a local `.env` file before starting the server. On first startup, the server stores a salted password hash in `data/admin_auth.json`; later password changes are saved there. The recovery key is required for the Admin panel's Forgot Password flow. Keep both values private and do not commit `.env` or `data/admin_auth.json`.

## Deploy on Render and Vercel

Create a PostgreSQL database on Render or Supabase and set its connection string as the private `DATABASE_URL` environment variable in Render. Production startup requires this setting; JSON-file persistence is only available for local development. Set `ADMIN_PASSWORD` and `ADMIN_RECOVERY_KEY` as private environment variables as well. Store config, orders, and vault data are persisted in the PostgreSQL `roshanbrand_state` table. The table is created automatically. On the first start against an empty database, existing `/var/data/roshanbrand_store.json` data (or the bundled seed file if it is absent) is imported once; subsequent starts load the existing database row without replacing it with defaults. The `/var/data` persistent disk remains in use for the admin password hash and legacy data import.

The `start` script builds the Vite frontend before starting the server, so deployments that invoke `bun run start` directly still create the required `dist/index.html`.

If the frontend is deployed on Vercel, keep the backend on Render. `vercel.json` forwards every `/api/*` request to `https://roshanbrand.onrender.com`, so store, orders, events, and admin login requests reach the backend without cross-origin cookie issues. Deploy this repository to Vercel with the Vite build output (`dist`), and keep the Render service and its environment variables configured. Set the custom domain on Vercel only if Vercel is serving the frontend; the Render service URL must remain available as the API backend.

For a Render-only deployment, point the custom domain directly to the Render service; the Vercel rewrite is not used.

Stock shown in the storefront is the number of unassigned credentials in the matching vault pool minus reservations held by submitted, unpaid orders. Add real credentials to the Admin Vault before making a product available; a fresh database starts with an empty vault.

## UPI Payment Verification

Opening checkout creates a server-timed payment order with a 10-minute deadline and a 5-minute grace period. The `payment_expires_at` field records the payment deadline; `expires_at` records the end of the grace period. `PAYMENT_GRACE_PERIOD_MINUTES` can change the grace period (default `5`). The countdown is shared across payment presentation, uses the server deadline, and survives refreshes and closing/reopening checkout in the same browser session. When the 10-minute deadline passes, the QR/payment link is hidden but the UTR form remains available. The order is marked `expired` only after the grace period if no UTR was submitted. The server calculates the whole-rupee price from the selected product and quantity; the browser never supplies the amount.

Submitting a valid, unused 12-digit UTR before the payment deadline sets `utr_submitted` and leaves the order pending verification without auto-expiring it. UTRs submitted after the deadline, including after the grace period, are classified as `late_payment_pending_review` and remain available for support review. On-time submissions can still be automatically delivered by a matching SMS webhook and exact amount; if stock is unavailable, the order remains `paid_stock_pending`. Admins can use the **Late Payments** filter to review the order amount, UTR, customer detail, order time, and UTR submission time, then approve and deliver or reject with a customer-visible reason. UTRs are validated on the server and a unique index prevents reuse.

Track Order checks are limited to 10 requests per minute per IP. Each UTR has one complaint record whose check count and last-checked time update on repeat checks. Admins can view the newest 100 open complaints and resolve them; delivery resolves a complaint automatically. Resolved complaints are deleted after seven days, and open complaints with no check for 30 days are deleted. The Recent SMS payments panel shows only SMS records linked to an order. Unlinked incoming credit payments and their SMS logs are deleted after 30 minutes; payment records linked to an order are retained.

The legacy cleanup endpoint is protected by the existing admin session: `POST /api/admin/orders/cleanup-fake-utrs` with a JSON body such as `{"orderIds":["RB_..."]}` rejects only the explicitly supplied pending orders that have a valid UTR, and releases their reservations. Review the IDs in Admin first; the endpoint intentionally does not guess which historic UTRs were submitted by a customer.

Credential access rechecks the persisted `paid` status and one-time `delivered` flag on the server and returns `409` for every unpaid order.

Configure these values in the Render service's **Environment** settings (or in an uncommitted local `.env`):

- `DATABASE_URL`: the same PostgreSQL database already used by the app. The payment tables are created automatically at startup.
- `UPI_ID`: optional fallback merchant UPI ID used only if no ID is saved in Admin Panel settings.
- `PAYEE_NAME`: the payee name shown in UPI apps.
- `PAYMENT_GRACE_PERIOD_MINUTES`: grace duration after the 10-minute payment deadline; defaults to `5`.
- `SMS_SECRET`: a private, high-entropy secret sent in the webhook's `x-secret` header.
- `SMS_SENDER_KEYWORDS`: comma-separated sender text accepted from bank/UPI SMS notifications, for example `airtel,airpay`.

The Merchant UPI ID saved in Admin Panel settings is the source of truth. The server uses `UPI_ID` only when the database has no saved ID. Save a valid `name@handle` value; it is stored and used exactly as entered, without trimming, lowercasing, or length truncation. Checkout QR links are generated from the current server setting, not an old order or inventory value. Deploy the existing Render service after setting the environment values. For Vercel-hosted frontend deployments, keep the backend URL configured in `vercel.json`; browser API calls use `/api/...` and are forwarded to that same server. A trusted SMS relay may record bank SMS evidence by sending:

```text
POST https://YOUR_BACKEND_HOST/api/sms-webhook
Content-Type: application/json
x-secret: YOUR_SMS_SECRET

{"sender":"AIRTEL","message":"INR 340.00 credited ... UTR 123456789012"}
```

The notification must include a configured sender keyword, `credited` or `received`, a rupee amount prefixed by `Rs`, `INR`, or `₹`, and a labeled 12-digit UTR/ref number. Debit and OTP messages are ignored, and a missing or incorrect `x-secret` receives HTTP 401. The webhook automatically delivers only when the UTR, amount, order creation time, and pending order status match. Keep `SMS_SECRET` only in the backend and SMS relay; never put it in frontend code. The customer's private order key remains in an HttpOnly cookie; a UTR alone can show status but cannot reveal credentials.

### Verify payment expiry and late-payment review

1. Deploy the server with `DATABASE_URL`, `UPI_ID`, and `PAYEE_NAME` set, and add test credentials to the vault.
2. Create an order and confirm the countdown starts at 10:00. Refresh checkout and switch payment presentation; confirm the server deadline does not reset.
3. Submit a valid, unused UTR before 10:00; confirm the timer stops and the order appears as pending verification without expiring.
4. Let a separate order reach 00:00; confirm QR/UPI payment details disappear, “Payment time expired.” appears, and the UTR form remains available through the grace period.
5. Submit a UTR after the deadline (both during and after grace); confirm it appears in **Late Payments** as `Late Payment - Pending Review`.
6. Approve a late payment after matching the displayed amount; confirm credentials are delivered. Reject another with a reason and confirm the reason is shown to the customer.
7. Submit the same UTR on another order and confirm the server rejects the duplicate. Confirm invalid/non-12-digit UTRs are rejected server-side.

## Guarantee Claims

Delivered 7-day and 1-month guarantee orders show the original expiry date and allow one open claim per order. Customers can report an issue and attach an optional PNG, JPEG, or WebP screenshot up to 1 MB. Claims and their audit/replacement history are persisted with the existing PostgreSQL `roshanbrand_state` JSONB state; screenshots are excluded from the polled admin state and loaded only when an admin views them.

Admins review and approve a claim before resolving it with a replacement or refund, or reject it with a customer-visible reason. Replacement IDs are assigned from the matching guarantee vault pool and replace only the selected account in the original order. The original delivery date and expiry are preserved. The default maximum is two replacements per order and can be changed in Prices & Site Control (0–20). A refund action is an audit record only: the admin must send the money through the payment provider and confirm that first. Admin actions use the configurable audit display name; the current panel uses one shared admin login.

The admin claims and order views are server-filtered and paginated in batches of 50; older records can be loaded on demand. State-changing API requests lock and refresh the shared PostgreSQL state row before applying changes. Admin login sessions are stored in PostgreSQL so they work across application instances.

24-hour rental credentials are hidden by the panel after their expiry and are not returned by the private order-access API. This panel cannot revoke or disable the account at IRCTC; account access must be disabled externally if the rental product requires that guarantee.
