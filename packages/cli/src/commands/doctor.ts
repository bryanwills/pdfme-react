import { accessSync, constants, existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { defineCommand } from 'citty';
import { checkGenerateProps, DEFAULT_FONT_NAME, isUrlSafeToFetch } from '@pdfme/common';
import {
  assertNoUnknownFlags,
  fail,
  parseEnumArg,
  printJson,
  runWithContract,
} from '../contract.js';
import { detectCJKInInputs, detectCJKInTemplate } from '../cjk-detect.js';
import {
  inspectTemplate,
  KNOWN_TEMPLATE_KEYS,
  loadValidationSource,
  summarizeBasePdf,
  validateTemplate,
} from '../diagnostics.js';
import { NOTO_CACHE_FILE } from '../fonts.js';
import {
  getImageOutputPaths,
  getSafeDefaultOutputPathIssue,
  inspectWriteTarget,
  type WriteTargetInspection,
} from '../utils.js';
import { CLI_VERSION } from '../version.js';

const doctorArgs = {
  target: {
    type: 'positional' as const,
    description: 'Optional job/template JSON file, or "fonts" for font-focused diagnosis',
    required: false,
  },
  file: {
    type: 'positional' as const,
    description: 'Job/template JSON file for "doctor fonts", or "-" for stdin',
    required: false,
  },
  json: { type: 'boolean' as const, description: 'Machine-readable JSON output', default: false },
  noAutoFont: {
    type: 'boolean' as const,
    description: 'Simulate generate with automatic CJK font download disabled',
    default: false,
  },
  output: {
    type: 'string' as const,
    alias: 'o',
    description: 'Simulate generate output PDF path for runtime/path diagnosis',
    default: 'output.pdf',
  },
  force: {
    type: 'boolean' as const,
    description: 'Simulate generate --force for implicit default output path checks',
    default: false,
  },
  image: {
    type: 'boolean' as const,
    description: 'Simulate generate --image when previewing runtime output paths',
    default: false,
  },
  imageFormat: {
    type: 'string' as const,
    description: 'Image format to use when previewing runtime output paths: png | jpeg',
    default: 'png',
  },
};

type DoctorTarget = 'environment' | 'input' | 'fonts';
type FontSourceKind =
  | 'default'
  | 'autoCache'
  | 'autoDownload'
  | 'localPath'
  | 'url'
  | 'dataUri'
  | 'inlineBytes'
  | 'invalid';

interface DoctorInvocation {
  target: DoctorTarget;
  file?: string;
}

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

interface FontSourceDiagnosis {
  fontName: string;
  source: 'explicit' | 'implicit';
  kind: FontSourceKind;
  path?: string;
  resolvedPath?: string;
  exists?: boolean;
  url?: string;
  mediaType?: string;
  formatHint?: string | null;
  supportedFormat?: boolean;
  needsNetwork: boolean;
  dataType?: string;
}

interface FontDiagnosis {
  hasCJK: boolean;
  requiredFonts: string[];
  explicitFonts: string[];
  effectiveFonts: string[];
  missingFonts: string[];
  autoFontNeeded: boolean;
  autoFontCached: boolean;
  issues: string[];
  warnings: string[];
  explicitSources: FontSourceDiagnosis[];
  implicitSources: FontSourceDiagnosis[];
  effectiveOptions?: Record<string, unknown>;
}

interface RuntimeOptions {
  output: string;
  force: boolean;
  image: boolean;
  imageFormat: 'png' | 'jpeg';
  rawArgs: string[];
}

interface OutputPathDiagnosis extends WriteTargetInspection {
  implicitDefaultProtected: boolean;
  issue?: string;
}

interface RuntimeDiagnosis {
  estimatedPages: number;
  output: OutputPathDiagnosis;
  imageOutputs: {
    enabled: boolean;
    format: 'png' | 'jpeg';
    paths: string[];
    directory: string;
  };
}

interface InputDiagnosis {
  validation: {
    valid: boolean;
    pages: number;
    fields: number;
    errors: string[];
    warnings: string[];
  };
  inspection: ReturnType<typeof inspectTemplate>;
  basePdfDiagnosis: BasePdfDiagnosis;
  fontDiagnosis: FontDiagnosis;
  runtimeDiagnosis: RuntimeDiagnosis;
  issues: string[];
  warnings: string[];
  healthy: boolean;
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

      const invocation = resolveDoctorInvocation(args);
      const imageFormat = parseEnumArg('imageFormat', args.imageFormat, ['png', 'jpeg']);
      const environment = getEnvironmentReport();

      if (invocation.target === 'environment') {
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

      const source = await loadValidationSource(invocation.file, {
        noInputMessage:
          invocation.target === 'fonts'
            ? 'No font diagnostic input provided. Pass a file path or pipe JSON via stdin.'
            : 'No diagnostic input provided. Pass a file path or pipe JSON via stdin.',
      });

      const diagnosis = buildInputDiagnosis(source, environment, Boolean(args.noAutoFont), {
        includeBasePdfIssue: invocation.target === 'input',
        includeRuntimeIssue: invocation.target === 'input',
        runtime: {
          output: args.output,
          force: Boolean(args.force),
          image: Boolean(args.image),
          imageFormat,
          rawArgs,
        },
      });

      const payload =
        invocation.target === 'fonts'
          ? {
              ok: true,
              target: 'fonts',
              healthy: diagnosis.healthy,
              mode: source.mode,
              environment,
              validation: diagnosis.validation,
              inspection: {
                schemaTypes: diagnosis.inspection.schemaTypes,
                requiredPlugins: diagnosis.inspection.requiredPlugins,
                requiredFonts: diagnosis.inspection.requiredFonts,
              },
              diagnosis: {
                fonts: createFontPayload(diagnosis.fontDiagnosis),
              },
              issues: diagnosis.issues,
              warnings: diagnosis.warnings,
            }
          : {
              ok: true,
              target: 'input',
              healthy: diagnosis.healthy,
              mode: source.mode,
              environment,
              validation: diagnosis.validation,
              inspection: diagnosis.inspection,
              diagnosis: {
                basePdf: diagnosis.basePdfDiagnosis,
                fonts: createFontPayload(diagnosis.fontDiagnosis),
                runtime: diagnosis.runtimeDiagnosis,
                plugins: {
                  required: diagnosis.inspection.requiredPlugins,
                  unsupportedSchemaTypes: diagnosis.inspection.schemaTypes.filter(
                    (type) => !diagnosis.inspection.requiredPlugins.includes(type),
                  ),
                },
              },
              issues: diagnosis.issues,
              warnings: diagnosis.warnings,
            };

      if (args.json) {
        printJson(payload);
      } else if (invocation.target === 'fonts') {
        printFontReport(payload);
      } else {
        printInputReport(payload);
      }

      if (!diagnosis.healthy) {
        process.exit(1);
      }
    });
  },
});

