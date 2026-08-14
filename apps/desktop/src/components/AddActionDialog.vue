<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { AppButton, AppDialog } from "@godgesture/ui";
import { Delete, GripVertical, MousePointer2, ScanLine } from "lucide-vue-next";
import {
  MAX_BOUNDARY_SEQUENCE_TOKENS,
  type BoundaryIntent,
  type BoundaryMouseButton,
  type BoundaryOrigin,
  type BoundaryToken,
  type ScreenCorner,
  type ScreenEdge,
  type StrokeDirection,
} from "@godgesture/shared";
import { cloneBoundarySequence, reorderBoundarySequence } from "../utils/boundary-actions";

type ActionChoice = "gesture" | "boundary";
type TokenKind = BoundaryToken["type"];

const props = defineProps<{
  modelValue: boolean;
  initialBoundary?: BoundaryIntent | null;
}>();
const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
  (event: "recordGesture"): void;
  (event: "confirmBoundary", value: { origin: BoundaryOrigin; sequence: BoundaryToken[] }): void;
}>();

const { t } = useI18n();
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});
const step = ref<1 | 2>(1);
const choice = ref<ActionChoice>("gesture");
const originKind = ref<BoundaryOrigin["kind"]>("hotCorner");
const corner = ref<ScreenCorner>("leftTop");
const edge = ref<ScreenEdge>("top");
const sequence = ref<BoundaryToken[]>([]);
const tokenKind = ref<TokenKind>("wheel");
const wheel = ref<"forward" | "backward">("forward");
const button = ref<BoundaryMouseButton>("right");
const stroke = ref<StrokeDirection>("right");
const draggingIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

const corners: ScreenCorner[] = ["leftTop", "rightTop", "leftBottom", "rightBottom"];
const edges: ScreenEdge[] = ["top", "right", "bottom", "left"];
const buttons: BoundaryMouseButton[] = ["left", "middle", "right", "x1", "x2"];
const strokes: StrokeDirection[] = [
  "up", "rightUp", "right", "rightDown", "down", "leftDown", "left", "leftUp",
];

function reset() {
  const initial = props.initialBoundary;
  step.value = initial ? 2 : 1;
  choice.value = initial ? "boundary" : "gesture";
  sequence.value = initial ? cloneBoundarySequence(initial.sequence) : [];
  if (initial?.origin.kind === "hotCorner") {
    originKind.value = "hotCorner";
    corner.value = initial.origin.corner;
  } else if (initial?.origin.kind === "rubEdge") {
    originKind.value = "rubEdge";
    edge.value = initial.origin.edge;
  } else {
    originKind.value = "hotCorner";
    corner.value = "leftTop";
  }
}

watch(() => props.modelValue, (open) => {
  if (open) reset();
});

function next() {
  if (choice.value === "gesture") {
    visible.value = false;
    emit("recordGesture");
  } else {
    step.value = 2;
  }
}

function addToken() {
  if (sequence.value.length >= MAX_BOUNDARY_SEQUENCE_TOKENS) return;
  if (tokenKind.value === "wheel") {
    sequence.value.push({ type: "wheel", direction: wheel.value });
  } else if (tokenKind.value === "button") {
    sequence.value.push({ type: "button", button: button.value });
  } else {
    sequence.value.push({ type: "stroke", direction: stroke.value });
  }
}

function onDragStart(event: DragEvent, index: number) {
  draggingIndex.value = index;
  dragOverIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }
}
function onDragOver(event: DragEvent, index: number) {
  event.preventDefault();
  dragOverIndex.value = index;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}
function onDrop(event: DragEvent, index: number) {
  event.preventDefault();
  if (draggingIndex.value !== null) {
    sequence.value = reorderBoundarySequence(sequence.value, draggingIndex.value, index);
  }
  onDragEnd();
}
function onDragEnd() {
  draggingIndex.value = null;
  dragOverIndex.value = null;
}

function onSequenceKeydown(event: KeyboardEvent, index: number) {
  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
  const target = event.key === "ArrowUp" ? index - 1 : index + 1;
  if (target < 0 || target >= sequence.value.length) return;
  event.preventDefault();
  sequence.value = reorderBoundarySequence(sequence.value, index, target);
}

function confirm() {
  const origin: BoundaryOrigin = originKind.value === "hotCorner"
    ? { kind: "hotCorner", corner: corner.value }
    : { kind: "rubEdge", edge: edge.value };
  emit("confirmBoundary", { origin, sequence: cloneBoundarySequence(sequence.value) });
}

function tokenLabel(token: BoundaryToken): string {
  if (token.type === "wheel") return t(`actions.token.wheel.${token.direction}`);
  if (token.type === "button") return t(`actions.token.button.${token.button}`);
  return t(`actions.token.stroke.${token.direction}`);
}
</script>

