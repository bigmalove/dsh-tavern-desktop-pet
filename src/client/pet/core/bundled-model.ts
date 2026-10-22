// 随插件分发的默认形象（大肥鱼 / 鲸鱼娘）。
// assetUrl 依赖运行时（宿主地址、插件安装名），由 main 在挂载前写进来。
export const BUNDLED_MODEL_ASSET = 'live2d/dafeiyu/dafeiyu.model3.json';
export const BUNDLED_MODEL_SUFFIX = '/live2d/dafeiyu/dafeiyu.model3.json';
export const BUNDLED_MODEL_NAME = '鲸鱼娘 (作者kousakayou)';

let bundledModelUrl = '';

export function setBundledModelUrl(url: string): void {
  bundledModelUrl = String(url || '');
}

export function getBundledModelUrl(): string {
  return bundledModelUrl;
}

/** 是否是自带模型（含换端口/来源前的旧地址）。 */
export function isBundledModelPath(path: string): boolean {
  const value = String(path || '');
  if (!value) return false;
  return value === bundledModelUrl || value.split(/[?#]/)[0].endsWith(BUNDLED_MODEL_SUFFIX);
}
