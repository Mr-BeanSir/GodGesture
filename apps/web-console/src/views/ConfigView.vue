<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AppEntry,
  BoundaryIntent,
  BoundaryToken,
  ConfigDocument,
  GestureIntent,
} from "@godgesture/shared";
import { pullConfig } from "../api/sync";
import { gestureMnemonic } from "../utils/gesture";
import { errorMessageKey } from "../utils/errors";

const GLOBAL = "__global__";
const { t } = useI18n();

const loading = ref(true);
const errorKey = ref<string | null>(null);
const doc = ref<ConfigDocument | null>(null);
const selectedAppId = ref(GLOBAL);

type ActionRow =
  | { kind: "gesture"; id: string; name: string; enabled: boolean; order: number; intent: GestureIntent }
  | { kind: "boundary"; id: string; name: string; enabled: boolean; order: number; intent: BoundaryIntent };

const sortedApps = computed<AppEntry[]>(() =>
  doc.value ? [...doc.value.apps].sort((a, b) => a.order - b.order) : [],
);

const currentApp = computed<AppEntry | null>(() =>
  selectedAppId.value === GLOBAL
    ? null
    : sortedApps.value.find((app) => app.id === selectedAppId.value) ?? null,
);

const currentIsGlobal = computed(() => selectedAppId.value === GLOBAL);

const currentTitle = computed(() =>
  currentIsGlobal.value ? t("config.globalApp") : currentApp.value?.name ?? "",
);

const currentIntents = computed<GestureIntent[]>(() => {
  if (!doc.value) return [];
  return currentIsGlobal.value ? doc.value.global.intents : currentApp.value?.intents ?? [];
});

const selectedActions = computed<ActionRow[]>(() => {
  const gestures: ActionRow[] = currentIntents.value.map((intent) => ({
    kind: "gesture",
    id: intent.id,
    name: intent.name,
    enabled: intent.enabled,
    order: intent.order,
    intent,
  }));
  if (!currentIsGlobal.value || !doc.value) {
    return gestures.sort((a, b) => a.order - b.order);
  }
  const boundaries: ActionRow[] = doc.value.boundaryIntents.map((intent) => ({
    kind: "boundary",
    id: intent.id,
    name: intent.name,
    enabled: intent.enabled,
    order: intent.order,
    intent,
  }));
  return [...gestures, ...boundaries].sort((a, b) => a.order - b.order);
});

const actionCountLabel = computed(() =>
  t("config.actionCount", { count: selectedActions.value.length }),
);

function selectApp(id: string): void {
  selectedAppId.value = id;
}

function boolLabel(value: boolean): string {
  return value ? t("common.yes") : t("common.no");
}

function platformBindings(app: AppEntry): string[] {
  const bindings: string[] = [];
  if (app.windows?.exeName) bindings.push(`${t("platform.windows")}: ${app.windows.exeName}`);
  if (app.mac?.bundleId) bindings.push(`${t("platform.macos")}: ${app.mac.bundleId}`);
  return bindings;
}

function appInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function boundaryOriginLabel(intent: BoundaryIntent): string {
  return intent.origin.kind === "hotCorner"
    ? t(`config.corner.${intent.origin.corner}`)
    : t(`config.edge.${intent.origin.edge}`);
}

function boundaryTokenLabel(token: BoundaryToken): string {
  if (token.type === "wheel") return t(`config.token.wheel.${token.direction}`);
  if (token.type === "button") return t(`config.token.button.${token.button}`);
  return t(`config.token.stroke.${token.direction}`);
}

function boundaryMnemonic(intent: BoundaryIntent): string {
  const origin = t(
    intent.origin.kind === "hotCorner" ? "config.hotCornerOrigin" : "config.rubEdgeOrigin",
    { location: boundaryOriginLabel(intent) },
  );
  if (!intent.sequence.length) return `${origin} ${t("config.immediate")}`;
  return `${origin} ${t("config.sequenceArrow")} ${intent.sequence
    .map(boundaryTokenLabel)
    .join(" ")}`;
}

