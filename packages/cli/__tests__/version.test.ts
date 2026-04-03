import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'dist', 'index.js');
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
  version: string;
};

describe('cli version', () => {
  it('prints the package version', () => {
    const stdout = execFileSync('node', [CLI, '--version'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    expect(stdout.trim()).toBe(packageJson.version);
  });
});
