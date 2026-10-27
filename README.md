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

Opening checkout creates only a 15-minute `draft` row. Drafts are not included in the admin order list and never reserve stock. Closing the checkout or leaving the page sends a best-effort cancellation; a server cleanup job silently deletes drafts that remain for 15 minutes. The server calculates the whole-rupee price from the selected product and quantity; the browser never supplies the amount. It returns an order-specific UPI link and QR.

Only the customer pressing **I have paid — submit UTR** with a valid, unused 12-digit UTR promotes the draft to `utr_submitted` and reserves its requested vault IDs for 30 minutes. A matching SMS webhook UTR and exact amount automatically delivers credentials once. If no matching SMS arrives, the authenticated admin can use **Update Delivered Vault ID** for a submitted pending order. SMS and manual delivery both require the database row to remain `utr_submitted` and atomically set `paid`/`delivered`; a second delivery attempt cannot assign another ID. SMS events, including notifications arriving after manual delivery, are visible in the Admin orders tab. Rejection releases the reserved IDs immediately.

The legacy cleanup endpoint is protected by the existing admin session: `POST /api/admin/orders/cleanup-fake-utrs` with a JSON body such as `{"orderIds":["RB_..."]}` rejects only the explicitly supplied pending orders that have a valid UTR, and releases their reservations. Review the IDs in Admin first; the endpoint intentionally does not guess which historic UTRs were submitted by a customer.

Credential access rechecks the persisted `paid` status and one-time `delivered` flag on the server and returns `409` for every unpaid order.

Configure these values in the Render service's **Environment** settings (or in an uncommitted local `.env`):

- `DATABASE_URL`: the same PostgreSQL database already used by the app. The payment tables are created automatically at startup.
- `UPI_ID`: optional fallback merchant UPI ID used only if no ID is saved in Admin Panel settings.
- `PAYEE_NAME`: the payee name shown in UPI apps.
- `SMS_SECRET`: a private, high-entropy secret sent in the webhook's `x-secret` header.
- `SMS_SENDER_KEYWORDS`: comma-separated sender text accepted from bank/UPI SMS notifications, for example `airtel,airpay`.

The Merchant UPI ID saved in Admin Panel settings is the source of truth. The server uses `UPI_ID` only when the database has no saved ID. Save a valid `name@handle` value; it is stored and used exactly as entered, without trimming, lowercasing, or length truncation. Checkout QR links are generated from the current server setting, not an old order or inventory value. Deploy the existing Render service after setting the environment values. For Vercel-hosted frontend deployments, keep the backend URL configured in `vercel.json`; browser API calls use `/api/...` and are forwarded to that same server. A trusted SMS relay may record bank SMS evidence by sending:

```text
POST https://YOUR_BACKEND_HOST/api/sms-webhook
Content-Type: application/json
x-secret: YOUR_SMS_SECRET

{"sender":"AIRTEL","message":"INR 340.00 credited ... UTR 123456789012"}
```

The notification must include a configured sender keyword, `credited` or `received`, a rupee amount prefixed by `Rs`, `INR`, or `₹`, and a labeled 12-digit UTR/ref number. The webhook records every accepted SMS and automatically delivers only when the UTR, amount, order creation time, and pending order status match. Keep `SMS_SECRET` only in the backend and SMS relay; never put it in frontend code. Review the payment directly in the bank account before using **Update Delivered Vault ID** in the logged-in admin panel.

### Verify the unpaid-order safeguard

1. Deploy the server with `DATABASE_URL`, `UPI_ID`, and `PAYEE_NAME` set, and add at least one test credential to the vault.
2. Open checkout and note the site stock count. Scan/open the QR, then press Back/close without submitting a UTR. Confirm there is no order in Admin, no order-expired card, and stock is unchanged.
3. Open checkout again and press **I have paid — submit UTR** with a valid 12-digit UTR. Confirm the order now appears as pending in Admin and stock decreases by the requested quantity. Before approval, the private access endpoint must not return credentials.
4. Test SMS auto-delivery with an accepted sender and matching credited amount/UTR after UTR submission. Confirm the order becomes paid and credentials appear once. Send the same notification again and verify no second ID is assigned.
5. For manual delivery, submit a different UTR and use the authenticated Admin **Update Delivered Vault ID** action. Then send a matching SMS and confirm it is logged as ignored/already paid with no second ID.
6. Reject another pending order and confirm the reserved stock is immediately restored. For draft cleanup, leave checkout open for more than 15 minutes; confirm the draft disappears silently and no stock or expired-order card appears.
7. For old fake-UTR orders, review their IDs in Admin and call the protected cleanup endpoint with only those IDs. Confirm they become rejected and their reservations are restored.

## Guarantee Claims

Delivered 7-day and 1-month guarantee orders show the original expiry date and allow one open claim per order. Customers can report an issue and attach an optional PNG, JPEG, or WebP screenshot up to 1 MB. Claims and their audit/replacement history are persisted with the existing PostgreSQL `roshanbrand_state` JSONB state; screenshots are excluded from the polled admin state and loaded only when an admin views them.

Admins review and approve a claim before resolving it with a replacement or refund, or reject it with a customer-visible reason. Replacement IDs are assigned from the matching guarantee vault pool and replace only the selected account in the original order. The original delivery date and expiry are preserved. The default maximum is two replacements per order and can be changed in Prices & Site Control (0–20). A refund action is an audit record only: the admin must send the money through the payment provider and confirm that first. Admin actions use the configurable audit display name; the current panel uses one shared admin login.

The admin claims and order views are server-filtered and paginated in batches of 50; older records can be loaded on demand. State-changing API requests lock and refresh the shared PostgreSQL state row before applying changes. Admin login sessions are stored in PostgreSQL so they work across application instances.

24-hour rental credentials are hidden by the panel after their expiry and are not returned by the private order-access API. This panel cannot revoke or disable the account at IRCTC; account access must be disabled externally if the rental product requires that guarantee.
