import { createApp } from "vue";
import { createPinia } from "pinia";
import "@godgesture/ui/styles.css";
import "./desktop.css";
import App from "./App.vue";
import { i18n } from "./locales";
import { appLog, setLogLevel } from "./logging";
import { useBackend, setBackendDiagnosticWriter } from "./api/backend";
import {
  installRuntimeDiagnostics,
  setBackendDiagnosticLevel,
} from "./runtime-diagnostics";

const backend = useBackend();
void backend.logLevelGet().then(
  (level) => {
    setBackendDiagnosticLevel(level);
    setLogLevel(level);
  },
  () => {
    setBackendDiagnosticLevel("off");
    setLogLevel("off");
  },
);
setBackendDiagnosticWriter((level, target, message) => appLog[level](target, message));
installRuntimeDiagnostics(backend);

document.documentElement.classList.add("gg-desktop");

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.mount("#app");
