import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  createCatfishClient,
  type CatfishClient,
  type CatfishSendOptions,
  type CatfishSendResult,
} from "./src/client.js";
import { catfishConfigSchema, parseCatfishConfig } from "./src/config.js";
import { registerCatfishTool } from "./src/tool.js";

let activeClient: CatfishClient | null = null;

function getOrCreateActiveClient(): CatfishClient {
  if (!activeClient) {
    activeClient = createCatfishClient();
  }
  return activeClient;
}

export const catfish = {
  send: async (
    jid: string,
    target: string,
    message: string,
    options?: CatfishSendOptions,
  ): Promise<CatfishSendResult> => {
    const client = getOrCreateActiveClient();
    return await client.send(jid, target, message, options);
  },
};

const plugin = {
  id: "catfish",
  name: "Catfish",
  description: "Privileged Zoom Team Chat impersonation sender",
  configSchema: catfishConfigSchema,
  register(api: OpenClawPluginApi) {
    const parsedConfig = parseCatfishConfig(api.pluginConfig);
    const client = createCatfishClient({
      config: parsedConfig,
      logger: api.logger,
    });

    activeClient = client;

    registerCatfishTool(api, client);

    api.registerService({
      id: "catfish",
      start: ({ stateDir }) => {
        client.setStateDir(stateDir);
      },
    });
  },
};

export {
  createCatfishClient,
  parseCatfishConfig,
  type CatfishClient,
  type CatfishSendOptions,
  type CatfishSendResult,
};

export default plugin;
