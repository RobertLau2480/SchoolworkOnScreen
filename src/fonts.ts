// 从项目根目录 fonts-woff2/ 文件夹加载字体（WOFF2 压缩版），并注册到浏览器。
// 采用注入 @font-face 样式表的方式（而非 FontFace API），这样 html-to-image
// 在导出 PNG 时能够读取 document.styleSheets 中的 @font-face 规则并内嵌字体数据。
// 列表内显示文件名（去掉后缀）。
import fangSongUrl from '../fonts-woff2/仿宋.woff2?url';
import huaWenZhongSongUrl from '../fonts-woff2/华文中宋.woff2?url';
import huaWenXinWeiUrl from '../fonts-woff2/华文新魏.woff2?url';
import youYuanUrl from '../fonts-woff2/幼圆.woff2?url';
import siYuanSongTiUrl from '../fonts-woff2/思源宋体.woff2?url';
import siYuanHeiTiUrl from '../fonts-woff2/思源黑体.woff2?url';
import fangZhengYaoTiUrl from '../fonts-woff2/方正姚体.woff2?url';
import fangZhengShuTiUrl from '../fonts-woff2/方正舒体.woff2?url';
import kaiTiUrl from '../fonts-woff2/楷体.woff2?url';
import hanYiLeMiaoTiUrl from '../fonts-woff2/汉仪乐喵体.woff2?url';
import liShuUrl from '../fonts-woff2/隶书.woff2?url';

export interface FontOption {
  /** 用于 CSS font-family 的字体族名 */
  family: string;
  /** 列表展示用的名称（文件名去掉后缀） */
  label: string;
  /** 字体资源的 URL（构建后为产物路径） */
  url: string;
}

const rawFonts: { label: string; url: string }[] = [
  { label: '仿宋', url: fangSongUrl },
  { label: '华文中宋', url: huaWenZhongSongUrl },
  { label: '华文新魏', url: huaWenXinWeiUrl },
  { label: '幼圆', url: youYuanUrl },
  { label: '思源宋体', url: siYuanSongTiUrl },
  { label: '思源黑体', url: siYuanHeiTiUrl },
  { label: '方正姚体', url: fangZhengYaoTiUrl },
  { label: '方正舒体', url: fangZhengShuTiUrl },
  { label: '楷体', url: kaiTiUrl },
  { label: '汉仪乐喵体', url: hanYiLeMiaoTiUrl },
  { label: '隶书', url: liShuUrl },
];

/** 字体族名加前缀，避免与系统同名字体冲突。 */
const FAMILY_PREFIX = 'SWOS-';

export const fontOptions: FontOption[] = rawFonts.map(({ label, url }) => ({
  family: `${FAMILY_PREFIX}${label}`,
  label,
  url,
}));

/** 默认字体：思源黑体。 */
export const DEFAULT_FONT_FAMILY = fontOptions.find((option) => option.label === '思源黑体')?.family ?? fontOptions[0].family;

let injected = false;

/** 注入 @font-face 样式表（只执行一次）。html-to-image 依赖此规则内嵌字体。 */
export function loadLocalFonts(): void {
  if (injected) return;
  injected = true;
  const style = window.document.createElement('style');
  style.id = 'swos-font-faces';
  style.textContent = fontOptions
    .map(({ family, url }) => `@font-face{font-family:"${family}";src:url("${url}") format("woff2");font-weight:normal;font-style:normal;font-display:block;}`)
    .join('\n');
  window.document.head.appendChild(style);
  // 预热加载，避免首次切换字体时出现短暂回退。
  void window.document.fonts.ready;
}

/** 生成仅包含指定字体族的 @font-face CSS，供 html-to-image 内嵌使用。 */
export function buildFontEmbedCSS(families: Set<string>): string {
  return fontOptions
    .filter((option) => families.has(option.family))
    .map(({ family, url }) => `@font-face{font-family:"${family}";src:url("${url}") format("woff2");font-weight:normal;font-style:normal;}`)
    .join('\n');
}

/** 判断某个 font-family 是否属于本地字体。 */
export function isLocalFont(family: string): boolean {
  return family.startsWith(FAMILY_PREFIX);
}