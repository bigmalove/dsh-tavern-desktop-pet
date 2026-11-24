import { Live2DManager } from './manager';

/**
 * 在线模型库：浏览玩家自己填写的 GitHub 仓库。
 * 插件不内置任何在线仓库地址，地址存在设置的 modelRepo 里。
 */
export interface RepoSource {
  owner: string;
  repo: string;
  /** 分支 / 标签；为空时用仓库默认分支。 */
  ref: string;
  /** 从仓库里的哪个目录开始浏览；为空即仓库根目录。 */
  basePath: string;
}

/** 仓库文件条目 */
export interface RepoEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  isModel: boolean;
  source: RepoSource;
}

const GITHUB_API_BASE = 'https://api.github.com/repos/';
const NAME_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** 目录内容缓存（按仓库 + 分支 + 路径） */
const cache = new Map<string, RepoEntry[]>();

/** 判断文件是否为 Live2D 模型 JSON */
export function isModelFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === 'model.json' ||
    lower === 'model3.json' ||
    lower.endsWith('.model.json') ||
    lower.endsWith('.model3.json')
  );
}

function shouldShow(entry: { name: string; type: string }): boolean {
  // 只显示目录和模型 JSON，其他文件（贴图、动作、压缩包等）都隐藏。
  return entry.type === 'dir' || isModelFile(entry.name);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodePath(path: string): string {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

/**
 * 解析玩家填写的仓库地址，支持：
 * - owner/repo
 * - owner/repo@分支
 * - owner/repo@分支/子目录
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/分支/子目录
 * 解析失败返回 null。
 */
export function parseRepoSource(input: string): RepoSource | null {
  const value = String(input || '').trim();
  if (!value) return null;

  let owner = '';
  let repo = '';
  let ref = '';
  let rest: string[] = [];

  const urlMatch = value.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i);
  if (urlMatch) {
    const parts = urlMatch[1].split(/[?#]/)[0].split('/').filter(Boolean).map(safeDecode);
    if (parts.length < 2) return null;
    owner = parts[0];
    repo = parts[1];
    if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
      ref = parts[3];
      rest = parts.slice(4);
      // blob 指向的是文件：退到它所在的目录。
      if (parts[2] === 'blob' && rest.length > 0) rest = rest.slice(0, -1);
    }
  } else {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
    const parts = value.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    owner = parts[0];
    const [repoName, atRef] = parts[1].split('@');
    repo = repoName;
    ref = atRef || '';
    rest = parts.slice(2);
  }

  repo = repo.replace(/\.git$/i, '');
  if (!NAME_SEGMENT.test(owner) || !NAME_SEGMENT.test(repo)) return null;
  if (ref && /[\s/]/.test(ref)) return null;

  return { owner, repo, ref, basePath: rest.join('/') };
}

/** 规范化成 owner/repo[@ref][/子目录]，用来保存和显示。 */
export function formatRepoSource(source: RepoSource): string {
  const refPart = source.ref ? `@${source.ref}` : '';
  const pathPart = source.basePath ? `/${source.basePath}` : '';
  return `${source.owner}/${source.repo}${refPart}${pathPart}`;
}

/** 仓库不存在 / 目录不存在之类、换代理也没用的错误。 */
class RepoNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoNotFoundError';
  }
}

/** 请求 GitHub API：先直连（本身支持 CORS），失败再走 CORS 代理。 */
async function githubApiGet(apiUrl: string): Promise<any> {
  const headers = { Accept: 'application/vnd.github.v3+json' };
  try {
    const resp = await fetch(apiUrl, { headers });

    if (resp.status === 403 || resp.status === 429) {
      const remaining = resp.headers.get('X-RateLimit-Remaining');
      const resetTime = resp.headers.get('X-RateLimit-Reset');
      const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000) : null;
      throw new RateLimitError(remaining, resetDate);
    }
    if (resp.status === 404) {
      throw new RepoNotFoundError('仓库或目录不存在（HTTP 404），请检查地址和分支');
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    if (e instanceof RateLimitError || e instanceof RepoNotFoundError) throw e;
    const proxiedUrl = Live2DManager._getProxiedUrl(apiUrl);
    const resp = await fetch(proxiedUrl, { headers });

    if (resp.status === 403 || resp.status === 429) throw new RateLimitError(null, null);
    if (resp.status === 404) {
      throw new RepoNotFoundError('仓库或目录不存在（HTTP 404），请检查地址和分支');
    }
    if (!resp.ok) throw new Error(`获取目录失败: HTTP ${resp.status}`);
    return await resp.json();
  }
}

/** 没写分支时查一次仓库默认分支，保证目录列表和模型地址指向同一个分支。 */
export async function resolveRepoSource(source: RepoSource): Promise<RepoSource> {
  if (source.ref) return source;
  const info = await githubApiGet(`${GITHUB_API_BASE}${source.owner}/${source.repo}`);
  const branch = typeof info?.default_branch === 'string' ? info.default_branch : '';
  return { ...source, ref: branch };
}

function cacheKey(source: RepoSource, path: string): string {
  return `${source.owner}/${source.repo}@${source.ref}:${path}`;
}

/** 通过 GitHub API 获取目录内容 */
export async function fetchDirectory(source: RepoSource, path: string): Promise<RepoEntry[]> {
  const key = cacheKey(source, path);
  const cached = cache.get(key);
  if (cached) return cached;

  const refQuery = source.ref ? `?ref=${encodeURIComponent(source.ref)}` : '';
  const apiUrl = `${GITHUB_API_BASE}${source.owner}/${source.repo}/contents/${encodePath(path)}${refQuery}`;
  const data = await githubApiGet(apiUrl);

  if (!Array.isArray(data)) {
    throw new Error('这个地址不是目录，请填写仓库或文件夹地址');
  }

  const entries: RepoEntry[] = data
    .map((item: any) => ({
      name: item.name as string,
      path: item.path as string,
      type: (item.type === 'dir' ? 'dir' : 'file') as 'file' | 'dir',
      isModel: item.type === 'file' && isModelFile(item.name),
      source,
    }))
    .filter(shouldShow)
    .sort((a, b) => {
      // 目录在前，文件在后
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  cache.set(key, entries);
  return entries;
}

/** 把仓库里的文件路径转成 jsDelivr 或 GitHub raw 地址（对中文等非 ASCII 字符编码）。 */
export function buildModelUrl(source: RepoSource, path: string, useCdn: boolean = true): string {
  const encoded = encodePath(path);
  if (useCdn) {
    const refPart = source.ref ? `@${encodeURIComponent(source.ref)}` : '';
    return `https://cdn.jsdelivr.net/gh/${source.owner}/${source.repo}${refPart}/${encoded}`;
  }
  const ref = encodeURIComponent(source.ref || 'HEAD');
  return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${ref}/${encoded}`;
}

/** 清除缓存 */
export function clearCache(): void {
  cache.clear();
}

/** API 限流错误 */
export class RateLimitError extends Error {
  remaining: string | null;
  resetDate: Date | null;

  constructor(remaining: string | null, resetDate: Date | null) {
    const resetStr = resetDate ? resetDate.toLocaleTimeString() : '未知';
    super(`GitHub API 已达到请求限制，请在 ${resetStr} 后重试`);
    this.name = 'RateLimitError';
    this.remaining = remaining;
    this.resetDate = resetDate;
  }
}
