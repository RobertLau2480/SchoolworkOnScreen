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
const VERSION = '1.3.1';
const BUILD_DATE = '2026年10月27日';
const UNDO_LIMIT = 120;
const CARET_TOOLBAR_LINGER = 5000;
const FADE_DURATION = 320;
const BILIBILI_URL = 'https://space.bilibili.com/509648854';

const FONT_SIZES = { small: 26, medium: 30, large: 34 } as const;
/** 最小字号（px），自适应缩放的下限 */
const MIN_FONT_SIZE = 18;
/**
 * 选中文字的字号五档（从小到大）。
 * 直接写入绝对像素值，彻底避免 em 嵌套叠加导致的样式冲突。
 */
const FONT_SIZE_LEVELS = [20, 25, 30, 35, 40] as const;
/** 五档中与「标准」对应的档位索引 */
const DEFAULT_SIZE_LEVEL = 2;

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

type SelectedFormat = Pick<AppSettings, 'font' | 'fontSize' | 'textColor' | 'bold' | 'highlight'> & {
  highlighted: boolean;
  italic: boolean;
  fontStep: number;
};

function fitEditor(editor: HTMLElement, baseSize: number): void {
  const overflows = () => editor.scrollHeight > editor.clientHeight + 1 || editor.scrollWidth > editor.clientWidth + 1;
  editor.style.fontSize = `${baseSize}px`;
  if (!overflows()) return;

  let low = MIN_FONT_SIZE;
  let high = baseSize;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const size = (low + high) / 2;
    editor.style.fontSize = `${size}px`;
    if (overflows()) high = size;
    else low = size;
  }
  editor.style.fontSize = `${low}px`;
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
  let count = 0;
  let startNode: Node = editor;
  let endNode: Node = editor;
  let startOffset = 0;
  let endOffset = 0;
  let node = walker.nextNode();
  while (node) {
    const length = (node as Text).length;
    if (startNode === editor && count + length >= start) {
      startNode = node;
      startOffset = start - count;
    }
    if (endNode === editor && count + length >= end) {
      endNode = node;
      endOffset = end - count;
      break;
    }
    count += length;
    node = walker.nextNode();
  }
  const range = window.document.createRange();
  try {
    range.setStart(startNode, Math.max(0, startOffset));
    range.setEnd(endNode, Math.max(0, endOffset));
  } catch {
    range.selectNodeContents(editor);
  }
  return range;
}