function resolveDoctorInvocation(args: { _: string[]; target?: string; file?: string }): DoctorInvocation {
  const positionals = Array.isArray(args._) ? args._ : [];

  if (args.target === 'fonts') {
    if (positionals.length > 2) {
      fail(
        `Unexpected extra positional argument: ${JSON.stringify(positionals[2])}. Usage: pdfme doctor fonts <job-or-template>.`,
        { code: 'EARG', exitCode: 1 },
      );
    }

    return { target: 'fonts', file: args.file };
  }

  if (positionals.length > 1) {
    fail(
      `Unexpected extra positional argument: ${JSON.stringify(positionals[1])}. Usage: pdfme doctor [job-or-template].`,
      { code: 'EARG', exitCode: 1 },
    );
  }

  if (args.target) {
    return { target: 'input', file: args.target };
  }

  return { target: 'environment' };
}

function buildInputDiagnosis(
  source: Awaited<ReturnType<typeof loadValidationSource>>,
  environment: EnvironmentReport,
  noAutoFont: boolean,
  options: {
    includeBasePdfIssue: boolean;
    includeRuntimeIssue: boolean;
    runtime: RuntimeOptions;
  },
): InputDiagnosis {
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
    noAutoFont,
    inspection.requiredFonts,
  );
  const basePdfDiagnosis = diagnoseBasePdf(source.template.basePdf, source.templateDir);
  const runtimeDiagnosis = diagnoseRuntime(source, options.runtime);
  const issues = [...validation.errors];
  const warnings = [...validation.warnings, ...fontDiagnosis.warnings];

  if (options.includeBasePdfIssue && basePdfDiagnosis.issue) {
    issues.push(basePdfDiagnosis.issue);
  }

  issues.push(...fontDiagnosis.issues);
  if (options.includeRuntimeIssue && runtimeDiagnosis.output.issue) {
    issues.push(runtimeDiagnosis.output.issue);
  }

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

  return {
    validation: {
      valid: validation.errors.length === 0,
      pages: validation.pages,
      fields: validation.fields,
      errors: validation.errors,
      warnings: validation.warnings,
    },
    inspection,
    basePdfDiagnosis,
    fontDiagnosis,
    runtimeDiagnosis,
    issues,
    warnings,
    healthy: issues.length === 0,
  };
}

