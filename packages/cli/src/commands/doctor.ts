import { accessSync, constants, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { defineCommand } from 'citty';
import { checkGenerateProps, DEFAULT_FONT_NAME } from '@pdfme/common';
import { assertNoUnknownFlags, printJson, runWithContract } from '../contract.js';
import { detectCJKInInputs, detectCJKInTemplate } from '../cjk-detect.js';
import {
  inspectTemplate,
  KNOWN_TEMPLATE_KEYS,
  loadValidationSource,
  summarizeBasePdf,
  validateTemplate,
} from '../diagnostics.js';
import { NOTO_CACHE_FILE } from '../fonts.js';
import { CLI_VERSION } from '../version.js';

const doctorArgs = {
  file: {
    type: 'positional' as const,
    description: 'Optional template/job JSON file, or "-" for stdin',
    required: false,
  },
  json: { type: 'boolean' as const, description: 'Machine-readable JSON output', default: false },
  noAutoFont: {
    type: 'boolean' as const,
    description: 'Simulate generate with automatic CJK font download disabled',
    default: false,
  },
};

interface PathStatus {
  path: string;
  writable: boolean;
  checkedPath?: string;
  error?: string;
}

interface EnvironmentReport {
  nodeVersion: string;
  cliVersion: string;
  platform: string;
  arch: string;
  cwd: PathStatus;
  tempDir: PathStatus;
  homeDir: string;
  fontCache: {
    file: string;
    dir: string;
    cached: boolean;
    writable: boolean;
    checkedPath?: string;
    error?: string;
  };
}

interface BasePdfDiagnosis {
  kind: string;
  width?: number;
  height?: number;
  paperSize?: string | null;
  path?: string;
  resolvedPath?: string;
  exists?: boolean;
  issue?: string;
}

export default defineCommand({
  meta: {
    name: 'doctor',
    description: 'Diagnose the local pdfme CLI environment and input readiness',
  },
  args: doctorArgs,
  async run({ args, rawArgs }) {
    return runWithContract({ json: Boolean(args.json) }, async () => {
      assertNoUnknownFlags(rawArgs, doctorArgs);

      const environment = getEnvironmentReport();
      const inputRequested = Boolean(args.file);

      if (!inputRequested) {
        const issues = collectEnvironmentIssues(environment);
        const warnings = collectEnvironmentWarnings(environment);
        const healthy = issues.length === 0;

        if (args.json) {
          printJson({
            ok: true,
            target: 'environment',
            healthy,
            environment,
            issues,
            warnings,
          });
        } else {
          printEnvironmentReport(environment, issues, warnings);
        }

        if (!healthy) {
          process.exit(1);
        }
        return;
      }

      const source = await loadValidationSource(args.file, {
        noInputMessage: 'No diagnostic input provided. Pass a file path or pipe JSON via stdin.',
      });
      const inspection = inspectTemplate(source.template, source.templateDir);
      const validation = validateTemplate(source.template);
      validation.warnings.push(...source.jobWarnings);

      const templateUnknownKeys = Object.keys(source.template)
        .filter((key) => !KNOWN_TEMPLATE_KEYS.has(key))
        .sort();
      if (templateUnknownKeys.length > 0) {
        validation.warnings.push(
          `Unknown template top-level field(s): ${templateUnknownKeys.join(', ')}`,
        );
      }

      const fontDiagnosis = diagnoseFonts(
        source,
        environment,
        Boolean(args.noAutoFont),
        inspection.requiredFonts,
      );
      const basePdfDiagnosis = diagnoseBasePdf(source.template.basePdf, source.templateDir);
      const issues = [...validation.errors];
      const warnings = [...validation.warnings, ...fontDiagnosis.warnings];

      if (basePdfDiagnosis.issue) {
        issues.push(basePdfDiagnosis.issue);
      }

      issues.push(...fontDiagnosis.issues);

      if (source.mode === 'job' && fontDiagnosis.effectiveOptions) {
        try {
          checkGenerateProps({
            template: source.template as any,
            inputs: source.inputs as any,
            options: fontDiagnosis.effectiveOptions as any,
          });
        } catch (error) {
          issues.unshift(error instanceof Error ? error.message : String(error));
        }
      }

      const healthy = issues.length === 0;
      const payload = {
        ok: true,
        target: 'input',
        healthy,
        mode: source.mode,
        environment,
        validation: {
          valid: validation.errors.length === 0,
          pages: validation.pages,
          fields: validation.fields,
          errors: validation.errors,
          warnings: validation.warnings,
        },
        inspection,
        diagnosis: {
          basePdf: basePdfDiagnosis,
          fonts: {
            hasCJK: fontDiagnosis.hasCJK,
            explicitFonts: fontDiagnosis.explicitFonts,
            effectiveFonts: fontDiagnosis.effectiveFonts,
            missingFonts: fontDiagnosis.missingFonts,
            autoNotoSansJP: {
              needed: fontDiagnosis.autoFontNeeded,
              disabled: Boolean(args.noAutoFont),
              cached: fontDiagnosis.autoFontCached,
              cacheFile: NOTO_CACHE_FILE,
            },
          },
          plugins: {
            required: inspection.requiredPlugins,
            unsupportedSchemaTypes: inspection.schemaTypes.filter(
              (type) => !inspection.requiredPlugins.includes(type),
            ),
          },
        },
        issues,
        warnings,
      };

      if (args.json) {
        printJson(payload);
      } else {
        printInputReport(payload);
      }

      if (!healthy) {
        process.exit(1);
      }
    });
  },
});

function getEnvironmentReport(): EnvironmentReport {
  const fontCacheDir = dirname(NOTO_CACHE_FILE);
  const cwdStatus = getWritableStatus(process.cwd());
  const tempStatus = getWritableStatus(tmpdir());
  const fontCacheStatus = getWritableStatus(fontCacheDir);

  return {
    nodeVersion: process.version,
    cliVersion: CLI_VERSION,
    platform: process.platform,
    arch: process.arch,
    cwd: cwdStatus,
    tempDir: tempStatus,
    homeDir: homedir(),
    fontCache: {
      file: NOTO_CACHE_FILE,
      dir: fontCacheDir,
      cached: existsSync(NOTO_CACHE_FILE),
      writable: fontCacheStatus.writable,
      checkedPath: fontCacheStatus.checkedPath,
      error: fontCacheStatus.error,
    },
  };
}

function getWritableStatus(path: string): PathStatus {
  const checkedPath = findExistingParent(path);

  try {
    accessSync(checkedPath, constants.W_OK);
    return {
      path,
      writable: true,
      checkedPath: checkedPath !== path ? checkedPath : undefined,
    };
  } catch (error) {
    return {
      path,
      writable: false,
      checkedPath: checkedPath !== path ? checkedPath : undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function findExistingParent(path: string): string {
  let current = path;

  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return current;
}

function collectEnvironmentIssues(environment: EnvironmentReport): string[] {
  const issues: string[] = [];

  if (!environment.cwd.writable) {
    issues.push(`Current working directory is not writable: ${environment.cwd.path}`);
  }
  if (!environment.tempDir.writable) {
    issues.push(`Temporary directory is not writable: ${environment.tempDir.path}`);
  }

  return issues;
}

function collectEnvironmentWarnings(environment: EnvironmentReport): string[] {
  const warnings: string[] = [];

  if (!environment.fontCache.writable) {
    warnings.push(`Font cache directory is not writable: ${environment.fontCache.dir}`);
  }
  if (!environment.fontCache.cached) {
    warnings.push(`NotoSansJP is not cached at ${environment.fontCache.file}`);
  }

  return warnings;
}

function diagnoseBasePdf(basePdf: unknown, templateDir?: string): BasePdfDiagnosis {
  const summary = summarizeBasePdf(basePdf, templateDir);

  if (summary.kind !== 'pdfPath' || !summary.resolvedPath) {
    return summary;
  }

  const exists = existsSync(summary.resolvedPath);
  return {
    ...summary,
    exists,
    issue: exists ? undefined : `Base PDF file not found: ${summary.resolvedPath}`,
  };
}

function diagnoseFonts(
  source: Awaited<ReturnType<typeof loadValidationSource>>,
  environment: EnvironmentReport,
  noAutoFont: boolean,
  requiredFonts: string[],
): {
  hasCJK: boolean;
  explicitFonts: string[];
  effectiveFonts: string[];
  missingFonts: string[];
  autoFontNeeded: boolean;
  autoFontCached: boolean;
  issues: string[];
  warnings: string[];
  effectiveOptions?: Record<string, unknown>;
} {
  const hasCJK = detectCJKInTemplate(source.template) || detectCJKInInputs(source.inputs ?? []);
  const issues: string[] = [];
  const warnings: string[] = [];
  const autoFontCached = existsSync(NOTO_CACHE_FILE);
  const explicit = normalizeExplicitFontConfig(source.options);

  issues.push(...explicit.issues);

  const autoFontNeeded = hasCJK && explicit.fontNames.length === 0;
  if (autoFontNeeded && noAutoFont) {
    issues.push(
      'CJK text detected, but automatic NotoSansJP download is disabled by --noAutoFont and no explicit font source was provided.',
    );
  } else if (autoFontNeeded && !autoFontCached && !environment.fontCache.writable) {
    issues.push(
      `CJK text detected and NotoSansJP is not cached at ${NOTO_CACHE_FILE}, but the font cache directory is not writable: ${environment.fontCache.dir}. Provide --font / options.font or warm the cache in a writable HOME.`,
    );
  } else if (autoFontNeeded && !autoFontCached) {
    warnings.push(
      `CJK text detected and NotoSansJP is not cached at ${NOTO_CACHE_FILE}. Generate will require network access to fetch it.`,
    );
  }

  const resolvedFont = autoFontNeeded
    ? {
        NotoSansJP: { data: new Uint8Array(), fallback: true, subset: true },
        [DEFAULT_FONT_NAME]: { data: new Uint8Array(), fallback: false, subset: true },
      }
    : {
        [DEFAULT_FONT_NAME]: { data: new Uint8Array(), fallback: true, subset: true },
      };

  const effectiveFont = explicit.fontRecord ? { ...explicit.fontRecord, ...resolvedFont } : resolvedFont;
  const effectiveFonts = Object.keys(effectiveFont).sort();
  const missingFonts = requiredFonts.filter((fontName) => !effectiveFonts.includes(fontName));

  if (source.mode === 'template' && missingFonts.length > 0) {
    issues.push(
      `Template references font(s) that are not available by default: ${missingFonts.join(', ')}. Provide them via generate --font or unified job options.font.`,
    );
  }

  return {
    hasCJK,
    explicitFonts: explicit.fontNames,
    effectiveFonts,
    missingFonts,
    autoFontNeeded,
    autoFontCached,
    issues,
    warnings,
    effectiveOptions: explicit.optionsRecord
      ? { ...explicit.optionsRecord, font: effectiveFont }
      : { font: effectiveFont },
  };
}

function normalizeExplicitFontConfig(options: unknown): {
  issues: string[];
  fontNames: string[];
  fontRecord?: Record<string, unknown>;
  optionsRecord?: Record<string, unknown>;
} {
  if (options === undefined) {
    return { issues: [], fontNames: [] };
  }

  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    return {
      issues: ['Unified job options must be a JSON object.'],
      fontNames: [],
    };
  }

  const optionsRecord = options as Record<string, unknown>;
  const font = optionsRecord.font;
  if (font === undefined) {
    return { issues: [], fontNames: [], optionsRecord };
  }

  if (typeof font !== 'object' || font === null || Array.isArray(font)) {
    return {
      issues: ['Unified job options.font must be an object.'],
      fontNames: [],
      optionsRecord,
    };
  }

  return {
    issues: [],
    fontNames: Object.keys(font).sort(),
    fontRecord: font as Record<string, unknown>,
    optionsRecord,
  };
}

function printEnvironmentReport(
  environment: EnvironmentReport,
  issues: string[],
  warnings: string[],
): void {
  const header = issues.length === 0 ? '\u2713 Environment looks ready' : '\u2717 Environment has blocking issues';
  console.log(header);
  console.log(`Node: ${environment.nodeVersion}`);
  console.log(`CLI: ${environment.cliVersion}`);
  console.log(`Platform: ${environment.platform} ${environment.arch}`);
  console.log(`cwd: ${environment.cwd.path} (${environment.cwd.writable ? 'writable' : 'not writable'})`);
  console.log(
    `temp: ${environment.tempDir.path} (${environment.tempDir.writable ? 'writable' : 'not writable'})`,
  );
  console.log(
    `font cache: ${environment.fontCache.file} (${environment.fontCache.cached ? 'cached' : 'not cached'})`,
  );

  for (const issue of issues) {
    console.log(`\u2717 Issue: ${issue}`);
  }
  for (const warning of warnings) {
    console.log(`\u26a0 Warning: ${warning}`);
  }
}

function printInputReport(payload: Record<string, unknown>): void {
  const healthy = Boolean(payload.healthy);
  const validation = payload.validation as {
    valid: boolean;
    pages: number;
    fields: number;
  };
  const inspection = payload.inspection as {
    schemaTypes: string[];
  };
  const issues = payload.issues as string[];
  const warnings = payload.warnings as string[];

  console.log(healthy ? '\u2713 Doctor checks passed' : '\u2717 Doctor found blocking issues');
  console.log(`Mode: ${payload.mode}`);
  console.log(`Pages: ${validation.pages}`);
  console.log(`Fields: ${validation.fields}`);
  console.log(`Schema types: ${inspection.schemaTypes.join(', ') || '(none)'}`);

  for (const issue of issues) {
    console.log(`\u2717 Issue: ${issue}`);
  }
  for (const warning of warnings) {
    console.log(`\u26a0 Warning: ${warning}`);
  }
}
