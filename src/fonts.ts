// 字体从程序目录下的 ./fonts/ 文件夹在每次启动时动态读取，用户可自行增删字体文件。
// 支持的格式：.woff2 / .woff / .ttf / .otf。
// 字体通过注入 @font-face 规则加载（src 使用 data URL），因此 html-to-image 导出可直接内嵌。

export interface FontOption {
  /** 用于 CSS font-family 的字体族名 */
  family: string;
  /** 列表展示用的名称（文件名去掉后缀） */
  label: string;
  /** 以内联 data URL 提供的字体数据 */
  dataUrl: string;
}

/** 字体族名加前缀，避免与系统同名字体冲突。 */
const FAMILY_PREFIX = 'SWOS-';

/** 运行时字体列表（启动时填充）。 */
export let fontOptions: FontOption[] = [];

/** 默认字体名（用户字体目录中找不到「思源黑体」时回退到列表首项）。 */
export let DEFAULT_FONT_FAMILY = `${FAMILY_PREFIX}思源黑体`;

/** 注入 @font-face 样式表。重复调用会先移除旧规则，便于字体列表变更后刷新。 */
function injectFontFaces(): void {
  window.document.getElementById('swos-font-faces')?.remove();
  const style = window.document.createElement('style');
  style.id = 'swos-font-faces';
  style.textContent = fontOptions
    // 只声明常规字重，浏览器在需要 700 时会使用 font-synthesis 合成粗体；
    // 若声明成 "100 900"，浏览器会认为字体自带全部字重而跳过合成，导致粗体无效。
    .map(({ family, dataUrl }) => `@font-face{font-family:"${family}";src:url("${dataUrl}");font-weight:normal;font-style:normal;font-display:swap;}`)
    .join('\n');
  window.document.head.appendChild(style);
}

/**
 * 从主进程读取 ./fonts/ 目录并注册字体（每次启动调用一次）。
 * 返回最终生效的字体列表。
 */
export async function loadLocalFonts(): Promise<FontOption[]> {
  let files: { label: string; mime: string; dataUrl: string }[] = [];
  try {
    files = await window.schoolwork.listFonts();
  } catch (error) {
    console.error('读取字体目录失败', error);
  }
  fontOptions = files
    .map(({ label, dataUrl }) => ({ family: `${FAMILY_PREFIX}${label}`, label, dataUrl }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
  DEFAULT_FONT_FAMILY =
    fontOptions.find((option) => option.label === '思源黑体')?.family
    ?? fontOptions[0]?.family
    ?? `${FAMILY_PREFIX}SimSun`;
  injectFontFaces();
  // 触发浏览器加载，避免首次切换字体时闪烁
  if (window.document.fonts?.ready) void window.document.fonts.ready;
  return fontOptions;
}

/**
 * 生成用于 html-to-image 的 fontEmbedCSS。
 * 只内嵌实际使用到的字体族，且 src 已是 data URL，确保任何协议下都能渲染。
 */
export function buildFontEmbedCSS(families: Set<string>): string {
  return fontOptions
    .filter((option) => families.has(option.family))
    .map(({ family, dataUrl }) => `@font-face{font-family:"${family}";src:url("${dataUrl}");font-weight:normal;font-style:normal;}`)
    .join('\n');
}

/** 判断某个 font-family 是否属于本地字体。 */
export function isLocalFont(family: string): boolean {
  return family.startsWith(FAMILY_PREFIX);
}