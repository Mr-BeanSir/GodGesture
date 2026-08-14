import { createApp } from "vue";
import { createPinia } from "pinia";
import "@godgesture/ui/styles.css";
import "./desktop.css";
import App from "./App.vue";
import { i18n } from "./locales";

document.documentElement.classList.add("gg-desktop");

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.mount("#app");
