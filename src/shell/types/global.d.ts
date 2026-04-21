import type { ElectronAPI } from '@toolbox/bridge';

export type { ElectronAPI };

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
