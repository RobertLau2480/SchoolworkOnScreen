# 📚 屏上作业 · SchoolworkOnScreen

> 面向 Windows 的本地作业展示程序，让作业内容清晰呈现在屏幕上。

![Version](https://img.shields.io/badge/version-1.2.2-blue)
![Electron](https://img.shields.io/badge/Electron-22.3.27-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18.2.0-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4.5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-4.5.3-646CFF?logo=vite&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-10%201703%2B-0078D6?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/License-GPLv3-blue)

---

## 📖 项目简介

**屏上作业** 是一款面向 Windows 的本地作业展示程序。它使用 Electron 容器承载 React Web UI，数据完全保存在本机，不经过任何网络传输。作业内容和设置分别以 `content.json`、`config.ini` 文件保存在程序 EXE 同目录，方便备份和迁移。

程序内置 **11 款中文字体**（WOFF2 压缩，放在 `fonts/` 目录，可自行增删），并提供 **深色 / 浅色两套主题**，适合在触摸屏或大屏上展示每日作业。

## ✨ 功能特性

### 📝 作业管理
- **多种网格布局**：支持 2x3、2x4、2x5 作业格，切换时二次确认并清空内容
- **灵活编辑**：编辑科目与作业文本，自动换行、自动保存
- **智能缩放**：内容过多时自动缩小字体，保证完整显示
- **修改时间标记**：每格右上角显示上次修改时间（"xx分钟前 / xx小时前 / xx天前"），
  12 小时内为灰色、超过 12 小时为黄色；**仅在内容真正变更时刷新**

### 🎨 文本格式化
- 选中文字后可设置**字体**、**字号**、**颜色**、**粗体 / 斜体**、**高光**
- **字号滑条**：12–72px 连续可调（不再局限于固定几档），拖动时实时预览，从左到右滑条逐渐变宽
- **精确作用范围**：字号 / 颜色 / 高光只作用于真正选中的文字，不会连带影响相邻字符
- **主题高光**：高亮颜色随主题联动（深色为暖橙、浅色为亮黄），避免颜色叠加

### 🎨 界面定制
- **深色 / 浅色模式**：一键切换，字体颜色预设与高光颜色同步映射
- **网格锁定**：锁定或解锁网格尺寸，解锁后可自由拖动分隔线调整单元格大小
- **导出图片**：一键导出网格为 PNG 图片

### ⚡ 系统集成
- **启动即最大化**：程序启动时自动最大化窗口
- **防休眠**：窗口获得前台焦点时阻止显示器休眠，失焦或关闭后恢复系统策略

## 🚀 快速开始  
- 可直接从**Release**页面下载发布版运行
- 可通过源代码编译，编译方法如下：
### 环境要求

- **Node.js** 18 或更新版本
- **Windows 10** 1703（Build 15063）或更新版本

### 开发模式

```powershell
# 安装依赖
npm install

# 启动开发模式（Vite + Electron）
npm run dev:desktop
```

### 打包发布

```powershell
# 生成 Windows 完整运行目录（含 Electron 运行时 DLL）
npm run package:full
```

产物位于 `release\windows\win-unpacked\`。请**整体复制或压缩**该文件夹，不要单独移动 `SchoolworkOnScreen.exe`（`ffmpeg.dll` 等运行时依赖必须与 EXE 保持在同一目录）。

`fonts\`、`config.ini`、`content.json` 会一起打进去：程序直接使用 EXE 同目录下的 `fonts\`，自定义字体只需往该目录增删文件后重启。

> ⚠️ **注意**：作业数据 `config.ini` / `content.json`（以及 `history\` 目录）写在 EXE 所在目录，因此该目录需要写入权限。建议放在可写的普通文件夹，**不要**放在 `Program Files`。


## 📁 项目结构

```
SchoolworkOnScreen/
├── 📂 electron/              # Electron 主进程
│   ├── main.ts               # 主进程入口（默认最大化、防休眠、IPC 处理）
│   └── preload.ts            # 预加载脚本（IPC 桥接）
├── 📂 src/                   # React 渲染进程
│   ├── App.tsx               # 主应用组件
│   ├── main.tsx              # React 入口
│   ├── styles.css            # 全局样式（含深浅主题）
│   ├── fonts.ts              # 本地字体加载与注册
│   ├── types.ts              # TypeScript 类型定义
│   └── assets.d.ts           # 资源类型声明
├── 📂 fonts/                 # 内置字体（WOFF2，运行时扫描，可自行增删）
├── 📄 config.ini             # 外观配置（运行时生成，位于 EXE 旁）
├── 📄 content.json           # 作业内容数据（运行时生成，位于 EXE 旁）
├── 📄 index.html             # HTML 入口
├── 📄 package.json           # 项目配置与依赖
├── 📄 vite.config.ts         # Vite 配置
├── 📄 tsconfig.json          # TypeScript 配置
└── 📄 tsconfig.electron.json # Electron TypeScript 配置
```

## 🔤 内置字体

程序启动时扫描 EXE 同目录下的 `fonts/` 文件夹（支持 `.woff2` / `.woff` / `.ttf` / `.otf`，最多 200 个），字体选择列表显示文件名（去掉后缀）：

仿宋、华文中宋、华文新魏、幼圆、思源宋体、**思源黑体**（默认）、方正姚体、方正舒体、楷体、汉仪乐喵体、隶书

字体通过自定义协议 `swos-font://` 按需流式加载（不拖慢启动、不走 IPC 传 base64），启动时注入对应 `@font-face` 规则；导出图片时再把用到的字体转成 data URL 内嵌，保证导出的 PNG 字体一致。

需要新增字体时，把 `.woff2` / `.ttf` / `.otf` 文件放进 `fonts/` 然后重启程序即可。

## 🎨 主题与配色

| 元素 | 深色模式 | 浅色模式 |
|---|---|---|
| 背景 | `#29332f` | `#eef1ee` |
| 单元格 | `#35413b` | `#ffffff` |
| 默认文字 | 白 `#ffffff` | 黑 `#000000` |
| 高光 | 深棕 `#5a3a1e` | 亮黄 `#fff176` |

字体颜色预设在切换主题时按顺序一一对应映射，高光颜色同步切换。

## 📊 数据格式

### `config.ini`

使用 `[appearance]` 节保存界面外观设置：

```ini
[appearance]
background=#29332f        ; 背景颜色
frame=#35413b             ; 单元格颜色
locked=true               ; 网格尺寸是否锁定
font=SWOS-思源黑体         ; 默认字体（族名带 SWOS- 前缀）
fontSize=medium           ; 单元格基准字号
textColor=#ffffff         ; 文字颜色
bold=false                ; 是否粗体
highlight=#5a3a1e         ; 高光颜色（随主题）
theme=dark                ; 主题（dark / light）
historyEnabled=false      ; 是否开启每日存档
```

### `content.json`

带有 `version` 字段，保存布局、每格科目与 HTML 文本、行列比例及修改时间：

```json
{
  "version": 1,
  "layout": "2x3",
  "cells": [
    { "subject": "语文", "text": "", "lastModified": null },
    { "subject": "数学", "text": "", "lastModified": 1729000000000 }
  ],
  "columns": [1, 1, 1],
  "rows": [1, 1]
}
```

> 💡 升级时应保留版本号，并在读取逻辑中为旧版数据提供迁移/默认值。

## 🔒 安全设计

- 渲染进程启用 **`contextIsolation`**、关闭 **Node 集成**并运行在 **sandbox** 中
- 文件读写、窗口控制和系统休眠控制仅经 **preload 暴露的窄 IPC API** 处理
- 仅允许打开项目 GitHub 地址这一条外部链接，其余 `window.open` 请求一律拒绝
- 作业文本允许保留编辑器生成的富文本 HTML，因此**不应从不可信来源导入 `content.json`**

## 🖥️ Windows 兼容性

本项目固定使用 **Electron 22.3.27**（Chromium 108），作为 Windows 10 1703（Build 15063）及以上版本的兼容目标。

> ⚠️ **安全提示**：Electron 22 已停止上游安全维护，适合隔离网络的本地展示用途。若用于联网或处理敏感内容，应将最低系统版本提高到受支持的 Windows 版本，并升级 Electron 主版本。

## 📄 许可证

本项目基于 **GNU General Public License v3.0 (GPLv3)** 授权发布。

版权所有 © 2026 OctSeventh（RobertLau）

这意味着你可以自由使用、修改和分发本软件，但衍生作品必须以相同许可证开源，并保留原作者版权声明。完整条款见仓库根目录的 [LICENSE](LICENSE) 文件。
