import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import appIcon from '../icon.png';
import type { AppSettings, HomeworkCell, HomeworkDocument, Layout } from './types';

const layouts: Record<Layout, { rows: number; columns: number }> = {
  '2x3': { rows: 2, columns: 3 },
  '2x4': { rows: 2, columns: 4 },
  '2x5': { rows: 2, columns: 5 },
};
const subjects = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '其他'];
const colors = ['#000000', '#ffffff', '#ffd83d', '#df4d47', '#3587d4', '#38a56b'];
const fonts = ['Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'Arial'];
const defaultSettings: AppSettings = {
  background: '#29332f', frame: '#35413b', locked: true, font: 'Microsoft YaHei',
  fontSize: 'medium', textColor: '#e6edef', bold: false, highlight: '#b85c1e',
};
const highlightColor = '#b85c1e';
const legacyHighlightColors = ['#087f80', '#58d9e6'];

type SelectedFormat = Pick<AppSettings, 'font' | 'fontSize' | 'textColor' | 'bold' | 'highlight'> & { highlighted: boolean };

function fitEditor(editor: HTMLElement, baseSize: number): void {
  const overflows = () => editor.scrollHeight > editor.clientHeight + 1 || editor.scrollWidth > editor.clientWidth + 1;
  editor.style.fontSize = `${baseSize}px`;
  if (!overflows()) return;

  let low = 6;
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
  if (color.startsWith('#')) return color;
  const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  return values?.length === 3
    ? `#${values.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`
    : '#e6edef';
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
  const savedBackground = raw.background?.toLowerCase();
  const savedFrame = raw.frame?.toLowerCase();
  const savedTextColor = raw.textColor?.toLowerCase();
  const savedHighlight = raw.highlight === '#ffe979' || raw.highlight === '#58d9e6'
    ? highlightColor
    : raw.highlight;
  return {
    background: savedBackground === '#e9edef' ? defaultSettings.background : (raw.background ?? defaultSettings.background),
    frame: savedFrame === '#ffffff' ? defaultSettings.frame : (raw.frame ?? defaultSettings.frame),
    locked: raw.locked !== 'false',
    font: raw.font ?? defaultSettings.font,
    fontSize: raw.fontSize === 'small' || raw.fontSize === 'large' ? raw.fontSize : 'medium',
    textColor: savedTextColor === '#18242a' ? defaultSettings.textColor : (raw.textColor ?? defaultSettings.textColor),
    bold: raw.bold === 'true',
    highlight: savedHighlight === highlightColor ? savedHighlight : highlightColor,
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
    bold: false, highlight: defaultSettings.highlight, highlighted: false,
  });
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ left: 0, top: 0, side: 'above' as 'above' | 'below' });
  const [aboutOpen, setAboutOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [exporting, setExporting] = useState(false);
  const gridRef = useRef<HTMLElement>(null);
  const formatToolbarRef = useRef<HTMLDivElement>(null);
  const selectionRectRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const toolbarPointerRef = useRef(false);
  const selectionRef = useRef<Range | null>(null);
  const fitFramesRef = useRef(new WeakMap<HTMLElement, number>());
  const inputTimersRef = useRef(new Map<number, number>());
  const resizeRef = useRef<{ axis: 'columns' | 'rows'; index: number; start: number; values: number[] } | null>(null);

  useEffect(() => {
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
      });
      setLoaded(true);
    }).catch(() => setLoaded(true));
    void window.schoolwork.isMaximized().then(setMaximized);
    return () => { alive = false; };
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

  useEffect(() => {
    const baseSize = settings.fontSize === 'small' ? 15 : settings.fontSize === 'large' ? 22 : 18;
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

  const queueContentUpdate = (index: number, editor: HTMLElement, immediate = false) => {
    const pending = inputTimersRef.current.get(index);
    if (pending) window.clearTimeout(pending);
    if (immediate) {
      inputTimersRef.current.delete(index);
      updateCell(index, { text: editor.innerHTML });
      return;
    }
    inputTimersRef.current.set(index, window.setTimeout(() => {
      inputTimersRef.current.delete(index);
      updateCell(index, { text: editor.innerHTML });
    }, 120));
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
    const side = bounds.top > 140 ? 'above' : 'below';
    setToolbarPosition({
      left: bounds.left + bounds.width / 2,
      top: side === 'above' ? bounds.top : bounds.bottom,
      side,
    });
    const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode as HTMLElement
      : selection.anchorNode?.parentElement;
    const editor = anchor?.closest<HTMLElement>('.cell-editor');
    if (!editor) return;
    const computed = window.getComputedStyle(anchor ?? editor);
    const pixelSize = Number.parseFloat(computed.fontSize);
    let highlight = highlightColor;
    let highlighted = false;
    for (let element = anchor; element && element !== editor; element = element.parentElement) {
      const background = element.style.backgroundColor;
      if (background) {
        const color = cssColorToHex(background).toLowerCase();
        highlighted = color === highlightColor || legacyHighlightColors.includes(color);
        if (highlighted) highlight = highlightColor;
        break;
      }
    }
    const size = pixelSize < 15 ? 'small' : pixelSize >= 21 ? 'large' : 'medium';
    const next: SelectedFormat = {
      font: fonts.find((font) => computed.fontFamily.includes(font)) ?? computed.fontFamily.split(',')[0].replace(/"/g, '').trim(),
      fontSize: size,
      textColor: cssColorToHex(computed.color),
      bold: window.document.queryCommandState('bold'),
      highlight,
      highlighted,
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
    const aboveTop = selectionBounds.top - bounds.height - 10;
    const belowTop = selectionBounds.bottom + 10;
    const canPlaceAbove = aboveTop >= 8;
    const canPlaceBelow = belowTop + bounds.height <= window.innerHeight - 8;
    const prefersAbove = selectionBounds.top > 140;
    const side = prefersAbove && canPlaceAbove
      ? 'above'
      : !canPlaceBelow && canPlaceAbove ? 'above' : 'below';
    const top = side === 'above'
      ? Math.max(8, aboveTop)
      : Math.min(window.innerHeight - bounds.height - 8, belowTop);
    if (left !== toolbarPosition.left || top !== toolbarPosition.top || side !== toolbarPosition.side) {
      setToolbarPosition({ left, top, side });
    }
  }, [toolbarPosition, toolbarVisible, selectedFormat]);

  const applyInlineFormat = (property: 'fontFamily' | 'fontSize' | 'color' | 'backgroundColor' | 'fontWeight', value: string) => {
    const savedRange = selectionRef.current;
    const selection = window.getSelection();
    if (!savedRange || !selection || !gridRef.current?.contains(savedRange.commonAncestorContainer)) return;
    const node = savedRange.commonAncestorContainer;
    const editor = (node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement)?.closest<HTMLElement>('.cell-editor');
    if (!editor) return;

    const range = savedRange.cloneRange();
    const collapsed = range.collapsed;
    const span = window.document.createElement('span');
    if (property === 'fontSize') {
      const baseSize = settings.fontSize === 'small' ? 15 : settings.fontSize === 'large' ? 22 : 18;
      span.style.fontSize = `${Number.parseFloat(value) / baseSize}em`;
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
    readSelectionFormat();
  };

  const applyBold = () => {
    applyInlineFormat('fontWeight', selectedFormat.bold ? '400' : '700');
  };

  const toggleHighlight = () => {
    applyInlineFormat('backgroundColor', selectedFormat.highlighted ? 'var(--cell-bg)' : highlightColor);
  };

  const exportImage = async () => {
    if (!gridRef.current) return;
    setExporting(true);
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(gridRef.current, { pixelRatio: 2, backgroundColor: settings.background });
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
  const cellFontSize = settings.fontSize === 'small' ? 15 : settings.fontSize === 'large' ? 22 : 18;
  const gridStyle = {
    gridTemplateColumns: document.columns.map((value) => `${value}fr`).join(' '),
    gridTemplateRows: document.rows.map((value) => `${value}fr`).join(' '),
    backgroundColor: settings.background,
  } as React.CSSProperties;

  return (
    <main className="app-shell" style={{ '--app-bg': settings.background, '--cell-bg': settings.frame } as React.CSSProperties}>
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
            return (
              <article key={`${document.layout}-${index}`} className="homework-cell" style={{ backgroundColor: settings.frame }}>
                <div className="cell-heading">
                  <span className="cell-index">{String(index + 1).padStart(2, '0')}</span>
                  <input aria-label={`第${index + 1}格科目`} value={cell.subject} onChange={(event) => updateCell(index, { subject: event.target.value })} placeholder="科目" />
                  <span className="cell-grip" aria-hidden="true">⠿</span>
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
                    const baseSize = settings.fontSize === 'small' ? 15 : settings.fontSize === 'large' ? 22 : 18;
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
                    fontFamily: settings.font,
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
            <span className="floating-value">{selectedFormat.font.replace('Microsoft ', '')}</span>
            <select className="select-hit-area" aria-label="选中文字字体" value={selectedFormat.font} onChange={(event) => {
              setSelectedFormat((current) => ({ ...current, font: event.target.value }));
              applyInlineFormat('fontFamily', event.target.value);
            }}>
              {!fonts.includes(selectedFormat.font) && <option value={selectedFormat.font}>{selectedFormat.font}</option>}
              {fonts.map((font) => <option key={font} value={font}>{font.replace('Microsoft ', '')}</option>)}
            </select>
          </label>
          <label className="floating-select size-select" title="字号">
            <span className="floating-caption">字号</span>
            <span className="floating-value">{{ small: '小', medium: '中', large: '大' }[selectedFormat.fontSize]}</span>
            <select className="select-hit-area" aria-label="选中文字字号" value={selectedFormat.fontSize} onChange={(event) => {
              const size = event.target.value as AppSettings['fontSize'];
              const pixels = size === 'small' ? 15 : size === 'large' ? 22 : 18;
              setSelectedFormat((current) => ({ ...current, fontSize: size }));
              applyInlineFormat('fontSize', `${pixels}px`);
            }}>
              <option value="small">小</option><option value="medium">中</option><option value="large">大</option>
            </select>
          </label>
        </div>
        <div className="selection-toolbar-row style-controls-row">
          <button className={`floating-format ${selectedFormat.bold ? 'selected' : ''}`} aria-label="粗体" title="粗体" onMouseDown={(event) => event.preventDefault()} onClick={applyBold}><b>B</b></button>
          <div className="floating-colors" aria-label="预设字体颜色">
            {colors.map((color) => <button
              key={color}
              className={`floating-color ${selectedFormat.textColor.toLowerCase() === color ? 'active' : ''}`}
              style={{ '--swatch': color } as React.CSSProperties}
              title={color === '#000000' ? '黑色' : color === '#ffffff' ? '白色' : color}
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
              style={{ '--highlight': highlightColor } as React.CSSProperties}
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
        <button className="about-button" onClick={() => setAboutOpen(true)}>关于</button>
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
          <label className="color-tool surface-color" title="背景颜色">
            <span className="tool-caption">背景</span><span className="surface-swatch" style={{ backgroundColor: settings.background }} />
            <input aria-label="背景颜色" type="color" value={settings.background} onChange={(event) => updateSettings({ background: event.target.value })} />
          </label>
          <label className="color-tool surface-color" title="表面颜色">
            <span className="tool-caption">表面</span><span className="surface-swatch" style={{ backgroundColor: settings.frame }} />
            <input aria-label="表面颜色" type="color" value={settings.frame} onChange={(event) => updateSettings({ frame: event.target.value })} />
          </label>
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
