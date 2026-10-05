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
3. Run the app:
   `npm run dev`

## Admin Access

Set `ADMIN_PASSWORD` and `ADMIN_RECOVERY_KEY` in a local `.env` file before starting the server. On first startup, the server stores a salted password hash in `data/admin_auth.json`; later password changes are saved there. The recovery key is required for the Admin panel's Forgot Password flow. Keep both values private and do not commit `.env` or `data/admin_auth.json`.

## Deploy on Render and Vercel

Create a Render Blueprint from this repository using `render.yaml`. Set `ADMIN_PASSWORD` and `ADMIN_RECOVERY_KEY` as private environment variables in the Render dashboard. The service uses a persistent disk at `/var/data` for orders, inventory, store settings, and the admin password hash. On first startup, existing `data/roshanbrand_store.json` is copied as the initial store database. Store updates are written atomically, and the server will fail to start rather than replace an unreadable saved database with seed defaults.

The `start` script builds the Vite frontend before starting the server, so deployments that invoke `bun run start` directly still create the required `dist/index.html`.

If the frontend is deployed on Vercel, keep the backend on Render. `vercel.json` forwards every `/api/*` request to `https://roshanbrand.onrender.com`, so store, orders, events, and admin login requests reach the backend without cross-origin cookie issues. Deploy this repository to Vercel with the Vite build output (`dist`), and keep the Render service and its environment variables configured. Set the custom domain on Vercel only if Vercel is serving the frontend; the Render service URL must remain available as the API backend.

For a Render-only deployment, point the custom domain directly to the Render service; the Vercel rewrite is not used.
