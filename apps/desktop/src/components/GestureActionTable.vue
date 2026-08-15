<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { AppBadge, AppEmptyState } from "@godgesture/ui";
import type { BoundaryIntent, Command, GestureSpec } from "@godgesture/shared";
import BoundaryMnemonic from "./BoundaryMnemonic.vue";
import MnemonicText from "./MnemonicText.vue";

export type GestureActionTableRow =
  | {
      kind: "gesture";
      key: string;
      name: string;
      gesture: GestureSpec;
      commandType: Command["type"];
      enabled?: boolean;
      conflict?: boolean;
    }
  | {
      kind: "boundary";
      key: string;
      name: string;
      boundary: BoundaryIntent;
      commandType: Command["type"];
      enabled?: boolean;
      conflict?: boolean;
    };

withDefaults(
  defineProps<{
    rows: readonly GestureActionTableRow[];
    selectedKey?: string | null;
    mode?: "editable" | "readonly";
    showToolbar?: boolean;
  }>(),
  { selectedKey: null, mode: "editable", showToolbar: true },
);

const emit = defineEmits<{
  select: [key: string];
  toggle: [key: string];
}>();

const { t } = useI18n();
const emptyTitle = computed(() => t("gestures.emptyIntents"));

function selectFromKey(row: GestureActionTableRow, event: KeyboardEvent): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  emit("select", row.key);
}
</script>

<template>
  <div class="gesture-action-table" :class="{ 'is-readonly': mode === 'readonly' }">
    <div v-if="showToolbar" class="gesture-action-table__toolbar">
      <slot name="toolbar">
        <span class="gesture-action-table__count">{{ rows.length }}</span>
      </slot>
    </div>
    <div class="gesture-action-table__body">
      <div v-if="rows.length" class="gesture-action-table__scroll gestures__table-scroll">
        <table class="gg-table gesture-action-table__table gestures__table">
          <thead>
            <tr>
              <th scope="col">{{ t("gestures.colKind") }}</th>
              <th scope="col">{{ t("gestures.colName") }}</th>
              <th scope="col">{{ t("gestures.colMnemonic") }}</th>
              <th scope="col">{{ t("gestures.colCommand") }}</th>
              <th scope="col"><span class="gg-sr-only">{{ t("gestures.colStatus") }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.key"
              :data-action-key="row.key"
              :class="{
                'is-selected': row.key === selectedKey,
                'is-disabled': mode === 'editable' && row.enabled === false,
                'is-conflict': mode === 'readonly' && row.conflict,
              }"
              :aria-selected="row.key === selectedKey"
              tabindex="0"
              @click="emit('select', row.key)"
              @keydown="selectFromKey(row, $event)"
            >
              <td class="gesture-action-table__cell-kind gestures__cell-kind">
                <AppBadge :variant="row.kind === 'boundary' ? 'warning' : 'info'">
                  {{ t(row.kind === "boundary" ? "gestures.boundaryKind" : "gestures.gestureKind") }}
                </AppBadge>
              </td>
              <td class="gesture-action-table__cell-name gestures__cell-name">{{ row.name }}</td>
              <td class="gesture-action-table__cell-mnemonic gestures__cell-mnemonic">
                <MnemonicText v-if="row.kind === 'gesture'" :gesture="row.gesture" />
                <BoundaryMnemonic v-else :intent="row.boundary" />
              </td>
              <td class="gesture-action-table__cell-command gestures__cell-command">{{ t(`command.types.${row.commandType}`) }}</td>
              <td class="gesture-action-table__cell-status gestures__cell-toggle">
                <button
                  v-if="mode === 'editable'"
                  type="button"
                  class="gg-icon-button gesture-action-table__status-button gestures__icon-action"
                  :class="{ 'is-enabled': row.enabled !== false, 'is-disabled': row.enabled === false }"
                  :aria-pressed="row.enabled !== false"
                  :aria-label="t(row.enabled !== false ? 'gestures.disableAction' : 'gestures.enableAction')"
                  :title="t(row.enabled !== false ? 'gestures.disableAction' : 'gestures.enableAction')"
                  @click.stop="emit('toggle', row.key)"
                >
                  <span class="gesture-action-table__status-dot gestures__status-dot" aria-hidden="true" />
                </button>
                <AppBadge v-else :variant="row.conflict ? 'warning' : 'success'">
                  {{ t(row.conflict ? "templates.detail.conflict" : "templates.detail.noConflict") }}
                </AppBadge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <AppEmptyState v-else :title="emptyTitle" />
    </div>
  </div>
