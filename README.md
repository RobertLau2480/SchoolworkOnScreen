# 📚 屏上作业 · SchoolworkOnScreen

> 面向 Windows 的本地作业展示程序，让作业内容清晰呈现在屏幕上。

![Electron](https://img.shields.io/badge/Electron-22.3.27-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18.2.0-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4.5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-4.5.3-646CFF?logo=vite&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-10%201703%2B-0078D6?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/License-Private-red)

---

## 📖 项目简介

**屏上作业** 是一款面向 Windows 的本地作业展示程序。它使用 Electron 容器承载 React Web UI，数据完全保存在本机，不经过任何网络传输。作业内容和设置分别以 `content.json`、`config.ini` 文件保存在程序 EXE 同目录，方便备份和迁移。

## ✨ 功能特性

### 📝 作业管理
- **多种网格布局**：支持 2x3、2x4、2x5 作业格，切换时二次确认并清空内容
- **灵活编辑**：编辑科目与作业文本，自动换行、自动保存
- **智能缩放**：内容过多时自动缩小字体，保证完整显示

### 🎨 文本格式化
- 对选中文字应用**字体**、**字号**、**颜色**、**粗体**、**斜体**设置
- 支持**青色**和**黄色**高光标记重点内容

### 🖥️ 界面定制
- **网格锁定**：锁定或解锁网格尺寸，解锁后可自由拖动分隔线调整单元格大小
- **颜色主题**：自定义背景与单元格颜色
- **导出图片**：一键导出网格为 PNG 图片

### ⚡ 系统集成
- **防休眠**：窗口获得前台焦点时阻止显示器休眠，失焦或关闭后恢复系统策略

## 🚀 快速开始

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
# 生成 Windows 完整运行目录
npm run package:windows
```

产物位于 `release\windows\win-unpacked`。请**整体复制或压缩**该文件夹，不要单独移动 `SchoolworkOnScreen.exe`；Electron 运行时 DLL（包括 `ffmpeg.dll`）必须与 EXE 保持在同一目录。

> ⚠️ **注意**：首次启动时默认 `config.ini` 与 `content.json` 会复制到 EXE 所在目录；之后该目录需要有写入权限。建议放在可写的普通文件夹，**不要**放在 `Program Files`。

## 📁 项目结构

```
SchoolworkOnScreen/
├── 📂 electron/              # Electron 主进程
│   ├── main.ts               # 主进程入口
│   └── preload.ts            # 预加载脚本（IPC 桥接）
├── 📂 src/                   # React 渲染进程
│   ├── App.tsx               # 主应用组件
│   ├── main.tsx              # React 入口
│   ├── styles.css            # 全局样式
│   ├── types.ts              # TypeScript 类型定义
│   └── assets.d.ts           # 资源类型声明
├── 📄 config.ini             # 外观配置（运行时生成）
├── 📄 content.json           # 作业内容数据（运行时生成）
├── 📄 index.html             # HTML 入口
├── 📄 package.json           # 项目配置与依赖
├── 📄 vite.config.ts         # Vite 配置
├── 📄 tsconfig.json          # TypeScript 配置
└── 📄 tsconfig.electron.json # Electron TypeScript 配置
```

## 📊 数据格式

### `config.ini`

使用 `[appearance]` 节保存界面外观设置：

```ini
[appearance]
background=#29332f        ; 背景颜色
frame=#35413b             ; 表框颜色
layout=2x3                ; 网格布局
locked=true               ; 网格是否锁定
font=Microsoft YaHei       ; 默认字体
fontSize=medium           ; 默认字号
textColor=#e6edef         ; 文字颜色
bold=false                ; 是否粗体
italic=false              ; 是否斜体
highlight=#b85c1e         ; 高光颜色
```

### `content.json`

带有 `version` 字段，保存布局、每格科目与 HTML 文本，以及行列比例：

```json
{
  "version": 1,
  "layout": "2x3",
  "cells": [
    { "subject": "语文", "text": "" },
    { "subject": "数学", "text": "" }
  ],
  "columns": [1, 1, 1],
  "rows": [1, 1]
}
```

> 💡 升级时应保留版本号，并在读取逻辑中为旧版数据提供迁移/默认值。

## 🔒 安全设计

- 渲染进程启用 **`contextIsolation`**、关闭 **Node 集成**并运行在 **sandbox** 中
- 文件读写、窗口控制和系统休眠控制仅经 **preload 暴露的窄 IPC API** 处理
- 作业文本允许保留编辑器生成的富文本 HTML，因此**不应从不可信来源导入 `content.json`**

## 🖥️ Windows 兼容性

本项目固定使用 **Electron 22.3.27**（Chromium 108），作为 Windows 10 1703（Build 15063）及以上版本的兼容目标。

> ⚠️ **安全提示**：Electron 22 已停止上游安全维护，适合隔离网络的本地展示用途。若用于联网或处理敏感内容，应将最低系统版本提高到受支持的 Windows 版本，并升级 Electron 主版本。

## 📄 许可证

本项目为私有项目，保留所有权利。