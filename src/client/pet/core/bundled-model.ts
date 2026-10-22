// 随插件分发的内置形象（大肥鱼 / 鲸鱼娘的三套装扮）。
// assetUrl 依赖运行时（宿主地址、插件安装名），由 main 在挂载前写进来。
export type BundledModel = {
  id: string;
  name: string;
  /** assetUrl 的相对路径（插件 assets/ 下）。 */
  asset: string;
  /** 用来识别旧地址的后缀：换端口/来源后据此迁到当前地址。 */
  suffix: string;
};

export const BUNDLED_MODELS: readonly BundledModel[] = [
  {
    id: 'dafeiyu',
    name: '鲸鱼娘·女仆 (作者kousakayou)',
    asset: 'live2d/dafeiyu/dafeiyu.model3.json',
    suffix: '/live2d/dafeiyu/dafeiyu.model3.json',
  },
  {
    id: 'dafeiyu-claude',
    name: '鲸鱼娘·Claude (作者kousakayou)',
    asset: 'live2d/dafeiyu-claude/dafeiyu-claude.model3.json',
    suffix: '/live2d/dafeiyu-claude/dafeiyu-claude.model3.json',
  },
  {
    id: 'dafeiyu-basin',
    name: '鲸鱼娘·铁盆 (作者kousakayou)',
    asset: 'live2d/dafeiyu-basin/dafeiyu.model3.json',
    suffix: '/live2d/dafeiyu-basin/dafeiyu.model3.json',
  },
];

/** 默认形象：女仆装。旧版本只认这一个，保留这些导出给旧调用方。 */
export const DEFAULT_BUNDLED_MODEL_ID = BUNDLED_MODELS[0].id;
export const BUNDLED_MODEL_ASSET = BUNDLED_MODELS[0].asset;
export const BUNDLED_MODEL_SUFFIX = BUNDLED_MODELS[0].suffix;
export const BUNDLED_MODEL_NAME = BUNDLED_MODELS[0].name;

/** id -> 当前运行时地址（每次加载由 main 写入）。 */
const bundledModelUrls = new Map<string, string>();

function stripQueryAndHash(value: string): string {
  return String(value || '').split(/[?#]/)[0];
}

function sameUrlPath(left: string, right: string): boolean {
  return !!left && !!right && stripQueryAndHash(left) === stripQueryAndHash(right);
}

/** 一次性写入所有内置形象的当前地址；缺项就留空，避免半套地址。 */
export function setBundledModelUrls(urls: Record<string, string> | null | undefined): void {
  bundledModelUrls.clear();
  if (!urls || typeof urls !== 'object') return;
  for (const model of BUNDLED_MODELS) {
    const url = String(urls[model.id] || '');
    if (url) bundledModelUrls.set(model.id, url);
  }
}

/** 兼容旧调用：只设置默认形象。 */
export function setBundledModelUrl(url: string): void {
  if (String(url || '')) bundledModelUrls.set(DEFAULT_BUNDLED_MODEL_ID, String(url));
}

export function getBundledModelUrl(modelId: string = DEFAULT_BUNDLED_MODEL_ID): string {
  return bundledModelUrls.get(modelId) || '';
}

/** 设置面板用：按资产顺序列出已拿到运行时地址的内置形象。 */
export function getBundledModelOptions(): Array<{ id: string; name: string; path: string }> {
  return BUNDLED_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    path: getBundledModelUrl(model.id),
  })).filter((model) => !!model.path);
}

/** 认出某个路径是哪一个内置形象（含换端口/来源前的旧地址）。 */
export function findBundledModel(path: string): BundledModel | null {
  const value = String(path || '').trim();
  if (!value) return null;
  for (const model of BUNDLED_MODELS) {
    if (sameUrlPath(value, getBundledModelUrl(model.id))) return model;
    if (stripQueryAndHash(value).endsWith(model.suffix)) return model;
  }
  return null;
}

/** 把旧内置地址迁到当前运行时地址；不是内置形象返回空字符串。 */
export function resolveBundledModelUrl(path: string): string {
  const model = findBundledModel(path);
  return model ? getBundledModelUrl(model.id) : '';
}

/** 是否是内置形象（含换端口/来源前的旧地址）。 */
export function isBundledModelPath(path: string): boolean {
  return !!findBundledModel(path);
}
