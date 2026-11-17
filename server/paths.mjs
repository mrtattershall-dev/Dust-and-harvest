// Where things live on the host. Everything that is not source code
// (the Minecraft server, settings, credentials) stays out of the repository.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BDS_DIR = process.env.SKYAI_BDS_DIR ?? path.join(ROOT, "bds");
export const DATA_DIR = process.env.SKYAI_DATA_DIR ?? path.join(ROOT, "data");
export const WORLD_NAME = process.env.SKYAI_WORLD ?? "skyblock";
export const PACK_SOURCE = path.join(ROOT, "addon", "behavior_pack");
export const PACK_UUID = "6f0b6a52-6d0e-4c0e-9a55-1d7c2f1e8a01";
export const BACKEND_PORT = Number(process.env.SKYAI_PORT) || 8765;
