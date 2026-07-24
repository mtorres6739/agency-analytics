export type MessageCatalog = Record<string, unknown>;

function isMessageCatalog(value: unknown): value is MessageCatalog {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeWithSourceMessages(source: MessageCatalog, localized: MessageCatalog): MessageCatalog {
  const merged: MessageCatalog = { ...source };

  for (const [key, value] of Object.entries(localized)) {
    const sourceValue = source[key];
    if (typeof value === "string" && value.trim() === "" && typeof sourceValue === "string") {
      continue;
    }
    if (isMessageCatalog(value) && isMessageCatalog(sourceValue)) {
      merged[key] = mergeWithSourceMessages(sourceValue, value);
      continue;
    }
    merged[key] = value;
  }

  return merged;
}
