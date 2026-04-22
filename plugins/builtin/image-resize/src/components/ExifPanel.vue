<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  exif: Record<string, unknown> | null;
}>();

interface ExifField {
  label: string;
  value: string;
}

function fmtAperture(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `f/${n.toFixed(1)}`;
}

function fmtShutter(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1) return `${n.toFixed(1)}s`;
  return `1/${Math.round(1 / n)}s`;
}

function fmtFocal(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(0)} mm`;
}

function fmtDate(v: unknown): string | null {
  if (v instanceof Date) {
    return v.toLocaleString('zh-CN');
  }
  if (typeof v === 'string') return v;
  return null;
}

function fmtGPS(lat: unknown, lon: unknown): string | null {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  const laDir = la >= 0 ? 'N' : 'S';
  const loDir = lo >= 0 ? 'E' : 'W';
  return `${Math.abs(la).toFixed(4)}°${laDir}, ${Math.abs(lo).toFixed(4)}°${loDir}`;
}

const fields = computed((): ExifField[] => {
  const e = props.exif;
  if (!e) return [];
  const out: ExifField[] = [];

  const make = (e.Make as string) ?? '';
  const model = (e.Model as string) ?? '';
  const cam = [make, model].filter(Boolean).join(' ');
  if (cam) out.push({ label: '相机', value: cam });

  const lens = (e.LensModel as string) ?? (e.Lens as string) ?? '';
  if (lens) out.push({ label: '镜头', value: lens });

  const ap = fmtAperture(e.FNumber ?? e.ApertureValue);
  if (ap) out.push({ label: '光圈', value: ap });

  const sh = fmtShutter(e.ExposureTime);
  if (sh) out.push({ label: '快门', value: sh });

  const iso = e.ISO ?? e.ISOSpeedRatings;
  if (iso !== undefined && iso !== null) {
    out.push({ label: 'ISO', value: `ISO ${iso}` });
  }

  const fl = fmtFocal(e.FocalLength);
  if (fl) out.push({ label: '焦距', value: fl });

  const date = fmtDate(e.DateTimeOriginal ?? e.CreateDate ?? e.DateTime);
  if (date) out.push({ label: '拍摄时间', value: date });

  const gps = fmtGPS(e.latitude, e.longitude);
  if (gps) out.push({ label: 'GPS', value: gps });

  return out;
});

const hasExif = computed(() => props.exif && fields.value.length > 0);
</script>

<template>
  <div class="card">
    <div class="card-title">EXIF</div>
    <div v-if="hasExif" class="fields">
      <div v-for="f in fields" :key="f.label" class="field">
        <span class="label">{{ f.label }}</span>
        <span class="value">{{ f.value }}</span>
      </div>
    </div>
    <div v-else class="empty">
      {{ exif ? '未提取到常用 EXIF 字段' : '该图片不含 EXIF 信息' }}
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 14px;
}

.card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.label {
  color: var(--text-dim);
  flex-shrink: 0;
}

.value {
  color: var(--text-primary);
  font-family: 'SF Mono', ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
  text-align: right;
}

.empty {
  color: var(--text-dim);
  font-size: 12px;
  padding: 8px 0;
}
</style>
