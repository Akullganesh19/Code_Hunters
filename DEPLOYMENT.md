# Deploy TraceLayer

The production layout uses Vercel for the static frontend and same-origin API proxy, and Render for the API and agent services. The proxy adds the private service token at the edge, so it is not sent to the browser and large analysis requests do not pass through a serverless function body limit.

## 1. Create the Render services

Create a Render Blueprint from this repository's `render.yaml`. It defines two always-on Starter web services and a 1 GB persistent disk for redacted agent run and audit metadata. During initial Blueprint creation, Render asks for:

- `CORS_ORIGIN` on each service: enter the final Vercel site origin, such as `https://your-project.vercel.app` (no trailing slash).
- `AGENT_MODEL_API_KEY`: enter a newly generated Groq API key. Do not commit it or paste it into source files.

Render generates `TRACELAYER_INTERNAL_TOKEN` in a shared environment group for both services. Wait for both health checks to pass. The expected service origins are `https://tracelayer-api.onrender.com` and `https://tracelayer-agent.onrender.com`; use the actual service URLs shown by Render if those names are unavailable.

## 2. Deploy the Vercel frontend

Import this repository into Vercel with the repository root as the project root. Vercel uses `vercel.ts` and `npm run build`; the output is `frontend/dist`. Add these project environment variables for Production (and Preview if you want preview builds to use the same services):

- `RENDER_API_URL`: the backend service origin from Render.
- `RENDER_AGENT_URL`: the agent service origin from Render.
- `TRACELAYER_INTERNAL_TOKEN`: the exact generated value from the Render environment group.

Deploy, then verify the frontend and `/api/health`, `/api/agent/health`, and agent capabilities endpoint. If you changed the Vercel origin after creating Render, update `CORS_ORIGIN` on both Render services and redeploy them.

## Operating notes

- The Groq key is stored only in Render. Rotate any key previously posted in chat before making the app public.
- The agent SQLite file contains workflow state and redacted audit metadata only; uploaded transaction datasets are not stored there.
- Starter compute and the persistent disk are billable. Render free services sleep and have ephemeral filesystems, so this Blueprint intentionally uses persistent, always-on services.
- Vercel and Render deploy from the connected GitHub repository. Keep secrets in provider environment settings only.
