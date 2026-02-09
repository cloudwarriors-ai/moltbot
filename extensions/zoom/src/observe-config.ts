/**
 * File-based config store for channel observe mode settings.
 * Allows dynamic configuration via slash commands in Zoom channels.
 */

import { resolveZoomStorePath } from "./storage.js";
import { readJsonFile, withFileLock, writeJsonFile } from "./store-fs.js";

type ObserveConfigData = {
  version: 1;
  /** Global review channel JID — where approval cards are posted */
  reviewChannelJid?: string;
  reviewChannelName?: string;
  /** Map of channel JID → observe mode enabled */
  observedChannels: Record<string, { enabled: boolean; channelName?: string }>;
};

const STORE_FILENAME = "zoom-observe-config.json";

const empty: ObserveConfigData = { version: 1, observedChannels: {} };

function resolveFilePath(): string {
  return resolveZoomStorePath({ filename: STORE_FILENAME });
}

async function readConfig(): Promise<ObserveConfigData> {
  const filePath = resolveFilePath();
  const { value } = await readJsonFile<ObserveConfigData>(filePath, empty);
  if (value.version !== 1 || !value.observedChannels) return empty;
  return value;
}

async function writeConfig(config: ObserveConfigData): Promise<void> {
  const filePath = resolveFilePath();
  await writeJsonFile(filePath, config);
}

/** Toggle observe mode for a channel. Returns the new state. */
export async function toggleObserveChannel(
  channelJid: string,
  channelName?: string,
): Promise<{ enabled: boolean }> {
  const filePath = resolveFilePath();
  let result = { enabled: false };

  await withFileLock(filePath, empty, async () => {
    const config = await readConfig();
    const current = config.observedChannels[channelJid];
    const newEnabled = !(current?.enabled ?? false);

    if (newEnabled) {
      config.observedChannels[channelJid] = { enabled: true, channelName };
    } else {
      delete config.observedChannels[channelJid];
    }

    await writeConfig(config);
    result = { enabled: newEnabled };
  });

  return result;
}

/** Set a channel as the review channel. */
export async function setReviewChannel(
  channelJid: string,
  channelName?: string,
): Promise<void> {
  const filePath = resolveFilePath();
  await withFileLock(filePath, empty, async () => {
    const config = await readConfig();
    config.reviewChannelJid = channelJid;
    config.reviewChannelName = channelName;
    await writeConfig(config);
  });
}

/** Get the dynamic observe policy for a channel. */
export async function getDynamicObservePolicy(channelJid: string): Promise<{
  observeMode: boolean;
  reviewChannelJid?: string;
}> {
  const config = await readConfig();
  const entry = config.observedChannels[channelJid];
  if (!entry?.enabled) return { observeMode: false };
  return {
    observeMode: true,
    reviewChannelJid: config.reviewChannelJid,
  };
}