function createFontPayload(fontDiagnosis: FontDiagnosis): Record<string, unknown> {
  return {
    hasCJK: fontDiagnosis.hasCJK,
    requiredFonts: fontDiagnosis.requiredFonts,
    explicitFonts: fontDiagnosis.explicitFonts,
    effectiveFonts: fontDiagnosis.effectiveFonts,
    missingFonts: fontDiagnosis.missingFonts,
    explicitSources: fontDiagnosis.explicitSources,
    implicitSources: fontDiagnosis.implicitSources,
    autoNotoSansJP: {
      needed: fontDiagnosis.autoFontNeeded,
      cached: fontDiagnosis.autoFontCached,
      cacheFile: NOTO_CACHE_FILE,
    },
  };
}

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

function diagnoseRuntime(
  source: Awaited<ReturnType<typeof loadValidationSource>>,
  options: RuntimeOptions,
): RuntimeDiagnosis {
  const estimatedPages =
    source.mode === 'job'
      ? (source.inputs?.length ?? 0) * getTemplatePageCount(source.template)
      : getTemplatePageCount(source.template);
  const output = diagnoseOutputPath(options);

  return {
    estimatedPages,
    output,
    imageOutputs: {
      enabled: options.image,
      format: options.imageFormat,
      paths: options.image ? getImageOutputPaths(options.output, estimatedPages, options.imageFormat) : [],
      directory: dirname(output.resolvedPath),
    },
  };
}

function diagnoseOutputPath(options: RuntimeOptions): OutputPathDiagnosis {
  const inspection = inspectWriteTarget(options.output);
  const implicitDefaultIssue = getSafeDefaultOutputPathIssue({
    filePath: options.output,
    rawArgs: options.rawArgs,
    optionName: 'output',
    optionAlias: 'o',
    defaultValue: 'output.pdf',
    force: options.force,
  });

  let issue = implicitDefaultIssue;

  if (!issue && inspection.exists && inspection.existingType === 'directory') {
    issue = `Output path points to a directory: ${inspection.resolvedPath}. Choose a file path like out.pdf.`;
  } else if (!issue && inspection.exists && inspection.existingType === 'other') {
    issue = `Output path is not a regular file: ${inspection.resolvedPath}.`;
  } else if (!issue && inspection.checkedType && inspection.checkedType !== 'directory' && inspection.existingType !== 'file') {
    issue = `Output directory cannot be created because an existing path segment is not a directory: ${inspection.checkedPath ?? inspection.parentDir}.`;
  } else if (!issue && !inspection.writable) {
    issue =
      inspection.exists && inspection.existingType === 'file'
        ? `Output file is not writable: ${inspection.resolvedPath}.`
        : `Output directory is not writable for ${inspection.resolvedPath}: ${inspection.checkedPath ?? inspection.parentDir}.`;
  }

  return {
    ...inspection,
    implicitDefaultProtected: Boolean(implicitDefaultIssue),
    issue,
  };
}

function getTemplatePageCount(template: Record<string, unknown>): number {
  return Array.isArray(template.schemas) ? template.schemas.length : 0;
}

function diagnoseFonts(
  source: Awaited<ReturnType<typeof loadValidationSource>>,
  environment: EnvironmentReport,
  noAutoFont: boolean,
  requiredFonts: string[],
): FontDiagnosis {
  const hasCJK = detectCJKInTemplate(source.template) || detectCJKInInputs(source.inputs ?? []);
  const issues: string[] = [];
  const warnings: string[] = [];
  const autoFontCached = existsSync(NOTO_CACHE_FILE);
  const explicit = normalizeExplicitFontConfig(source.options, source.templateDir);

  issues.push(...explicit.issues);
  warnings.push(...explicit.warnings);

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
    requiredFonts,
    explicitFonts: explicit.fontNames,
    effectiveFonts,
    missingFonts,
    autoFontNeeded,
    autoFontCached,
    issues,
    warnings,
    explicitSources: explicit.sources,
    implicitSources: buildImplicitFontSources(autoFontNeeded, autoFontCached),
    effectiveOptions: explicit.optionsRecord
      ? { ...explicit.optionsRecord, font: effectiveFont }
      : { font: effectiveFont },
  };
}

