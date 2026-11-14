import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const npmCli = process.env.npm_execpath;
const spawnNpm = (args, options = {}) => spawn(
  npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm'),
  npmCli ? [npmCli, ...args] : args,
  {
  ...options,
  stdio: 'inherit',
  },
);
const backend = spawnNpm(['run', 'dev:backend']);
const agent = spawnNpm(['--prefix', 'upgrades/agent-platform', 'run', 'dev']);
let frontend;
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  frontend?.kill('SIGTERM');
  agent.kill('SIGTERM');
  backend.kill('SIGTERM');
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
backend.on('exit', (code) => {
  if (!stopping) {
    console.error(`Backend exited with code ${code ?? 'unknown'}.`);
    stop();
    process.exitCode = code ?? 1;
  }
});

agent.on('exit', (code) => {
  if (!stopping) {
    console.error(`Agent service exited with code ${code ?? 'unknown'}.`);
    stop();
    process.exitCode = code ?? 1;
  }
});

for (let attempt = 0; attempt < 40; attempt++) {
  if (backend.exitCode !== null) {
    stop();
    process.exitCode = backend.exitCode ?? 1;
    break;
  }

  try {
    const [apiResponse, agentResponse] = await Promise.all([
      fetch('http://127.0.0.1:3001/api/health'),
      fetch('http://127.0.0.1:3100/api/agent/health'),
    ]);
    if (apiResponse.ok && agentResponse.ok) {
      frontend = spawnNpm(['run', 'dev:frontend']);
      frontend.on('exit', (code) => {
        if (!stopping) {
          stop();
          process.exitCode = code ?? 1;
        }
      });
      break;
    }
  } catch {
    // The API is still starting.
  }

  await delay(250);
}

if (!frontend && !stopping && process.exitCode === undefined) {
  console.error('The API services did not become ready.');
  stop();
  process.exitCode = 1;
}
