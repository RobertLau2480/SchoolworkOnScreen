import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import appIcon from '../icon.png';
import { DEFAULT_FONT_FAMILY, buildFontEmbedCSS, fontOptions, loadLocalFonts } from './fonts';
import type { AppSettings, HomeworkCell, HomeworkDocument, Layout, Theme } from './types';

/** 由 font-family 取列表展示名（去掉前缀）。 */
function fontLabel(family: string): string {
  const option = fontOptions.find((item) => item.family === family);
  return option ? option.label : family;
}

const FONT_FALLBACK = '"Microsoft YaHei", "SimHei", sans-serif';
const fontStack = (family: string) => `"${family}", ${FONT_FALLBACK}`;

const layouts: Record<Layout, { rows: number; columns: number }> = {
  '2x3': { rows: 2, columns: 3 },
  '2x4': { rows: 2, columns: 4 },
  '2x5': { rows: 2, columns: 5 },
};
const subjects = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '其他'];

// 深色 / 浅色模式下的字体预设颜色（按顺序一一对应）
const THEME_PALETTES: Record<Theme, string[]> = {
  dark: ['#ffffff', '#ff5252', '#ffd83d', '#4d9fff', '#c77dff'],
  light: ['#000000', '#c62828', '#b58900', '#1565c0', '#6a1b9a'],
};
// 每种模式对应的背景、表面与默认文字颜色
const THEME_SURFACES: Record<Theme, { background: string; frame: string; textColor: string }> = {
  dark: { background: '#29332f', frame: '#35413b', textColor: '#ffffff' },
  light: { background: '#eef1ee', frame: '#ffffff', textColor: '#000000' },
};

// 高光颜色：深色模式保留原色，浅色模式使用很亮的黄色
const HIGHLIGHT_COLORS: Record<Theme, string> = { dark: '#b85c1e', light: '#fff176' };
const LEGACY_HIGHLIGHT_COLORS = ['#087f80', '#58d9e6'];
const VERSION = '1.1.2';
const BUILD_DATE = '2026年10月24日';

const defaultSettings: AppSettings = {
  background: THEME_SURFACES.dark.background,
  frame: THEME_SURFACES.dark.frame,
  locked: true,
  font: DEFAULT_FONT_FAMILY,
  fontSize: 'medium',
  textColor: THEME_SURFACES.dark.textColor,
  bold: false,
  highlight: HIGHLIGHT_COLORS.dark,
  theme: 'dark',
};
const FONT_SIZES = { small: 26, medium: 30, large: 34 } as const;
const FONT_STEP_SIZE = 2;
const MAX_FONT_STEP = 5;
const MIN_FONT_SIZE = 14;

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

type SelectedFormat = Pick<AppSettings, 'font' | 'fontSize' | 'textColor' | 'bold' | 'highlight'> & { highlighted: boolean; fontStep: number };

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

/** 构建从 from 主题到 to 主题的字体颜色映射表。 */
function buildColorMapping(from: Theme, to: Theme): Record<string, string> {
  const mapping: Record<string, string> = {};
  THEME_PALETTES[from].forEach((color, index) => {
    mapping[color.toLowerCase()] = THEME_PALETTES[to][index];
  });
  return mapping;
}

/** 依据映射表替换 HTML 富文本中已有的行内文字颜色。 */
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

/** 依据映射表替换 HTML 富文本中已有的高光背景色。 */
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

/**
 * 清除选区内元素上的同名内联样式。
 * 这样「给已高光/已改色的文字重新设置样式」时才能真正覆盖旧值，
 * 同时其它未涉及的样式（如高光、字号）仍会保留。
 */
