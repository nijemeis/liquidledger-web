export type Dict = { [key: string]: string | Dict };
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };

/** A namespace: English is complete and is the fallback for every other language. */
export type Namespace<T extends Dict> = { en: T } & Partial<Record<"nl" | "fr" | "de" | "it" | "es" | "pl", DeepPartial<T>>>;

export function ns<T extends Dict>(n: Namespace<T>): Namespace<T> {
  return n;
}