<template>
  <AppDialog
    :open="visible"
    :title="t('actions.addTitle')"
    :close-label="t('common.cancel')"
    class="add-action-dialog"
    @close="visible = false"
  >
    <div v-if="step === 1" class="action-choice">
      <button
        type="button"
        class="action-choice__item"
        :class="{ 'is-active': choice === 'gesture' }"
        :aria-label="t('actions.gestureTitle')"
        :aria-pressed="choice === 'gesture'"
        @click="choice = 'gesture'"
      >
        <ScanLine aria-hidden="true" />
        <span><strong>{{ t("actions.gestureTitle") }}</strong><small>{{ t("actions.gestureDescription") }}</small></span>
      </button>
      <button
        type="button"
        class="action-choice__item"
        :class="{ 'is-active': choice === 'boundary' }"
        :aria-label="t('actions.boundaryTitle')"
        :aria-pressed="choice === 'boundary'"
        @click="choice = 'boundary'"
      >
        <MousePointer2 aria-hidden="true" />
        <span><strong>{{ t("actions.boundaryTitle") }}</strong><small>{{ t("actions.boundaryDescription") }}</small></span>
      </button>
    </div>

    <div v-else class="boundary-builder">
      <div class="boundary-builder__origin">
        <fieldset class="gg-field boundary-builder__origin-field">
          <legend class="gg-field-label">{{ t("actions.originType") }}</legend>
          <div class="boundary-builder__screen">
            <button
              v-for="item in corners"
              :key="`corner-${item}`"
              type="button"
              class="boundary-builder__point"
              :class="[`is-${item}`, { 'is-active': originKind === 'hotCorner' && corner === item }]"
              :aria-pressed="originKind === 'hotCorner' && corner === item"
              @click="originKind = 'hotCorner'; corner = item"
            >
              {{ t(`corners.corner.${item}`) }}
            </button>
            <button
              v-for="item in edges"
              :key="`edge-${item}`"
              type="button"
              class="boundary-builder__point"
              :class="[`is-${item}`, { 'is-active': originKind === 'rubEdge' && edge === item }]"
              :aria-pressed="originKind === 'rubEdge' && edge === item"
              @click="originKind = 'rubEdge'; edge = item"
            >
              {{ t(`corners.edge.${item}`) }}
            </button>
          </div>
        </fieldset>
      </div>

      <div class="boundary-builder__sequence">
        <div class="boundary-builder__sequence-head">
          <div><strong>{{ t("actions.sequenceTitle") }}</strong><p class="gg-hint">{{ t("actions.sequenceHint") }}</p></div>
          <span class="gg-hint">{{ sequence.length }} / {{ MAX_BOUNDARY_SEQUENCE_TOKENS }}</span>
        </div>
        <ol v-if="sequence.length" class="boundary-builder__tokens">
          <li
            v-for="(token, index) in sequence"
            :key="index"
            class="boundary-builder__token"
            :class="{ 'is-dragging': draggingIndex === index, 'is-drag-over': dragOverIndex === index && draggingIndex !== index }"
            tabindex="0"
            :aria-keyshortcuts="'Alt+ArrowUp Alt+ArrowDown'"
            draggable="true"
            @dragstart="onDragStart($event, index)"
            @dragover="onDragOver($event, index)"
            @drop="onDrop($event, index)"
            @dragend="onDragEnd"
            @keydown="onSequenceKeydown($event, index)"
          >
            <span class="boundary-builder__token-main">
              <GripVertical class="boundary-builder__drag-handle" aria-hidden="true" />
              <span>{{ index + 1 }}. {{ tokenLabel(token) }}</span>
            </span>
            <button
              type="button"
              class="gg-icon-button boundary-builder__delete"
              :aria-label="t('common.delete')"
              :title="t('common.delete')"
              @click="sequence.splice(index, 1)"
            >
              <Delete aria-hidden="true" />
            </button>
          </li>
        </ol>
        <div v-else class="boundary-builder__immediate">{{ t("actions.immediateDescription") }}</div>
        <div class="boundary-builder__add">
          <select v-model="tokenKind" class="gg-select boundary-builder__kind" :aria-label="t(`actions.tokenKind.${tokenKind}`)">
            <option value="wheel">{{ t("actions.tokenKind.wheel") }}</option>
            <option value="button">{{ t("actions.tokenKind.button") }}</option>
            <option value="stroke">{{ t("actions.tokenKind.stroke") }}</option>
          </select>
          <select v-if="tokenKind === 'wheel'" v-model="wheel" class="gg-select" :aria-label="t(`actions.token.wheel.${wheel}`)">
            <option value="forward">{{ t("actions.token.wheel.forward") }}</option>
            <option value="backward">{{ t("actions.token.wheel.backward") }}</option>
          </select>
          <select v-else-if="tokenKind === 'button'" v-model="button" class="gg-select" :aria-label="t(`actions.token.button.${button}`)">
            <option v-for="item in buttons" :key="item" :value="item">{{ t(`actions.token.button.${item}`) }}</option>
          </select>
          <select v-else v-model="stroke" class="gg-select" :aria-label="t(`actions.token.stroke.${stroke}`)">
            <option v-for="item in strokes" :key="item" :value="item">{{ t(`actions.token.stroke.${item}`) }}</option>
          </select>
          <AppButton :disabled="sequence.length >= MAX_BOUNDARY_SEQUENCE_TOKENS" :aria-label="t('actions.appendToken')" @click="addToken">{{ t("actions.appendToken") }}</AppButton>
        </div>
      </div>
    </div>

    <template #footer>
      <AppButton v-if="step === 2 && !initialBoundary" @click="step = 1">{{ t("common.back") }}</AppButton>
      <AppButton @click="visible = false">{{ t("common.cancel") }}</AppButton>
      <AppButton v-if="step === 1" variant="primary" :aria-label="t('common.next')" @click="next">{{ t("common.next") }}</AppButton>
      <AppButton v-else variant="primary" :aria-label="t('common.ok')" @click="confirm">{{ t("common.ok") }}</AppButton>
    </template>
  </AppDialog>
