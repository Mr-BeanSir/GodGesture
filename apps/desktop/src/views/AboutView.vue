<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Download, Link, Refresh } from "@element-plus/icons-vue";
import { useBackend } from "../api/backend";
import { useUpdateStore } from "../stores/update";

const DEFAULT_HOMEPAGE = "https://github.com/Mr-BeanSir/GodGesture";

const { t, locale } = useI18n();
const backend = useBackend();
const updates = useUpdateStore();
const version = ref("");
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

onMounted(async () => {
  version.value = await backend.getAppVersion();
});

function errorText(code: string) {
  const key = `about.update.errors.${code}`;
  const translated = t(key);
  return translated === key ? t("about.update.errors.unknown") : translated;
}
</script>

<template>
  <div class="about">
    <section class="gg-section about__product">
      <div class="about__heading">
        <div>
          <h2 class="about__name">{{ t("app.name") }}</h2>
          <p class="about__version">{{ t("about.version", { version }) }}</p>
        </div>
        <el-button :icon="Link" @click="backend.openExternal(homepage)">
          {{ t("about.homepage") }}
        </el-button>
      </div>
      <p class="about__desc">{{ t("about.appDesc") }}</p>
    </section>

    <section class="gg-section about__update">
      <div class="about__heading">
        <div>
          <h3 class="gg-section-title">{{ t("about.update.title") }}</h3>
          <p class="gg-hint about__subtitle">{{ t("about.update.subtitle") }}</p>
        </div>
        <el-button
          :icon="Refresh"
          :loading="updates.state === 'checking'"
          :disabled="updates.state === 'downloading' || updates.state === 'restarting'"
          @click="updates.check(false)"
        >
          {{ t("about.checkUpdate") }}
        </el-button>
      </div>

      <el-alert
        v-if="updates.state === 'current'"
        type="success"
        show-icon
        :closable="false"
        :title="t('about.update.current')"
      />
      <el-alert
        v-else-if="updates.state === 'failed' && updates.errorCode"
        type="error"
        show-icon
        :closable="false"
        :title="errorText(updates.errorCode)"
      />
      <el-skeleton v-else-if="updates.state === 'checking'" :rows="2" animated />
      <div v-else-if="updates.metadata" class="about__release">
        <div class="about__release-head">
          <div>
            <strong>{{ t("about.update.available", { version: updates.metadata.version }) }}</strong>
            <span v-if="publishedAt">{{ publishedAt }}</span>
          </div>
          <el-tag type="success" disable-transitions>{{ t("about.update.signed") }}</el-tag>
        </div>
        <p v-if="updates.metadata.notes" class="about__notes">{{ updates.metadata.notes }}</p>
        <p v-else class="gg-hint">{{ t("about.update.noNotes") }}</p>

        <div v-if="updates.state === 'downloading' || updates.state === 'restarting'" class="about__progress">
          <el-progress
            v-if="updates.progress !== null"
            :percentage="updates.progress"
            :status="updates.state === 'restarting' ? 'success' : undefined"
          />
          <el-progress v-else :percentage="100" :indeterminate="true" :duration="1.5" />
          <span class="gg-hint">
            {{ t(updates.state === "restarting" ? "about.update.restarting" : "about.update.downloading") }}
          </span>
        </div>
        <el-alert
          v-else-if="updates.state === 'ready'"
          type="success"
          show-icon
          :closable="false"
          :title="t('about.update.ready')"
        />
        <el-button
          v-else
          type="primary"
          :icon="Download"
          @click="updates.install()"
        >
          {{ t("about.update.install") }}
        </el-button>
      </div>
      <el-empty v-else :image-size="54" :description="t('about.update.idle')" />
    </section>

    <p class="about__credits">{{ t("about.credits") }}</p>
  </div>
</template>

<style scoped>
.about {
  width: min(100%, 680px);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.about__heading,
.about__release-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.about__desc {
  line-height: 1.6;
}
.about__subtitle {
  margin-top: 5px;
}
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
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.55;
}
.about__progress {
  width: 100%;
}
.about__credits {
  padding: 0 2px;
}
@media (max-width: 600px) {
  .about__heading {
    align-items: stretch;
    flex-direction: column;
  }
  .about__heading > .el-button {
    align-self: flex-start;
  }
}
</style>
