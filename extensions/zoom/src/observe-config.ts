/**
 * File-based config store for channel observe mode settings.
 * Allows dynamic configuration via slash commands in Zoom channels.
 */

import { resolveZoomStorePath } from "./storage.js";
import { readJsonFile, withFileLock, writeJsonFile } from "./store-fs.js";

export type ChannelMode = "active" | "silent" | "training";

type ObservedChannelEntry = {
  enabled: boolean;
  channelName?: string;
  /** @deprecated Use `mode` instead. Kept for migration of existing configs. */
  silent?: boolean;
  mode?: ChannelMode;
  /** Allow cross-channel customer data retrieval. Default: false. */
  crossChannelTraining?: boolean;
  /** Redaction policy when cross-channel is enabled. Default: "llm" when cross-channel on. */
  redactionPolicy?: RedactionPolicy;
  /** Actor who last toggled cross-channel training. */
  lastCrossTrainingActor?: string;
  /** ISO timestamp of last cross-channel toggle. */
  lastCrossTrainingAt?: string;
};

export type RedactionPolicy = "off" | "llm";

type ObserveConfigData = {
  version: 1;
  /** Global review channel JID — where approval cards are posted */
  reviewChannelJid?: string;
  reviewChannelName?: string;
  /** Map of channel JID → observe mode enabled */
  observedChannels: Record<string, ObservedChannelEntry>;
};

/** Resolve effective mode from an entry, handling legacy `silent` field migration. */
function resolveMode(entry: ObservedChannelEntry): ChannelMode {
  if (entry.mode) return entry.mode;
  return entry.silent ? "silent" : "active";
}

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

/** Enable observe mode for a channel (idempotent — no-ops if already enabled). */
export async function enableObserveChannel(
  channelJid: string,
  channelName?: string,
): Promise<void> {
  const filePath = resolveFilePath();
  await withFileLock(filePath, empty, async () => {
    const config = await readConfig();
    if (config.observedChannels[channelJid]?.enabled) return; // already enabled
    config.observedChannels[channelJid] = { enabled: true, channelName };
    await writeConfig(config);
  });
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

/** Toggle silent mode for an observed channel. Returns the new state. */
export async function toggleSilentChannel(
  channelJid: string,
): Promise<{ silent: boolean; found: boolean }> {
  const filePath = resolveFilePath();
  let result = { silent: false, found: false };

  await withFileLock(filePath, empty, async () => {
    const config = await readConfig();
    const entry = config.observedChannels[channelJid];
    if (!entry?.enabled) {
      result = { silent: false, found: false };
      return;
    }
    const currentMode = resolveMode(entry);
    const newMode: ChannelMode = currentMode === "silent" ? "active" : "silent";
    entry.mode = newMode;
    entry.silent = newMode === "silent"; // keep legacy field in sync
    await writeConfig(config);
    result = { silent: newMode === "silent", found: true };
  });

  return result;
}

/** Set the mode for an observed channel. */
export async function setChannelMode(
  channelJid: string,
  mode: ChannelMode,
): Promise<{ found: boolean }> {
  const filePath = resolveFilePath();
  let result = { found: false };

  await withFileLock(filePath, empty, async () => {
    const config = await readConfig();
    const entry = config.observedChannels[channelJid];
    if (!entry?.enabled) {
      result = { found: false };
      return;
    }
    entry.mode = mode;
    entry.silent = mode === "silent"; // keep legacy field in sync
    await writeConfig(config);
    result = { found: true };
  });

  return result;
}

/** Return all observed channels with their current mode. */
export async function getObservedChannelsList(): Promise<
  Array<{ channelJid: string; channelName?: string; mode: ChannelMode }>
> {
  const config = await readConfig();
  return Object.entries(config.observedChannels)
    .filter(([, entry]) => entry.enabled)
    .map(([jid, entry]) => ({
      channelJid: jid,
      channelName: entry.channelName,
      mode: resolveMode(entry),
    }));
}

/** Get the dynamic observe policy for a channel. */
export async function getDynamicObservePolicy(channelJid: string): Promise<{
  observeMode: boolean;
  reviewChannelJid?: string;
  silent?: boolean;
  mode?: ChannelMode;
  crossChannelTraining?: boolean;
  redactionPolicy?: RedactionPolicy;
}> {
  const config = await readConfig();
  const entry = config.observedChannels[channelJid];
  if (!entry?.enabled) return { observeMode: false };
  const mode = resolveMode(entry);
  return {
    observeMode: true,
    reviewChannelJid: config.reviewChannelJid,
    silent: mode === "silent",
    mode,
    crossChannelTraining: entry.crossChannelTraining ?? false,
    redactionPolicy: entry.redactionPolicy ?? (entry.crossChannelTraining ? "llm" : "off"),
  };
}

/** Enable or disable cross-channel training for an observed channel. */
export async function setCrossChannelTraining(
  channelJid: string,
  enabled: boolean,
  actor?: string,
): Promise<{ found: boolean }> {
  const filePath = resolveFilePath();
  let result = { found: false };

  await withFileLock(filePath, empty, async () => {
    const config = await readConfig();
    const entry = config.observedChannels[channelJid];
    if (!entry?.enabled) {
      result = { found: false };
      return;
    }
    entry.crossChannelTraining = enabled;
    if (!enabled) {
      entry.redactionPolicy = "off";
    } else if (!entry.redactionPolicy || entry.redactionPolicy === "off") {
      entry.redactionPolicy = "llm"; // default to LLM redaction when cross-channel on
    }
    entry.lastCrossTrainingActor = actor;
    entry.lastCrossTrainingAt = new Date().toISOString();
    await writeConfig(config);
    result = { found: true };
  });

  return result;
}

/** Get cross-channel training state for a channel. */
export async function getCrossChannelTraining(
  channelJid: string,
): Promise<{ enabled: boolean; redactionPolicy: RedactionPolicy; found: boolean }> {
  const config = await readConfig();
  const entry = config.observedChannels[channelJid];
  if (!entry?.enabled) return { enabled: false, redactionPolicy: "off", found: false };
  return {
    enabled: entry.crossChannelTraining ?? false,
    redactionPolicy: entry.redactionPolicy ?? (entry.crossChannelTraining ? "llm" : "off"),
    found: true,
  };
}

/** Set the redaction policy for an observed channel. */
export async function setRedactionPolicy(
  channelJid: string,
  policy: RedactionPolicy,
  actor?: string,
): Promise<{ found: boolean }> {
  const filePath = resolveFilePath();
  let result = { found: false };

  await withFileLock(filePath, empty, async () => {
    const config = await readConfig();
    const entry = config.observedChannels[channelJid];
    if (!entry?.enabled) {
      result = { found: false };
      return;
    }
    entry.redactionPolicy = policy;
    entry.lastCrossTrainingActor = actor;
    entry.lastCrossTrainingAt = new Date().toISOString();
    await writeConfig(config);
    result = { found: true };
  });

  return result;
}

/** Get the redaction policy for a channel. */
export async function getRedactionPolicy(
  channelJid: string,
): Promise<RedactionPolicy> {
  const config = await readConfig();
  const entry = config.observedChannels[channelJid];
  if (!entry?.enabled) return "off";
  return entry.redactionPolicy ?? (entry.crossChannelTraining ? "llm" : "off");
}
