import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, extname, basename, join, resolve } from 'node:path';
import { fail, isOptionProvided } from './contract.js';

export interface UnifiedJob {
  template: Record<string, unknown>;
  inputs: Record<string, unknown>[];
  options?: unknown;
}

interface LoadedInput {
  template: Record<string, unknown>;
  inputs: Record<string, unknown>[];
  options?: unknown;
  templateDir?: string;
}

export function readJsonFile(filePath: string): unknown {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    fail(`File not found: ${resolvedPath}`, { code: 'EIO', exitCode: 3 });
  }

  try {
    const content = readFileSync(resolvedPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    fail(
      `Failed to parse JSON file: ${resolvedPath}. ${error instanceof Error ? error.message : String(error)}`,
      {
        code: 'EIO',
        exitCode: 3,
        cause: error,
      },
    );
  }
}

export function loadInput(args: {
  _: string[];
  template?: string;
  inputs?: string;
}): LoadedInput {
  const positionalFile = args._[0];

  if (positionalFile && !args.template && !args.inputs) {
    const jobFilePath = resolve(positionalFile);
    const data = readJsonFile(jobFilePath) as Record<string, unknown>;
    if ('template' in data && 'inputs' in data) {
      return {
        template: data.template as Record<string, unknown>,
        inputs: data.inputs as Record<string, unknown>[],
        options: data.options,
        templateDir: dirname(jobFilePath),
      };
    }
    fail(
      'Positional file must be a unified format with "template" and "inputs" keys. Use -t and -i for separate files.',
      { code: 'EARG', exitCode: 1 },
    );
  }

  if (args.template) {
    if (!args.inputs) {
      fail('--inputs (-i) is required when using --template (-t).', {
        code: 'EARG',
        exitCode: 1,
      });
    }
    const templatePath = resolve(args.template);
    const template = readJsonFile(templatePath) as Record<string, unknown>;
    const inputs = readJsonFile(resolve(args.inputs)) as Record<string, unknown>[];
    return { template, inputs, templateDir: dirname(templatePath) };
  }

  fail(
    'No input provided. Use a unified job file or pass --template/-t with --inputs/-i.',
    { code: 'EARG', exitCode: 1 },
  );
}

export function resolveBasePdf(
  template: Record<string, unknown>,
  basePdfArg: string | undefined,
  templateDir?: string,
): Record<string, unknown> {
  if (basePdfArg) {
    const resolvedBasePdf = resolve(basePdfArg);
    if (!existsSync(resolvedBasePdf)) {
      fail(`Base PDF file not found: ${resolvedBasePdf}`, {
        code: 'EIO',
        exitCode: 3,
      });
    }
    const pdfData = new Uint8Array(readFileSync(resolvedBasePdf));
    return { ...template, basePdf: pdfData };
  }

  const basePdf = template.basePdf;
  if (typeof basePdf === 'string' && basePdf.endsWith('.pdf') && !basePdf.startsWith('data:')) {
    const resolvedBasePdf = templateDir ? resolve(templateDir, basePdf) : resolve(basePdf);
    if (!existsSync(resolvedBasePdf)) {
      fail(`Base PDF file not found: ${resolvedBasePdf}`, {
        code: 'EIO',
        exitCode: 3,
      });
    }
    const pdfData = new Uint8Array(readFileSync(resolvedBasePdf));
    return { ...template, basePdf: pdfData };
  }

  return template;
}

export function getImageOutputPaths(
  pdfOutputPath: string,
  pageCount: number,
  imageFormat: string,
): string[] {
  const dir = dirname(pdfOutputPath);
  const base = basename(pdfOutputPath, extname(pdfOutputPath));
  const ext = imageFormat === 'jpeg' ? 'jpg' : 'png';
  return Array.from({ length: pageCount }, (_, i) => join(dir, `${base}-${i + 1}.${ext}`));
}

