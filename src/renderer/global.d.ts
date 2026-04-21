export {};

interface AppInfo {
  name: string;
  version: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
}

interface ElectronAPI {
  getAppInfo: () => Promise<AppInfo>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
