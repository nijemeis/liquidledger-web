// Role → permission matrix from DOMAIN_AND_DATA.md §3.
// F = full access, V = view only, N = none. Owner and Admin differ only on
// billing and deleting the administration.

export type Role = "OWNER" | "ADMIN" | "BOOKKEEPER" | "WAREHOUSE" | "ACCOUNTANT" | "READ_ONLY";
export type Level = "F" | "V" | "N";

export const ROLES: Role[] = ["OWNER", "ADMIN", "BOOKKEEPER", "WAREHOUSE", "ACCOUNTANT", "READ_ONLY"];

export const PERMISSIONS = {
  sales: "FFFVFV",
  purchases: "FFFFVV",
  bank: "FFFNVV",
  stock: "FFVFVV",
  fileVat: "FFNNFN",
  fileExcise: "FFFNVN",
  customs: "FFFFVN",
  reports: "FFFNFV",
  users: "FFNNNN",
  billing: "FNNNNN",
  deleteAdministration: "FNNNNN",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_GROUPS: { group: string; items: Permission[] }[] = [
  { group: "bookkeeping", items: ["sales", "purchases", "bank", "stock"] },
  { group: "taxFiling", items: ["fileVat", "fileExcise", "customs"] },
  { group: "administration", items: ["reports", "users", "billing", "deleteAdministration"] },
];

export function level(role: Role, perm: Permission): Level {
  return PERMISSIONS[perm][ROLES.indexOf(role)] as Level;
}

export function canView(role: Role, perm: Permission): boolean {
  return level(role, perm) !== "N";
}

export function canEdit(role: Role, perm: Permission): boolean {
  return level(role, perm) === "F";
}

/** Screens (nav items) and the permission that gates them. `null` = everyone. */
export const SCREEN_PERMISSION: Record<string, Permission | null> = {
  dashboard: null,
  bank: "bank",
  sales: "sales",
  purchases: "purchases",
  costs: "purchases",
  relations: null,
  products: "stock",
  stock: "stock",
  excise: "fileExcise",
  shipments: "customs",
  vat: "fileVat",
  ledger: "reports",
  reports: "reports",
};

/** Financial figures are hidden from roles without any access to bank or reports (Warehouse). */
export function seesFinancials(role: Role): boolean {
  return canView(role, "reports") || canView(role, "bank");
}
