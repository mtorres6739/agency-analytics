import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 22's strip-types loader intentionally imports the TypeScript source directly.
import { mergeWithSourceMessages } from "./messageFallback.ts";

test("uses source messages for missing and empty localized values", () => {
  assert.deepEqual(
    mergeWithSourceMessages(
      {
        translated: "English translation",
        empty: "English fallback",
        missing: "Missing fallback",
        nested: { empty: "Nested fallback", translated: "Nested English" },
      },
      {
        translated: "Traducción",
        empty: "",
        nested: { empty: "   ", translated: "Traducción anidada" },
        localeOnly: "Solo local",
      }
    ),
    {
      translated: "Traducción",
      empty: "English fallback",
      missing: "Missing fallback",
      nested: { empty: "Nested fallback", translated: "Traducción anidada" },
      localeOnly: "Solo local",
    }
  );
});
