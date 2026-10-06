import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const [mode, command, ...args] = process.argv.slice(2);
const env = {};

for (const file of ['.env', ...(mode === 'development' ? ['.env.development'] : [])]) {
  if (existsSync(file)) Object.assign(env, parseEnv(readFileSync(file, 'utf8')));
}

Object.assign(env, process.env);

const apiBaseUrl = (env.API_BASE_URL ?? '/api').replace(/\/$/, '');

const child = spawn(
  process.execPath,
  [
    'node_modules/@angular/cli/bin/ng.js',
    command,
    ...args,
    '--define',
    `API_BASE_URL=${JSON.stringify(apiBaseUrl)}`,
  ],
  { stdio: 'inherit', env },
);

child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
