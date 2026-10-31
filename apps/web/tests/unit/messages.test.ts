import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") acc[path] = value;
    else Object.assign(acc, flatten(value, path));
    return acc;
  }, {});
}

/** `{name}`, `{count, plural, …}` → name, count. Nested `{# minute}` branches are not arguments. */
function argumentsOf(message: string): string[] {
  return Array.from(
    new Set(Array.from(message.matchAll(/\{\s*([a-zA-Z_]\w*)\s*[,}]/g), (m) => m[1] ?? "")),
  ).sort();
}

function tagsOf(message: string): string[] {
  return Array.from(new Set(Array.from(message.matchAll(/<(\w+)>/g), (m) => m[1] ?? ""))).sort();
}

const enFlat = flatten(en as Tree);
const hiFlat = flatten(hi as Tree);

describe("messages (brief §3.1: all copy through next-intl, en + hi)", () => {
  it("has the same keys in English and Hindi", () => {
    expect(Object.keys(hiFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it("uses the same ICU arguments and rich-text tags in both languages", () => {
    for (const [key, message] of Object.entries(enFlat)) {
      const translated = hiFlat[key] ?? "";
      expect(argumentsOf(translated), key).toEqual(argumentsOf(message));
      expect(tagsOf(translated), key).toEqual(tagsOf(message));
    }
  });

  it("has no empty strings", () => {
    for (const [key, message] of [...Object.entries(enFlat), ...Object.entries(hiFlat)]) {
      expect(message.trim(), key).not.toBe("");
    }
  });

  it("carries the mandatory AI disclaimers", () => {
    expect(enFlat["Saransh.disclaimer"]).toBe("AI summary. Please verify with your advocate.");
    expect(enFlat["Parakh.disclaimer"]).toMatch(/not legal advice/);
    expect(enFlat["Footer.disclaimer"]).toMatch(/does not provide legal advice/);
  });
});
