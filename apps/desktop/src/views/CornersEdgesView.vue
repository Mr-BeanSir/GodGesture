<script setup lang="ts">
/**
 * 「触发角 & 摩擦边」区:四角 / 四边独立配置命令(全部 12 类命令可选)。
 * commands 为 Partial<Record<zone, Command>>,未配置即无该键。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { Command, ScreenCorner, ScreenEdge } from "@godgesture/shared";
import { useConfigStore } from "../stores/config";
import { createDefaultCommand } from "../utils/commands";
import CommandEditor from "../components/CommandEditor.vue";

type ZoneKind = "corner" | "edge";

const { t } = useI18n();
const store = useConfigStore();

const hotCorners = computed(() => store.doc!.hotCorners);
const rubEdges = computed(() => store.doc!.rubEdges);

const CORNER_KEYS: ScreenCorner[] = ["leftTop", "rightTop", "leftBottom", "rightBottom"];
const EDGE_KEYS: ScreenEdge[] = ["top", "right", "bottom", "left"];

const selKind = ref<ZoneKind | null>(null);
const selKey = ref<string | null>(null);

function selectZone(kind: ZoneKind, key: string) {
  selKind.value = kind;
  selKey.value = key;
}

function zoneCommand(kind: ZoneKind, key: string): Command | undefined {
  return kind === "corner"
    ? hotCorners.value.commands[key as ScreenCorner]
    : rubEdges.value.commands[key as ScreenEdge];
}
function hasCommand(kind: ZoneKind, key: string): boolean {
  return zoneCommand(kind, key) !== undefined;
}
function isSelected(kind: ZoneKind, key: string): boolean {
  return selKind.value === kind && selKey.value === key;
}

const activeCommand = computed<Command | null>(() =>
  selKind.value && selKey.value ? (zoneCommand(selKind.value, selKey.value) ?? null) : null,
);

function setActiveCommand(cmd: Command) {
  if (!selKind.value || !selKey.value) return;
  if (selKind.value === "corner") hotCorners.value.commands[selKey.value as ScreenCorner] = cmd;
  else rubEdges.value.commands[selKey.value as ScreenEdge] = cmd;
}
function configureZone() {
  setActiveCommand(createDefaultCommand("doNothing"));
}
function clearZone() {
  if (!selKind.value || !selKey.value) return;
  if (selKind.value === "corner") delete hotCorners.value.commands[selKey.value as ScreenCorner];
  else delete rubEdges.value.commands[selKey.value as ScreenEdge];
}

const selZoneLabel = computed(() => {
  if (!selKind.value || !selKey.value) return "";
  return selKind.value === "corner"
    ? t(`corners.corner.${selKey.value}`)
    : t(`corners.edge.${selKey.value}`);
});
</script>

<template>
  <div class="corners">
    <div class="corners__panels">
      <!-- 触发角 -->
      <section class="gg-section">
        <div class="corners__head">
          <h3 class="gg-section-title">{{ t("corners.hotCornersTitle") }}</h3>
          <el-switch v-model="hotCorners.enabled" />
        </div>
        <p class="gg-hint">{{ t("corners.hotCornersDesc") }}</p>
        <div class="corners__screen">
          <button
            v-for="c in CORNER_KEYS"
            :key="c"
            type="button"
            class="corners__corner"
            :class="[
              `corners__corner--${c}`,
              { 'has-cmd': hasCommand('corner', c), 'is-active': isSelected('corner', c) },
            ]"
            @click="selectZone('corner', c)"
          >
            {{ t(`corners.corner.${c}`) }}
          </button>
        </div>
      </section>

      <!-- 摩擦边 -->
      <section class="gg-section">
        <div class="corners__head">
          <h3 class="gg-section-title">{{ t("corners.rubEdgesTitle") }}</h3>
          <el-switch v-model="rubEdges.enabled" />
        </div>
        <p class="gg-hint">{{ t("corners.rubEdgesDesc") }}</p>
        <div class="corners__screen">
          <button
            v-for="e in EDGE_KEYS"
            :key="e"
            type="button"
            class="corners__edge"
            :class="[
              `corners__edge--${e}`,
              { 'has-cmd': hasCommand('edge', e), 'is-active': isSelected('edge', e) },
            ]"
            @click="selectZone('edge', e)"
          >
            {{ t(`corners.edge.${e}`) }}
          </button>
        </div>
      </section>
    </div>

    <!-- 选中区域的命令编辑 -->
    <section v-if="selKind && selKey" class="gg-section corners__editor">
      <div class="corners__head">
        <h3 class="gg-section-title">{{ t("corners.commandFor", { zone: selZoneLabel }) }}</h3>
        <el-button v-if="activeCommand" size="small" @click="clearZone">
          {{ t("corners.clearCommand") }}
        </el-button>
      </div>
      <template v-if="activeCommand">
        <CommandEditor :model-value="activeCommand" @update:model-value="setActiveCommand" />
      </template>
      <template v-else>
        <p class="gg-hint">{{ t("corners.noCommand") }}</p>
        <el-button type="primary" @click="configureZone">{{ t("corners.setCommand") }}</el-button>
      </template>
    </section>
    <p v-else class="gg-hint">{{ t("corners.screenPreview") }}</p>
  </div>
</template>

<style scoped>
.corners {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 720px;
}
.corners__panels {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}
.corners__panels .gg-section {
  flex: 1;
  min-width: 280px;
}
.corners__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.corners__screen {
  position: relative;
  aspect-ratio: 16 / 10;
  border: 2px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
  margin-top: 10px;
}
.corners__corner,
.corners__edge {
  position: absolute;
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  border-radius: var(--el-border-radius-base);
  font-size: 12px;
  padding: 3px 8px;
  cursor: pointer;
  transition: all 0.15s;
}
.corners__corner:hover,
.corners__edge:hover {
  border-color: var(--el-color-primary);
}
.corners__corner.has-cmd,
.corners__edge.has-cmd {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  font-weight: 600;
}
.corners__corner.is-active,
.corners__edge.is-active {
  box-shadow: 0 0 0 2px var(--el-color-primary);
}
.corners__corner--leftTop {
  top: 8px;
  left: 8px;
}
.corners__corner--rightTop {
  top: 8px;
  right: 8px;
}
.corners__corner--leftBottom {
  bottom: 8px;
  left: 8px;
}
.corners__corner--rightBottom {
  bottom: 8px;
  right: 8px;
}
.corners__edge--top {
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
}
.corners__edge--bottom {
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
}
.corners__edge--left {
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
}
.corners__edge--right {
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
}
</style>
