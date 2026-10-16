// 从项目根目录 fonts-woff2/ 文件夹加载字体（WOFF2 压缩版，体积更小），
// 并注册到浏览器 FontFace。使用 Vite 的 `?url` 后缀导入，让字体作为静态资源复制到产物目录。
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
}

const rawFonts: { label: string; url: string; format: string }[] = [
  { label: '仿宋', url: fangSongUrl, format: 'woff2' },
  { label: '华文中宋', url: huaWenZhongSongUrl, format: 'woff2' },
  { label: '华文新魏', url: huaWenXinWeiUrl, format: 'woff2' },
  { label: '幼圆', url: youYuanUrl, format: 'woff2' },
  { label: '思源宋体', url: siYuanSongTiUrl, format: 'woff2' },
  { label: '思源黑体', url: siYuanHeiTiUrl, format: 'woff2' },
  { label: '方正姚体', url: fangZhengYaoTiUrl, format: 'woff2' },
  { label: '方正舒体', url: fangZhengShuTiUrl, format: 'woff2' },
  { label: '楷体', url: kaiTiUrl, format: 'woff2' },
  { label: '汉仪乐喵体', url: hanYiLeMiaoTiUrl, format: 'woff2' },
  { label: '隶书', url: liShuUrl, format: 'woff2' },
];

/** 字体族名加前缀，避免与系统同名字体冲突。 */
const FAMILY_PREFIX = 'SWOS-';

export const fontOptions: FontOption[] = rawFonts.map(({ label }) => ({
  family: `${FAMILY_PREFIX}${label}`,
  label,
}));

/** 默认字体：思源黑体。 */
export const DEFAULT_FONT_FAMILY = fontOptions.find((option) => option.label === '思源黑体')?.family ?? fontOptions[0].family;

let loaded = false;

/** 将所有本地字体注册为 FontFace（只执行一次）。 */
export async function loadLocalFonts(): Promise<void> {
  if (loaded) return;
  loaded = true;
  await Promise.all(rawFonts.map(async ({ label, url, format }) => {
    try {
      const face = new FontFace(`${FAMILY_PREFIX}${label}`, `url(${url}) format('${format}')`);
      await face.load();
      window.document.fonts.add(face);
    } catch (error) {
      console.error(`字体加载失败：${label}`, error);
    }
  }));
}

/** 判断某个 font-family 是否属于本地字体。 */
export function isLocalFont(family: string): boolean {
  return family.startsWith(FAMILY_PREFIX);
}