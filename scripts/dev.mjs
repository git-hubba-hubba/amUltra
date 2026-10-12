import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Start both services from their package directories so backend/.env is loaded.
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error) { if (error.code !== 'ESRCH') console.error('Could not stop a development service:', error.code); }
  }
  process.exitCode = code;
}
for (const path of ['../backend/', '../frontend/amethyst2/']) {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
    cwd: fileURLToPath(new URL(path, import.meta.url)), stdio: 'inherit', detached: process.platform !== 'win32',
  });
  children.push(child);
  child.on('error', error => { console.error('Development service could not start:', error.code); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
