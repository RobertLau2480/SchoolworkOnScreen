// 自动扫描 fonts-woff2/ 目录下的所有 .woff2 字体，无需手动逐个 import。
// 新增字体时只需把 .woff2 放进该目录即可，列表会自动出现（显示文件名，去掉后缀）。
// 字体通过注入 @font-face 规则加载，html-to-image 导出时可直接读取。

export interface FontOption {
  /** 用于 CSS font-family 的字体族名 */
  family: string;
  /** 列表展示用的名称（文件名去掉后缀） */
  label: string;
  /** 字体资源的 URL（构建后为产物路径） */
  url: string;
}

/** 字体族名加前缀，避免与系统同名字体冲突。 */
const FAMILY_PREFIX = 'SWOS-';

// eager + query:?url 确保构建时把字体作为静态资源输出并拿到最终 URL
const modules = import.meta.glob('../fonts-woff2/*.woff2', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 从路径中取出不带扩展名的文件名。 */
function fileLabel(path: string): string {
  const name = path.split('/').pop() ?? path;
  return decodeURIComponent(name.replace(/\.woff2$/i, ''));
}

export const fontOptions: FontOption[] = Object.entries(modules)
  .map(([path, url]) => {
    const label = fileLabel(path);
    return { family: `${FAMILY_PREFIX}${label}`, label, url };
  })
  .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));

/** 默认字体：思源黑体，缺失时回退到列表首项。 */
export const DEFAULT_FONT_FAMILY =
  fontOptions.find((option) => option.label === '思源黑体')?.family
  ?? fontOptions[0]?.family
  ?? `${FAMILY_PREFIX}SimSun`;

let injected = false;

/** 注入 @font-face 样式表（只执行一次）。html-to-image 依赖此规则内嵌字体。 */
export function loadLocalFonts(): void {
  if (injected) return;
  injected = true;
  const style = window.document.createElement('style');
  style.id = 'swos-font-faces';
  style.textContent = fontOptions
    .map(({ family, url }) => `@font-face{font-family:"${family}";src:url("${url}") format("woff2");font-weight:100 900;font-style:normal;font-display:block;}`)
    .join('\n');
  window.document.head.appendChild(style);
}

// 字体二进制转 data URL 的缓存，避免导出图片时重复读取
const dataUrlCache = new Map<string, Promise<string>>();

/** 在渲染进程内把字体文件读成 base64 data URL（file:// 下也能工作）。 */
function toDataUrl(url: string): Promise<string> {
  const cached = dataUrlCache.get(url);
  if (cached) return cached;
  const task = (async () => {
    // 打包后页面是 file:// 协议，Chromium 会拦截 fetch(file://)，因此优先走主进程读取
    try {
      const result = await window.schoolwork.fontDataUrls([url]);
      if (result[url]) return result[url];
    } catch {
      /* 忽略，回退到 fetch */
    }
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // 分块拼接，避免超大字符串导致调用栈溢出
    const chunk = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return `data:font/woff2;base64,${window.btoa(binary)}`;
  })().catch(() => '');
  dataUrlCache.set(url, task);
  return task;
}

/**
 * 生成用于 html-to-image 的 fontEmbedCSS。
 * 只内嵌实际使用到的字体族，且 src 使用 base64 data URL，确保任何协议下都能渲染。
 */
export async function buildFontEmbedCSS(families: Set<string>): Promise<string> {
  const targets = fontOptions.filter((option) => families.has(option.family));
  const rules = await Promise.all(targets.map(async ({ family, url }) => {
    const dataUrl = await toDataUrl(url);
    if (!dataUrl) return '';
    return `@font-face{font-family:"${family}";src:url("${dataUrl}") format("woff2");font-weight:100 900;font-style:normal;}`;
  }));
  return rules.filter(Boolean).join('\n');
}

/** 判断某个 font-family 是否属于本地字体。 */
export function isLocalFont(family: string): boolean {
  return family.startsWith(FAMILY_PREFIX);
}