function clearInlineProperty(editor: HTMLElement, range: Range, property: string): void {
  editor.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    const style = element.style as unknown as Record<string, string>;
    if (!style[property]) return;
    if (!range.intersectsNode(element)) return;
    style[property] = '';
    if (!element.getAttribute('style')) element.removeAttribute('style');
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

function parseSettings(raw: Record<string, string>): AppSettings {
  const theme: Theme = raw.theme === 'light' ? 'light' : 'dark';
  const surfaces = THEME_SURFACES[theme];
  const savedTextColor = raw.textColor?.toLowerCase();
  return {
    background: raw.background ?? surfaces.background,
    frame: raw.frame ?? surfaces.frame,
    locked: raw.locked !== 'false',
    font: fontOptions.some((option) => option.family === raw.font) ? raw.font : defaultSettings.font,
    fontSize: raw.fontSize === 'small' || raw.fontSize === 'large' ? raw.fontSize : 'medium',
    textColor: savedTextColor ?? surfaces.textColor,
    bold: raw.bold === 'true',
    highlight: HIGHLIGHT_COLORS[theme],
    theme,
  };
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
  const [selectedFormat, setSelectedFormat] = useState<SelectedFormat>({
    font: defaultSettings.font, fontSize: defaultSettings.fontSize, textColor: defaultSettings.textColor,
    bold: false, highlight: defaultSettings.highlight, highlighted: false, fontStep: 0,
  });
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ left: 0, top: 0, side: 'below' as 'above' | 'below' });
  const [aboutOpen, setAboutOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const gridRef = useRef<HTMLElement>(null);
  const formatToolbarRef = useRef<HTMLDivElement>(null);
  const selectionRectRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const toolbarPointerRef = useRef(false);
  const selectionRef = useRef<Range | null>(null);
  const fontStepRef = useRef(0);
  const fitFramesRef = useRef(new WeakMap<HTMLElement, number>());
  const inputTimersRef = useRef(new Map<number, number>());
  const resizeRef = useRef<{ axis: 'columns' | 'rows'; index: number; start: number; values: number[] } | null>(null);

  useEffect(() => {
    loadLocalFonts();
    let alive = true;
    void window.schoolwork.load().then(({ content, settings: savedSettings }) => {
      if (!alive) return;
      const chosen = content && layouts[content.layout] ? content.layout : '2x3';
      const fresh = content?.cells?.length === layouts[chosen].rows * layouts[chosen].columns
        ? content
        : emptyDocument(chosen);
      setDocument(fresh);
      const parsedSettings = parseSettings(savedSettings);
      setSettings(parsedSettings);
      setSelectedFormat({
        font: parsedSettings.font,
        fontSize: parsedSettings.fontSize,
        textColor: parsedSettings.textColor,
        bold: parsedSettings.bold,
        highlight: parsedSettings.highlight,
        highlighted: false,
        fontStep: 0,
      });
      fontStepRef.current = 0;
      setLoaded(true);
    }).catch(() => setLoaded(true));
    void window.schoolwork.isMaximized().then(setMaximized);
    return () => { alive = false; };
  }, []);

  // 每分钟刷新一次相对时间显示
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
    const timer = window.setTimeout(() => { void window.schoolwork.saveSettings(serializable); }, 180);
    return () => window.clearTimeout(timer);
  }, [settings, loaded]);

  // 原生右键菜单（复制/剪切/粘贴）由系统绘制，需同步 nativeTheme 才能避免白底白字
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

  // 单元格基准字号：仅由全局字号设置决定，不受选中文字的字号调整影响
  const getBaseFontSize = (level: AppSettings['fontSize'] = settings.fontSize) => {
    return FONT_SIZES[level];
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
  }, [document.layout, settings.fontSize]);

  const updateCell = (index: number, patch: Partial<HomeworkCell>) => {
    setDocument((current) => ({
      ...current,
      cells: current.cells.map((cell, cellIndex) => cellIndex === index ? { ...cell, ...patch } : cell),
    }));
  };

  const markCellModified = (index: number) => {
    updateCell(index, { lastModified: Date.now() });
  };

  // 仅在内容真正变化时才写入文本并刷新“修改时间”，避免光标进入/离开即计时
  const queueContentUpdate = (index: number, editor: HTMLElement, immediate = false) => {
    const pending = inputTimersRef.current.get(index);
    if (pending) window.clearTimeout(pending);
    const apply = () => {
      inputTimersRef.current.delete(index);
      const html = editor.innerHTML;
      setDocument((current) => {
        const cell = current.cells[index];
        if (!cell || cell.text === html) return current;
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
    if (confirmed) setDocument(emptyDocument(layout));
  };

  const resizeStart = (axis: 'columns' | 'rows', index: number, event: React.PointerEvent) => {
    event.preventDefault();
    const values = document[axis];
    resizeRef.current = { axis, index, start: axis === 'columns' ? event.clientX : event.clientY, values };
  };

  const readSelectionFormat = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      if (toolbarPointerRef.current) return;
      setToolbarVisible(false);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!gridRef.current?.contains(range.commonAncestorContainer)) {
      if (!toolbarPointerRef.current) setToolbarVisible(false);
      return;
    }

    if (range.collapsed || !selection.toString().trim()) {
      if (toolbarPointerRef.current) return;
      setToolbarVisible(false);
      return;
    }

    selectionRef.current = range.cloneRange();
    setToolbarVisible(true);
    const bounds = range.getBoundingClientRect();
    selectionRectRef.current = { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
    const side = 'below';
    setToolbarPosition({
      left: bounds.left + bounds.width / 2,
      top: bounds.bottom + 10,
      side,
    });
    const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode as HTMLElement
      : selection.anchorNode?.parentElement;
    const editor = anchor?.closest<HTMLElement>('.cell-editor');
    if (!editor) return;
    const computed = window.getComputedStyle(anchor ?? editor);
    const pixelSize = Number.parseFloat(computed.fontSize);
    const themeHighlight = HIGHLIGHT_COLORS[settings.theme];
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
    // 根据选中文字相对编辑器基准字号的倍率换算 step（选中普通文字时为 0）
    const level = settings.fontSize;
    const stepBase = FONT_SIZES[level];
    const editorSize = Number.parseFloat(window.getComputedStyle(editor).fontSize);
    const ratio = editorSize > 0 ? pixelSize / editorSize : 1;
    const calcStep = Math.round((ratio - 1) * (stepBase / FONT_STEP_SIZE));
    const fontStep = Math.max(-MAX_FONT_STEP, Math.min(MAX_FONT_STEP, calcStep));
    fontStepRef.current = fontStep;
    const size = calcStep < 0 ? 'small' : calcStep > 0 ? 'large' : level;
    const matched = fontOptions.find((option) => computed.fontFamily.includes(option.family));
    const next: SelectedFormat = {
      font: matched ? matched.family : settings.font,
      fontSize: size,
      textColor: cssColorToHex(computed.color),
      bold: window.document.queryCommandState('bold'),
      highlight,
      highlighted,
      fontStep,
    };
    setSelectedFormat((current) => Object.keys(next).every((key) => current[key as keyof SelectedFormat] === next[key as keyof SelectedFormat]) ? current : next);
  };

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (gridRef.current?.contains(range.commonAncestorContainer)) readSelectionFormat();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (formatToolbarRef.current?.contains(target)) {
        toolbarPointerRef.current = true;
        return;
      }
      if (!gridRef.current?.contains(target)) {
        setToolbarVisible(false);
      }
    };
    window.document.addEventListener('selectionchange', handleSelectionChange);
    window.document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      window.document.removeEventListener('selectionchange', handleSelectionChange);
      window.document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, []);

  useLayoutEffect(() => {
    const toolbar = formatToolbarRef.current;
    const selectionBounds = selectionRectRef.current;
    if (!toolbar || !toolbarVisible || !selectionBounds) return;
    const bounds = toolbar.getBoundingClientRect();
    const anchorCenter = (selectionBounds.left + selectionBounds.right) / 2;
    const left = Math.min(window.innerWidth - bounds.width - 8, Math.max(8, anchorCenter - bounds.width / 2));
    // 始终显示在文字下方
    const belowTop = selectionBounds.bottom + 10;
    const top = Math.min(window.innerHeight - bounds.height - 8, belowTop);
    const side = 'below';
    // 如果下方放不下，允许滚动到底部位置
    const finalTop = top < 8 ? Math.max(8, top) : top;
    if (left !== toolbarPosition.left || finalTop !== toolbarPosition.top || side !== toolbarPosition.side) {
      setToolbarPosition({ left, top: finalTop, side });
    }
  }, [toolbarPosition, toolbarVisible, selectedFormat]);

  /** 恢复保存的选区到编辑器，供 execCommand 使用。 */
  const restoreSavedSelection = (editor: HTMLElement, savedRange: Range): boolean => {
    const selection = window.getSelection();
    if (!selection) return false;
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(savedRange);
    return true;
  };

  const applyInlineFormat = (property: 'fontFamily' | 'fontSize' | 'color' | 'backgroundColor' | 'fontWeight', value: string) => {
    const savedRange = selectionRef.current;
    const selection = window.getSelection();
    if (!savedRange || !selection || !gridRef.current?.contains(savedRange.commonAncestorContainer)) return;
    const node = savedRange.commonAncestorContainer;
    const editor = (node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement)?.closest<HTMLElement>('.cell-editor');
    if (!editor) return;

    // 颜色 / 高光 / 粗体交给 execCommand 处理：浏览器会自动拆分嵌套的行内标签，
    // 因此可以覆盖选区内已有的同类样式（这正是之前无法覆盖旧高光的原因）。
    if (property === 'color' || property === 'backgroundColor' || property === 'fontWeight') {
      if (!restoreSavedSelection(editor, savedRange)) return;
      window.document.execCommand('styleWithCSS', false, 'true');
      if (property === 'color') window.document.execCommand('foreColor', false, value);
      else if (property === 'backgroundColor') {
        // 'transparent' 表示取消高光，露出单元格背景色
        window.document.execCommand('hiliteColor', false, value === 'var(--cell-bg)' ? 'transparent' : value);
      } else {
        window.document.execCommand('bold');
      }
      const currentSelection = window.getSelection();
      if (currentSelection?.rangeCount) selectionRef.current = currentSelection.getRangeAt(0).cloneRange();
      const cellIndex = Number(editor.dataset.cellIndex);
      updateCell(cellIndex, { text: editor.innerHTML });
      markCellModified(cellIndex);
      readSelectionFormat();
      return;
    }

    const range = savedRange.cloneRange();
    // 字体 / 字号：清除选区内同名旧值后重新包裹，避免嵌套造成样式叠加
    clearInlineProperty(editor, range, property);

    const collapsed = range.collapsed;
    const span = window.document.createElement('span');
    if (property === 'fontSize') {
      const baseSize = getBaseFontSize();
      const editorSize = Number.parseFloat(window.getComputedStyle(editor).fontSize) || baseSize;
      span.style.fontSize = `${Number.parseFloat(value) / editorSize}em`;
    } else {
      span.style[property] = value;
    }
    const nextRange = window.document.createRange();
    if (collapsed) {
      range.insertNode(span);
      nextRange.setStart(span, 0);
      nextRange.collapse(true);
    } else {
      span.append(range.extractContents());
      range.insertNode(span);
      nextRange.selectNodeContents(span);
    }
    selection.removeAllRanges();
    selection.addRange(nextRange);
    selectionRef.current = nextRange.cloneRange();
    editor.focus();
    const index = Number(editor.dataset.cellIndex);
    updateCell(index, { text: editor.innerHTML });
    markCellModified(index);
    readSelectionFormat();
  };

  const changeFontStep = (delta: number) => {
    const current = fontStepRef.current;
    const newStep = Math.max(-MAX_FONT_STEP, Math.min(MAX_FONT_STEP, current + delta));
    if (newStep === current) return;
    fontStepRef.current = newStep;
    setSelectedFormat((format) => ({ ...format, fontStep: newStep }));
    const targetSize = getBaseFontSize(settings.fontSize) + newStep * FONT_STEP_SIZE;
    applyInlineFormat('fontSize', `${targetSize}px`);
  };

  const applyBold = () => {
    applyInlineFormat('fontWeight', selectedFormat.bold ? '400' : '700');
  };

  const toggleHighlight = () => {
    // 优化高光：已高亮则取消（恢复单元格背景色），否则应用当前主题的高光色
    applyInlineFormat('backgroundColor', selectedFormat.highlighted ? 'var(--cell-bg)' : HIGHLIGHT_COLORS[settings.theme]);
  };

  const toggleTheme = () => {
    const from: Theme = settings.theme;
    const to: Theme = from === 'dark' ? 'light' : 'dark';
    const mapping = buildColorMapping(from, to);
    // 高光颜色映射：任意主题（含历史）的高光都切到目标主题的高光色
    const highlightMapping: Record<string, string> = {
      [HIGHLIGHT_COLORS.dark]: HIGHLIGHT_COLORS[to],
      [HIGHLIGHT_COLORS.light]: HIGHLIGHT_COLORS[to],
      '#087f80': HIGHLIGHT_COLORS[to],
      '#58d9e6': HIGHLIGHT_COLORS[to],
    };
    const surfaces = THEME_SURFACES[to];
    // 把每个单元格富文本中的字体颜色与高光颜色按预设对应改写
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

  const exportImage = async () => {
    if (!gridRef.current) return;
    setExporting(true);
    try {
      const { toPng } = await import('html-to-image');
      // 收集用到的字体族，交给主进程读成 data URL 内嵌；否则 file:// 下字体加载失败会回退到微软雅黑
      const used = new Set<string>([settings.font]);
      gridRef.current.querySelectorAll<HTMLElement>('[style*="font-family"]').forEach((element) => {
        const matched = fontOptions.find((option) => element.style.fontFamily.includes(option.family));
        if (matched) used.add(matched.family);
      });
      let fontEmbedCSS = '';
      try {
        const dataUrls = await window.schoolwork.fontDataUrls(fontOptions.map((option) => option.url));
        fontEmbedCSS = buildFontEmbedCSS(used).replace(/url\("([^"]+)"\)/g, (match, url: string) => (
          dataUrls[url] ? `url("${dataUrls[url]}")` : match
        ));
      } catch (error) {
        console.error('Font embedding failed', error);
      }
      const dataUrl = await toPng(gridRef.current, {
        pixelRatio: 2,
        backgroundColor: settings.background,
        ...(fontEmbedCSS ? { fontEmbedCSS } : {}),
      });
      const anchor = window.document.createElement('a');
      anchor.download = `屏上作业-${new Date().toISOString().slice(0, 10)}.png`;
      anchor.href = dataUrl;
      anchor.click();
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
        <div className="brand"><img className="brand-icon" src={appIcon} alt="" /><span className="brand-name">屏上作业</span><span className="brand-en">SCHOOLWORK ON SCREEN</span></div>
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
                    readSelectionFormat();
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
        className={`selection-toolbar ${toolbarPosition.side}`}
        style={{ left: toolbarPosition.left, top: toolbarPosition.top }}
        role="toolbar"
        aria-label="选中文字格式"
        onPointerDownCapture={() => { toolbarPointerRef.current = true; }}
        onPointerUpCapture={() => window.setTimeout(() => { toolbarPointerRef.current = false; }, 120)}
      >
        <div className="selection-toolbar-row text-controls-row">
          <label className="floating-select font-select" title="字体">
            <span className="floating-caption">字体</span>
            <span className="floating-value">{fontLabel(selectedFormat.font)}</span>
            <select className="select-hit-area" aria-label="选中文字字体" value={selectedFormat.font} onChange={(event) => {
              setSelectedFormat((current) => ({ ...current, font: event.target.value }));
              applyInlineFormat('fontFamily', fontStack(event.target.value));
            }}>
              {fontOptions.map((option) => <option key={option.family} value={option.family}>{option.label}</option>)}
            </select>
          </label>
          <div className="font-size-controls" title="字号调整">
            <span className="floating-caption">字号</span>
            <button className="font-size-btn" aria-label="减小字号" title="减小字号" onMouseDown={(event) => event.preventDefault()} onClick={() => changeFontStep(-1)} disabled={selectedFormat.fontStep <= -MAX_FONT_STEP}>A−</button>
            <span className="font-step-value">{selectedFormat.fontStep === 0 ? '标准' : selectedFormat.fontStep > 0 ? `+${selectedFormat.fontStep}` : `${selectedFormat.fontStep}`}</span>
            <button className="font-size-btn" aria-label="增大字号" title="增大字号" onMouseDown={(event) => event.preventDefault()} onClick={() => changeFontStep(1)} disabled={selectedFormat.fontStep >= MAX_FONT_STEP}>A+</button>
          </div>
        </div>
        <div className="selection-toolbar-row style-controls-row">
          <button className={`floating-format ${selectedFormat.bold ? 'selected' : ''}`} aria-label="粗体" title="粗体" onMouseDown={(event) => event.preventDefault()} onClick={applyBold}><b>B</b></button>
          <div className="floating-colors" aria-label="预设字体颜色">
            {palette.map((color) => <button
              key={color}
              className={`floating-color ${selectedFormat.textColor.toLowerCase() === color ? 'active' : ''}`}
              style={{ '--swatch': color } as React.CSSProperties}
              title={color}
              aria-label={`字体颜色 ${color}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setSelectedFormat((current) => ({ ...current, textColor: color }));
                applyInlineFormat('color', color);
              }}
            />)}
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
        </div>
        <div className="table-tools" aria-label="表格控制">
          <button className={`lock-button ${settings.locked ? 'locked' : ''}`} title={settings.locked ? '解锁表格尺寸' : '锁定表格尺寸'} onClick={() => updateSettings({ locked: !settings.locked })}>
            <span className="lock-icon">{settings.locked ? '▣' : '⠿'}</span><span>{settings.locked ? '已锁定' : '可调整'}</span>
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
          <button className="export-button" title="导出 PNG 图片" onClick={() => void exportImage()} disabled={exporting}>
            <span aria-hidden="true">↧</span><span>{exporting ? '导出中' : '导出图片'}</span>
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
            <div><dt>作者</dt><dd>OctSeventh（RobertLau）</dd></div>
          </dl>
          <button className="about-close" onClick={() => setAboutOpen(false)}>关闭</button>
        </section>
      </div>}
    </main>
  );
}

export default App;