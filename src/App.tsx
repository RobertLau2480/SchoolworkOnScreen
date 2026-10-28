import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import appIcon from '../icon.png';
import { buildFontEmbedCSS, loadLocalFonts, type FontOption } from './fonts';
import type { AppSettings, HomeworkCell, HomeworkDocument, Layout, Theme } from './types';

const FONT_FALLBACK = '"Microsoft YaHei", "SimHei", sans-serif';
const fontStack = (family: string) => (family ? `"${family}", ${FONT_FALLBACK}` : FONT_FALLBACK);

const layouts: Record<Layout, { rows: number; columns: number }> = {
  '2x3': { rows: 2, columns: 3 },
  '2x4': { rows: 2, columns: 4 },
  '2x5': { rows: 2, columns: 5 },
};
const subjects = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '其他'];

const THEME_PALETTES: Record<Theme, string[]> = {
  dark: ['#ffffff', '#ff5252', '#ffd83d', '#7cc0ff', '#c77dff'],
  light: ['#000000', '#c62828', '#b58900', '#1565c0', '#6a1b9a'],
};
const THEME_SURFACES: Record<Theme, { background: string; frame: string; textColor: string }> = {
  dark: { background: '#29332f', frame: '#35413b', textColor: '#ffffff' },
  light: { background: '#eef1ee', frame: '#ffffff', textColor: '#000000' },
};

// 深色模式用深棕色高光（深底上更柔和），浅色模式用亮黄
const HIGHLIGHT_COLORS: Record<Theme, string> = { dark: '#5a3a1e', light: '#fff176' };
const LEGACY_HIGHLIGHT_COLORS = ['#087f80', '#58d9e6'];
const VERSION = '1.2.2';
const BUILD_DATE = '2026年10月27日';
const UNDO_LIMIT = 120;
const BILIBILI_URL = 'https://space.bilibili.com/509648854';

const FONT_SIZES = { small: 26, medium: 30, large: 34 } as const;
/** 最小字号（px），自适应缩放的下限 */
const MIN_FONT_SIZE = 10;
/**
 * 选中文字的字号滑条范围（px）。
 * 写入绝对像素值，彻底避免 em 嵌套叠加导致的样式冲突；
 * 档位连续可调，不再局限于固定几档。
 */
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 72;
/** 选区字号不一致时滑条的默认停靠字号 */
const FONT_SIZE_DEFAULT = 30;
const defaultSettings: AppSettings = {
  background: THEME_SURFACES.dark.background,
  frame: THEME_SURFACES.dark.frame,
  locked: true,
  font: '',
  fontSize: 'medium',
  textColor: THEME_SURFACES.dark.textColor,
  bold: false,
  highlight: HIGHLIGHT_COLORS.dark,
  theme: 'dark',
};

function formatRelativeTime(timestamp: number | null | undefined, now: number): string {
  if (!timestamp) return '';
  const diff = now - timestamp;
  if (diff < 0) return '刚刚';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

function isTimeStale(timestamp: number | null | undefined, now: number): boolean {
  if (!timestamp) return false;
  return now - timestamp > 12 * 60 * 60 * 1000;
}

type SelectedFormat = Pick<AppSettings, 'font' | 'textColor' | 'bold' | 'highlight'> & {
  highlighted: boolean;
  italic: boolean;
  /** 选区统一时的实际字号（px）；不统一时用锚点处字号作为滑条停靠位置 */
  sizePx: number;
  /** 选区内的字号是否统一；不统一时滑条显示中性状态 */
  sizeUniform: boolean;
};

/**
 * 让单元格内容始终留在框内：先按基准字号排版，放不下就二分查找更小的字号，
 * 并把内容里所有「手动设置过字号」的片段按同一比例一起缩小，避免局部大字号把框撑破。
 * 手动字号记录在 data-swos-fs 上（作者字号），所以反复缩放不会层层缩小。
 */
function fitEditor(editor: HTMLElement, baseSize: number): void {
  const overflows = () => editor.scrollHeight > editor.clientHeight + 1 || editor.scrollWidth > editor.clientWidth + 1;

  const scaleInline = (factor: number) => {
    editor.querySelectorAll<HTMLElement>('[style*="font-size"]').forEach((element) => {
      let authored = Number.parseFloat(element.dataset.swosFs ?? '');
      if (!Number.isFinite(authored) || authored <= 0) {
        // 旧数据没记录作者字号：把当前字号视为作者字号
        const current = Number.parseFloat(element.style.fontSize);
        if (!Number.isFinite(current) || current <= 0) return;
        authored = current;
        element.dataset.swosFs = `${authored}`;
      }
      element.style.fontSize = `${Math.round(Math.max(1, authored * factor) * 100) / 100}px`;
    });
  };

  scaleInline(1); // 先还原成作者字号，再重新测量
  editor.style.fontSize = `${baseSize}px`;
  if (!overflows()) return;

  let low = MIN_FONT_SIZE;
  let high = baseSize;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const size = (low + high) / 2;
    editor.style.fontSize = `${size}px`;
    scaleInline(size / baseSize);
    if (overflows()) high = size;
    else low = size;
  }
  const fitted = Math.max(MIN_FONT_SIZE, low);
  editor.style.fontSize = `${fitted}px`;
  scaleInline(fitted / baseSize);
}

function cssColorToHex(color: string): string {
  if (color.startsWith('#')) return color.toLowerCase();
  const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  return values?.length === 3
    ? `#${values.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`
    : '#e6edef';
}

function buildColorMapping(from: Theme, to: Theme): Record<string, string> {
  const mapping: Record<string, string> = {};
  THEME_PALETTES[from].forEach((color, index) => {
    mapping[color.toLowerCase()] = THEME_PALETTES[to][index];
  });
  return mapping;
}

function remapTextColors(html: string, mapping: Record<string, string>): string {
  if (!html || !html.includes('color')) return html;
  const container = window.document.createElement('div');
  container.innerHTML = html;
  let changed = false;
  container.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    const inline = element.style.color;
    if (!inline) return;
    const hex = cssColorToHex(inline);
    const target = mapping[hex];
    if (target && target.toLowerCase() !== hex) {
      element.style.color = target;
      changed = true;
    }
  });
  return changed ? container.innerHTML : html;
}

