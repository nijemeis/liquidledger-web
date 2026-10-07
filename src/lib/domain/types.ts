// Re-exports so domain modules don't import from "server-only" code paths and
// can be used from scripts (seed) as well as from the app.
export type {
  ExciseBasis,
  ExciseRate,
  Product,
  ProductCategory,
  TaxRegime,
  WarehouseKind,
  Relation,
  Administration,
} from "@prisma/client";
export type { Prisma } from "@prisma/client";
import type { Prisma } from "@prisma/client";
export type Tx = Prisma.TransactionClient;
