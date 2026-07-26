<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  ConfigDocument,
  GestureIntent,
  ScreenCorner,
  ScreenEdge,
} from "@godgesture/shared";
import { pullConfig } from "../api/sync";
import { gestureMnemonic } from "../utils/gesture";
import { errorMessageKey } from "../utils/errors";

const { t } = useI18n();

const loading = ref(true);
const errorKey = ref<string | null>(null);
const doc = ref<ConfigDocument | null>(null);

const CORNERS: ScreenCorner[] = [
  "leftTop",
  "rightTop",
  "leftBottom",
  "rightBottom",
];
const EDGES: ScreenEdge[] = ["left", "top", "right", "bottom"];

const sortedApps = computed(() =>
  doc.value ? [...doc.value.apps].sort((a, b) => a.order - b.order) : [],
);

function sortedIntents(intents: GestureIntent[]): GestureIntent[] {
  return [...intents].sort((a, b) => a.order - b.order);
}

function cornerCommandLabel(corner: ScreenCorner): string {
  const cmd = doc.value?.hotCorners.commands[corner];
  return cmd ? t(`command.${cmd.type}`) : t("config.unassigned");
}

function edgeCommandLabel(edge: ScreenEdge): string {
  const cmd = doc.value?.rubEdges.commands[edge];
  return cmd ? t(`command.${cmd.type}`) : t("config.unassigned");
}

function boolLabel(value: boolean): string {
  return value ? t("common.yes") : t("common.no");
}

