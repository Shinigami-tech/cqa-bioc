# Deploying the UI to Vercel

The UI (`web/`) is static. `/api/*` is proxied to the FastAPI backend, so the browser never hits CORS.

1. Replace `BACKEND_HOST` in `vercel.json` with the backend's public host (Render, Railway or a VM; or FastAPI as a Vercel Python function).
2. Copy `web/*` and this `vercel.json` into one folder, or set Root Directory = `web` and keep `vercel.json` there.
3. Import the repo in Vercel (Framework: Other, no build command).

The backend needs persistent storage (Postgres or SQLite on a disk), because Vercel functions have no persistent filesystem.
