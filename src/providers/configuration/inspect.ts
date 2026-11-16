import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  ConfigurationDeclaration,
  ConfigurationInspection,
  ConfigurationScope,
  ConfigurationSource,
  Provider,
} from '../../shared/model';
import { type Projection, projectJson, projectToml, type Select } from './projection';

interface SourceSpec extends ConfigurationSource {
  base: string;
  format: 'json' | 'toml';
}
export interface InspectConfigurationOptions {
  provider: Provider;
  cwd: string;
  runtimeHome?: string;
  home?: string;
  systemDirectory?: string;
  signal?: AbortSignal;
}
const IDENTIFIER = /^[A-Za-z0-9_.:@/-]{1,200}$/;
const ENVIRONMENT = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const BOOLS = new Set([
  'disableAllHooks',
  'disableBundledSkills',
  'disableSkillShellExecution',
  'enableAllProjectMcpServers',
]);
const MAX_CONFIGURATION_BYTES = 256 * 1024;
const POLICY_KEYS = new Set([
  'allowed_approval_policies',
  'allowed_sandbox_modes',
  'allowed_mcp_servers',
  'allowedMcpServers',
  'deniedMcpServers',
  'allowManagedHooksOnly',
  'allowManagedPermissionRulesOnly',
]);
const ENUMS: Record<string, readonly string[]> = {
  'permissions.defaultMode': [
    'default',
    'acceptEdits',
    'dontAsk',
    'plan',
    'auto',
    'bypassPermissions',
  ],
  sandbox_mode: ['read-only', 'workspace-write', 'danger-full-access'],
  approval_policy: ['untrusted', 'on-failure', 'on-request', 'never'],
};
function booleanKey(provider: Provider, key: string): boolean {
  return provider === 'claude'
    ? BOOLS.has(key)
    : ['features.hooks', 'features.plugins', 'skills.bundled.enabled'].includes(key);
}
function identity(value: string): boolean {
  return IDENTIFIER.test(value);
}
function credential(field: string[]): boolean {
  if (field.length === 2 && field[0] === 'env' && ENVIRONMENT.test(field[1])) return true;
  return (
    field.length === 4 &&
    ['mcpServers', 'mcp_servers'].includes(field[0]) &&
    identity(field[1]) &&
    ['env', 'headers', 'http_headers'].includes(field[2])
  );
}
function credentialRef(field: string[]): boolean {
  if (
    field.length === 4 &&
    field[0] === 'mcp_servers' &&
    identity(field[1]) &&
    field[2] === 'env_http_headers'
  )
    return true;
  return (
    field.length === 3 &&
    field[0] === 'mcp_servers' &&
    identity(field[1]) &&
    field[2] === 'bearer_token_env_var'
  );
}
function selectFor(provider: Provider): Select {
  return (field, type) => {
    const key = field.join('.');
    const simple = field.every((part) => !part.includes('.'));
    if (simple && booleanKey(provider, key)) return type === 'boolean' ? 'value' : 'presence';
    if (
      simple &&
      Object.hasOwn(ENUMS, key) &&
      (provider === 'claude'
        ? key === 'permissions.defaultMode'
        : key !== 'permissions.defaultMode')
    )
      return type === 'string' ? 'value' : 'presence';
    if (field.length === 1 && POLICY_KEYS.has(key)) return 'presence';
    if (credential(field)) return 'presence';
    if (credentialRef(field)) return type === 'string' ? 'value' : 'presence';
    if (provider === 'claude' && field.length === 2 && identity(field[1])) {
      if (field[0] === 'skillOverrides') return type === 'string' ? 'value' : 'presence';
      if (field[0] === 'enabledPlugins') return type === 'boolean' ? 'value' : 'presence';
    }
    if (
      provider === 'codex' &&
      field.length === 4 &&
      field[0] === 'skills' &&
      field[1] === 'config' &&
      /^#\d+$/.test(field[2])
    ) {
      if (['name', 'path'].includes(field[3])) return type === 'string' ? 'value' : 'presence';
      if (field[3] === 'enabled') return type === 'boolean' ? 'value' : 'presence';
    }
    if (
      provider === 'codex' &&
      field.length === 3 &&
      field[0] === 'mcp_servers' &&
      identity(field[1]) &&
      field[2] === 'enabled'
    )
      return type === 'boolean' ? 'value' : 'presence';
    return undefined;
  };
}