function normalizeExplicitFontConfig(
  options: unknown,
  templateDir?: string,
): {
  issues: string[];
  warnings: string[];
  fontNames: string[];
  fontRecord?: Record<string, unknown>;
  optionsRecord?: Record<string, unknown>;
  sources: FontSourceDiagnosis[];
} {
  if (options === undefined) {
    return { issues: [], warnings: [], fontNames: [], sources: [] };
  }

  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    return {
      issues: ['Unified job options must be a JSON object.'],
      warnings: [],
      fontNames: [],
      sources: [],
    };
  }

  const optionsRecord = options as Record<string, unknown>;
  const font = optionsRecord.font;
  if (font === undefined) {
    return { issues: [], warnings: [], fontNames: [], optionsRecord, sources: [] };
  }

  if (typeof font !== 'object' || font === null || Array.isArray(font)) {
    return {
      issues: ['Unified job options.font must be an object.'],
      warnings: [],
      fontNames: [],
      optionsRecord,
      sources: [],
    };
  }

  const fontRecord = font as Record<string, unknown>;
  const sourceDiagnostics = diagnoseExplicitFontSources(fontRecord, templateDir);

  return {
    issues: sourceDiagnostics.issues,
    warnings: sourceDiagnostics.warnings,
    fontNames: Object.keys(fontRecord).sort(),
    fontRecord,
    optionsRecord,
    sources: sourceDiagnostics.sources,
  };
}

function diagnoseExplicitFontSources(
  fontRecord: Record<string, unknown>,
  templateDir?: string,
): {
  sources: FontSourceDiagnosis[];
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];
  const sources: FontSourceDiagnosis[] = [];

  for (const fontName of Object.keys(fontRecord).sort()) {
    const result = diagnoseExplicitFontSource(fontName, fontRecord[fontName], templateDir);
    sources.push(result.source);
    issues.push(...result.issues);
    warnings.push(...result.warnings);
  }

  return { sources: sortFontSources(sources), issues, warnings };
}

function diagnoseExplicitFontSource(
  fontName: string,
  value: unknown,
  templateDir?: string,
): {
  source: FontSourceDiagnosis;
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push(`Font config for ${fontName} must be an object with a "data" field.`);
    return {
      source: {
        fontName,
        source: 'explicit',
        kind: 'invalid',
        needsNetwork: false,
        dataType: getValueType(value),
      },
      issues,
      warnings,
    };
  }

  const record = value as Record<string, unknown>;
  const data = record.data;
  if (data === undefined) {
    issues.push(`Font config for ${fontName} is missing "data".`);
    return {
      source: {
        fontName,
        source: 'explicit',
        kind: 'invalid',
        needsNetwork: false,
        dataType: 'missing',
      },
      issues,
      warnings,
    };
  }

  if (typeof data === 'string') {
    if (data.startsWith('data:')) {
      return diagnoseDataUriFontSource(fontName, data);
    }

    const parsedUrl = tryParseUrl(data);
    if (parsedUrl) {
      if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
        return diagnoseUrlFontSource(fontName, parsedUrl);
      }

      issues.push(
        `Font source for ${fontName} uses unsupported URL protocol "${parsedUrl.protocol}". Use a local .ttf path, a data URI, or an https URL.`,
      );
      return {
        source: {
          fontName,
          source: 'explicit',
          kind: 'invalid',
          needsNetwork: false,
          dataType: 'string',
        },
        issues,
        warnings,
      };
    }

    return diagnoseLocalFontSource(fontName, data, templateDir);
  }

  if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
    return {
      source: {
        fontName,
        source: 'explicit',
        kind: 'inlineBytes',
        needsNetwork: false,
        dataType: getValueType(data),
      },
      issues,
      warnings,
    };
  }

  issues.push(`Font source for ${fontName} has unsupported data type ${getValueType(data)}.`);
  return {
    source: {
      fontName,
      source: 'explicit',
      kind: 'invalid',
      needsNetwork: false,
      dataType: getValueType(data),
    },
    issues,
    warnings,
  };
}

