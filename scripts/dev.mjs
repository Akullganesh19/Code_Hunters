import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const backend = spawn(npm, ['run', 'dev:backend'], {stdio: 'inherit'});
let frontend;
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  frontend?.kill('SIGTERM');
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

for (let attempt = 0; attempt < 40; attempt++) {
  if (backend.exitCode !== null) {
    stop();
    process.exitCode = backend.exitCode ?? 1;
    break;
  }

  try {
    const response = await fetch('http://127.0.0.1:3001/api/health');
    if (response.ok) {
      frontend = spawn(npm, ['run', 'dev:frontend'], {stdio: 'inherit'});
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
  console.error('Backend did not become ready at http://127.0.0.1:3001.');
  stop();
  process.exitCode = 1;
}
