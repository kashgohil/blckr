import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-vue"],
  manifest: {
    name: "Blckr",
    version: "1.0.0",
    description: "Block distractions and focus on what matters most.",
    permissions: ["storage", "tabs", "webNavigation", "alarms"],
    host_permissions: ["<all_urls>"],
    web_accessible_resources: [
      {
        resources: ["blocked.html"],
        matches: ["<all_urls>"],
      },
    ],
    action: {
      default_title: "Blckr - Block distractions",
    },
  },
  manifestVersion: 3,
});
