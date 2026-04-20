import { readFileSync } from 'node:fs';

declare const __CLI_VERSION__: string | undefined;

function readPackageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      version?: string;
    };
    return packageJson.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const CLI_VERSION =
  typeof __CLI_VERSION__ === 'string' && __CLI_VERSION__.length > 0
    ? __CLI_VERSION__
    : readPackageVersion();
