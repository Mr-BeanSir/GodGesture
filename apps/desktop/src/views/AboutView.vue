<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { BookOpen, Download, ExternalLink, RefreshCw } from "lucide-vue-next";
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppEmptyState,
  AppSkeleton,
  AppSpinner,
} from "@godgesture/ui";
import { useBackend } from "../api/backend";
import { useUpdateStore } from "../stores/update";

const DEFAULT_HOMEPAGE = "https://github.com/Mr-BeanSir/GodGesture";

const emit = defineEmits<{
  "open-quick-start": [];
}>();

const { t, locale } = useI18n();
const backend = useBackend();
const updates = useUpdateStore();
const version = ref("");
const checkingManually = ref(false);
const installing = ref(false);
const openingHomepage = ref(false);
const homepage =
  import.meta.env.VITE_GODGESTURE_REPOSITORY_URL?.trim() || DEFAULT_HOMEPAGE;

const publishedAt = computed(() => {
  if (!updates.metadata?.publishedAt) return null;
  const date = new Date(updates.metadata.publishedAt);
  return Number.isNaN(date.getTime())
    ? updates.metadata.publishedAt
    : new Intl.DateTimeFormat(locale.value, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
});

const isChecking = computed(
  () => checkingManually.value || updates.state === "checking",
);
const isInstalling = computed(
  () =>
    installing.value ||
    updates.state === "downloading" ||
    updates.state === "restarting",
);
const updateProgressText = computed(() =>
  t(
    updates.state === "restarting"
      ? "about.update.restarting"
      : "about.update.downloading",
  ),
);

onMounted(async () => {
  version.value = await backend.getAppVersion();
});

function errorText(code: string) {
  const key = `about.update.errors.${code}`;
  const translated = t(key);
  return translated === key ? t("about.update.errors.unknown") : translated;
}

async function checkForUpdates() {
  if (isChecking.value || isInstalling.value) return;
  checkingManually.value = true;
  try {
    await updates.check(false);
  } finally {
    checkingManually.value = false;
  }
}

async function installUpdate() {
  if (isInstalling.value || !updates.metadata) return;
  installing.value = true;
  try {
    await updates.install();
  } finally {
    installing.value = false;
  }
}

async function openHomepage() {
  if (openingHomepage.value) return;
  openingHomepage.value = true;
  try {
    await backend.openExternal(homepage);
  } finally {
    openingHomepage.value = false;
  }
}
</script>

<template>
  <div class="gg-page about-page">
    <header class="gg-page__header">
      <h2>{{ t("nav.about") }}</h2>
    </header>
    <div class="gg-page__scroll">
      <div class="about gg-page__stack">
        <section class="gg-section about__product">
          <div class="about__heading">
            <div>
              <h2 class="about__name">{{ t("app.name") }}</h2>
              <p class="about__version">{{ t("about.version", { version }) }}</p>
            </div>
            <div class="about__actions">
              <AppButton
                data-testid="about-quick-start"
                :aria-label="t('about.quickGuide')"
                :title="t('about.quickGuide')"
                @click="emit('open-quick-start')"
              >
                <BookOpen class="about__button-icon" aria-hidden="true" />
                {{ t("about.quickGuide") }}
              </AppButton>
              <AppButton
                data-testid="about-homepage"
                :aria-label="t('about.homepage')"
                :title="t('about.homepage')"
                :loading="openingHomepage"
                :loading-label="t('about.homepage')"
                @click="openHomepage"
              >
                <ExternalLink class="about__button-icon" aria-hidden="true" />
                {{ t("about.homepage") }}
              </AppButton>
            </div>
          </div>
          <p class="about__desc">{{ t("about.appDesc") }}</p>
        </section>

        <section class="gg-section about__update">
          <div class="about__heading">
            <div>
              <h3 class="gg-section-title">{{ t("about.update.title") }}</h3>
              <p class="gg-hint about__subtitle">{{ t("about.update.subtitle") }}</p>
            </div>
            <AppButton
              data-testid="about-check-update"
              :aria-label="t('about.checkUpdate')"
              :title="t('about.checkUpdate')"
              :loading="isChecking"
              :loading-label="t('about.checkUpdate')"
              :disabled="isInstalling"
              @click="checkForUpdates"
            >
              <RefreshCw class="about__button-icon" aria-hidden="true" />
              {{ t("about.checkUpdate") }}
            </AppButton>
          </div>

          <AppAlert
            v-if="updates.state === 'current'"
            variant="success"
            :title="t('about.update.current')"
          />
          <AppAlert
            v-else-if="updates.state === 'failed' && updates.errorCode"
            variant="error"
            :title="errorText(updates.errorCode)"
          />
          <div v-else-if="updates.state === 'checking'" class="about__checking">
            <AppSpinner
              data-testid="about-update-checking"
              aria-live="polite"
              :label="t('about.checkUpdate')"
            />
            <AppSkeleton :rows="2" />
          </div>
          <div v-else-if="updates.metadata" class="about__release">
            <div class="about__release-head">
              <div>
                <strong>{{ t("about.update.available", { version: updates.metadata.version }) }}</strong>
                <span v-if="publishedAt">{{ publishedAt }}</span>
              </div>
              <AppBadge variant="success">{{ t("about.update.signed") }}</AppBadge>
            </div>
            <p v-if="updates.metadata.notes" class="about__notes">{{ updates.metadata.notes }}</p>
            <p v-else class="gg-hint">{{ t("about.update.noNotes") }}</p>

            <div
              v-if="updates.state === 'downloading' || updates.state === 'restarting'"
              class="about__progress"
              role="status"
              aria-live="polite"
            >
              <div v-if="updates.progress !== null" class="about__progress-track">
                <progress
                  :class="[
                    'about__progress-bar',
                    { 'about__progress-bar--complete': updates.state === 'restarting' },
                  ]"
                  :value="updates.progress"
                  max="100"
                  role="progressbar"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-valuenow="updates.progress"
                  :aria-label="updateProgressText"
                />
                <span class="about__progress-value" aria-hidden="true">{{ updates.progress }}%</span>
              </div>
              <AppSpinner v-else size="sm" :label="updateProgressText" />
              <span class="gg-hint">{{ updateProgressText }}</span>
            </div>
            <AppAlert
              v-else-if="updates.state === 'ready'"
              variant="success"
              :title="t('about.update.ready')"
            />
            <AppButton
              v-else
              data-testid="about-install-update"
              variant="primary"
              :aria-label="t('about.update.install')"
              :title="t('about.update.install')"
              :loading="isInstalling"
              :loading-label="t('about.update.install')"
              @click="installUpdate"
            >
              <Download class="about__button-icon" aria-hidden="true" />
              {{ t("about.update.install") }}
            </AppButton>
          </div>
          <AppEmptyState v-else :title="t('about.update.idle')" />
        </section>

        <p class="about__credits">{{ t("about.credits") }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about {
  width: min(100%, 760px);
}

.about__heading,
.about__release-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.about__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.about__button-icon {
  width: 16px;
  height: 16px;
}

.about__name {
  margin: 0 0 4px;
  font-size: 20px;
}

.about__version,
.about__desc,
.about__credits {
  margin: 0;
}

.about__version,
.about__credits,
.about__release-head span {
  color: var(--gg-text-muted);
  font-size: 12px;
}

.about__desc {
  line-height: 1.6;
}

.about__subtitle {
  margin-top: 5px;
}

.about__checking,
.about__release {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.about__release-head {
  width: 100%;
}

.about__release-head > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.about__notes {
  max-height: 180px;
  margin: 0;
  overflow-y: auto;
  color: var(--gg-text);
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.about__progress {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 8px;
}

.about__progress-track {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.about__progress-bar {
  width: 100%;
  height: 8px;
  appearance: none;
  overflow: hidden;
  border: 1px solid var(--gg-border);
  border-radius: 4px;
  background: var(--gg-surface-muted);
  color: var(--gg-primary);
}

.about__progress-bar::-webkit-progress-bar {
  background: var(--gg-surface-muted);
}

.about__progress-bar::-webkit-progress-value {
  background: var(--gg-primary);
}

.about__progress-bar::-moz-progress-bar {
  background: var(--gg-primary);
}

.about__progress-bar--complete {
  color: var(--gg-success);
}

.about__progress-bar--complete::-webkit-progress-value,
.about__progress-bar--complete::-moz-progress-bar {
  background: var(--gg-success);
}

.about__progress-value {
  min-width: 3ch;
  color: var(--gg-text-muted);
  font-family: "Cascadia Mono", "SFMono-Regular", monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.about__credits {
  padding: 0 2px;
}

</style>
