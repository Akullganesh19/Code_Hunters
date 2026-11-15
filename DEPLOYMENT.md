# Deploy TraceLayer

The Vercel production frontend is live at `https://tracelayer-eight.vercel.app`. Its Production settings point to the live Render API and agent services. The proxy adds the private service token at the edge, so it is not sent to the browser and large analysis requests do not pass through a serverless function body limit.

## Current live preview

- Frontend: `https://tracelayer-eight.vercel.app`
- API: `https://tracelayer-api-bi7q.onrender.com`
- Agent: `https://tracelayer-agent.onrender.com`
- Both Render services currently run on the Free plan. Health checks and agent capabilities have been verified through the public Vercel URL.
- Groq chat is not configured yet. Add a newly generated Groq API key to `AGENT_MODEL_API_KEY` on the Render agent service to enable model responses. Rotate the key previously shared in chat before using it for a public deployment.
- The free Render agent has no persistent disk, so run history and redacted audit metadata can be lost when its instance restarts. Free services can also sleep while idle.

## 1. Create the Render services

For the durable, always-on setup, create a Render Blueprint from this repository's `render.yaml`. It defines two paid Starter web services and a 1 GB persistent disk for redacted agent run and audit metadata. During initial Blueprint creation, Render asks for:

- `CORS_ORIGIN` on each service: enter `https://tracelayer-eight.vercel.app` (no trailing slash).
- `AGENT_MODEL_API_KEY`: enter a newly generated Groq API key. Do not commit it or paste it into source files.

The current Vercel Production project has the internal service token in its encrypted environment settings. For a new paid Render deployment, set the same token on both services and confirm their actual service URLs. If the URLs change, update `RENDER_API_URL` and `RENDER_AGENT_URL` in the Vercel project and redeploy.

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
