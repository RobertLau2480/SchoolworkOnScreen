// 字体从程序目录下的 ./fonts/ 文件夹在每次启动时动态读取，用户可自行增删字体文件。
// 支持的格式：.woff2 / .woff / .ttf / .otf。
//
// 性能策略：启动时只从主进程拿到「文件名 + swos-font:// URL」这样的轻量元数据，
// 字体二进制由自定义协议按需流式加载并长期缓存，不再把几十 MB 转成 base64 走 IPC。

export interface FontOption {
  /** 用于 CSS font-family 的字体族名 */
  family: string;
  /** 列表展示用的名称（文件名去掉后缀） */
  label: string;
  /** swos-font:// 协议地址，浏览器可直接加载与缓存 */
  url: string;
}

/** 字体族名加前缀，避免与系统同名字体冲突。 */
const FAMILY_PREFIX = 'SWOS-';

/** 运行时字体列表（启动时填充）。 */
let fontOptions: FontOption[] = [];

/** 注入 @font-face 规则（重复调用会先移除旧规则）。 */
function injectFontFaces(): void {
  window.document.getElementById('swos-font-faces')?.remove();
  const style = window.document.createElement('style');
  style.id = 'swos-font-faces';
  style.textContent = fontOptions
    // 只声明常规字重，浏览器在需要 700 时会用 font-synthesis 合成粗体；
    // 若声明成 "100 900"，浏览器会认为字体自带全部字重而跳过合成，导致粗体无效。
    .map(({ family, url }) => `@font-face{font-family:"${family}";src:url("${url}") format("woff2");font-weight:normal;font-style:normal;font-display:swap;}`)
    .join('\n');
  window.document.head.appendChild(style);
}

/**
 * 从主进程读取 ./fonts/ 目录并注册字体（每次启动调用一次）。
 * 返回最终生效的字体列表。
 */
export async function loadLocalFonts(): Promise<FontOption[]> {
  let files: { label: string; url: string }[] = [];
  try {
    files = await window.schoolwork.listFonts();
  } catch (error) {
    console.error('读取字体目录失败', error);
  }
  fontOptions = files.map(({ label, url }) => ({ family: `${FAMILY_PREFIX}${label}`, label, url }));
  injectFontFaces();
  return fontOptions;
}

/**
 * 生成用于 html-to-image 的 fontEmbedCSS。
 * 只内嵌实际使用到的字体族；dataUrl 由主进程按需提供（已缓存）。
 */
export async function buildFontEmbedCSS(families: Set<string>): Promise<string> {
  const targets = fontOptions.filter((option) => families.has(option.family));
  if (!targets.length) return '';
  let dataUrls: Record<string, string> = {};
  try {
    dataUrls = await window.schoolwork.fontDataUrls(targets.map((option) => option.url));
  } catch (error) {
    console.error('读取字体数据失败', error);
  }
  return targets
    .map(({ family, url }) => {
      const dataUrl = dataUrls[url];
      return dataUrl
        ? `@font-face{font-family:"${family}";src:url("${dataUrl}");font-weight:normal;font-style:normal;}`
        : '';
    })
    .filter(Boolean)
    .join('\n');
}
