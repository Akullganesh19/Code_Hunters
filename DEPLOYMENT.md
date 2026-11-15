# Deploy TraceLayer

The Vercel production frontend is live at `https://tracelayer-eight.vercel.app`. Its Production settings already point to `https://tracelayer-api.onrender.com` and `https://tracelayer-agent.onrender.com`. The proxy adds the private service token at the edge, so it is not sent to the browser and large analysis requests do not pass through a serverless function body limit.

## 1. Create the Render services

Create a Render Blueprint from this repository's `render.yaml`. It defines two always-on Starter web services and a 1 GB persistent disk for redacted agent run and audit metadata. During initial Blueprint creation, Render asks for:

- `CORS_ORIGIN` on each service: enter `https://tracelayer-eight.vercel.app` (no trailing slash).
- `AGENT_MODEL_API_KEY`: enter a newly generated Groq API key. Do not commit it or paste it into source files.

Render generates `TRACELAYER_INTERNAL_TOKEN` in a shared environment group for both services. After creation, replace that value with the matching token already stored in Vercel's Production environment (the token has been copied to the local clipboard for setup). Wait for both health checks to pass. Confirm the service URLs are `https://tracelayer-api.onrender.com` and `https://tracelayer-agent.onrender.com`; if Render assigns different URLs, update `RENDER_API_URL` and `RENDER_AGENT_URL` in the Vercel project and redeploy.

## 2. Vercel environment setup (already done)

The `tracelayer` Vercel project uses the repository root, `vercel.ts`, `npm run build`, and `frontend/dist`. Its Production environment already contains:

- `RENDER_API_URL`: `https://tracelayer-api.onrender.com`.
- `RENDER_AGENT_URL`: `https://tracelayer-agent.onrender.com`.
- `TRACELAYER_INTERNAL_TOKEN`: a Vercel secret to match in Render.

After Render is live, verify the frontend and `/api/health`, `/api/agent/health`, and agent capabilities endpoint. If you change the Vercel origin, update `CORS_ORIGIN` on both Render services and redeploy them.

## Operating notes

- The Groq key is stored only in Render. Rotate any key previously posted in chat before making the app public.
- The agent SQLite file contains workflow state and redacted audit metadata only; uploaded transaction datasets are not stored there.
- Starter compute and the persistent disk are billable. Render free services sleep and have ephemeral filesystems, so this Blueprint intentionally uses persistent, always-on services.
- Vercel and Render deploy from the connected GitHub repository. Keep secrets in provider environment settings only.
