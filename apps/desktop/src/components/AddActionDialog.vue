<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Delete, MagicStick, Position } from "@element-plus/icons-vue";
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
import { cloneBoundarySequence } from "../utils/boundary-actions";

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
  <el-dialog
    v-model="visible"
    :title="t('actions.addTitle')"
    width="min(600px, calc(100vw - 24px))"
    class="add-action-dialog"
    align-center
    append-to-body
  >
    <div v-if="step === 1" class="action-choice">
      <button type="button" class="action-choice__item" :class="{ 'is-active': choice === 'gesture' }" @click="choice = 'gesture'">
        <el-icon><MagicStick /></el-icon>
        <span><strong>{{ t("actions.gestureTitle") }}</strong><small>{{ t("actions.gestureDescription") }}</small></span>
      </button>
      <button type="button" class="action-choice__item" :class="{ 'is-active': choice === 'boundary' }" @click="choice = 'boundary'">
        <el-icon><Position /></el-icon>
        <span><strong>{{ t("actions.boundaryTitle") }}</strong><small>{{ t("actions.boundaryDescription") }}</small></span>
      </button>
    </div>

    <div v-else class="boundary-builder">
      <div class="boundary-builder__origin">
        <div class="gg-field">
          <label class="gg-field-label">{{ t("actions.originType") }}</label>
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
        </div>
      </div>

      <div class="boundary-builder__sequence">
        <div class="boundary-builder__sequence-head">
          <div><strong>{{ t("actions.sequenceTitle") }}</strong><p class="gg-hint">{{ t("actions.sequenceHint") }}</p></div>
          <span class="gg-hint">{{ sequence.length }} / {{ MAX_BOUNDARY_SEQUENCE_TOKENS }}</span>
        </div>
        <div v-if="sequence.length" class="boundary-builder__tokens">
          <div v-for="(token, index) in sequence" :key="index" class="boundary-builder__token">
            <span>{{ index + 1 }}. {{ tokenLabel(token) }}</span>
            <el-button link type="danger" :icon="Delete" :aria-label="t('common.delete')" @click="sequence.splice(index, 1)" />
          </div>
        </div>
        <div v-else class="boundary-builder__immediate">{{ t("actions.immediateDescription") }}</div>
        <div class="boundary-builder__add">
          <el-select v-model="tokenKind" class="boundary-builder__kind">
            <el-option :label="t('actions.tokenKind.wheel')" value="wheel" />
            <el-option :label="t('actions.tokenKind.button')" value="button" />
            <el-option :label="t('actions.tokenKind.stroke')" value="stroke" />
          </el-select>
          <el-select v-if="tokenKind === 'wheel'" v-model="wheel">
            <el-option :label="t('actions.token.wheel.forward')" value="forward" />
            <el-option :label="t('actions.token.wheel.backward')" value="backward" />
          </el-select>
          <el-select v-else-if="tokenKind === 'button'" v-model="button">
            <el-option v-for="item in buttons" :key="item" :label="t(`actions.token.button.${item}`)" :value="item" />
          </el-select>
          <el-select v-else v-model="stroke">
            <el-option v-for="item in strokes" :key="item" :label="t(`actions.token.stroke.${item}`)" :value="item" />
          </el-select>
          <el-button :disabled="sequence.length >= MAX_BOUNDARY_SEQUENCE_TOKENS" @click="addToken">{{ t("actions.appendToken") }}</el-button>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button v-if="step === 2 && !initialBoundary" @click="step = 1">{{ t("common.back") }}</el-button>
      <el-button @click="visible = false">{{ t("common.cancel") }}</el-button>
      <el-button v-if="step === 1" type="primary" @click="next">{{ t("common.next") }}</el-button>
      <el-button v-else type="primary" @click="confirm">{{ t("common.ok") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.action-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.action-choice__item { display: grid; grid-template-columns: 32px 1fr; gap: 10px; min-height: 104px; padding: 16px; text-align: left; border: 1px solid var(--el-border-color); border-radius: 6px; background: var(--el-bg-color); color: var(--el-text-color-primary); cursor: pointer; }
.action-choice__item:hover, .action-choice__item.is-active { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.action-choice__item .el-icon { margin-top: 2px; font-size: 24px; color: var(--el-color-primary); }
.action-choice__item span { display: flex; flex-direction: column; gap: 7px; }
.action-choice__item small { color: var(--el-text-color-secondary); line-height: 1.5; }
.boundary-builder { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 18px; }
.boundary-builder__origin { min-width: 0; }
.boundary-builder__screen { position: relative; aspect-ratio: 16 / 10; border: 2px solid var(--el-border-color); border-radius: 6px; background: var(--el-fill-color-lighter); }
.boundary-builder__point { position: absolute; padding: 3px 6px; border: 1px solid var(--el-border-color); border-radius: 4px; background: var(--el-bg-color); color: var(--el-text-color-regular); font-size: 11px; cursor: pointer; }
.boundary-builder__point:hover, .boundary-builder__point:focus-visible { border-color: var(--el-color-primary); }
.boundary-builder__point.is-active { border-color: var(--el-color-primary); background: var(--el-color-primary); color: var(--el-color-white); }
.boundary-builder__point.is-leftTop { top: 7px; left: 7px; } .boundary-builder__point.is-rightTop { top: 7px; right: 7px; } .boundary-builder__point.is-leftBottom { bottom: 7px; left: 7px; } .boundary-builder__point.is-rightBottom { right: 7px; bottom: 7px; }
.boundary-builder__point.is-top { top: 7px; left: 50%; transform: translateX(-50%); } .boundary-builder__point.is-right { top: 50%; right: 7px; transform: translateY(-50%); } .boundary-builder__point.is-bottom { bottom: 7px; left: 50%; transform: translateX(-50%); } .boundary-builder__point.is-left { top: 50%; left: 7px; transform: translateY(-50%); }
.boundary-builder__sequence { min-width: 0; }
.boundary-builder__sequence-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.boundary-builder__sequence-head p { margin-top: 4px; }
.boundary-builder__tokens { display: flex; flex-direction: column; gap: 5px; max-height: 156px; overflow-y: auto; }
.boundary-builder__token { display: flex; align-items: center; justify-content: space-between; min-height: 30px; padding: 0 6px 0 9px; border: 1px solid var(--el-border-color-lighter); border-radius: 4px; font-size: 12px; }
.boundary-builder__immediate { padding: 12px; border: 1px dashed var(--el-border-color); border-radius: 4px; color: var(--el-text-color-secondary); font-size: 12px; }
.boundary-builder__add { display: grid; grid-template-columns: 94px minmax(110px, 1fr) auto; gap: 6px; margin-top: 10px; }
@media (max-width: 680px) { .action-choice, .boundary-builder { grid-template-columns: 1fr; } .boundary-builder__screen { max-width: 260px; } }
:global(.add-action-dialog) { display: flex; flex-direction: column; max-height: calc(100vh - 24px); }
:global(.add-action-dialog .el-dialog__body) { min-height: 0; overflow-y: auto; }
</style>
