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

Stock shown in the storefront is capped by both the configured display limit and the number of unassigned credentials in that product's vault pool. Add real credentials to the Admin Vault before making a product available; a fresh database starts with an empty vault.

## Guarantee Claims

Delivered 7-day and 1-month guarantee orders show the original expiry date and allow one open claim per order. Customers can report an issue and attach an optional PNG, JPEG, or WebP screenshot up to 1 MB. Claims and their audit/replacement history are persisted with the existing PostgreSQL `roshanbrand_state` JSONB state; screenshots are excluded from the polled admin state and loaded only when an admin views them.

Admins review and approve a claim before resolving it with a replacement or refund, or reject it with a customer-visible reason. Replacement IDs are assigned from the matching guarantee vault pool and replace only the selected account in the original order. The original delivery date and expiry are preserved. The default maximum is two replacements per order and can be changed in Prices & Site Control (0–20). A refund action is an audit record only: the admin must send the money through the payment provider and confirm that first. Admin actions use the configurable audit display name; the current panel uses one shared admin login.

The admin claims and order views are server-filtered and paginated in batches of 50; older records can be loaded on demand. State-changing API requests lock and refresh the shared PostgreSQL state row before applying changes. Admin login sessions are stored in PostgreSQL so they work across application instances.

24-hour rental credentials are hidden by the panel after their expiry and are not returned by the private order-access API. This panel cannot revoke or disable the account at IRCTC; account access must be disabled externally if the rental product requires that guarantee.