function diagnoseLocalFontSource(
  fontName: string,
  pathValue: string,
  templateDir?: string,
): {
  source: FontSourceDiagnosis;
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];
  const resolvedPath = templateDir ? resolve(templateDir, pathValue) : resolve(pathValue);
  const exists = existsSync(resolvedPath);
  const formatHint = detectPathFormatHint(resolvedPath);
  const formatResult = evaluateFontFormat(fontName, formatHint, `Font file for ${fontName}`);

  if (!exists) {
    issues.push(`Font file for ${fontName} not found: ${resolvedPath}`);
  }
  if (formatResult.issue) {
    issues.push(formatResult.issue);
  }
  if (formatResult.warning) {
    warnings.push(formatResult.warning);
  }

  return {
    source: {
      fontName,
      source: 'explicit',
      kind: 'localPath',
      path: pathValue,
      resolvedPath,
      exists,
      formatHint,
      supportedFormat: formatResult.supportedFormat,
      needsNetwork: false,
      dataType: 'string',
    },
    issues,
    warnings,
  };
}

function diagnoseUrlFontSource(
  fontName: string,
  url: URL,
): {
  source: FontSourceDiagnosis;
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];
  const formatHint = detectPathFormatHint(url.pathname);
  const formatResult = evaluateFontFormat(fontName, formatHint, `Font URL for ${fontName}`);

  if (!isUrlSafeToFetch(url.toString())) {
    issues.push(
      `Font URL for ${fontName} is invalid or unsafe. Only http: and https: URLs pointing to public hosts are allowed.`,
    );
  }
  if (formatResult.issue) {
    issues.push(formatResult.issue);
  }
  if (formatResult.warning) {
    warnings.push(formatResult.warning);
  }

  return {
    source: {
      fontName,
      source: 'explicit',
      kind: 'url',
      url: url.toString(),
      formatHint,
      supportedFormat: formatResult.supportedFormat,
      needsNetwork: true,
      dataType: 'string',
    },
    issues,
    warnings,
  };
}

function diagnoseDataUriFontSource(
  fontName: string,
  dataUri: string,
): {
  source: FontSourceDiagnosis;
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];
  const mediaType = getDataUriMediaType(dataUri);
  const formatHint = detectDataUriFormatHint(mediaType);
  const formatResult = evaluateFontFormat(fontName, formatHint, `Font data URI for ${fontName}`);

  if (formatResult.issue) {
    issues.push(formatResult.issue);
  }
  if (formatResult.warning) {
    warnings.push(formatResult.warning);
  }

  return {
    source: {
      fontName,
      source: 'explicit',
      kind: 'dataUri',
      mediaType,
      formatHint,
      supportedFormat: formatResult.supportedFormat,
      needsNetwork: false,
      dataType: 'string',
    },
    issues,
    warnings,
  };
}

function buildImplicitFontSources(
  autoFontNeeded: boolean,
  autoFontCached: boolean,
): FontSourceDiagnosis[] {
  const sources: FontSourceDiagnosis[] = [
    {
      fontName: DEFAULT_FONT_NAME,
      source: 'implicit',
      kind: 'default',
      formatHint: 'ttf',
      supportedFormat: true,
      needsNetwork: false,
    },
  ];

  if (autoFontNeeded) {
    sources.push({
      fontName: 'NotoSansJP',
      source: 'implicit',
      kind: autoFontCached ? 'autoCache' : 'autoDownload',
      path: NOTO_CACHE_FILE,
      resolvedPath: NOTO_CACHE_FILE,
      exists: autoFontCached,
      formatHint: 'ttf',
      supportedFormat: true,
      needsNetwork: !autoFontCached,
    });
  }

  return sortFontSources(sources);
}

