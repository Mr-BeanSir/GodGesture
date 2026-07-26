<script setup lang="ts">
/**
 * 「关于」区:版本、简介、项目主页、检查更新(占位)、致敬信息。
 */
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { useBackend } from "../api/backend";

const { t } = useI18n();
const backend = useBackend();

// 项目主页占位(正式仓库地址待定,分发走 GitHub Releases)
const HOMEPAGE = "https://github.com/godgesture/godgesture";

const version = ref("");
onMounted(async () => {
  version.value = await backend.getAppVersion();
});

function openHomepage() {
  void backend.openExternal(HOMEPAGE);
}
function checkUpdate() {
  ElMessage.info(t("about.checkUpdatePlaceholder"));
}
</script>

<template>
  <div class="about">
    <section class="gg-section about__card">
      <h2 class="about__name">{{ t("app.name") }}</h2>
      <p class="about__version">{{ t("about.version", { version }) }}</p>
      <p class="about__desc">{{ t("about.appDesc") }}</p>

      <div class="about__actions">
        <el-button @click="openHomepage">{{ t("about.homepage") }}</el-button>
        <el-button @click="checkUpdate">{{ t("about.checkUpdate") }}</el-button>
      </div>

      <el-divider />
      <p class="about__credits">{{ t("about.credits") }}</p>
    </section>
  </div>
</template>

<style scoped>
.about {
  max-width: 460px;
}
.about__name {
  margin: 0 0 4px;
}
.about__version {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
}
.about__desc {
  margin: 0 0 16px;
  line-height: 1.6;
}
.about__actions {
  display: flex;
  gap: 10px;
}
.about__credits {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
