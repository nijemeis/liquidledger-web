import type { Dict } from "./types";

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

function lookup(dict: Dict, key: string): string | undefined {
  let cur: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    if (cur === undefined || typeof cur === "string") return undefined;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function createT(messages: Dict): TFunction {
  return (key, vars) => {
    const raw = lookup(messages, key) ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
  };
}

export function deepMerge(base: Dict, over: Dict | undefined): Dict {
  if (!over) return base;
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    out[k] = typeof v === "object" && v && typeof b === "object" ? deepMerge(b, v) : v;
  }
  return out;
}
