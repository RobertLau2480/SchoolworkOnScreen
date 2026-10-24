export type Layout = '2x3' | '2x4' | '2x5';

export interface HomeworkCell {
  subject: string;
  text: string;
  lastModified?: number;
}

export interface HomeworkDocument {
  version: number;
  layout: Layout;
  cells: HomeworkCell[];
  columns: number[];
  rows: number[];
}

export type Theme = 'dark' | 'light';

export interface AppSettings {
  background: string;
  frame: string;
  locked: boolean;
  font: string;
  fontSize: 'small' | 'medium' | 'large';
  textColor: string;
  bold: boolean;
  highlight: string;
  theme: Theme;
}

declare global {
  interface Window {
    schoolwork: {
      load: () => Promise<{ content: HomeworkDocument | null; settings: Record<string, string> }>;
      saveContent: (content: HomeworkDocument) => Promise<void>;
      saveSettings: (settings: Record<string, string>) => Promise<void>;
      minimize: () => Promise<void>;
      toggleMaximize: () => Promise<boolean>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      confirmLayout: (message: string) => Promise<boolean>;
      fontDataUrls: (urls: string[]) => Promise<Record<string, string>>;
      setNativeTheme: (theme: string) => Promise<void>;
      saveHistory: (payload: { date: string; html: string; enabled: boolean }) => Promise<boolean>;
    };
  }
}