function unwrapSizeSpans(editor: HTMLElement, range: Range): void {
  editor.querySelectorAll<HTMLElement>('span[style*="font-size"]').forEach((span) => {
    if (!range.intersectsNode(span)) return;
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  });
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
    font: '', fontSize: defaultSettings.fontSize, textColor: defaultSettings.textColor,
    bold: false, italic: false, highlight: defaultSettings.highlight, highlighted: false, fontStep: 0,
  });
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [toolbarPinned, setToolbarPinned] = useState(false);
  const [toolbarFading, setToolbarFading] = useState(false);
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
  const toolbarPointerRef = useRef(false);
  const selectionRef = useRef<Range | null>(null);
  const fontStepRef = useRef(0);
  const fitFramesRef = useRef(new WeakMap<HTMLElement, number>());
  const inputTimersRef = useRef(new Map<number, number>());
  const resizeRef = useRef<{ axis: 'columns' | 'rows'; index: number; start: number; values: number[] } | null>(null);
  const undoStackRef = useRef<HomeworkDocument[]>([]);
  const redoStackRef = useRef<HomeworkDocument[]>([]);
  const documentRef = useRef(document);
  const historyTimerRef = useRef(0);
  const caretTimerRef = useRef(0);
  const fadeTimerRef = useRef(0);
  const fontsRef = useRef<FontOption[]>([]);
  const pinnedRef = useRef(false);
  const themeRef = useRef<Theme>('dark');
  documentRef.current = document;
  fontsRef.current = fonts;
  pinnedRef.current = toolbarPinned;
  themeRef.current = settings.theme;

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
  };

  const redo = () => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(structuredClone(documentRef.current));
    setDocument(next);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
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
        fontSize: parsed.fontSize,
        textColor: parsed.textColor,
        bold: parsed.bold,
        italic: false,
        highlight: parsed.highlight,
        highlighted: false,
        fontStep: 0,
      });
      fontStepRef.current = 0;
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

  const clearCaretTimer = () => {
    window.clearTimeout(caretTimerRef.current);
    window.clearTimeout(fadeTimerRef.current);
  };

  const scheduleCaretFade = () => {
    clearCaretTimer();
    if (pinnedRef.current) return;
    caretTimerRef.current = window.setTimeout(() => {
      setToolbarFading(true);
      fadeTimerRef.current = window.setTimeout(() => {
        setToolbarVisible(false);
        setToolbarFading(false);
      }, FADE_DURATION);
    }, CARET_TOOLBAR_LINGER);
  };

  const hideToolbar = () => {
    clearCaretTimer();
    setToolbarFading(false);
    setToolbarVisible(false);
    setToolbarPinned(false);
  };

  const readSelectionFormat = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      if (!toolbarPointerRef.current) hideToolbar();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!gridRef.current?.contains(range.commonAncestorContainer)) {
      if (!toolbarPointerRef.current) hideToolbar();
      return;
    }

    const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode as HTMLElement
      : selection.anchorNode?.parentElement;
    const editor = anchor?.closest<HTMLElement>('.cell-editor');
    if (!editor) {
      if (!toolbarPointerRef.current) hideToolbar();
      return;
    }

    const hasText = !range.collapsed && Boolean(selection.toString().trim());
    if (toolbarPointerRef.current) {
      // 操作菜单期间不改变显示状态
      return;
    }
    // 只有真正选中文字时才显示样式框；单纯点击光标不弹菜单。
    if (!hasText) {
      hideToolbar();
      return;
    }

    selectionRef.current = range.cloneRange();

    const bounds = range.getBoundingClientRect();
    const rect = range.collapsed
      ? { left: bounds.left, top: bounds.top, right: bounds.left, bottom: bounds.bottom || bounds.top }
      : { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
    selectionRectRef.current = rect;
    setToolbarFading(false);
    setToolbarVisible(true);
    setToolbarPinned(true);
    setToolbarPosition({ left: rect.left + (rect.right - rect.left) / 2, top: rect.bottom + 10, side: 'below' });
    clearCaretTimer();

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
    // 当前文字字号最接近五档中的哪一档
    let sizeLevel = 0;
    let bestDelta = Number.POSITIVE_INFINITY;
    FONT_SIZE_LEVELS.forEach((value, index) => {
      const delta = Math.abs(value - pixelSize);
      if (delta < bestDelta) {
        bestDelta = delta;
        sizeLevel = index;
      }
    });
    fontStepRef.current = sizeLevel;
    const matched = fontsRef.current.find((option) => computed.fontFamily.includes(option.family));
    const next: SelectedFormat = {
      font: matched ? matched.family : settings.font,
      fontSize: settings.fontSize,
      textColor: cssColorToHex(computed.color),
      bold: Number.parseInt(computed.fontWeight, 10) >= 600,
      italic: computed.fontStyle === 'italic' || computed.fontStyle.startsWith('oblique'),
      highlight,
      highlighted,
      fontStep: sizeLevel,
    };
    setSelectedFormat((current) => (
      Object.keys(next).every((key) => current[key as keyof SelectedFormat] === next[key as keyof SelectedFormat]) ? current : next
    ));
  };

  const readSelectionFormatRef = useRef(readSelectionFormat);
  readSelectionFormatRef.current = readSelectionFormat;

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (gridRef.current?.contains(range.commonAncestorContainer)) readSelectionFormatRef.current();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (formatToolbarRef.current?.contains(target)) {
        toolbarPointerRef.current = true;
        if (!pinnedRef.current) scheduleCaretFade();
        return;
      }
      if (!gridRef.current?.contains(target)) hideToolbar();
    };
    // 统一由渲染进程触发右键菜单，避免触屏长按 + 右键同时弹出两个原生菜单。
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const editor = target.closest<HTMLElement>('.cell-editor, input, textarea');
      const isEditable = Boolean(editor);
      const selection = window.getSelection();
      const hasSelection = Boolean(selection && selection.toString().trim().length > 0);
      // 只在编辑器 / 输入框或已有选中文字时接管，其它位置交给系统默认行为。
      if (!isEditable && !hasSelection) return;
      event.preventDefault();
      void window.schoolwork.showContextMenu({ editable: isEditable, hasSelection });
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

  useLayoutEffect(() => {
    const toolbar = formatToolbarRef.current;
    const selectionBounds = selectionRectRef.current;
    if (!toolbar || !toolbarVisible || !selectionBounds) return;
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
    if (!pinnedRef.current) scheduleCaretFade();
  };

  /** 五档字号：直接把选中文字改成目标档位的绝对字号，保留其他所有样式。 */
  const applyFontSizeLevel = (level: number) => {
    const target = resolveEditor();
    const selection = window.getSelection();
    if (!target || !selection) return;
    const { editor, range: savedRange } = target;
    const targetSize = FONT_SIZE_LEVELS[Math.max(0, Math.min(FONT_SIZE_LEVELS.length - 1, level))];

    // 只处理「被选区完整或部分覆盖」的文本节点；部分覆盖时先按选区边界切分，
    // 确保选区外的文字不会被连带改变字号。
    const collect = (): { node: Text; size: number }[] => {
      const walker = window.document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const result: { node: Text; size: number }[] = [];
      let textNode = walker.nextNode();
      while (textNode) {
        const current = textNode as Text;
        if (savedRange.intersectsNode(current) && (current.textContent ?? '').trim().length > 0) {
          result.push({ node: current, size: targetSize });
        }
        textNode = walker.nextNode();
      }
      return result;
    };

    // 先切分被选区部分覆盖的文本节点
    const splitEdges = () => {
      editor.querySelectorAll<HTMLElement>('*').forEach(() => undefined);
      const walker = window.document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const targets: Text[] = [];
      let node = walker.nextNode();
      while (node) {
        const text = node as Text;
        if (savedRange.intersectsNode(text) && (text.textContent ?? '').length > 0) targets.push(text);
        node = walker.nextNode();
      }
      targets.forEach((text) => {
        const content = text.textContent ?? '';
        // 找到该文本节点相对选区的起止字符位置
        let startInNode = 0;
        let endInNode = content.length;
        if (savedRange.startContainer === text) startInNode = savedRange.startOffset;
        else if (savedRange.startContainer !== text) {
          const pre = window.document.createRange();
          pre.selectNodeContents(editor);
          pre.setEnd(text, 0);
          startInNode = savedRange.compareBoundaryPoints(Range.START_TO_START, pre) > 0 ? 0 : 0;
        }
        if (savedRange.endContainer === text) endInNode = savedRange.endOffset;
        if (startInNode <= 0 && endInNode >= content.length) return;
        // 只保留选区内的部分为可改动片段：切出 前/中/后 三段
        const parent = text.parentNode;
        if (!parent) return;
        if (endInNode < content.length) {
          text.splitText(endInNode);
        }
        if (startInNode > 0) {
          text.splitText(startInNode);
        }
      });
    };
    splitEdges();

    const plans = collect();
    const anyChanged = plans.some(({ node }) => {
      const px = Number.parseFloat(window.getComputedStyle(node.parentElement ?? editor).fontSize) || 0;
      return Math.abs(targetSize - px) > 0.05;
    });
    if (!plans.length || !anyChanged) return;

    pushUndo();
    const offsets = saveOffsets(editor, savedRange);
    unwrapSizeSpans(editor, savedRange);
    plans.forEach(({ node, size }) => {
      const parent = node.parentNode;
      if (!parent) return;
      const span = window.document.createElement('span');
      span.style.fontSize = `${size}px`;
      parent.insertBefore(span, node);
      span.appendChild(node);
    });
    const restored = restoreOffsets(editor, offsets.start, offsets.end);
    selection.removeAllRanges();
    selection.addRange(restored);
    selectionRef.current = restored.cloneRange();

    queueContentUpdate(Number(editor.dataset.cellIndex), editor, true, true);
    readSelectionFormatRef.current();
    if (!pinnedRef.current) scheduleCaretFade();
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
    // 先让按钮立刻进入「导出中」橙色状态，再开始耗时的图片生成。
    setExporting(true);
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
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
                  <input aria-label={`第${index + 1}格科目`} value={cell.subject} onChange={(event) => {
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
                  suppressContentEditableWarning
                  role="textbox"
                  data-cell-index={index}
                  aria-label={`${cell.subject || `第${index + 1}格`}作业内容`}
                  data-placeholder="点击这里输入作业内容…"
                  onInput={(event) => {
                    const editor = event.currentTarget;
                    queueContentUpdate(index, editor);
                    const pending = fitFramesRef.current.get(editor);
                    if (pending) window.cancelAnimationFrame(pending);
                    const baseSize = getBaseFontSize();
                    fitFramesRef.current.set(editor, window.requestAnimationFrame(() => fitEditor(editor, baseSize)));
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
                    if (element && element !== window.document.activeElement && element.innerHTML !== cell.text) {
                      element.innerHTML = cell.text;
                    }
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
        className={`selection-toolbar ${toolbarPosition.side} ${toolbarFading ? 'fading' : ''} ${toolbarPinned ? 'pinned' : 'caret'}`}
        style={{ left: toolbarPosition.left, top: toolbarPosition.top }}
        role="toolbar"
        aria-label="文字格式"
        onPointerDownCapture={() => {
          toolbarPointerRef.current = true;
          if (!pinnedRef.current) scheduleCaretFade();
        }}
        onPointerUpCapture={() => window.setTimeout(() => { toolbarPointerRef.current = false; }, 120)}
      >
        <div className="selection-toolbar-row text-controls-row">
          <label className="floating-select font-select" title="字体">
            <span className="floating-caption">字体</span>
            <span className="floating-value">{fontLabel(selectedFormat.font)}</span>
            <select className="select-hit-area" aria-label="文字字体" value={selectedFormat.font} onChange={(event) => applyFontFamily(event.target.value)}>
              {fonts.map((option) => <option key={option.family} value={option.family}>{option.label}</option>)}
            </select>
          </label>
          <div className="font-size-controls" title={`字号：${FONT_SIZE_LEVELS[selectedFormat.fontStep] ?? FONT_SIZE_LEVELS[DEFAULT_SIZE_LEVEL]}px`}>
            <span className="floating-caption">字号</span>
            <span className="font-size-glyph small" aria-hidden="true">A</span>
            <input
              className="font-size-slider"
              type="range"
              min={0}
              max={FONT_SIZE_LEVELS.length - 1}
              step={1}
              aria-label="字号"
              value={selectedFormat.fontStep}
              onMouseDown={(event) => event.preventDefault()}
              onChange={(event) => applyFontSizeLevel(Number(event.target.value))}
            />
            <span className="font-size-glyph large" aria-hidden="true">A</span>
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
            <button className="history-link" type="button" onClick={() => void window.schoolwork.openHistory()}>打开 history 文件夹</button>
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
            <div><dt>字体</dt><dd>{fonts.length} 个（来自 fonts/ 目录）</dd></div>
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