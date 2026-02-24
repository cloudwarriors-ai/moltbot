import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type CatfishAuditRecord = {
  timestamp: string;
  senderJid: string;
  senderResolvedUserId?: string;
  senderResolvedEmail?: string;
  senderLookupSource?: string;
  targetRaw: string;
  targetType: "dm" | "channel";
  targetResolved: string;
  payloadField: "to_contact" | "to_channel";
  message: string;
  ok: boolean;
  status?: number;
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
};

type CatfishAuditLogger = {
  warn?: (message: string) => void;
};

export async function appendCatfishAuditRecord(params: {
  filePath: string;
  record: CatfishAuditRecord;
  logger?: CatfishAuditLogger;
}): Promise<void> {
  const directory = dirname(params.filePath);
  try {
    await mkdir(directory, { recursive: true });
    await appendFile(params.filePath, `${JSON.stringify(params.record)}\n`, "utf8");
  } catch (err) {
    params.logger?.warn?.(`catfish audit write failed: ${String(err)}`);
  }
}