function sortFontSources(sources: FontSourceDiagnosis[]): FontSourceDiagnosis[] {
  return [...sources].sort(
    (a, b) => a.fontName.localeCompare(b.fontName) || a.kind.localeCompare(b.kind),
  );
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function getDataUriMediaType(value: string): string | undefined {
  const match = value.match(/^data:([^;,]+)/i);
  return match ? match[1] : undefined;
}

function detectPathFormatHint(value: string): string | null {
  const extension = extname(value).toLowerCase();
  return extension ? extension.slice(1) : null;
}

function detectDataUriFormatHint(mediaType?: string): string | null {
  if (!mediaType) {
    return null;
  }

  const lower = mediaType.toLowerCase();
  if (lower.includes('ttf') || lower.endsWith('/sfnt')) {
    return 'ttf';
  }
  if (lower.includes('otf')) {
    return 'otf';
  }
  if (lower.includes('ttc')) {
    return 'ttc';
  }
  return null;
}

function evaluateFontFormat(
  fontName: string,
  formatHint: string | null,
  sourceLabel: string,
): {
  supportedFormat?: boolean;
  issue?: string;
  warning?: string;
} {
  if (formatHint === 'ttf') {
    return { supportedFormat: true };
  }

  if (formatHint === null) {
    return {
      warning: `${sourceLabel} does not clearly advertise a .ttf format. @pdfme/cli currently guarantees only .ttf custom fonts.`,
    };
  }

  return {
    supportedFormat: false,
    issue: `${sourceLabel} uses .${formatHint}. @pdfme/cli currently guarantees only .ttf custom fonts for ${fontName}.`,
  };
}

function getValueType(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (value instanceof Uint8Array) return 'Uint8Array';
  if (value instanceof ArrayBuffer) return 'ArrayBuffer';
  if (Array.isArray(value)) return 'array';
  return typeof value;
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
  const diagnosis = payload.diagnosis as {
    runtime?: RuntimeDiagnosis;
  };
  const issues = payload.issues as string[];
  const warnings = payload.warnings as string[];

  console.log(healthy ? '\u2713 Doctor checks passed' : '\u2717 Doctor found blocking issues');
  console.log(`Mode: ${payload.mode}`);
  console.log(`Pages: ${validation.pages}`);
  console.log(`Fields: ${validation.fields}`);
  console.log(`Schema types: ${inspection.schemaTypes.join(', ') || '(none)'}`);
  if (diagnosis.runtime) {
    console.log(
      `Output: ${diagnosis.runtime.output.path} (${diagnosis.runtime.output.writable ? 'writable' : 'not writable'})`,
    );
    if (diagnosis.runtime.imageOutputs.enabled) {
      console.log(
        `Images: ${diagnosis.runtime.imageOutputs.paths.length} ${diagnosis.runtime.imageOutputs.format.toUpperCase()} file(s) in ${diagnosis.runtime.imageOutputs.directory}`,
      );
    }
  }

  for (const issue of issues) {
    console.log(`\u2717 Issue: ${issue}`);
  }
  for (const warning of warnings) {
    console.log(`\u26a0 Warning: ${warning}`);
  }
}

function printFontReport(payload: Record<string, unknown>): void {
  const healthy = Boolean(payload.healthy);
  const diagnosis = payload.diagnosis as {
    fonts: {
      requiredFonts: string[];
      explicitFonts: string[];
      effectiveFonts: string[];
      explicitSources: FontSourceDiagnosis[];
      implicitSources: FontSourceDiagnosis[];
    };
  };
  const issues = payload.issues as string[];
  const warnings = payload.warnings as string[];

  console.log(healthy ? '\u2713 Font checks passed' : '\u2717 Font checks found blocking issues');
  console.log(`Mode: ${payload.mode}`);
  console.log(`Required fonts: ${diagnosis.fonts.requiredFonts.join(', ') || '(none)'}`);
  console.log(`Explicit fonts: ${diagnosis.fonts.explicitFonts.join(', ') || '(none)'}`);
  console.log(`Effective fonts: ${diagnosis.fonts.effectiveFonts.join(', ') || '(none)'}`);

  for (const source of diagnosis.fonts.explicitSources) {
    console.log(
      `- explicit ${source.fontName}: ${source.kind}${source.path ? ` (${source.path})` : source.url ? ` (${source.url})` : ''}`,
    );
  }
  for (const source of diagnosis.fonts.implicitSources) {
    console.log(
      `- implicit ${source.fontName}: ${source.kind}${source.path ? ` (${source.path})` : ''}`,
    );
  }

  for (const issue of issues) {
    console.log(`\u2717 Issue: ${issue}`);
  }
  for (const warning of warnings) {
    console.log(`\u26a0 Warning: ${warning}`);
  }
}