function remapHighlightColors(html: string, mapping: Record<string, string>): string {
  if (!html || !html.includes('background')) return html;
  const container = window.document.createElement('div');
  container.innerHTML = html;
  let changed = false;
  container.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    const inline = element.style.backgroundColor;
    if (!inline) return;
    const hex = cssColorToHex(inline);
    const target = mapping[hex];
    if (target && target.toLowerCase() !== hex) {
      element.style.backgroundColor = target;
      changed = true;
    }
  });
  return changed ? container.innerHTML : html;
}

function saveOffsets(editor: HTMLElement, range: Range): { start: number; end: number } {
  const pre = window.document.createRange();
  pre.selectNodeContents(editor);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + range.toString().length };
}

function restoreOffsets(editor: HTMLElement, start: number, end: number): Range {
  const walker = window.document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const range = window.document.createRange();
  let count = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const next = count + text.length;
    if (!startNode && start <= next) {
      startNode = text;
      startOffset = Math.max(0, Math.min(text.length, start - count));
    }
    if (!endNode && end <= next) {
      endNode = text;
      endOffset = Math.max(0, Math.min(text.length, end - count));
      break;
    }
    count = next;
  }
  if (!startNode || !endNode) {
    range.selectNodeContents(editor);
    return range;
  }
  try {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  } catch {
    range.selectNodeContents(editor);
  }
  return range;
}

/**
 * 把选区起止边界处被「切到一半」的文本节点拆开。
 * 拆完后选区外的文字成为独立节点，后续无论怎样包裹都不会被牵连。
 */
function splitTextAtRange(range: Range): void {
  const { startContainer, startOffset, endContainer, endOffset } = range;
  // 先切尾部：此时头部边界尚未变化，range 会自动跟随
  if (endContainer.nodeType === Node.TEXT_NODE) {
    const text = endContainer as Text;
    if (endOffset > 0 && endOffset < text.length) text.splitText(endOffset);
  }
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const text = startContainer as Text;
    if (startOffset > 0 && startOffset < text.length) text.splitText(startOffset);
  }
}

/** 选区两端是否仍挂在文档上（编辑区被重写后 Range 会失效） */
function isRangeAlive(range: Range | null): boolean {
  return Boolean(range && range.startContainer.isConnected && range.endContainer.isConnected);
}

function emptyDocument(layout: Layout): HomeworkDocument {
  const { rows, columns } = layouts[layout];
  return {
    version: 1,
    layout,
    cells: Array.from({ length: rows * columns }, (_, index) => ({ subject: subjects[index] ?? '其他', text: '' })),
    columns: Array(columns).fill(1),
    rows: Array(rows).fill(1),
  };
}

function parseSettings(raw: Record<string, string>, fonts: FontOption[]): AppSettings {
  const theme: Theme = raw.theme === 'light' ? 'light' : 'dark';
  const surfaces = THEME_SURFACES[theme];
  const savedTextColor = raw.textColor?.toLowerCase();
  // 默认字体固定为「思源黑体」：只有用户明确选过其它字体时才沿用。
  const preferredFamily = fonts.find((option) => option.label === '思源黑体')?.family
    ?? fonts[0]?.family
    ?? '';
  const savedFamily = fonts.some((option) => option.family === raw.font) ? raw.font : preferredFamily;
  return {
    background: raw.background ?? surfaces.background,
    frame: raw.frame ?? surfaces.frame,
    locked: raw.locked !== 'false',
    font: raw.font ? savedFamily : preferredFamily,
    fontSize: raw.fontSize === 'small' || raw.fontSize === 'large' ? raw.fontSize : 'medium',
    textColor: savedTextColor ?? surfaces.textColor,
    bold: raw.bold === 'true',
    highlight: HIGHLIGHT_COLORS[theme],
    theme,
  };
}

function escapeHtml(value: string): string {
  return value
    .split('\u0026').join('\u0026amp;')
    .split('\u003C').join('\u0026lt;')
    .split('\u003E').join('\u0026gt;')
    .split('\u0022').join('\u0026quot;');
}

