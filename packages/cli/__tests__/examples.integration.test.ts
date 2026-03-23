import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaultFont } from '@pdfme/common';
import { generate } from '@pdfme/generator';
import * as schemas from '@pdfme/schemas';
import examplesCmd from '../src/commands/examples.js';
import { OFFICIAL_EXAMPLE_FONT_URLS } from '../src/example-fonts.js';
import { CLI_VERSION } from '../src/version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'dist', 'index.js');
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
const AUTO_NOTO_SANS_JP_URL =
  'https://github.com/google/fonts/raw/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf';
const ALL_PLUGINS = {
  text: schemas.text,
  multiVariableText: schemas.multiVariableText,
  image: schemas.image,
  signature: schemas.signature,
  svg: schemas.svg,
  table: schemas.table,
  ...schemas.barcodes,
  line: schemas.line,
  rectangle: schemas.rectangle,
  ellipse: schemas.ellipse,
  dateTime: schemas.dateTime,
  date: schemas.date,
  time: schemas.time,
  select: schemas.select,
  radioGroup: schemas.radioGroup,
  checkbox: schemas.checkbox,
};

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
  const fontFixtures: Record<string, string> = {
    [OFFICIAL_EXAMPLE_FONT_URLS.NotoSansJP]: join(FONT_FIXTURES_DIR, 'NotoSansJP-Regular.ttf'),
    [OFFICIAL_EXAMPLE_FONT_URLS.NotoSerifJP]: join(FONT_FIXTURES_DIR, 'NotoSerifJP-Regular.ttf'),
    [OFFICIAL_EXAMPLE_FONT_URLS['PinyonScript-Regular']]: join(
      FONT_FIXTURES_DIR,
      'PinyonScript-Regular.ttf',
    ),
    [AUTO_NOTO_SANS_JP_URL]: join(FONT_FIXTURES_DIR, 'NotoSansJP-Regular.ttf'),
  };

  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const baseUrl = 'https://fixtures.example.com/template-assets';
    const fontFixture = fontFixtures[url];
    if (fontFixture) {
      return new Response(readFileSync(fontFixture), {
        status: 200,
        headers: { 'content-type': 'font/ttf' },
      });
    }

    if (!url.startsWith(`${baseUrl}/`)) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    const relativePath = url.replace(`${baseUrl}/`, '');
    const filePath = join(ASSETS_DIR, relativePath);
    if (!existsSync(filePath)) {
      throw new Error(`Fixture not found for URL: ${url}`);
    }

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

  it(
    'generates every version-pinned playground example through examples -w and generate',
    async () => {
      mkdirSync(TMP, { recursive: true });
      process.env.PDFME_EXAMPLES_BASE_URL = 'https://fixtures.example.com/template-assets';
      process.env.PDFME_EXAMPLES_CACHE_DIR = join(TMP, 'cache-all');
      vi.stubGlobal('fetch', buildFetchStub());

      const manifest = JSON.parse(readFileSync(join(ASSETS_DIR, 'manifest.json'), 'utf8')) as {
        templates: Array<{ name: string }>;
      };
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      for (const { name } of manifest.templates) {
        const jobPath = join(TMP, `${name}.job.json`);

        await examplesCmd.run!({
          args: {
            list: false,
            name,
            output: jobPath,
            withInputs: true,
            latest: false,
            json: true,
          },
          rawArgs: [name, '--withInputs', '-o', jobPath, '--json'],
          cmd: examplesCmd,
        } as never);

        const examplePayload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] ?? 'null'));
        expect(examplePayload.ok).toBe(true);
        expect(examplePayload.outputPath).toBe(jobPath);
        const job = JSON.parse(readFileSync(jobPath, 'utf8'));
        expect(job).toHaveProperty('template');
        expect(Array.isArray(job.inputs)).toBe(true);

        try {
          const jobOptions =
            typeof job.options === 'object' && job.options !== null && !Array.isArray(job.options)
              ? (job.options as Record<string, unknown>)
              : {};
          const jobFont =
            typeof jobOptions.font === 'object' &&
            jobOptions.font !== null &&
            !Array.isArray(jobOptions.font)
              ? (jobOptions.font as Record<string, unknown>)
              : undefined;
          const pdf = await generate({
            template: job.template,
            inputs: job.inputs,
            options: {
              ...jobOptions,
              font: {
                ...(jobFont ?? {}),
                ...getDefaultFont(),
              },
            },
            plugins: ALL_PLUGINS,
          });
          expect(pdf.byteLength).toBeGreaterThan(0);
        } catch (error) {
          throw new Error(
            `Example "${name}" failed to generate.\nJob:\n${JSON.stringify(job, null, 2)}\n${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    },
    120000,
  );
});
