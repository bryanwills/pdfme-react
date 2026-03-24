import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'dist', 'index.js');
const PRELOAD = pathToFileURL(join(__dirname, 'fixtures', 'fetch-fixture-loader.mjs')).href;
const TMP = join(__dirname, '..', '.test-tmp-examples-integration');
const ASSETS_DIR = resolve(__dirname, '..', '..', '..', 'playground', 'public', 'template-assets');
const FONT_FIXTURES_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'generator',
  '__tests__',
  'assets',
  'fonts',
);

function createFixtureEnv(rootDir: string): NodeJS.ProcessEnv {
  const homeDir = join(rootDir, 'home');
  return {
    ...process.env,
    HOME: homeDir,
    PDFME_EXAMPLES_BASE_URL: 'https://fixtures.example.com/template-assets',
    PDFME_TEST_ASSETS_DIR: ASSETS_DIR,
    PDFME_TEST_FONT_FIXTURES_DIR: FONT_FIXTURES_DIR,
  };
}

function runCli(
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', ['--import', PRELOAD, CLI, ...args], {
      encoding: 'utf8',
      timeout: 60000,
      env: options.env,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: error.status ?? 1,
    };
  }
}

describe('examples integration smoke', () => {
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('uses a playground example to generate a PDF through the CLI', () => {
    mkdirSync(TMP, { recursive: true });
    const env = createFixtureEnv(TMP);
    const jobPath = join(TMP, 'invoice-job.json');
    const pdfPath = join(TMP, 'invoice.pdf');

    const examplesResult = runCli(['examples', 'invoice', '--withInputs', '-o', jobPath, '--json'], {
      env,
    });
    expect(examplesResult.exitCode).toBe(0);

    const examplesPayload = JSON.parse(examplesResult.stdout);
    expect(examplesPayload.ok).toBe(true);
    expect(examplesPayload.outputPath).toBe(jobPath);
    expect(existsSync(jobPath)).toBe(true);

    const generateResult = runCli(['generate', jobPath, '-o', pdfPath, '--json'], { env });
    expect(generateResult.exitCode).toBe(0);

    const payload = JSON.parse(generateResult.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.pdf).toBe(pdfPath);
    expect(existsSync(pdfPath)).toBe(true);
  });

  it('lists manifest metadata through the CLI', () => {
    mkdirSync(TMP, { recursive: true });
    const result = runCli(['examples', '--list', '--json'], {
      env: createFixtureEnv(TMP),
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.source).toBe('remote');
    expect(Array.isArray(payload.manifest.templates)).toBe(true);
    expect(payload.manifest.templates.length).toBeGreaterThan(0);
  });

  it(
    'generates every playground example through examples -w and generate',
    () => {
      mkdirSync(TMP, { recursive: true });
      const env = createFixtureEnv(TMP);
      const manifest = JSON.parse(readFileSync(join(ASSETS_DIR, 'manifest.json'), 'utf8')) as {
        templates: Array<{ name: string }>;
      };

      for (const { name } of manifest.templates) {
        const jobPath = join(TMP, `${name}.job.json`);
        const pdfPath = join(TMP, `${name}.pdf`);

        const examplesResult = runCli(['examples', name, '--withInputs', '-o', jobPath, '--json'], {
          env,
        });
        if (examplesResult.exitCode !== 0) {
          throw new Error(
            `Example "${name}" failed to export.\nstdout:\n${examplesResult.stdout}\nstderr:\n${examplesResult.stderr}`,
          );
        }

        const examplePayload = JSON.parse(examplesResult.stdout);
        expect(examplePayload.ok).toBe(true);
        expect(examplePayload.outputPath).toBe(jobPath);

        const job = JSON.parse(readFileSync(jobPath, 'utf8'));
        expect(job).toHaveProperty('template');
        expect(Array.isArray(job.inputs)).toBe(true);
        expect(existsSync(jobPath)).toBe(true);

        const generateResult = runCli(['generate', jobPath, '-o', pdfPath, '--json'], { env });
        if (generateResult.exitCode !== 0) {
          throw new Error(
            `Example "${name}" failed to generate via CLI.\nJob:\n${JSON.stringify(job, null, 2)}\nstdout:\n${generateResult.stdout}\nstderr:\n${generateResult.stderr}`,
          );
        }

        const payload = JSON.parse(generateResult.stdout);
        expect(payload.ok).toBe(true);
        expect(payload.pdf).toBe(pdfPath);
        expect(existsSync(pdfPath)).toBe(true);
      }
    },
    180000,
  );
});
