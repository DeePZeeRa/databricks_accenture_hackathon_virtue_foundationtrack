# Free Hosting Deployment Guide

This project is already set up for a split deployment:

- Frontend: Vercel free static hosting
- Backend: Render free web service

The frontend reads the backend URL from `VITE_API_URL`, and the backend allows CORS from your deployed frontend domain.

## 1. Deploy the backend on Render

1. Push this repository to GitHub.
2. Open Render and create a new Web Service from the repository.
3. Use the `backend` folder as the root directory.
4. Let Render use `backend/render.yaml`.
5. Set these required environment variables in Render:
   - `DATABRICKS_HOST`
   - `DATABRICKS_TOKEN`
   - `DATABRICKS_HTTP_PATH` or `DATABRICKS_SQL_WAREHOUSE_ID`
   - `DATABRICKS_CATALOG=virtue_foundation`
   - `DATABRICKS_SCHEMA=ghana`
   - `LLM_ENDPOINT`
   - `EMBED_ENDPOINT`
   - `SECRET_KEY` at least 32 characters
   - `CORS_ORIGINS`
6. Redeploy the service.

Suggested `CORS_ORIGINS` value while testing:

```text
http://localhost:5173,https://your-vercel-app.vercel.app
```

If you only want the demo mode to work without live Databricks access, leave the Databricks secrets empty and the backend will fall back to bundled FAISS and CSV data where possible.

## 2. Deploy the frontend on Vercel

1. Open Vercel and import the same GitHub repository.
2. Set the Root Directory to `frontend`.
3. Vercel should detect Vite automatically.
4. Add this environment variable in Vercel:
   - `VITE_API_URL` = your Render backend URL, for example `https://virtue-foundation-api.onrender.com`
5. Deploy the project.

The frontend already has a SPA rewrite in `frontend/vercel.json`, so direct navigation to routes like `/map` and `/agent` works correctly.

## 3. Verify the deployment

After both services are live, check these URLs:

- Backend health: `https://your-render-backend.onrender.com/health`
- Backend root: `https://your-render-backend.onrender.com/`
- Frontend: your Vercel URL

If the frontend loads but the dashboard is empty, the usual causes are:

1. `VITE_API_URL` is missing or points to the wrong backend.
2. `CORS_ORIGINS` does not include the Vercel domain.
3. The Databricks credentials are not valid, so the backend is running in fallback mode.

## 4. Local development

Backend:

```bash
cd backend
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## 5. Recommended production env values

- `ENVIRONMENT=production`
- `LOG_LEVEL=INFO`
- `RATE_LIMIT_PER_MINUTE=20`
- `AGENT_TIMEOUT_SECONDS=180`
- `PYTHON_VERSION=3.11.9`

If you later change the frontend domain, update `CORS_ORIGINS` in Render and redeploy the backend.