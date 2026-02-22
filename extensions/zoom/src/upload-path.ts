import os from "node:os";
import path from "node:path";

/**
 * Keep Zoom uploads under OpenClaw state media root so media tools can read them.
 * This path is included in default local media roots.
 */
export function resolveZoomUploadDir(): string {
  return path.resolve(os.homedir(), ".openclaw", "media", "zoom-uploads");
}
