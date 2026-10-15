# 屏上作业 · SchoolworkOnScreen

面向 Windows 的本地作业展示程序。Electron 容器承载 React Web UI，数据不离开本机；作业内容和设置分别以 `content.json`、`config.ini` 保存在程序 EXE 同目录。

## 运行与打包

需要安装 Node.js 18 或更新版本，并在项目目录运行：

```powershell
npm install
npm run dev:desktop
```

生成 Windows 完整运行目录：

```powershell
npm run package:windows
```

产物位于 `release\windows\win-unpacked`。请整体复制或压缩该文件夹，不要单独移动 `SchoolworkOnScreen.exe`；Electron 运行时 DLL（包括 `ffmpeg.dll`）必须与 EXE 保持在同一目录。首次启动时默认 `config.ini` 与 `content.json` 会复制到 EXE 所在目录；之后该目录需要有写入权限。建议放在可写的普通文件夹，不要放在 `Program Files`。

## 功能

- 2x3、2x4、2x5 作业格；切换时二次确认并清空内容。
- 编辑科目与作业文本，自动换行、自动保存；内容过多时自动缩小字体。
- 对选中文字应用字体、字号、颜色、粗体、斜体和青/黄色高光。
- 锁定或解锁网格尺寸；解锁后可拖动分隔线，单格最小宽高受限。
- 调整背景与单元格颜色，导出网格 PNG。
- 窗口获得前台焦点时阻止显示器休眠；失焦或关闭后恢复系统策略。

## 数据格式

`config.ini` 使用 `[appearance]` 节保存背景、表框、网格锁定、默认字体与字号、文字颜色和高光设置。`content.json` 带有 `version` 字段，保存布局、每格科目与 HTML 文本，以及行列比例。升级时应保留版本号，并在读取逻辑中为旧版数据提供迁移/默认值。

## Windows 兼容性

本项目固定使用 Electron 22.3.27（Chromium 108），作为 Windows 10 1703（Build 15063）及以上版本的兼容目标。Electron 22 已停止上游安全维护，适合隔离网络的本地展示用途；若用于联网或处理敏感内容，应将最低系统版本提高到受支持的 Windows 版本，并升级 Electron 主版本。

## 安全边界

渲染进程启用 `contextIsolation`、关闭 Node 集成并运行在 sandbox 中；文件读写、窗口控制和系统休眠控制仅经 preload 暴露的窄 IPC API 处理。作业文本允许保留编辑器生成的富文本 HTML，因此不应从不可信来源导入 `content.json`。