onMounted(async () => {
  try {
    // apiRequest 内部已用 zod 解析(含 ConfigDocument);解析失败抛 ZodError
    const pull = await pullConfig();
    doc.value = pull.document;
  } catch (err) {
    errorKey.value = errorMessageKey(err);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-loading="loading">
    <h2>{{ t("config.title") }}</h2>
    <el-alert
      v-if="errorKey"
      type="error"
      :title="t(errorKey)"
      :closable="false"
      class="page-card"
    />
    <el-empty
      v-else-if="!loading && !doc"
      :description="t('config.empty')"
    />
    <template v-if="doc">
      <!-- 全局 -->
      <el-card class="page-card">
        <template #header>
          <span>{{ t("config.globalApp") }}</span>
          <el-tag
            v-if="!doc.global.gesturingEnabled"
            type="danger"
            class="header-tag"
          >
            {{ t("config.globalDisabled") }}
          </el-tag>
        </template>
        <el-table
          v-if="doc.global.intents.length > 0"
          :data="sortedIntents(doc.global.intents)"
          size="small"
        >
          <el-table-column :label="t('config.intentName')" prop="name" min-width="160" />
          <el-table-column :label="t('config.mnemonic')" min-width="140">
            <template #default="{ row }">
              <span class="mnemonic">{{ gestureMnemonic(row.gesture) }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('config.modifier')" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.gesture.modifier !== 'none'" size="small">
                {{ t(`modifier.${row.gesture.modifier}`) }}
              </el-tag>
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('config.commandType')" min-width="140">
            <template #default="{ row }">
              {{ t(`command.${row.command.type}`) }}
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else :description="t('config.noIntents')" :image-size="60" />
      </el-card>

      <!-- 各应用 -->
      <el-card v-for="app in sortedApps" :key="app.id" class="page-card">
        <template #header>
          <span>{{ app.name }}</span>
          <el-tag v-if="app.windows" size="small" class="header-tag">
            {{ t("platform.windows") }}: {{ app.windows.exeName }}
          </el-tag>
          <el-tag v-if="app.mac" size="small" class="header-tag">
            {{ t("platform.macos") }}: {{ app.mac.bundleId }}
          </el-tag>
          <el-tag
            v-if="!app.gesturingEnabled"
            type="danger"
            size="small"
            class="header-tag"
          >
            {{ t("config.appDisabled") }}
          </el-tag>
          <el-tag
            v-else-if="app.inheritGlobalGestures"
            type="info"
            size="small"
            class="header-tag"
          >
            {{ t("config.inheritGlobal") }}
          </el-tag>
        </template>
        <el-table
          v-if="app.intents.length > 0"
          :data="sortedIntents(app.intents)"
          size="small"
        >
          <el-table-column :label="t('config.intentName')" prop="name" min-width="160" />
          <el-table-column :label="t('config.mnemonic')" min-width="140">
            <template #default="{ row }">
              <span class="mnemonic">{{ gestureMnemonic(row.gesture) }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('config.modifier')" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.gesture.modifier !== 'none'" size="small">
                {{ t(`modifier.${row.gesture.modifier}`) }}
              </el-tag>
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('config.commandType')" min-width="140">
            <template #default="{ row }">
              {{ t(`command.${row.command.type}`) }}
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else :description="t('config.noIntents')" :image-size="60" />
      </el-card>

      <!-- 触发角 / 摩擦边 -->
      <el-row :gutter="16">
        <el-col :span="12">
          <el-card class="page-card">
            <template #header>
              <span>{{ t("config.hotCorners") }}</span>
              <el-tag
                :type="doc.hotCorners.enabled ? 'success' : 'info'"
                size="small"
                class="header-tag"
              >
                {{
                  doc.hotCorners.enabled
                    ? t("common.enabled")
                    : t("common.disabled")
                }}
              </el-tag>
            </template>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item
                v-for="corner in CORNERS"
                :key="corner"
                :label="t(`config.corner.${corner}`)"
              >
                {{ cornerCommandLabel(corner) }}
              </el-descriptions-item>
            </el-descriptions>
          </el-card>
        </el-col>
        <el-col :span="12">
          <el-card class="page-card">
            <template #header>
              <span>{{ t("config.rubEdges") }}</span>
              <el-tag
                :type="doc.rubEdges.enabled ? 'success' : 'info'"
                size="small"
                class="header-tag"
              >
                {{
                  doc.rubEdges.enabled
                    ? t("common.enabled")
                    : t("common.disabled")
                }}
              </el-tag>
            </template>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item
                v-for="edge in EDGES"
                :key="edge"
                :label="t(`config.edge.${edge}`)"
              >
                {{ edgeCommandLabel(edge) }}
              </el-descriptions-item>
            </el-descriptions>
          </el-card>
        </el-col>
      </el-row>

      <!-- 偏好设置摘要 -->
      <el-card class="page-card">
        <template #header>{{ t("config.preferences") }}</template>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item :label="t('config.prefTriggerButtons')">
            <el-tag
              v-for="b in doc.preferences.pathTracker.triggerButtons"
              :key="b"
              size="small"
              class="provider-tag"
            >
              {{ t(`trigger.${b}`) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item :label="t('config.pref8Directions')">
            {{ boolLabel(doc.preferences.pathTracker.enable8Directions) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('config.prefWindowsKey')">
            {{ boolLabel(doc.preferences.pathTracker.enableWindowsKeyGesturing) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('config.prefCursorWindow')">
            {{ boolLabel(doc.preferences.pathTracker.preferCursorWindow) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('config.prefDisableFullscreen')">
            {{ boolLabel(doc.preferences.pathTracker.disableInFullscreen) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('config.prefShowPath')">
            {{ boolLabel(doc.preferences.gestureView.showPath) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('config.prefShowCommandName')">
            {{ boolLabel(doc.preferences.gestureView.showCommandName) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('config.prefPauseHotkey')">
            {{
              [...doc.preferences.pauseHotkey.modifiers, doc.preferences.pauseHotkey.key]
                .join(" + ")
                .toUpperCase()
            }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('config.prefLocale')">
            {{
              doc.preferences.locale === "auto"
                ? t("config.prefLocaleAuto")
                : doc.preferences.locale
            }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('config.prefAutoUpdate')">
            {{ boolLabel(doc.preferences.autoCheckForUpdate) }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
h2 {
  margin-top: 0;
}

.header-tag {
  margin-left: 8px;
}

.provider-tag {
  margin-right: 6px;
}
</style>
