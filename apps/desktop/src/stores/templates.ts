import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  ConfigDocument,
  TemplateAdoptionError,
  planGestureTemplateAdoption,
  type GestureTemplateCatalog,
  type GestureTemplateCatalogEntry,
  type GestureTemplatePackage,
  type TemplateAdoptionPlan,
  type TemplateConflictPolicy,
  officialOnlinePluginSource,
} from "@godgesture/shared";
import { newId } from "../utils/id";
import {
  TemplateSourceError,
  createGestureTemplateSource,
  type GestureTemplateSource,
} from "../templates/source";
import { useConfigStore } from "./config";
import { usePluginsStore } from "./plugins";

export type TemplateRiskFilter = "all" | "low" | "elevated";

function adoptionErrorCode(error: unknown) {
  const code = errorCode(error, "template_apply_failed");
  return code.startsWith("plugin_") || code === "rollback_incomplete"
    ? "template_plugin_install_failed"
    : code;
}

function errorCode(error: unknown, fallback: string) {
  if (
    error instanceof TemplateSourceError ||
    error instanceof TemplateAdoptionError
  ) {
    return error.code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return fallback;
}

export const useTemplatesStore = defineStore("templates", () => {
  const config = useConfigStore();
  const plugins = usePluginsStore();
  const source: GestureTemplateSource = createGestureTemplateSource(
    !config.backend.isTauri,
  );

  const catalog = ref<GestureTemplateCatalog | null>(null);
  const loadingCatalog = ref(false);
  const catalogError = ref<string | null>(null);
  const query = ref("");
  const riskFilter = ref<TemplateRiskFilter>("all");

  const selectedEntry = ref<GestureTemplateCatalogEntry | null>(null);
  const selectedPackage = ref<GestureTemplatePackage | null>(null);
  const loadingPackage = ref(false);
  const packageError = ref<string | null>(null);
  const conflictPolicy = ref<TemplateConflictPolicy>("keepExisting");
  const adoptionPlan = ref<TemplateAdoptionPlan | null>(null);
  const adoptionError = ref<string | null>(null);
  const adopting = ref(false);
  const adopted = ref(false);

  const packageCache = new Map<string, GestureTemplatePackage>();
  let catalogRequest: Promise<void> | null = null;
  let catalogRequestForced = false;
  let detailGeneration = 0;
  let expectedDocument: ConfigDocument | null = null;

  const entries = computed(() => catalog.value?.entries ?? []);
  const filteredEntries = computed(() => {
    const needle = query.value.trim().toLocaleLowerCase();
    return entries.value.filter((entry) => {
      const elevated = entry.risks.length > 0;
      if (riskFilter.value === "low" && elevated) return false;
      if (riskFilter.value === "elevated" && !elevated) return false;
      if (!needle) return true;
      return [
        entry.title,
        entry.summary,
        entry.author,
        ...entry.tags,
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  });

  async function loadCatalog(force = false) {
    if (catalogRequest) {
      const pending = catalogRequest;
      if (!force || catalogRequestForced) return pending;
      await pending;
      return loadCatalog(true);
    }
    if (catalog.value && !force) return;
    const request = (async () => {
      loadingCatalog.value = true;
      catalogError.value = null;
      try {
        catalog.value = await source.loadCatalog(force);
      } catch (error) {
        catalogError.value = errorCode(error, "template_catalog_failed");
      } finally {
        loadingCatalog.value = false;
      }
    })();
    catalogRequest = request;
    catalogRequestForced = force;
    const clearRequest = () => {
      if (catalogRequest === request) {
        catalogRequest = null;
        catalogRequestForced = false;
      }
    };
    void request.then(clearRequest, clearRequest);
    return request;
  }

  function buildPlan() {
    adoptionPlan.value = null;
    adoptionError.value = null;
    expectedDocument = null;
    if (!selectedPackage.value) return;
    if (!config.doc) {
      adoptionError.value = "template_config_not_ready";
      return;
    }
    try {
      expectedDocument = ConfigDocument.parse(
        JSON.parse(JSON.stringify(config.doc)) as unknown,
      );
      adoptionPlan.value = planGestureTemplateAdoption(
        expectedDocument,
        selectedPackage.value,
        {
          conflictPolicy: conflictPolicy.value,
          createId: newId,
          resolvePluginSource: (pluginId) => {
            const entry = plugins.onlineEntries.find((candidate) => candidate.pluginId === pluginId && !candidate.disabled);
            return entry ? officialOnlinePluginSource(entry) : null;
          },
        },
      );
    } catch (error) {
      adoptionError.value = errorCode(error, "template_plan_failed");
    }
  }

  async function openDetails(entry: GestureTemplateCatalogEntry) {
    const generation = ++detailGeneration;
    selectedEntry.value = entry;
    selectedPackage.value = null;
    packageError.value = null;
    adoptionError.value = null;
    adoptionPlan.value = null;
    adopted.value = false;
    loadingPackage.value = true;
    try {
      const key = `${entry.id}@${entry.versionNumber}`;
      const cached = packageCache.get(key);
      const templatePackage = cached ?? (await source.loadPackage(entry));
      if (!cached) packageCache.set(key, templatePackage);
      if (generation !== detailGeneration) return;
      selectedPackage.value = templatePackage;
      buildPlan();
    } catch (error) {
      if (generation === detailGeneration) {
        packageError.value = errorCode(error, "template_package_failed");
      }
    } finally {
      if (generation === detailGeneration) loadingPackage.value = false;
    }
  }

  function closeDetails() {
    detailGeneration += 1;
    selectedEntry.value = null;
    selectedPackage.value = null;
    loadingPackage.value = false;
    packageError.value = null;
    adoptionPlan.value = null;
    adoptionError.value = null;
    expectedDocument = null;
    adopted.value = false;
  }

  function setConflictPolicy(policy: TemplateConflictPolicy) {
    conflictPolicy.value = policy;
    buildPlan();
  }

  async function adopt() {
    const plan = adoptionPlan.value;
    const expected = expectedDocument;
    if (!plan || !expected || adopting.value) return false;
    adopting.value = true;
    adoptionError.value = null;
    try {
      for (const pluginSource of plan.pluginSources) {
        await config.backend.nodePluginInstall(pluginSource);
      }
      const applied = await config.applyTemplateDocument(
        plan.document,
        expected,
      );
      if (!applied) {
        adoptionError.value = "template_config_changed";
        return false;
      }
      adopted.value = true;
      return true;
    } catch (error) {
      adoptionError.value = adoptionErrorCode(error);
      return false;
    } finally {
      adopting.value = false;
    }
  }

  return {
    catalog,
    entries,
    filteredEntries,
    loadingCatalog,
    catalogError,
    query,
    riskFilter,
    selectedEntry,
    selectedPackage,
    loadingPackage,
    packageError,
    conflictPolicy,
    adoptionPlan,
    adoptionError,
    adopting,
    adopted,
    loadCatalog,
    openDetails,
    closeDetails,
    setConflictPolicy,
    buildPlan,
    adopt,
  };
});