/** Returns safe, allowlisted declarations only. Unknown string values are never decoded. */
export function configurationDeclarations(
  provider: Provider,
  text: string,
  format: 'json' | 'toml',
  sourceId: string,
): ConfigurationDeclaration[] {
  const projected =
    format === 'json'
      ? projectJson(text, selectFor(provider))
      : projectToml(text, selectFor(provider));
  const result: ConfigurationDeclaration[] = [];
  for (const item of projected) {
    const key =
      item.path[2] === 'env_http_headers'
        ? `${item.path.slice(0, 3).join('.')}.(reference)`
        : item.path.join('.');
    if (item.path[0] === 'skills' && item.path[1] === 'config') continue;
    let value = 'Unsupported value';
    let category: ConfigurationDeclaration['category'] = 'setting';
    let resolution: ConfigurationDeclaration['resolution'] = 'declarationOnly';
    if (POLICY_KEYS.has(key)) {
      result.push({
        sourceId,
        key,
        value: 'Configured · resolve with native provider',
        category: 'policy',
        resolution,
      });
      continue;
    }
    if (credential(item.path)) {
      // Header names and inline credential values are intentionally not exported.
      const env = item.path.at(-2) === 'env' || item.path.length === 2;
      if (env && !ENVIRONMENT.test(item.path.at(-1) ?? '')) continue;
      result.push({
        sourceId,
        key: env ? key : `${item.path.slice(0, -1).join('.')}.(values hidden)`,
        value: 'Value managed by native provider',
        category: 'credentialReference',
        resolution,
      });
      continue;
    }
    if (credentialRef(item.path)) {
      category = 'credentialReference';
      if (typeof item.value === 'string' && ENVIRONMENT.test(item.value)) value = item.value;
    } else if (typeof item.value === 'boolean') {
      value = String(item.value);
      if (booleanKey(provider, key)) resolution = 'localWinner';
    } else if (Object.hasOwn(ENUMS, key) && ENUMS[key].includes(String(item.value))) {
      value = String(item.value);
      // Permission decisions have field-specific restrictions and launch overrides.
      if (key !== 'permissions.defaultMode') resolution = 'localWinner';
    } else if (item.path[0] === 'skillOverrides') {
      category = 'skill';
      if (['on', 'off', 'name-only', 'user-invocable-only'].includes(String(item.value))) {
        value = String(item.value);
        resolution = 'localWinner';
      }
    }
    result.push({ sourceId, key, value, category, resolution });
  }
  const groups = new Map<string, Projection[]>();
  for (const item of projected) {
    if (item.path[0] !== 'skills' || item.path[1] !== 'config') continue;
    const group = groups.get(item.path[2]) ?? [];
    group.push(item);
    groups.set(item.path[2], group);
  }
  for (const [index, group] of groups) {
    const name = group.find((item) => item.path[3] === 'name')?.value;
    const file = group.find((item) => item.path[3] === 'path')?.value;
    const enabled = group.find((item) => item.path[3] === 'enabled')?.value;
    let selector = 'Unsupported selector';
    if (name && !file && typeof name === 'string' && identity(name)) selector = `name: ${name}`;
    if (
      file &&
      !name &&
      typeof file === 'string' &&
      path.isAbsolute(file) &&
      file.length <= 4096 &&
      !/[\r\n]/.test(file)
    )
      selector = `path: ${file}`;
    result.push({
      sourceId,
      key: `skills.config.${index}`,
      value: `${selector} · enabled: ${typeof enabled === 'boolean' ? enabled : 'unknown'}`,
      category: 'skill',
      resolution: 'declarationOnly',
    });
  }
  return result.filter(
    (row, index, all) =>
      all.findIndex((other) => other.key === row.key && other.value === row.value) === index,
  );
}