</template>

<style scoped>
.gesture-action-table {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: 40px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  background: var(--gg-surface);
}

.gesture-action-table.is-readonly {
  grid-template-rows: minmax(0, 1fr);
}

.gesture-action-table__toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  padding: 0 10px;
  border-bottom: 1px solid var(--gg-border);
}

.gesture-action-table__count {
  color: var(--gg-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.gesture-action-table__body {
  min-height: 0;
  overflow: hidden;
}

.gesture-action-table__scroll {
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.gesture-action-table__table {
  width: 100%;
  min-width: 0;
  table-layout: fixed;
}

.gesture-action-table__table th,
.gesture-action-table__table td {
  padding: 2px 8px;
  line-height: 1.2;
}

.gesture-action-table__table th:nth-child(1),
.gesture-action-table__table td:nth-child(1) { width: 59px; }
.gesture-action-table__table th:nth-child(2),
.gesture-action-table__table td:nth-child(2) { width: 23%; }
.gesture-action-table__table th:nth-child(3),
.gesture-action-table__table td:nth-child(3) { width: 28%; }
.gesture-action-table__table th:nth-child(4),
.gesture-action-table__table td:nth-child(4) { width: auto; }
.gesture-action-table__table th:nth-child(5),
.gesture-action-table__table td:nth-child(5) { width: 44px; }
.gesture-action-table__table tbody tr { cursor: pointer; }
.gesture-action-table__table tbody tr.is-selected { background: var(--gg-primary-soft); }
.gesture-action-table__table tbody tr.is-disabled { color: var(--gg-text-muted); }
.gesture-action-table__table tbody tr.is-conflict td { color: var(--gg-warning); }
.gesture-action-table__table tbody tr:focus-visible { outline: 2px solid var(--gg-ring); outline-offset: -2px; }

.gesture-action-table__cell-kind,
.gesture-action-table__cell-mnemonic,
.gesture-action-table__cell-name,
.gesture-action-table__cell-command {
  min-width: 0;
  max-width: 230px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gesture-action-table__cell-kind :deep(.gg-badge) { white-space: nowrap; }
.gesture-action-table__cell-mnemonic :deep(.mnemonic),
.gesture-action-table__cell-mnemonic :deep(.boundary-mnemonic) {
  max-width: 100%;
  flex-wrap: nowrap;
  overflow: hidden;
}
.gesture-action-table__cell-status { width: 44px; text-align: right; }
.gesture-action-table.is-readonly .gesture-action-table__table th:nth-child(5),
.gesture-action-table.is-readonly .gesture-action-table__table td:nth-child(5) { width: 62px; }
.gesture-action-table__cell-status :deep(.gg-badge) { white-space: nowrap; }
.gesture-action-table__status-button {
  min-width: 36px;
  min-height: 36px;
  margin-left: 0;
  color: var(--gg-text-subtle);
}
.gesture-action-table__status-button.is-enabled { color: #38b567; }
.gesture-action-table__status-button.is-disabled { color: var(--gg-danger); }
.gesture-action-table__status-button:hover:not(:disabled) { background: transparent; }
.gesture-action-table__status-dot {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 18%, transparent), 0 0 8px color-mix(in srgb, currentColor 68%, transparent);
  transition: background-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
}
.gesture-action-table__status-button:hover:not(:disabled) .gesture-action-table__status-dot { transform: scale(1.12); }

@media (prefers-reduced-motion: reduce) {
  .gesture-action-table__status-dot { transition: none; }
}
</style>
