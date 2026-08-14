<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useBackend, type AppIconRequest } from "../api/backend";
import godGestureIcon from "../../src-tauri/icons/32x32.png";
import {
  appIconCacheKey,
  loadCachedAppIcon,
  normalizeAppIconRequest,
} from "./app-icon";

const props = withDefaults(
  defineProps<{
    label: string;
    global?: boolean;
    windowsExeName?: string | null;
    macBundleId?: string | null;
    size?: number;
  }>(),
  { global: false, windowsExeName: null, macBundleId: null, size: 20 },
);

const { t } = useI18n();
const backend = useBackend();
const remoteIcon = ref<string | null>(null);
const loading = ref(false);
let requestVersion = 0;

const iconCache = getIconCache();
const request = computed<AppIconRequest | null>(() => {
  if (props.global) return null;
  return normalizeAppIconRequest({
    windowsExeName: props.windowsExeName ?? undefined,
    macBundleId: props.macBundleId ?? undefined,
  });
});
const cacheKey = computed(() => {
  if (props.global) return "global";
  return appIconCacheKey(request.value);
});
const imageSource = computed(() => {
  if (props.global) return godGestureIcon;
  return remoteIcon.value ? `data:image/png;base64,${remoteIcon.value}` : null;
});
const accessibleLabel = computed(() =>
  imageSource.value
    ? t("gestures.appIcon", { name: props.label })
    : t("gestures.appIconUnavailable", { name: props.label }),
);
const dimensions = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}));

watch(
  cacheKey,
  async (key) => {
    const version = ++requestVersion;
    remoteIcon.value = null;
    loading.value = false;
    if (key === "global" || !key || !request.value) return;
    loading.value = true;
    const pending = loadCachedAppIcon(iconCache, key, () =>
      backend.appIcon(request.value!),
    );
    const icon = await pending;
    if (version === requestVersion) {
      remoteIcon.value = icon;
      loading.value = false;
    }
  },
  { immediate: true },
);

function getIconCache() {
  const root = globalThis as typeof globalThis & {
    __godGestureAppIconCache?: Map<string, Promise<string | null>>;
  };
  return (root.__godGestureAppIconCache ??= new Map());
}
</script>

<template>
  <span
    class="app-icon"
    :class="{ 'is-loading': loading }"
    :style="dimensions"
    role="img"
    :aria-label="accessibleLabel"
    :title="accessibleLabel"
  >
    <img v-if="imageSource" :src="imageSource" alt="" draggable="false" />
    <svg v-else viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" />
      <path d="M8.7 9.2a3.45 3.45 0 0 1 6.65 1.3c0 2.1-1.9 2.75-2.8 3.45-.42.33-.55.68-.55 1.3" />
      <circle cx="12" cy="18" r="1" />
    </svg>
  </span>
</template>

<style scoped>
.app-icon {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border-radius: 5px;
  background: var(--gg-surface-muted);
}
.app-icon img,
.app-icon svg {
  display: block;
  width: 100%;
  height: 100%;
}
.app-icon img {
  object-fit: contain;
}
.app-icon svg rect {
  fill: var(--gg-surface);
  stroke: var(--gg-border);
}
.app-icon svg path,
.app-icon svg circle {
  fill: none;
  stroke: var(--gg-text-muted);
  stroke-width: 1.8;
  stroke-linecap: round;
}
.app-icon svg circle {
  fill: var(--gg-text-muted);
  stroke: none;
}
.app-icon.is-loading {
  animation: app-icon-pulse 1s ease-in-out infinite alternate;
}
@keyframes app-icon-pulse {
  to {
    opacity: 0.55;
  }
}
@media (prefers-reduced-motion: reduce) {
  .app-icon.is-loading {
    animation: none;
  }
}
</style>
