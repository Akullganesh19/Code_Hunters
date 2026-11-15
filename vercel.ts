import {deploymentEnv, routes, type VercelConfig} from '@vercel/config/v1';

const apiOrigin = deploymentEnv('RENDER_API_URL');
const agentOrigin = deploymentEnv('RENDER_AGENT_URL');
const internalToken = deploymentEnv('TRACELAYER_INTERNAL_TOKEN');

export const config: VercelConfig = {
  buildCommand: 'npm run build',
  outputDirectory: 'frontend/dist',
  routes: [
    routes.rewrite('/api/agent/:path*', `${agentOrigin}/api/agent/:path*`, {
      requestHeaders: {'x-tracelayer-internal-token': internalToken},
    }),
    routes.rewrite('/api/:path*', `${apiOrigin}/api/:path*`, {
      requestHeaders: {'x-tracelayer-internal-token': internalToken},
    }),
    routes.rewrite('/(.*)', '/index.html'),
  ],
};
