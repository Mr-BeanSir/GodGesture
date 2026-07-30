/** 同步配置的协议容量边界。字符串上限按 UTF-16 code unit，整文档按 UTF-8 字节。 */
export const MAX_CONFIG_DOCUMENT_BYTES = 256 * 1024;
export const MAX_APPS = 128;
export const MAX_INTENTS_PER_SCOPE = 256;
export const MAX_BOUNDARY_INTENTS = 256;
export const MAX_BOUNDARY_SEQUENCE_TOKENS = 12;
export const MAX_HOTKEY_MODIFIERS = 4;
export const MAX_HOTKEY_KEYS = 16;
export const MAX_COMMAND_TEXT_LENGTH = 16 * 1024;
export const MAX_SCRIPT_SLOT_LENGTH = 32 * 1024;
export const MAX_SCRIPT_TOTAL_LENGTH = 64 * 1024;
export const MAX_URL_LENGTH = 4096;
export const MAX_PATH_LENGTH = 4096;

export function configDocumentSizeBytes(document: unknown): number {
  const serialized = JSON.stringify(document);
  if (serialized === undefined)
    throw new TypeError("document is not JSON serializable");
  return new TextEncoder().encode(serialized).byteLength;
}
