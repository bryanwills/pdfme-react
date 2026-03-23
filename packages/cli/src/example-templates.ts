import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CLI_VERSION } from './version.js';

export interface ExampleManifestEntry {
  name: string;
  author?: string;
  path?: string;
  thumbnailPath?: string;
  pageCount?: number;
  fieldCount?: number;
  schemaTypes?: string[];
  fontNames?: string[];
  hasCJK?: boolean;
  basePdfKind?: string;
}

export interface ExampleManifest {
  schemaVersion: number;
  cliVersion: string;
  templates: ExampleManifestEntry[];
}

export interface ExampleManifestLoadResult {
  manifest: ExampleManifest;
  source: 'remote' | 'cache';
  url?: string;
}

export interface ExampleTemplateLoadResult {
  template: Record<string, unknown>;
  source: 'remote' | 'cache';
  url?: string;
}

export function getExamplesBaseUrl(): string {
  return process.env.PDFME_EXAMPLES_BASE_URL ?? 'https://playground.pdfme.com/template-assets';
}

export function getExamplesCacheRoot(): string {
  return process.env.PDFME_EXAMPLES_CACHE_DIR ?? join(homedir(), '.pdfme', 'examples');
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getExampleManifest(options: { latest?: boolean } = {}): Promise<ExampleManifestLoadResult> {
  const latest = Boolean(options.latest);
  const cachePath = getManifestCachePath(latest);
  const manifestUrls = getManifestUrls(latest);

  let lastError: unknown;
  for (const url of manifestUrls) {
    try {
      const manifest = normalizeManifest(await fetchJson<unknown>(url));
      writeCachedJson(cachePath, manifest);
      return { manifest, source: 'remote', url };
    } catch (error) {
      lastError = error;
    }
  }

  const cached = readCachedJson<unknown>(cachePath);
  if (cached !== undefined) {
    return { manifest: normalizeManifest(cached), source: 'cache' };
  }

  throw new Error(
    `Could not load examples manifest from remote or cache. Cache path: ${cachePath}. ${formatError(lastError)}`,
  );
}

export async function getExampleTemplateNames(options: { latest?: boolean } = {}): Promise<string[]> {
  const { manifest } = await getExampleManifest(options);
  return manifest.templates
    .map((entry) => entry.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .sort();
}

export async function fetchExampleTemplate(
  name: string,
  options: { latest?: boolean; manifest?: ExampleManifest } = {},
): Promise<Record<string, unknown>> {
  const result = await fetchExampleTemplateWithSource(name, options);
  return result.template;
}

export async function fetchExampleTemplateWithSource(
  name: string,
  options: { latest?: boolean; manifest?: ExampleManifest } = {},
): Promise<ExampleTemplateLoadResult> {
  const latest = Boolean(options.latest);
  const manifest = options.manifest ?? (await getExampleManifest({ latest })).manifest;
  const entry = manifest.templates.find((template) => template.name === name);

  if (!entry) {
    throw new Error(`Template "${name}" is not present in the examples manifest.`);
  }

  const relativePath = entry.path ?? `${name}/template.json`;
  const templateUrl = `${getExamplesBaseUrl().replace(/\/$/, '')}/${relativePath}`;
  const cachePath = getTemplateCachePath(name, latest);

  try {
    const template = await fetchJson<Record<string, unknown>>(templateUrl);
    writeCachedJson(cachePath, template);
    return { template, source: 'remote', url: templateUrl };
  } catch (error) {
    const cached = readCachedJson<Record<string, unknown>>(cachePath);
    if (cached !== undefined) {
      return { template: cached, source: 'cache' };
    }

    throw new Error(
      `Could not load template "${name}" from remote or cache. Cache path: ${cachePath}. ${formatError(error)}`,
    );
  }
}

function getManifestUrls(latest: boolean): string[] {
  const baseUrl = getExamplesBaseUrl().replace(/\/$/, '');

  if (latest) {
    return [`${baseUrl}/manifest.json`, `${baseUrl}/index.json`];
  }

  return [
    `${baseUrl}/manifests/${encodeURIComponent(CLI_VERSION)}.json`,
    `${baseUrl}/manifest.json`,
    `${baseUrl}/index.json`,
  ];
}

function getManifestCachePath(latest: boolean): string {
  return join(getExamplesCacheDir(latest), 'manifest.json');
}

function getTemplateCachePath(name: string, latest: boolean): string {
  return join(getExamplesCacheDir(latest), 'templates', `${name}.json`);
}

function getExamplesCacheDir(latest: boolean): string {
  return join(getExamplesCacheRoot(), latest ? 'latest' : CLI_VERSION);
}

function readCachedJson<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function writeCachedJson(filePath: string, value: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeManifest(raw: unknown): ExampleManifest {
  if (Array.isArray(raw)) {
    return {
      schemaVersion: 1,
      cliVersion: CLI_VERSION,
      templates: normalizeEntries(raw),
    };
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Examples manifest must be a JSON object or array.');
  }

  const record = raw as Record<string, unknown>;
  const rawTemplates = Array.isArray(record.templates)
    ? record.templates
    : Array.isArray(record.entries)
      ? record.entries
      : undefined;

  if (!rawTemplates) {
    throw new Error('Examples manifest is missing templates.');
  }

  return {
    schemaVersion:
      typeof record.schemaVersion === 'number' && Number.isFinite(record.schemaVersion)
        ? record.schemaVersion
        : 1,
    cliVersion: typeof record.cliVersion === 'string' ? record.cliVersion : CLI_VERSION,
    templates: normalizeEntries(rawTemplates),
  };
}

function normalizeEntries(rawTemplates: unknown[]): ExampleManifestEntry[] {
  return rawTemplates
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      ...entry,
      name: typeof entry.name === 'string' ? entry.name : '',
      author: typeof entry.author === 'string' ? entry.author : undefined,
      path: typeof entry.path === 'string' ? entry.path : undefined,
      thumbnailPath: typeof entry.thumbnailPath === 'string' ? entry.thumbnailPath : undefined,
      pageCount: typeof entry.pageCount === 'number' ? entry.pageCount : undefined,
      fieldCount: typeof entry.fieldCount === 'number' ? entry.fieldCount : undefined,
      schemaTypes: normalizeStringArray(entry.schemaTypes),
      fontNames: normalizeStringArray(entry.fontNames),
      hasCJK: typeof entry.hasCJK === 'boolean' ? entry.hasCJK : undefined,
      basePdfKind: typeof entry.basePdfKind === 'string' ? entry.basePdfKind : undefined,
    }))
    .filter((entry) => entry.name.length > 0);
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
