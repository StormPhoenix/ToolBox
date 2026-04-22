export type PresetGroup = 'iPhone' | 'iPad' | 'Mac' | 'Windows' | 'Android';

export interface SafeArea {
  top: number;    // 0–1
  bottom: number;
  left: number;
  right: number;
}

export interface Preset {
  id: string;
  name: string;
  group: PresetGroup;
  width: number;
  height: number;
  safeArea: SafeArea;
}

const SAFE_AREAS: Record<PresetGroup, SafeArea> = {
  iPhone:  { top: 0.07, bottom: 0.05, left: 0, right: 0 },
  iPad:    { top: 0.04, bottom: 0.03, left: 0, right: 0 },
  Mac:     { top: 0.03, bottom: 0.08, left: 0, right: 0 },
  Windows: { top: 0,    bottom: 0.05, left: 0, right: 0 },
  Android: { top: 0.05, bottom: 0.04, left: 0, right: 0 },
};

export const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'iphone-16-pro-max',
    name: 'iPhone 16 Pro Max',
    group: 'iPhone',
    width: 1320,
    height: 2868,
    safeArea: SAFE_AREAS.iPhone,
  },
  {
    id: 'iphone-16-pro',
    name: 'iPhone 16 Pro',
    group: 'iPhone',
    width: 1206,
    height: 2622,
    safeArea: SAFE_AREAS.iPhone,
  },
  {
    id: 'iphone-se',
    name: 'iPhone SE',
    group: 'iPhone',
    width: 750,
    height: 1334,
    safeArea: SAFE_AREAS.iPhone,
  },
  {
    id: 'ipad-pro-13',
    name: 'iPad Pro 13"',
    group: 'iPad',
    width: 2064,
    height: 2752,
    safeArea: SAFE_AREAS.iPad,
  },
  {
    id: 'ipad-air-11',
    name: 'iPad Air 11"',
    group: 'iPad',
    width: 1640,
    height: 2360,
    safeArea: SAFE_AREAS.iPad,
  },
  {
    id: 'macbook-pro-16',
    name: '16" MacBook Pro',
    group: 'Mac',
    width: 3456,
    height: 2234,
    safeArea: SAFE_AREAS.Mac,
  },
  {
    id: 'studio-display-27',
    name: 'Studio Display 27"',
    group: 'Mac',
    width: 5120,
    height: 2880,
    safeArea: SAFE_AREAS.Mac,
  },
  {
    id: 'windows-4k',
    name: '4K 通用',
    group: 'Windows',
    width: 3840,
    height: 2160,
    safeArea: SAFE_AREAS.Windows,
  },
  {
    id: 'windows-2k',
    name: '2K 通用',
    group: 'Windows',
    width: 2560,
    height: 1440,
    safeArea: SAFE_AREAS.Windows,
  },
  {
    id: 'android-generic',
    name: '通用手机',
    group: 'Android',
    width: 1440,
    height: 3200,
    safeArea: SAFE_AREAS.Android,
  },
];

export const PRESET_GROUPS: PresetGroup[] = [
  'iPhone', 'iPad', 'Mac', 'Windows', 'Android',
];
