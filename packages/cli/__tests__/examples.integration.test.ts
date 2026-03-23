import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import examplesCmd from '../src/commands/examples.js';
import { CLI_VERSION } from '../src/version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'dist', 'index.js');
const TMP = join(__dirname, '..', '.test-tmp-examples-integration');
const ASSETS_DIR = resolve(__dirname, '..', '..', '..', 'playground', 'public', 'template-assets');

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      timeout: 30000,
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

function buildFetchStub() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const baseUrl = 'https://fixtures.example.com/template-assets';
    const relativePath = url.replace(`${baseUrl}/`, '');
    const filePath = join(ASSETS_DIR, relativePath);

    return new Response(readFileSync(filePath, 'utf8'), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('examples integration smoke', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PDFME_EXAMPLES_BASE_URL;
    delete process.env.PDFME_EXAMPLES_CACHE_DIR;
    rmSync(TMP, { recursive: true, force: true });
  });

  it('uses a playground example to generate a PDF through the CLI', async () => {
    mkdirSync(TMP, { recursive: true });
    process.env.PDFME_EXAMPLES_BASE_URL = 'https://fixtures.example.com/template-assets';
    process.env.PDFME_EXAMPLES_CACHE_DIR = join(TMP, 'cache');
    vi.stubGlobal('fetch', buildFetchStub());

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const jobPath = join(TMP, 'invoice-job.json');
    const pdfPath = join(TMP, 'invoice.pdf');

    await examplesCmd.run!({
      args: {
        list: false,
        name: 'invoice',
        output: jobPath,
        withInputs: true,
        latest: false,
        json: true,
      },
      rawArgs: [],
      cmd: examplesCmd,
    } as never);

    const examplesPayload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] ?? 'null'));
    expect(examplesPayload.ok).toBe(true);
    expect(examplesPayload.outputPath).toBe(jobPath);

    const generateResult = runCli(['generate', jobPath, '-o', pdfPath, '--json']);
    expect(generateResult.exitCode).toBe(0);

    const payload = JSON.parse(generateResult.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.pdf).toBe(pdfPath);
  });

  it('uses the cached manifest after remote fetch failures', async () => {
    mkdirSync(TMP, { recursive: true });
    process.env.PDFME_EXAMPLES_BASE_URL = 'https://fixtures.example.com/template-assets';
    process.env.PDFME_EXAMPLES_CACHE_DIR = join(TMP, 'cache-offline');
    vi.stubGlobal('fetch', buildFetchStub());

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await examplesCmd.run!({
      args: { list: true, name: undefined, latest: false, json: true },
      rawArgs: [],
      cmd: examplesCmd,
    } as never);

    expect(JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] ?? 'null')).source).toBe('remote');

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error(`manifest offline for ${CLI_VERSION}`);
    }));

    await examplesCmd.run!({
      args: { list: true, name: undefined, latest: false, json: true },
      rawArgs: [],
      cmd: examplesCmd,
    } as never);

    expect(JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] ?? 'null')).source).toBe('cache');
  });
});
