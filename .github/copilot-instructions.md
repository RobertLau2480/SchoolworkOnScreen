# Project Checklist

- [x] Verify that this file exists.
- [x] Clarify project requirements: Electron, React, TypeScript, Windows desktop web application.
- [x] Scaffold the project in the workspace root.
- [x] Customize the project for the requested homework display workflow.
- [x] No extensions needed; none were specified by the project setup.
- [x] Compile the project and resolve diagnostics.
- [x] No separate VS Code task needed; package.json provides the development and Windows directory packaging scripts.
- [x] Do not launch the application without user confirmation.
- [x] Document usage and Windows compatibility in README.md.

## Project Notes

- Target Windows 10 version 1703 (Build 15063) and newer with Electron 22.3.27.
- Electron 22 is out of security support; see README.md before using on networked machines.
- `npm run dev:desktop` starts the Vite renderer and Electron shell.
- `npm run package:windows` builds a complete Windows app directory under `release/windows/win-unpacked`, with runtime DLLs beside the executable.
- Runtime files `config.ini` and `content.json` belong beside the executable.