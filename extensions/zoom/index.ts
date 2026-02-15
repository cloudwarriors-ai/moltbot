import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { zoomPlugin } from "./src/channel.js";
import { setZoomRuntime } from "./src/runtime.js";
import { registerZoomTools } from "./src/tools.js";

export { monitorZoomProvider } from "./src/monitor.js";

const plugin = {
  id: "zoom",
  name: "Zoom Team Chat",
  description: "Zoom Team Chat channel plugin (S2S OAuth)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setZoomRuntime(api.runtime);
    api.registerChannel({ plugin: zoomPlugin });
    registerZoomTools(api);
  },
};

export default plugin;
