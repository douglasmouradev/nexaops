import '../src/load-env';
import { execSync } from 'child_process';
import { resolve } from 'path';

const args = process.argv.slice(2).join(' ');
const apiDir = resolve(__dirname, '..');

execSync(`npx prisma ${args}`, {
  stdio: 'inherit',
  env: process.env,
  cwd: apiDir,
});
