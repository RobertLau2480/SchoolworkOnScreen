// 从项目根目录 fonts/ 文件夹加载字体，并注册到浏览器 FontFace。
// 使用 Vite 的 `?url` 后缀导入，让字体作为静态资源被复制到产物目录。
// 列表内显示文件名（去掉后缀）。
import fangSongUrl from '../fonts/仿宋.ttf?url';
import huaWenZhongSongUrl from '../fonts/华文中宋.TTF?url';
import huaWenXinWeiUrl from '../fonts/华文新魏.TTF?url';
import youYuanUrl from '../fonts/幼圆.TTF?url';
import siYuanSongTiUrl from '../fonts/思源宋体.otf?url';
import siYuanHeiTiUrl from '../fonts/思源黑体.otf?url';
import fangZhengYaoTiUrl from '../fonts/方正姚体.TTF?url';
import fangZhengShuTiUrl from '../fonts/方正舒体.TTF?url';
import kaiTiUrl from '../fonts/楷体.ttf?url';
import hanYiLeMiaoTiUrl from '../fonts/汉仪乐喵体.otf?url';
import liShuUrl from '../fonts/隶书.TTF?url';

export interface FontOption {
  /** 用于 CSS font-family 的字体族名 */
  family: string;
  /** 列表展示用的名称（文件名去掉后缀） */
  label: string;
}

const rawFonts: { label: string; url: string; format: string }[] = [
  { label: '仿宋', url: fangSongUrl, format: 'truetype' },
  { label: '华文中宋', url: huaWenZhongSongUrl, format: 'truetype' },
  { label: '华文新魏', url: huaWenXinWeiUrl, format: 'truetype' },
  { label: '幼圆', url: youYuanUrl, format: 'truetype' },
  { label: '思源宋体', url: siYuanSongTiUrl, format: 'opentype' },
  { label: '思源黑体', url: siYuanHeiTiUrl, format: 'opentype' },
  { label: '方正姚体', url: fangZhengYaoTiUrl, format: 'truetype' },
  { label: '方正舒体', url: fangZhengShuTiUrl, format: 'truetype' },
  { label: '楷体', url: kaiTiUrl, format: 'truetype' },
  { label: '汉仪乐喵体', url: hanYiLeMiaoTiUrl, format: 'opentype' },
  { label: '隶书', url: liShuUrl, format: 'truetype' },
];

/** 字体族名加前缀，避免与系统同名字体冲突。 */
const FAMILY_PREFIX = 'SWOS-';

export const fontOptions: FontOption[] = rawFonts.map(({ label }) => ({
  family: `${FAMILY_PREFIX}${label}`,
  label,
}));

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