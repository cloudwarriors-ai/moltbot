import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { registerTools } from "./src/tools.js";

const plugin = {
  id: "devtools",
  name: "DevTools API",
  description: "Docker container management and codebase file browsing via devtools-api",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    registerTools(api);
  },
};

export default plugin;
