import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, loadEnv, type ProxyOptions} from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(projectRoot, '..');

export default defineConfig(({mode}) => {
  const serverEnv = loadEnv(mode, repositoryRoot, '');
  const internalToken = serverEnv.TRACELAYER_INTERNAL_TOKEN;
  const proxyTo = (target: string): ProxyOptions => ({
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyRequest) => {
        if (internalToken) proxyRequest.setHeader('x-tracelayer-internal-token', internalToken);
      });
    },
  });

  return {
    envDir: repositoryRoot,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(projectRoot, 'src'),
      },
    },
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api/agent': proxyTo('http://127.0.0.1:3100'),
        '/api': proxyTo('http://127.0.0.1:3001'),
      },
    },
  };
});