onMounted(async () => {
  try {
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
  <div class="config-view" v-loading="loading">
    <div class="config-heading">
      <div>
        <h2>{{ t("config.title") }}</h2>
        <p>{{ t("config.readOnlyHint") }}</p>
      </div>
      <el-tag v-if="doc" type="info" effect="plain">
        {{ t("config.actionCount", { count: doc.global.intents.length + doc.boundaryIntents.length + doc.apps.reduce((sum, app) => sum + app.intents.length, 0) }) }}
      </el-tag>
    </div>

    <el-alert
      v-if="errorKey"
      type="error"
      :title="t(errorKey)"
      :closable="false"
      class="config-alert"
    />
    <el-empty
      v-else-if="!loading && !doc"
      :description="t('config.empty')"
    />

    <template v-if="doc">
      <section class="config-preferences">
        <div class="config-preferences__head">
          <h4>{{ t("config.preferences") }}</h4>
          <span>{{ t("config.preferencesHint") }}</span>
        </div>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item :label="t('config.prefTriggerButtons')">
            <el-tag
              v-for="button in doc.preferences.pathTracker.triggerButtons"
              :key="button"
              size="small"
              class="provider-tag"
            >
              {{ t(`trigger.${button}`) }}
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
            {{ [...doc.preferences.pauseHotkey.modifiers, doc.preferences.pauseHotkey.key].join(" + ").toUpperCase() }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('config.prefLocale')">
            {{ doc.preferences.locale === "auto" ? t("config.prefLocaleAuto") : doc.preferences.locale }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('config.prefAutoUpdate')">
            {{ boolLabel(doc.preferences.autoCheckForUpdate) }}
          </el-descriptions-item>
        </el-descriptions>
      </section>

      <div class="config-workspace">
        <aside class="config-apps">
          <div class="config-apps__head">
            <span>{{ t("config.apps") }}</span>
            <span class="config-apps__count">{{ sortedApps.length + 1 }}</span>
          </div>
          <nav class="config-apps__list" :aria-label="t('config.apps')">
            <button
              type="button"
              class="config-app"
              :class="{ 'is-active': currentIsGlobal }"
              @click="selectApp(GLOBAL)"
            >
              <span class="config-app__avatar config-app__avatar--global">G</span>
              <span class="config-app__body">
                <span class="config-app__name">{{ t("config.globalApp") }}</span>
                <span class="config-app__meta">
                  {{ t("config.actionCount", { count: doc.global.intents.length + doc.boundaryIntents.length }) }}
                </span>
              </span>
              <el-tag v-if="!doc.global.gesturingEnabled" type="danger" size="small">
                {{ t("config.disabledShort") }}
              </el-tag>
            </button>

            <button
              v-for="app in sortedApps"
              :key="app.id"
              type="button"
              class="config-app"
              :class="{ 'is-active': app.id === selectedAppId }"
              @click="selectApp(app.id)"
            >
              <span class="config-app__avatar">{{ appInitials(app.name) }}</span>
              <span class="config-app__body">
                <span class="config-app__name">{{ app.name }}</span>
                <span class="config-app__meta">
                  {{ t("config.actionCount", { count: app.intents.length }) }}
                </span>
              </span>
              <el-tag v-if="!app.gesturingEnabled" type="danger" size="small">
                {{ t("config.disabledShort") }}
              </el-tag>
              <el-tag v-else-if="app.inheritGlobalGestures" type="info" size="small">
                {{ t("config.inheritShort") }}
              </el-tag>
            </button>
          </nav>
        </aside>

        <main class="config-main">
          <header class="config-main__head">
            <div class="config-main__title-row">
              <div>
                <h3>{{ currentTitle }}</h3>
                <div v-if="currentApp" class="config-bindings">
                  <span v-for="binding in platformBindings(currentApp)" :key="binding">
                    {{ binding }}
                  </span>
                  <span v-if="!platformBindings(currentApp).length">{{ t("config.noBinding") }}</span>
                </div>
                <div v-else class="config-bindings">
                  <span>{{ t("config.globalDescription") }}</span>
                </div>
              </div>
              <div class="config-statuses">
                <el-tag
                  :type="(currentIsGlobal ? doc.global.gesturingEnabled : currentApp?.gesturingEnabled) ? 'success' : 'danger'"
                  effect="plain"
                >
                  {{ (currentIsGlobal ? doc.global.gesturingEnabled : currentApp?.gesturingEnabled) ? t("common.enabled") : t("common.disabled") }}
                </el-tag>
                <el-tag v-if="currentApp?.inheritGlobalGestures" type="info" effect="plain">
                  {{ t("config.inheritGlobal") }}
                </el-tag>
                <template v-if="currentIsGlobal">
                  <el-tag :type="doc.hotCorners.enabled ? 'success' : 'info'" effect="plain">
                    {{ t("config.hotCornersStatus", { status: doc.hotCorners.enabled ? t("common.enabled") : t("common.disabled") }) }}
                  </el-tag>
                  <el-tag :type="doc.rubEdges.enabled ? 'success' : 'info'" effect="plain">
                    {{ t("config.rubEdgesStatus", { status: doc.rubEdges.enabled ? t("common.enabled") : t("common.disabled") }) }}
                  </el-tag>
                </template>
              </div>
            </div>
          </header>

          <section class="config-actions" :aria-label="t('config.actions')">
            <div class="config-actions__head">
              <div>
                <h4>{{ t("config.actions") }}</h4>
                <span>{{ actionCountLabel }}</span>
              </div>
            </div>
            <el-table
              v-if="selectedActions.length"
              :data="selectedActions"
              size="small"
              class="config-actions__table"
            >
              <el-table-column :label="t('config.actionKind')" width="100">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.kind === 'boundary' ? 'warning' : 'info'">
                    {{ t(row.kind === "boundary" ? "config.boundaryKind" : "config.gestureKind") }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="t('config.intentName')" prop="name" min-width="150" show-overflow-tooltip />
              <el-table-column :label="t('config.mnemonic')" min-width="180" show-overflow-tooltip>
                <template #default="{ row }">
                  <span v-if="row.kind === 'gesture'" class="mnemonic">{{ gestureMnemonic(row.intent.gesture) }}</span>
                  <span v-else class="boundary-mnemonic">{{ boundaryMnemonic(row.intent) }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('config.commandType')" min-width="140" show-overflow-tooltip>
                <template #default="{ row }">
                  {{ t(`command.${row.intent.command.type}`) }}
                </template>
              </el-table-column>
              <el-table-column :label="t('config.status')" width="90" align="right">
                <template #default="{ row }">
                  <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
                    {{ row.enabled ? t("common.enabled") : t("common.disabled") }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-else :description="t('config.noIntents')" :image-size="64" />
          </section>

        </main>
      </div>
    </template>
  </div>
</template>

<style scoped>
.config-view {
  min-height: 100%;
}

.config-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

h2,
h3,
h4,
p {
  margin-top: 0;
}

.config-heading h2 {
  margin-bottom: 4px;
}

.config-heading p {
  margin-bottom: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.config-alert {
  margin-bottom: 16px;
}

.config-workspace {
  display: grid;
  grid-template-columns: minmax(190px, 232px) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.config-apps,
.config-main,
.config-preferences {
  min-width: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
}

.config-preferences {
  width: 100%;
  margin-bottom: 14px;
  box-sizing: border-box;
}

.config-apps {
  position: sticky;
  top: 0;
  overflow: hidden;
}

.config-apps__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 0 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.config-apps__count {
  color: var(--el-text-color-placeholder);
  font-variant-numeric: tabular-nums;
}

.config-apps__list {
  display: grid;
  gap: 3px;
  padding: 6px;
}

.config-app {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 48px;
  padding: 6px 7px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
}

.config-app:hover {
  background: var(--el-fill-color-light);
}

.config-app.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.config-app__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  border-radius: 5px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 700;
}

.config-app__avatar--global {
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
}

.config-app__body {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 2px;
}

.config-app__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.config-app__meta {
  color: var(--el-text-color-placeholder);
  font-size: 11px;
}

.config-main {
  display: grid;
  gap: 0;
  overflow: hidden;
}

.config-main__head {
  padding: 16px 18px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.config-main__title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.config-main h3 {
  margin-bottom: 5px;
  font-size: 18px;
}

.config-bindings {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.config-statuses {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.config-actions,
.config-preferences {
  padding: 16px 18px;
}

.config-actions__head,
.config-preferences__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.config-actions__head h4,
.config-preferences__head h4 {
  margin-bottom: 0;
  font-size: 14px;
}

.config-actions__head span,
.config-preferences__head span {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}

.config-actions__table {
  width: 100%;
}

.boundary-mnemonic {
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.provider-tag {
  margin-right: 6px;
}

@media (max-width: 760px) {
  .config-workspace {
    grid-template-columns: 1fr;
  }

  .config-apps {
    position: static;
  }

  .config-apps__list {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .config-main__title-row {
    flex-direction: column;
  }

  .config-statuses {
    justify-content: flex-start;
  }
}

@media (max-width: 520px) {
  .config-heading {
    flex-direction: column;
  }

  .config-actions,
  .config-preferences,
  .config-main__head {
    padding-left: 12px;
    padding-right: 12px;
  }

  .config-actions__table :deep(.el-table__cell) {
    padding: 7px 0;
  }
}
</style>
