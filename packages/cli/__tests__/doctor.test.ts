import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'dist', 'index.js');
const TMP = join(__dirname, '..', '.test-tmp-doctor');

function runCli(
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      timeout: 30000,
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

describe('doctor command', () => {
  beforeAll(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('reports environment health as structured JSON', () => {
    const result = runCli(['doctor', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.target).toBe('environment');
    expect(parsed.healthy).toBe(true);
    expect(parsed.environment.nodeVersion).toMatch(/^v/);
    expect(parsed.environment.cliVersion).toBeTruthy();
    expect(parsed.environment.cwd.path).toBeTruthy();
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(Array.isArray(parsed.warnings)).toBe(true);
  });

  it('reports basePdf and missing-font issues without crashing', () => {
    const file = join(TMP, 'doctor-missing-assets.json');
    writeFileSync(
      file,
      JSON.stringify({
        basePdf: './missing.pdf',
        schemas: [[
          {
            name: 'title',
            type: 'text',
            fontName: 'NotoSerifJP',
            position: { x: 20, y: 20 },
            width: 170,
            height: 15,
          },
        ]],
      }),
    );

    const result = runCli(['doctor', file, '--json']);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.target).toBe('input');
    expect(parsed.healthy).toBe(false);
    expect(parsed.diagnosis.basePdf.kind).toBe('pdfPath');
    expect(parsed.diagnosis.basePdf.exists).toBe(false);
    expect(parsed.diagnosis.fonts.missingFonts).toEqual(['NotoSerifJP']);
    expect(parsed.issues).toContain(
      `Template references font(s) that are not available by default: NotoSerifJP. Provide them via generate --font or unified job options.font.`,
    );
    expect(parsed.issues.some((issue: string) => issue.includes('Base PDF file not found'))).toBe(true);
  });

  it('treats a job with explicit fonts as healthy', () => {
    const file = join(TMP, 'doctor-job.json');
    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              fontName: 'NotoSerifJP',
              position: { x: 20, y: 20 },
              width: 170,
              height: 15,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
        options: {
          font: {
            NotoSerifJP: {
              data: 'https://fonts.example.com/NotoSerifJP.ttf',
            },
          },
        },
      }),
    );

    const result = runCli(['doctor', file, '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.healthy).toBe(true);
    expect(parsed.mode).toBe('job');
    expect(parsed.validation.valid).toBe(true);
    expect(parsed.diagnosis.fonts.explicitFonts).toEqual(['NotoSerifJP']);
    expect(parsed.diagnosis.fonts.effectiveFonts).toEqual(['NotoSerifJP', 'Roboto']);
    expect(parsed.issues).toEqual([]);
  });

  it('fails when CJK auto-font needs a non-writable empty cache', () => {
    const homeDir = join(TMP, 'readonly-home');
    const file = join(TMP, 'doctor-cjk-job.json');
    mkdirSync(homeDir, { recursive: true });

    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              position: { x: 20, y: 20 },
              width: 170,
              height: 15,
            },
          ]],
        },
        inputs: [{ title: 'こんにちは' }],
      }),
    );

    chmodSync(homeDir, 0o555);

    try {
      const result = runCli(['doctor', file, '--json'], {
        env: { ...process.env, HOME: homeDir },
      });

      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.healthy).toBe(false);
      expect(parsed.diagnosis.fonts.autoNotoSansJP.needed).toBe(true);
      expect(parsed.diagnosis.fonts.autoNotoSansJP.cached).toBe(false);
      expect(parsed.issues.some((issue: string) => issue.includes('font cache directory is not writable'))).toBe(true);
    } finally {
      chmodSync(homeDir, 0o755);
    }
  });
});
