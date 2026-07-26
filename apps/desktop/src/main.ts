import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import App from "./App.vue";
import { i18n } from "./locales";

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.use(ElementPlus);
app.mount("#app");