export function writeOutput(filePath: string, data: Uint8Array | ArrayBuffer): void {
  try {
    const dir = dirname(filePath);
    if (dir && dir !== '.' && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  } catch (error) {
    fail(`Failed to write file: ${filePath}. ${error instanceof Error ? error.message : String(error)}`, {
      code: 'EIO',
      exitCode: 3,
      cause: error,
    });
  }
}

export function readPdfFile(filePath: string): Uint8Array {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    fail(`PDF file not found: ${resolvedPath}`, { code: 'EIO', exitCode: 3 });
  }

  try {
    return new Uint8Array(readFileSync(resolvedPath));
  } catch (error) {
    fail(`Failed to read PDF file: ${resolvedPath}. ${error instanceof Error ? error.message : String(error)}`, {
      code: 'EIO',
      exitCode: 3,
      cause: error,
    });
  }
}

// Standard paper sizes in mm (portrait)
const PAPER_SIZES: Record<string, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
  B4: [250, 353],
  B5: [176, 250],
  Letter: [216, 279],
  Legal: [216, 356],
  Tabloid: [279, 432],
};

export function detectPaperSize(width: number, height: number): string | null {
  const tolerance = 2; // mm
  for (const [name, [w, h]] of Object.entries(PAPER_SIZES)) {
    if (
      (Math.abs(width - w) <= tolerance && Math.abs(height - h) <= tolerance) ||
      (Math.abs(width - h) <= tolerance && Math.abs(height - w) <= tolerance)
    ) {
      const orientation = width < height ? 'portrait' : 'landscape';
      return `${name} ${orientation}`;
    }
  }
  return null;
}

export function parsePageRange(rangeStr: string, totalPages: number): number[] {
  const pages: Set<number> = new Set();
  for (const part of rangeStr.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) {
      fail(`Invalid page range: ${JSON.stringify(rangeStr)}. Empty segments are not allowed.`, {
        code: 'EARG',
        exitCode: 1,
      });
    }
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      if (
        !startStr ||
        !endStr ||
        !/^\d+$/.test(startStr) ||
        !/^\d+$/.test(endStr)
      ) {
        fail(`Invalid page range segment: ${JSON.stringify(trimmed)}. Use formats like "1-3" or "2".`, {
          code: 'EARG',
          exitCode: 1,
        });
      }

      const start = Number.parseInt(startStr, 10);
      const end = Number.parseInt(endStr, 10);
      if (start < 1 || end < 1 || start > end || end > totalPages) {
        fail(
          `Invalid page range segment: ${JSON.stringify(trimmed)}. Pages must be between 1 and ${totalPages}.`,
          {
            code: 'EARG',
            exitCode: 1,
          },
        );
      }

      for (let i = start; i <= end; i++) pages.add(i);
    } else {
      if (!/^\d+$/.test(trimmed)) {
        fail(`Invalid page range segment: ${JSON.stringify(trimmed)}. Use formats like "1-3" or "2".`, {
          code: 'EARG',
          exitCode: 1,
        });
      }
      const p = Number.parseInt(trimmed, 10);
      if (p < 1 || p > totalPages) {
        fail(`Invalid page number: ${p}. Pages must be between 1 and ${totalPages}.`, {
          code: 'EARG',
          exitCode: 1,
        });
      }
      pages.add(p);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

export async function readJsonFromStdin(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const content = Buffer.concat(chunks).toString('utf8').trim();
  if (!content) {
    fail('No JSON input received on stdin.', { code: 'EARG', exitCode: 1 });
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    fail(`Failed to parse JSON from stdin. ${error instanceof Error ? error.message : String(error)}`, {
      code: 'EIO',
      exitCode: 3,
      cause: error,
    });
  }
}

export function ensureSafeDefaultOutputPath(options: {
  filePath: string;
  rawArgs: string[];
  optionName: string;
  optionAlias?: string | string[];
  defaultValue: string;
  force?: boolean;
}): void {
  const { filePath, rawArgs, optionName, optionAlias, defaultValue, force = false } = options;
  if (force || isOptionProvided(rawArgs, optionName, optionAlias) || filePath !== defaultValue) {
    return;
  }

  const resolvedPath = resolve(filePath);
  if (existsSync(resolvedPath)) {
    fail(
      `Refusing to overwrite implicit default output file: ${resolvedPath}. Use -o to choose an explicit path or --force to overwrite.`,
      { code: 'EARG', exitCode: 1 },
    );
  }
}