function buildHistoryHtml(doc: HomeworkDocument, theme: Theme): string {
  const surfaces = THEME_SURFACES[theme];
  const { columns } = layouts[doc.layout];
  const cells = doc.cells.map((cell) => {
    const subject = cell.subject ? `<div class="s">${escapeHtml(cell.subject)}</div>` : '';
    return `<div class="c">${subject}<div class="t">${cell.text}</div></div>`;
  }).join('');
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<title>屏上作业 ${doc.layout}</title>`
    + '<style>'
    + `body{margin:0;padding:14px;background:${surfaces.background};color:${surfaces.textColor};font-family:"Microsoft YaHei","SimHei",sans-serif;font-size:18px}`
    + `.g{display:grid;grid-template-columns:repeat(${columns},1fr);gap:10px}`
    + `.c{background:${surfaces.frame};border-radius:6px;padding:10px;min-height:90px}`
    + '.s{font-weight:700;font-size:1.15em;margin-bottom:6px}'
    + '.t{white-space:pre-wrap;word-break:break-word;line-height:1.5}'
    + '</style></head><body>'
    + `<div class="g">${cells}</div></body></html>`;
}

async function appendFooterBar(dataUrl: string, theme: Theme): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('image decode failed'));
    el.src = dataUrl;
  });
  const light = theme === 'light';
  const scale = 2;
  const barHeight = Math.round(46 * scale);
  const canvas = window.document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height + barHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.fillStyle = light ? '#f4f7f4' : '#1a2320';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  ctx.fillStyle = light ? '#d5ded9' : '#31403b';
  ctx.fillRect(0, image.height, canvas.width, Math.max(1, scale));
  const padding = Math.round(16 * scale);
  const centerY = image.height + barHeight / 2 + scale * 0.5;
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(12 * scale)}px "Segoe UI","Microsoft YaHei",sans-serif`;
  ctx.fillStyle = light ? '#5c6d67' : '#a6b8b2';
  ctx.textAlign = 'left';
  ctx.fillText(`SchoolworkOnScreen  v${VERSION}`, padding, centerY);
  const stamp = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const text = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}  `
    + `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}:${pad(stamp.getSeconds())}`;
  ctx.textAlign = 'right';
  ctx.fillText(text, canvas.width - padding, centerY);
  return canvas.toDataURL('image/png');
}

function clampTracks(tracks: number[], index: number, delta: number): number[] {
  const next = [...tracks];
  const total = next[index] + next[index + 1];
  const min = Math.min(0.65, total * 0.3);
  next[index] = Math.min(total - min, Math.max(min, next[index] + delta));
  next[index + 1] = total - next[index];
  return next;
}

function App() {
  const [document, setDocument] = useState<HomeworkDocument>(() => emptyDocument('2x3'));
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [fonts, setFonts] = useState<FontOption[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<SelectedFormat>({
    font: '', textColor: defaultSettings.textColor,
    bold: false, italic: false, highlight: defaultSettings.highlight, highlighted: false,
    sizePx: FONT_SIZE_DEFAULT, sizeUniform: true,
  });
  const [toolbarVisible, setToolbarVisible] = useState(false);
  /** 正在拖动字号滑条：锁定样式框位置并让整框透明，只保留滑条 */
  const [sizeDragging, setSizeDragging] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ left: 0, top: 0, side: 'below' as 'above' | 'below' });
  const [aboutOpen, setAboutOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const gridRef = useRef<HTMLElement>(null);
  const formatToolbarRef = useRef<HTMLDivElement>(null);
  const selectionRectRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const selectionRef = useRef<Range | null>(null);
  /** 一次滑条拖动只记录一条撤销 */
  const sizeUndoPushedRef = useRef(false);
  /** 与 sizeDragging 同步，供事件回调与 layout effect 读取 */
  const sizeDraggingRef = useRef(false);
  const fitFramesRef = useRef(new WeakMap<HTMLElement, number>());
  const inputTimersRef = useRef(new Map<number, number>());
  const resizeRef = useRef<{ axis: 'columns' | 'rows'; index: number; start: number; values: number[] } | null>(null);
  const undoStackRef = useRef<HomeworkDocument[]>([]);
  const redoStackRef = useRef<HomeworkDocument[]>([]);
  const documentRef = useRef(document);
  const historyTimerRef = useRef(0);
  const fontsRef = useRef<FontOption[]>([]);
  const themeRef = useRef<Theme>('dark');
  documentRef.current = document;
  fontsRef.current = fonts;
  themeRef.current = settings.theme;
  sizeDraggingRef.current = sizeDragging;

  const fontLabel = (family: string) => {
    const option = fonts.find((item) => item.family === family);
    if (option) return option.label;
    return family.replace(/^SWOS-/, '');
  };

  const recordUndo = (snapshot: HomeworkDocument) => {
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };

  const pushUndo = () => recordUndo(structuredClone(documentRef.current));

  const undo = () => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(structuredClone(documentRef.current));
    setDocument(previous);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
    syncEditorsFromDocument(previous);
  };

  const redo = () => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(structuredClone(documentRef.current));
    setDocument(next);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
    syncEditorsFromDocument(next);
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await loadLocalFonts();
      if (!alive) return;
      setFonts(list);
      fontsRef.current = list;
      let saved: Record<string, string> = {};
      let content: HomeworkDocument | null = null;
      try {
        const result = await window.schoolwork.load();
        content = result.content;
        saved = result.settings;
      } catch {
        /* ignore */
      }
      if (!alive) return;
      const chosen = content && layouts[content.layout] ? content.layout : '2x3';
      setDocument(content?.cells?.length === layouts[chosen].rows * layouts[chosen].columns ? content : emptyDocument(chosen));
      const parsed = parseSettings(saved, list);
      setSettings(parsed);
      setSelectedFormat({
        font: parsed.font,
        textColor: parsed.textColor,
        bold: parsed.bold,
        italic: false,
        highlight: parsed.highlight,
        highlighted: false,
        sizePx: FONT_SIZE_DEFAULT,
        sizeUniform: true,
      });
      setHistoryEnabled(saved.historyEnabled === 'true');
      setLoaded(true);
    })();
    void window.schoolwork.isMaximized().then(setMaximized);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => { void window.schoolwork.saveContent(document); }, 180);
    return () => window.clearTimeout(timer);
  }, [document, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const serializable = Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, String(value)]));
    const timer = window.setTimeout(() => {
      void window.schoolwork.saveSettings({ ...serializable, historyEnabled: String(historyEnabled) });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [settings, historyEnabled, loaded]);

  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(historyTimerRef.current);
    historyTimerRef.current = window.setTimeout(() => {
      const date = new Date();
      const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const html = historyEnabled ? buildHistoryHtml(document, settings.theme) : '';
      void window.schoolwork.saveHistory({ date: stamp, html, enabled: historyEnabled });
    }, 1500);
    return () => window.clearTimeout(historyTimerRef.current);
  }, [document, settings.theme, historyEnabled, loaded]);

  useEffect(() => {
    void window.schoolwork.setNativeTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = resizeRef.current;
      const grid = gridRef.current;
      if (!active || !grid) return;
      const rect = grid.getBoundingClientRect();
      const size = active.axis === 'columns' ? rect.width : rect.height;
      const point = active.axis === 'columns' ? event.clientX : event.clientY;
      const delta = (point - active.start) / size;
      const tracks = clampTracks(active.values, active.index, delta);
      setDocument((current) => ({ ...current, [active.axis]: tracks }));
    };
    const end = () => { resizeRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, []);

  const getBaseFontSize = (level: AppSettings['fontSize'] = settings.fontSize) => FONT_SIZES[level];

  /** 在下一帧对某个单元格做一次自适应缩放（同一帧内多次调用只保留最后一次） */
  const scheduleFit = (editor: HTMLElement) => {
    const pending = fitFramesRef.current.get(editor);
    if (pending) window.cancelAnimationFrame(pending);
    const baseSize = getBaseFontSize();
    fitFramesRef.current.set(editor, window.requestAnimationFrame(() => fitEditor(editor, baseSize)));
  };

  /**
   * 撤销 / 重做后把文档直接写回编辑区。
   * 编辑区在「选区仍落在其中」时不会被 ref 回写（否则会销毁选区），
   * 因此这里显式同步一次，保证撤销立即可见。
   */
  const syncEditorsFromDocument = (doc: HomeworkDocument) => {
    gridRef.current?.querySelectorAll<HTMLElement>('.cell-editor').forEach((editor) => {
      const index = Number(editor.dataset.cellIndex);
      const text = doc.cells[index]?.text ?? '';
      if (editor.innerHTML !== text) editor.innerHTML = text;
      scheduleFit(editor);
    });
    // 内容已变，旧选区不再有效，顺手清掉避免后续操作作用在旧范围上
    window.getSelection()?.removeAllRanges();
    hideToolbar();
  };

  useEffect(() => {
    const baseSize = getBaseFontSize();
    const fitAll = () => gridRef.current?.querySelectorAll<HTMLElement>('.cell-editor').forEach((editor) => fitEditor(editor, baseSize));
    const observer = new ResizeObserver((entries) => {
      entries.forEach(({ target }) => {
        const editor = target.querySelector<HTMLElement>('.cell-editor');
        if (editor) fitEditor(editor, baseSize);
      });
    });
    gridRef.current?.querySelectorAll('.homework-cell').forEach((cell) => observer.observe(cell));
    const frame = window.requestAnimationFrame(fitAll);
    window.addEventListener('resize', fitAll);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', fitAll);
    };
  }, [document.layout, settings.fontSize, fonts.length]);

  const updateCell = (index: number, patch: Partial<HomeworkCell>) => {
    setDocument((current) => ({
      ...current,
      cells: current.cells.map((cell, cellIndex) => cellIndex === index ? { ...cell, ...patch } : cell),
    }));
  };

  const markCellModified = (index: number) => updateCell(index, { lastModified: Date.now() });

  const queueContentUpdate = (index: number, editor: HTMLElement, immediate = false, skipUndo = false) => {
    const pending = inputTimersRef.current.get(index);
    if (pending) window.clearTimeout(pending);
    const apply = () => {
      inputTimersRef.current.delete(index);
      const html = editor.innerHTML;
      setDocument((current) => {
        const cell = current.cells[index];
        if (!cell || cell.text === html) return current;
        if (!skipUndo) recordUndo(structuredClone(current));
        return {
          ...current,
          cells: current.cells.map((item, cellIndex) => cellIndex === index
            ? { ...item, text: html, lastModified: Date.now() }
            : item),
        };
      });
    };
    if (immediate) {
      apply();
      return;
    }
    inputTimersRef.current.set(index, window.setTimeout(apply, 120));
  };

  const updateSettings = (patch: Partial<AppSettings>) => setSettings((current) => ({ ...current, ...patch }));

  const changeLayout = async (layout: Layout) => {
    if (layout === document.layout) return;
    const confirmed = await window.schoolwork.confirmLayout(`确定切换到 ${layout} 表格吗？`);
    if (confirmed) {
      pushUndo();
      setDocument(emptyDocument(layout));
    }
  };

  const resizeStart = (axis: 'columns' | 'rows', index: number, event: React.PointerEvent) => {
    event.preventDefault();
    const values = document[axis];
    resizeRef.current = { axis, index, start: axis === 'columns' ? event.clientX : event.clientY, values };
  };

  const hideToolbar = () => {
    setToolbarVisible(false);
    selectionRef.current = null;
  };

  const readSelectionFormat = () => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const insideGrid = Boolean(range && gridRef.current?.contains(range.commonAncestorContainer));
    // 判定「是否选中文字」只看选区是否非折叠：不能用 trim()，
    // 否则只选中空格 / 换行时会被误判成没选中而把样式框藏起来。
    const hasText = Boolean(range && !range.collapsed && range.toString().length > 0);
    const anchor = selection?.anchorNode
      ? (selection.anchorNode.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode as HTMLElement
        : selection.anchorNode.parentElement)
      : null;
    const editor = insideGrid && anchor ? anchor.closest<HTMLElement>('.cell-editor') : null;

    if (!range || !hasText || !editor) {
      // 下拉框 / 字号滑条 / 取色器会把焦点移进样式框，浏览器此时可能瞬时折叠选区；
      // 只要样式框自身仍持有焦点、且之前记录的选区还在文档里，就保持显示。
      const toolbarFocused = Boolean(formatToolbarRef.current?.contains(window.document.activeElement));
      if (toolbarFocused && isRangeAlive(selectionRef.current)) return;
      hideToolbar();
      return;
    }

    selectionRef.current = range.cloneRange();

    const bounds = range.getBoundingClientRect();
    const rect = { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
    selectionRectRef.current = rect;
    setToolbarVisible(true);
    // 拖动字号滑条期间锁定样式框位置，避免它跟着文字布局跳动
    if (!sizeDraggingRef.current) {
      setToolbarPosition({ left: rect.left + (rect.right - rect.left) / 2, top: rect.bottom + 10, side: 'below' });
    }

    const computed = window.getComputedStyle(anchor ?? editor);
    const pixelSize = Number.parseFloat(computed.fontSize);
    const themeHighlight = HIGHLIGHT_COLORS[themeRef.current];
    let highlight = themeHighlight;
    let highlighted = false;
    for (let element = anchor; element && element !== editor; element = element.parentElement) {
      const background = element.style.backgroundColor;
      if (background) {
        const color = cssColorToHex(background);
        highlighted = color === HIGHLIGHT_COLORS.dark || color === HIGHLIGHT_COLORS.light || LEGACY_HIGHLIGHT_COLORS.includes(color);
        if (highlighted) highlight = themeHighlight;
        break;
      }
    }
    // 收集选区内所有文字的实际字号，判断是否统一（不统一时不点亮档位）。
    // 这里必须用字符偏移量精确判定「真正与选区重叠」的文本节点：
    // intersectsNode 会把紧贴选区边界的相邻节点也算进来，导致滑条读到的字号混入未选中的文字。
    const sizeSet = new Set<number>();
    if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
      const { start: selStart, end: selEnd } = saveOffsets(editor, range);
      const walker = window.document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let cursor = 0;
      for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
        const text = textNode as Text;
        const start = cursor;
        const end = cursor + text.length;
        cursor = end;
        if (end <= start || end <= selStart || start >= selEnd) continue;
        if ((text.textContent ?? '').trim().length === 0) continue;
        const parent = text.parentElement ?? editor;
        // 记录过作者字号的片段显示其作者字号，其余（继承了单元格基准字号）显示实际渲染字号
        const authored = Number.parseFloat(parent.dataset.swosFs ?? '');
        const px = Number.isFinite(authored) ? authored : Number.parseFloat(window.getComputedStyle(parent).fontSize);
        if (Number.isFinite(px)) sizeSet.add(Math.round(px * 10) / 10);
      }
    }
    const sizeUniform = sizeSet.size <= 1;
    // 统一时用选区实际字号；不统一时用锚点处字号，滑动滑条即可一键统一全部
    const rawSize = sizeSet.size === 1 ? [...sizeSet][0] : pixelSize;
    const sizePx = Number.isFinite(rawSize) ? Math.round(rawSize) : FONT_SIZE_DEFAULT;
    const matched = fontsRef.current.find((option) => computed.fontFamily.includes(option.family));
    const next: SelectedFormat = {
      font: matched ? matched.family : settings.font,
      textColor: cssColorToHex(computed.color),
      bold: Number.parseInt(computed.fontWeight, 10) >= 600,
      italic: computed.fontStyle === 'italic' || computed.fontStyle.startsWith('oblique'),
      highlight,
      highlighted,
      sizePx,
      sizeUniform,
    };
    setSelectedFormat((current) => (
      Object.keys(next).every((key) => current[key as keyof SelectedFormat] === next[key as keyof SelectedFormat]) ? current : next
    ));
  };

  const readSelectionFormatRef = useRef(readSelectionFormat);
  readSelectionFormatRef.current = readSelectionFormat;

  useEffect(() => {
    // 选区的任何变化（选中 / 折叠 / 清空 / 移出网格）都交给同一个判定函数处理
    const handleSelectionChange = () => readSelectionFormatRef.current();
    // 点在样式框与网格之外（标题栏、底栏、对话框…）时立即收起
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (formatToolbarRef.current?.contains(target)) return;
      if (!gridRef.current?.contains(target)) hideToolbar();
    };
    // 指针在窗口外松开 / 被取消时也要复位，否则标志会卡住导致样式框永不隐藏
    // 阻止浏览器默认右键菜单（含触屏长按菜单），
    // 全应用只保留自定义的横排样式工具栏这一套。
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    window.document.addEventListener('selectionchange', handleSelectionChange);
    window.document.addEventListener('pointerdown', handlePointerDown, true);
    window.document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      window.document.removeEventListener('selectionchange', handleSelectionChange);
      window.document.removeEventListener('pointerdown', handlePointerDown, true);
      window.document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  // 滑条一次拖动结束后复位，下一次操作重新记录撤销
  useEffect(() => {
    const reset = () => { sizeUndoPushedRef.current = false; };
    window.addEventListener('pointerup', reset);
    window.addEventListener('pointercancel', reset);
    return () => {
      window.removeEventListener('pointerup', reset);
      window.removeEventListener('pointercancel', reset);
    };
  }, []);

  /**
   * 拖动字号滑条结束：恢复整框显示，并按最终排版刷新一次样式框位置。
   * 触摸拖动时浏览器会把手势判成滚动并误发 pointercancel，此时拖动其实还在继续，
   * 因此 pointercancel 只在鼠标/触控笔下才算结束，触摸改由 touchend 兜底。
   */
  useEffect(() => {
    const end = (event: Event) => {
      if (!sizeDraggingRef.current) return;
      if (event.type === 'pointercancel' && (event as PointerEvent).pointerType === 'touch') return;
      sizeDraggingRef.current = false;
      setSizeDragging(false);
      window.requestAnimationFrame(() => readSelectionFormatRef.current());
    };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    window.addEventListener('touchend', end, true);
    window.addEventListener('touchcancel', end, true);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      window.removeEventListener('touchend', end, true);
      window.removeEventListener('touchcancel', end, true);
      window.removeEventListener('blur', end);
    };
  }, []);

  useLayoutEffect(() => {
    const toolbar = formatToolbarRef.current;
    const selectionBounds = selectionRectRef.current;
    if (!toolbar || !toolbarVisible || !selectionBounds) return;
    if (sizeDraggingRef.current) return; // 拖动字号期间不自动挪动位置
    const bounds = toolbar.getBoundingClientRect();
    const anchorCenter = (selectionBounds.left + selectionBounds.right) / 2;
    const left = Math.min(window.innerWidth - bounds.width - 8, Math.max(8, anchorCenter - bounds.width / 2));
    const belowTop = selectionBounds.bottom + 10;
    const top = Math.min(window.innerHeight - bounds.height - 8, belowTop);
    const side = 'below';
    const finalTop = top < 8 ? Math.max(8, top) : top;
    if (left !== toolbarPosition.left || finalTop !== toolbarPosition.top || side !== toolbarPosition.side) {
      setToolbarPosition({ left, top: finalTop, side });
    }
  }, [toolbarPosition, toolbarVisible, selectedFormat]);

  const resolveEditor = (): { editor: HTMLElement; range: Range } | null => {
    const savedRange = selectionRef.current;
    if (!savedRange || !gridRef.current?.contains(savedRange.commonAncestorContainer)) return null;
    const node = savedRange.commonAncestorContainer;
    const editor = (node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement)?.closest<HTMLElement>('.cell-editor');
    return editor ? { editor, range: savedRange } : null;
  };

  const applyInlineFormat = (
    property: 'fontFamily' | 'color' | 'backgroundColor' | 'fontWeight' | 'fontStyle',
    value: string,
  ) => {
    const target = resolveEditor();
    const selection = window.getSelection();
    if (!target || !selection) return;
    const { editor, range } = target;

    pushUndo();
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    window.document.execCommand('styleWithCSS', false, 'true');
    if (property === 'color') window.document.execCommand('foreColor', false, value);
    else if (property === 'backgroundColor') {
      window.document.execCommand('hiliteColor', false, value === 'var(--cell-bg)' ? 'transparent' : value);
    } else if (property === 'fontWeight') window.document.execCommand('bold');
    else if (property === 'fontStyle') window.document.execCommand('italic');
    else window.document.execCommand('fontName', false, value);

    const currentSelection = window.getSelection();
    if (currentSelection?.rangeCount) selectionRef.current = currentSelection.getRangeAt(0).cloneRange();
    queueContentUpdate(Number(editor.dataset.cellIndex), editor, true, true);
    readSelectionFormatRef.current();
  };

  /**
   * 字号滑条：把选区内的文字设为指定像素字号（档位连续可调）。
   * 只改动真正落在选区内的文字，选区外的文字绝不会被牵连；
   * 也不再拆掉已有 span，颜色 / 高光 / 粗体等样式因此不会被破坏。
   */
  const applyFontSize = (value: number) => {
    const target = resolveEditor();
    const selection = window.getSelection();
    if (!target || !selection) return;
    const { editor, range } = target;
    const size = Math.round(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value)));

    // 选区在「纯文本」中的起止位置：用它精确判断每个节点是否真的落在选区内，
    // 避免紧贴选区边界的文字被误判成选区内容。
    const offsets = saveOffsets(editor, range);

    // 1. 先在选区边界处切开文本节点，选区外的部分从此是独立节点
    splitTextAtRange(range);

    // 统计所有文本节点的字符区间（与选区用同一套偏移量，判定绝对一致）
    const all: { node: Text; start: number; end: number }[] = [];
    let cursor = 0;
    const walker = window.document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      all.push({ node: text, start: cursor, end: cursor + text.length });
      cursor += text.length;
    }
    const isInside = (item: { node: Text; start: number; end: number }) => item.end > item.start
      && item.start >= offsets.start && item.end <= offsets.end;
    const inside = new Set<Text>(all.filter(isInside).map((item) => item.node));

    // 2. 整块都在选区内的字号 span：直接改字号，不新增嵌套也不会丢其它样式
    const restyle: HTMLElement[] = [];
    const covered = new Set<Text>();
    editor.querySelectorAll<HTMLElement>('span[style*="font-size"]').forEach((span) => {
      const texts: Text[] = [];
      const inner = window.document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      for (let node = inner.nextNode(); node; node = inner.nextNode()) texts.push(node as Text);
      const filled = texts.filter((text) => text.length > 0);
      if (!filled.length || !filled.every((text) => inside.has(text))) return;
      restyle.push(span);
      filled.forEach((text) => covered.add(text));
    });

    // 3. 其余「完整落在选区内」的文本节点：各自包一层 span，作用范围精确到该节点
    const wrap: Text[] = [];
    all.forEach((item) => {
      if (!isInside(item) || covered.has(item.node)) return;
      const inherited = Number.parseFloat(window.getComputedStyle(item.node.parentElement ?? editor).fontSize);
      if (Number.isFinite(inherited) && Math.abs(inherited - size) < 0.1) return;
      wrap.push(item.node);
    });

    const restyleNeeded = restyle.some((span) => span.style.fontSize !== `${size}px`);
    if (!wrap.length && !restyleNeeded) {
      setSelectedFormat((current) => ({ ...current, sizePx: size, sizeUniform: true }));
      return;
    }

    // 一次拖动只记一条撤销，避免刷出一堆中间态
    if (!sizeUndoPushedRef.current) {
      pushUndo();
      sizeUndoPushedRef.current = true;
    }
    restyle.forEach((span) => {
      span.dataset.swosFs = `${size}`;
      span.style.fontSize = `${size}px`;
    });
    wrap.forEach((text) => {
      const parent = text.parentNode;
      if (!parent) return;
      const span = window.document.createElement('span');
      span.dataset.swosFs = `${size}`;
      span.style.fontSize = `${size}px`;
      parent.insertBefore(span, text);
      span.appendChild(text);
    });
    const restored = restoreOffsets(editor, offsets.start, offsets.end);
    selection.removeAllRanges();
    selection.addRange(restored);
    selectionRef.current = restored.cloneRange();
    setSelectedFormat((current) => ({ ...current, sizePx: size, sizeUniform: true }));

    queueContentUpdate(Number(editor.dataset.cellIndex), editor, true, true);
    // 放大后若超出框，立刻触发一次自适应缩放
    scheduleFit(editor);
  };

  const applyBold = () => {
    setSelectedFormat((current) => ({ ...current, bold: !current.bold }));
    applyInlineFormat('fontWeight', selectedFormat.bold ? '400' : '700');
  };

  const applyItalic = () => {
    setSelectedFormat((current) => ({ ...current, italic: !current.italic }));
    applyInlineFormat('fontStyle', selectedFormat.italic ? 'normal' : 'italic');
  };

  const toggleHighlight = () => {
    // 以 DOM 实际状态为准：选区内只要还有高光视为「已高亮」，本次点击即取消高光。
    const target = resolveEditor();
    let isHighlighted = false;
    if (target) {
      const { editor, range } = target;
      const anchor = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer as HTMLElement
        : range.startContainer.parentElement;
      for (let element = anchor; element && element !== editor; element = element.parentElement) {
        const background = element.style.backgroundColor;
        if (background) {
          const color = cssColorToHex(background);
          if (
            color === HIGHLIGHT_COLORS.dark
            || color === HIGHLIGHT_COLORS.light
            || LEGACY_HIGHLIGHT_COLORS.includes(color)
          ) {
            isHighlighted = true;
            break;
          }
        }
      }
    }
    setSelectedFormat((current) => ({ ...current, highlighted: !isHighlighted }));
    applyInlineFormat('backgroundColor', isHighlighted ? 'var(--cell-bg)' : HIGHLIGHT_COLORS[settings.theme]);
  };

  const applyColor = (color: string) => {
    setSelectedFormat((current) => ({ ...current, textColor: color }));
    applyInlineFormat('color', color);
  };

  const applyFontFamily = (family: string) => {
    setSelectedFormat((current) => ({ ...current, font: family }));
    applyInlineFormat('fontFamily', family);
  };

  const toggleTheme = () => {
    const from: Theme = settings.theme;
    const to: Theme = from === 'dark' ? 'light' : 'dark';
    const mapping = buildColorMapping(from, to);
    const highlightMapping: Record<string, string> = {
      [HIGHLIGHT_COLORS.dark]: HIGHLIGHT_COLORS[to],
      [HIGHLIGHT_COLORS.light]: HIGHLIGHT_COLORS[to],
      '#087f80': HIGHLIGHT_COLORS[to],
      '#58d9e6': HIGHLIGHT_COLORS[to],
    };
    const surfaces = THEME_SURFACES[to];
    pushUndo();
    setDocument((current) => ({
      ...current,
      cells: current.cells.map((cell) => cell.text
        ? { ...cell, text: remapHighlightColors(remapTextColors(cell.text, mapping), highlightMapping) }
        : cell),
    }));
    const nextTextColor = mapping[settings.textColor.toLowerCase()] ?? surfaces.textColor;
    setSettings((current) => ({
      ...current,
      theme: to,
      background: surfaces.background,
      frame: surfaces.frame,
      textColor: nextTextColor,
      highlight: HIGHLIGHT_COLORS[to],
    }));
    setSelectedFormat((current) => ({
      ...current,
      textColor: mapping[current.textColor.toLowerCase()] ?? surfaces.textColor,
      highlight: HIGHLIGHT_COLORS[to],
    }));
  };

  const toggleHistory = async () => {
    const next = !historyEnabled;
    setHistoryBusy(true);
    setHistoryEnabled(next);
    const date = new Date();
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    await window.schoolwork.saveHistory({
      date: stamp,
      html: next ? buildHistoryHtml(document, settings.theme) : '',
      enabled: next,
    });
    setHistoryBusy(false);
  };

  const exportImage = async () => {
    if (!gridRef.current || exporting) return;
    // 先让按钮立刻进入「导出中」橙色状态（含转圈），再开始耗时的图片生成。
    // 连续两帧 rAF：第一帧让 React 提交状态，第二帧确保样式已真正绘制到屏幕上。
    setExporting(true);
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
    try {
      const { toPng } = await import('html-to-image');
      const used = new Set<string>([settings.font]);
      gridRef.current.querySelectorAll<HTMLElement>('[style*="font-family"]').forEach((element) => {
        const matched = fontsRef.current.find((option) => element.style.fontFamily.includes(option.family));
        if (matched) used.add(matched.family);
      });
      let fontEmbedCSS = '';
      try {
        fontEmbedCSS = await buildFontEmbedCSS(used);
      } catch (error) {
        console.error('Font embedding failed', error);
      }
      const raw = await toPng(gridRef.current, {
        pixelRatio: 2,
        backgroundColor: settings.background,
        ...(fontEmbedCSS ? { fontEmbedCSS } : {}),
        cacheBust: true,
      });
      const dataUrl = await appendFooterBar(raw, settings.theme);
      // 弹出系统「另存为」对话框；此调用返回前按钮始终保持橙色「导出中」。
      await window.schoolwork.saveImage(dataUrl, `屏上作业-${new Date().toISOString().slice(0, 10)}.png`);
    } catch (error) {
      console.error('PNG export failed', error);
      window.alert('图片导出失败，请重试。');
    } finally {
      setExporting(false);
    }
  };

  const { rows, columns } = layouts[document.layout];
  const cellFontSize = getBaseFontSize();
  const palette = THEME_PALETTES[settings.theme];
  const gridStyle = {
    gridTemplateColumns: document.columns.map((value) => `${value}fr`).join(' '),
    gridTemplateRows: document.rows.map((value) => `${value}fr`).join(' '),
    backgroundColor: settings.background,
  } as React.CSSProperties;

  return (
    <main className="app-shell" data-theme={settings.theme} style={{ '--app-bg': settings.background, '--cell-bg': settings.frame } as React.CSSProperties}>
      {!loaded && <div className="startup-overlay" role="status" aria-live="polite">
        <div className="startup-mark">作</div>
        <div className="startup-title">屏上作业</div>
        <div className="startup-progress"><span /></div>
        <div className="startup-message">加载中</div>
      </div>}
      <header className="titlebar">
        <div className="brand">
          <img className="brand-icon" src={appIcon} alt="" />
          <span className="brand-name">屏上作业</span>
          <span className="brand-en">SchoolworkOnScreen</span>
        </div>
        <div className="window-actions">
          <button aria-label="最小化" title="最小化" onClick={() => void window.schoolwork.minimize()}>−</button>
          <button aria-label="最大化" title="最大化" onClick={() => void window.schoolwork.toggleMaximize().then(setMaximized)}>{maximized ? '❐' : '□'}</button>
          <button aria-label="关闭" title="关闭" className="close-window" onClick={() => void window.schoolwork.close()}>×</button>
        </div>
      </header>

      <section className="work-area">
        <section ref={gridRef} className={`homework-grid ${settings.locked ? 'is-locked' : 'is-unlocked'}`} style={gridStyle} aria-label="作业表格">
          {document.cells.map((cell, index) => {
            const row = Math.floor(index / columns);
            const column = index % columns;
            const timeText = formatRelativeTime(cell.lastModified, now);
            const stale = isTimeStale(cell.lastModified, now);
            return (
              <article key={`${document.layout}-${index}`} className="homework-cell" style={{ backgroundColor: settings.frame }}>
                <div className="cell-heading">
                  <input aria-label={`第${index + 1}格科目`} spellCheck={false} autoComplete="off" value={cell.subject} onChange={(event) => {
                    pushUndo();
                    updateCell(index, { subject: event.target.value });
                    markCellModified(index);
                  }} placeholder="科目" />
                  {timeText && (
                    <span className={`cell-modified-time ${stale ? 'stale' : ''}`} title={`上次修改时间：${new Date(cell.lastModified ?? 0).toLocaleString('zh-CN')}`}>
                      {timeText}
                    </span>
                  )}
                </div>
                <div
                  className="cell-editor"
                  contentEditable
                  spellCheck={false}
                  suppressContentEditableWarning
                  role="textbox"
                  data-cell-index={index}
                  aria-label={`${cell.subject || `第${index + 1}格`}作业内容`}
                  data-placeholder="点击这里输入作业内容…"
                  onInput={(event) => {
                    const editor = event.currentTarget;
                    queueContentUpdate(index, editor);
                    scheduleFit(editor);
                    readSelectionFormatRef.current();
                  }}
                  onFocus={readSelectionFormat}
                  onKeyUp={readSelectionFormat}
                  onMouseUp={readSelectionFormat}
                  onTouchEnd={readSelectionFormat}
                  onBlur={(event) => {
                    queueContentUpdate(index, event.currentTarget, true);
                  }}
                  ref={(element) => {
                    if (!element || element === window.document.activeElement) return;
                    // 选区还停在这一格时禁止回写 innerHTML，否则会销毁选区、让样式框突然消失
                    const anchorNode = window.getSelection()?.anchorNode;
                    if (anchorNode && element.contains(anchorNode)) return;
                    if (element.innerHTML !== cell.text) element.innerHTML = cell.text;
                  }}
                  style={{
                    fontFamily: fontStack(settings.font),
                    fontSize: `${cellFontSize}px`,
                    color: settings.textColor,
                    fontWeight: settings.bold ? 700 : 400,
                  }}
                />
                {!settings.locked && column < columns - 1 && <button className="resize-handle col-resize" title="拖动调整列宽" aria-label="拖动调整列宽" onPointerDown={(event) => resizeStart('columns', column, event)} />}
                {!settings.locked && row < rows - 1 && <button className="resize-handle row-resize" title="拖动调整行高" aria-label="拖动调整行高" onPointerDown={(event) => resizeStart('rows', row, event)} />}
              </article>
            );
          })}
        </section>
      </section>

      {toolbarVisible && <div
        ref={formatToolbarRef}
        className={`selection-toolbar ${toolbarPosition.side} ${sizeDragging ? 'dragging-size' : ''}`}
        style={{ left: toolbarPosition.left, top: toolbarPosition.top }}
        role="toolbar"
        aria-label="文字格式"
      >
        <div className="selection-toolbar-row text-controls-row">
          <label className="floating-select font-select" title="字体">
            <span className="floating-caption">字体</span>
            <span className="floating-value">{fontLabel(selectedFormat.font)}</span>
            <select className="select-hit-area" aria-label="文字字体" value={selectedFormat.font} onChange={(event) => applyFontFamily(event.target.value)}>
              {fonts.map((option) => <option key={option.family} value={option.family}>{option.label}</option>)}
            </select>
          </label>
          <div
            className={`font-size-controls ${selectedFormat.sizeUniform ? '' : 'mixed'}`}
            title={selectedFormat.sizeUniform
              ? `字号：${selectedFormat.sizePx}px`
              : '选中文字字号不一致，拖动滑条即可统一'}
          >
            <span className="floating-caption">字号</span>
            <div className="font-size-slider">
              <span className="slider-wedge" aria-hidden="true" />
              <input
                type="range"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={1}
                value={Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, selectedFormat.sizePx))}
                aria-label="选中文字字号"
                onPointerDown={() => {
                  sizeUndoPushedRef.current = false;
                  sizeDraggingRef.current = true;
                  setSizeDragging(true);
                }}
                onInput={(event) => applyFontSize(Number(event.currentTarget.value))}
              />
            </div>
            <span className="font-size-value">{selectedFormat.sizePx}</span>
          </div>
        </div>
        <div className="selection-toolbar-row style-controls-row">
          <button className={`floating-format ${selectedFormat.bold ? 'selected' : ''}`} aria-label="粗体" title="粗体" onMouseDown={(event) => event.preventDefault()} onClick={applyBold}><b>B</b></button>
          <button className={`floating-format ${selectedFormat.italic ? 'selected' : ''}`} aria-label="斜体" title="斜体" onMouseDown={(event) => event.preventDefault()} onClick={applyItalic}><i>I</i></button>
          <div className="floating-colors" aria-label="预设字体颜色">
            {palette.map((color) => <button
              key={color}
              className={`floating-color ${selectedFormat.textColor.toLowerCase() === color ? 'active' : ''}`}
              style={{ '--swatch': color } as React.CSSProperties}
              title={color}
              aria-label={`字体颜色 ${color}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyColor(color)}
            />)}
          </div>
          <div className="floating-picker" title="更多颜色">
            <span className="picker-swatch" style={{ backgroundColor: selectedFormat.textColor }} />
            <input
              className="picker-input"
              type="color"
              aria-label="自定义字体颜色"
              value={selectedFormat.textColor.startsWith('#') ? selectedFormat.textColor : '#ffffff'}
              onChange={(event) => applyColor(event.target.value)}
            />
          </div>
          <div className="floating-highlight" aria-label="高光设置">
            <button
              style={{ '--highlight': HIGHLIGHT_COLORS[settings.theme] } as React.CSSProperties}
              className={`highlight-toggle ${selectedFormat.highlighted ? 'selected' : ''}`}
              aria-label={selectedFormat.highlighted ? '取消高光' : '应用高光'}
              title={selectedFormat.highlighted ? '取消高光' : '应用高光'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleHighlight}
            >H</button>
          </div>
        </div>
      </div>}

      <footer className="controlbar">
        <div className="controlbar-left">
          <button className="about-button" onClick={() => setAboutOpen(true)}>关于</button>
          <span className="version-tag">v{VERSION}</span>
          <div className="edit-actions" role="group" aria-label="撤销与重做">
            <button className="edit-btn" title="撤销 (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
              <span aria-hidden="true">↶</span><span>撤销</span>
            </button>
            <button className="edit-btn" title="重做 (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
              <span aria-hidden="true">↷</span><span>重做</span>
            </button>
          </div>
        </div>
        <div className="table-tools" aria-label="表格控制">
          <button className={`lock-button ${settings.locked ? 'locked' : ''}`} title={settings.locked ? '解锁表格尺寸' : '锁定表格尺寸'} onClick={() => updateSettings({ locked: !settings.locked })}>
            <span className="lock-icon">{settings.locked ? '▣' : '⠿'}</span><span>{settings.locked ? '布局锁定' : '布局解锁'}</span>
          </button>
          <label className="tool-select layout-select" title="表格格数">
            <span className="tool-caption">格数</span>
            <span className="selected-value">{document.layout}</span>
            <select className="select-hit-area" aria-label="表格格数" value={document.layout} onChange={(event) => void changeLayout(event.target.value as Layout)}>
              {Object.keys(layouts).map((layout) => <option key={layout} value={layout}>{layout}</option>)}
            </select>
          </label>
          <button className="theme-button" title={settings.theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} onClick={toggleTheme}>
            <span className="theme-icon">{settings.theme === 'dark' ? '☾' : '☀'}</span>
            <span>{settings.theme === 'dark' ? '深色' : '浅色'}</span>
          </button>
          <div className="history-block">
            <label className={`history-toggle ${historyEnabled ? 'on' : ''} ${historyBusy ? 'busy' : ''}`} title="按天保存当天最后一次编辑内容到 history/ 目录">
              <input type="checkbox" checked={historyEnabled} onChange={() => void toggleHistory()} />
              <span className="history-switch" aria-hidden="true"><span className="history-knob" /></span>
              <span className="history-label">每日存档</span>
            </label>
            <button className="history-link" type="button" onClick={() => void window.schoolwork.openHistory()}>查看历史</button>
          </div>
          <button
            className={`export-button ${exporting ? 'exporting' : ''}`}
            title="导出 PNG 图片"
            onClick={() => void exportImage()}
            disabled={exporting}
          >
            {exporting
              ? <><span className="spinner" aria-hidden="true" /><span>导出中</span></>
              : <><span aria-hidden="true">↧</span><span>导出图片</span></>}
          </button>
        </div>
      </footer>

      {aboutOpen && <div className="about-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setAboutOpen(false);
      }}>
        <section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
          <div className="about-heading">
            <img className="about-mark" src={appIcon} alt="屏上作业图标" />
            <div><h2 id="about-title">屏上作业</h2><p>SchoolworkOnScreen</p></div>
          </div>
          <dl className="about-details">
            <div><dt>版本</dt><dd>v{VERSION} · {BUILD_DATE}</dd></div>
            <div><dt>项目地址</dt><dd><a href="https://github.com/RobertLau2480/SchoolworkOnScreen" target="_blank" rel="noreferrer">https://github.com/RobertLau2480/SchoolworkOnScreen</a></dd></div>
            <div><dt>作者</dt><dd>OctSeventh（RobertLau） · <a href={BILIBILI_URL} target="_blank" rel="noreferrer">B 站主页</a></dd></div>
          </dl>
          <button className="about-close" onClick={() => setAboutOpen(false)}>关闭</button>
        </section>
      </div>}
    </main>
  );
}

export default App;