async function projectDirectories(cwd: string, signal?: AbortSignal): Promise<string[]> {
  const directories: string[] = [];
  let current = path.resolve(cwd);
  for (let depth = 0; depth < 64; depth++) {
    signal?.throwIfAborted();
    directories.push(current);
    if (
      await lstat(path.join(current, '.git')).then(
        () => true,
        () => false,
      )
    )
      return directories.reverse();
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [path.resolve(cwd)];
}
function systemDirectory(provider: Provider): string {
  if (provider === 'codex') return process.platform === 'win32' ? '' : '/etc/codex';
  if (process.platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (process.platform === 'win32')
    return path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'ClaudeCode');
  return '/etc/claude-code';
}
async function specs(options: InspectConfigurationOptions): Promise<SourceSpec[]> {
  const home = options.home ?? homedir();
  const runtimeHome = options.runtimeHome
    ? path.resolve(options.cwd, options.runtimeHome)
    : path.join(home, options.provider === 'claude' ? '.claude' : '.codex');
  const system = options.systemDirectory ?? systemDirectory(options.provider);
  const result: SourceSpec[] = [];
  function add(base: string, relative: string, scope: ConfigurationScope) {
    if (!base) return;
    const file = path.join(base, relative);
    result.push({
      id: `${scope}:${file}`,
      path: file,
      base,
      scope,
      managed: scope === 'managed',
      status: 'missing',
      format: options.provider === 'claude' ? 'json' : 'toml',
    });
  }
  const directories = await projectDirectories(options.cwd, options.signal);
  if (options.provider === 'codex') {
    add(system, 'config.toml', 'system');
    add(runtimeHome, 'config.toml', 'user');
    for (const directory of directories) add(directory, '.codex/config.toml', 'project');
    add(system, 'requirements.toml', 'managed');
  } else {
    add(runtimeHome, 'settings.json', 'user');
    // Claude project settings use the project root. Nested cwd settings are separately uncertain.
    const root = directories[0];
    add(root, '.claude/settings.json', 'project');
    add(root, '.claude/settings.local.json', 'projectLocal');
    add(root, '.mcp.json', 'project');
    add(system, 'managed-settings.json', 'managed');
  }
  return result;
}

async function readSource(source: SourceSpec, signal?: AbortSignal): Promise<string | undefined> {
  signal?.throwIfAborted();
  try {
    const info = await lstat(source.path);
    if (!info.isFile() || info.size > MAX_CONFIGURATION_BYTES) {
      source.status = 'unsupported';
      return;
    }
    const [base, target] = await Promise.all([realpath(source.base), realpath(source.path)]);
    const relative = path.relative(base, target);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      source.status = 'unsupported';
      return;
    }
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.size > MAX_CONFIGURATION_BYTES ||
        opened.dev !== info.dev ||
        opened.ino !== info.ino ||
        (await realpath(source.path)) !== target
      ) {
        source.status = 'unsupported';
        return;
      }
      const buffer = Buffer.alloc(MAX_CONFIGURATION_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      signal?.throwIfAborted();
      if (bytesRead > MAX_CONFIGURATION_BYTES) {
        source.status = 'unsupported';
        return;
      }
      return buffer.toString('utf8', 0, bytesRead).replace(/^\uFEFF/, '');
    } finally {
      await handle.close();
    }
  } catch (error) {
    signal?.throwIfAborted();
    source.status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable';
  }
}

export async function inspectConfiguration(
  options: InspectConfigurationOptions,
): Promise<ConfigurationInspection> {
  const sources = await specs(options);
  const declarations: ConfigurationDeclaration[] = [];
  for (const source of sources) {
    const text = await readSource(source, options.signal);
    if (text === undefined) continue;
    try {
      const rows = configurationDeclarations(options.provider, text, source.format, source.id);
      if (declarations.length + rows.length > 2000) {
        source.status = 'unsupported';
        continue;
      }
      source.status = source.format === 'toml' ? 'partial' : 'read';
      for (const row of rows) {
        if (source.managed) row.resolution = 'constraint';
        // Security switches and managed restrictions require provider-specific merge rules.
        if (!source.managed && row.key.startsWith('disable')) row.resolution = 'declarationOnly';
      }
      declarations.push(...rows);
    } catch {
      source.status = 'unsupported';
    }
  }
  // Only ordinary allowlisted settings get a tentative local winner. Policy is never inferred.
  const winners = new Map<string, ConfigurationDeclaration>();
  for (const row of declarations) {
    if (row.resolution !== 'localWinner') continue;
    const previous = winners.get(row.key);
    if (previous) previous.resolution = 'overridden';
    winners.set(row.key, row);
  }
  const uncertain = sources.some(
    (source) => !source.managed && ['unavailable', 'unsupported'].includes(source.status),
  );
  const constrained = new Set(
    declarations.filter((row) => row.resolution === 'constraint').map((row) => row.key),
  );
  for (const row of declarations) {
    if (row.resolution === 'localWinner' && (uncertain || constrained.has(row.key)))
      row.resolution = 'declarationOnly';
  }
  return {
    provider: options.provider,
    cwd: options.cwd,
    observedAt: new Date().toISOString(),
    sources: sources.map(({ base: _base, format: _format, ...source }) => source),
    declarations,
    limitations: [
      'Read-only file projection using current documented keys. Local winners are estimates; native acceptance for the installed version and session availability remain unverified.',
      'Cloud policy, MDM, managed fragments, launch flags, selected Codex profiles and native trust decisions are unresolved. Missing files do not prove a policy is absent.',
      'Only supported skill controls, selected safety settings and credential references are shown. Credential values, commands and endpoints are omitted; no authentication files are read.',
      options.provider === 'codex'
        ? 'TOML inspection supports selected scalar/table declarations only; it does not validate the whole document. Project layers require native trust. Skill rules are listed in file order, not evaluated across selectors or layers.'
        : 'Claude project sources are candidates at the repository root (or cwd without Git). Nested project resolution, managed merge exceptions, and user/local MCP installation scopes are unresolved. skillOverrides apply to standalone skills, not plugin skills.',
    ],
  };
}