</template>

<style scoped>
.action-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.action-choice__item { display: grid; grid-template-columns: 32px 1fr; gap: 10px; min-height: 104px; padding: 16px; text-align: left; border: 1px solid var(--gg-border); border-radius: 6px; background: var(--gg-surface); color: var(--gg-text); cursor: pointer; }
.action-choice__item:hover, .action-choice__item.is-active { border-color: var(--gg-primary); background: var(--gg-primary-soft); }
.action-choice__item > svg { width: 24px; height: 24px; margin-top: 2px; color: var(--gg-primary); }
.action-choice__item span { display: flex; flex-direction: column; gap: 7px; }
.action-choice__item small { color: var(--gg-text-muted); line-height: 1.5; }
.boundary-builder { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 18px; }
.boundary-builder__origin { min-width: 0; }
.boundary-builder__origin-field { min-width: 0; margin: 0; padding: 0; border: 0; }
.boundary-builder__screen { position: relative; aspect-ratio: 16 / 10; border: 2px solid var(--gg-border); border-radius: 6px; background: var(--gg-surface-muted); }
.boundary-builder__point { position: absolute; padding: 3px 6px; border: 1px solid var(--gg-border); border-radius: 4px; background: var(--gg-surface); color: var(--gg-text); font-size: 11px; cursor: pointer; }
.boundary-builder__point:hover, .boundary-builder__point:focus-visible { border-color: var(--gg-primary); }
.boundary-builder__point.is-active { border-color: var(--gg-primary); background: var(--gg-primary); color: var(--gg-on-primary); }
.boundary-builder__point.is-leftTop { top: 7px; left: 7px; } .boundary-builder__point.is-rightTop { top: 7px; right: 7px; } .boundary-builder__point.is-leftBottom { bottom: 7px; left: 7px; } .boundary-builder__point.is-rightBottom { right: 7px; bottom: 7px; }
.boundary-builder__point.is-top { top: 7px; left: 50%; transform: translateX(-50%); } .boundary-builder__point.is-right { top: 50%; right: 7px; transform: translateY(-50%); } .boundary-builder__point.is-bottom { bottom: 7px; left: 50%; transform: translateX(-50%); } .boundary-builder__point.is-left { top: 50%; left: 7px; transform: translateY(-50%); }
.boundary-builder__sequence { min-width: 0; }
.boundary-builder__sequence-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.boundary-builder__sequence-head p { margin-top: 4px; }
.boundary-builder__tokens { display: flex; flex-direction: column; gap: 5px; max-height: 156px; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.boundary-builder__token { display: flex; align-items: center; justify-content: space-between; min-height: 36px; padding: 0 6px 0 9px; border: 1px solid var(--gg-border); border-radius: 4px; font-size: 12px; }
.boundary-builder__token.is-dragging { opacity: .45; }
.boundary-builder__token.is-drag-over { border-color: var(--gg-primary); background: var(--gg-primary-soft); }
.boundary-builder__token-main { display: inline-flex; align-items: center; min-width: 0; gap: 7px; }
.boundary-builder__drag-handle { width: 16px; color: var(--gg-text-subtle); cursor: grab; }
.boundary-builder__drag-handle:active { cursor: grabbing; }
.boundary-builder__delete { width: 32px; height: 32px; }
.boundary-builder__delete > svg { width: 16px; height: 16px; }
.boundary-builder__immediate { padding: 12px; border: 1px dashed var(--gg-border); border-radius: 4px; color: var(--gg-text-muted); font-size: 12px; }
.boundary-builder__add { display: grid; grid-template-columns: 94px minmax(110px, 1fr) auto; gap: 6px; margin-top: 10px; }
:global(.add-action-dialog) { width: min(600px, calc(100vw - 24px)); max-height: calc(100vh - 24px); }
:global(.add-action-dialog .gg-dialog__body) { min-height: 0; overflow-y: auto; }
</style>
