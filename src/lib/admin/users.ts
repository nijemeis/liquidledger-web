import "server-only";
import type { Role } from "@prisma/client";
import { prisma, withSystem } from "../db";
import { env } from "../env";
import { sendMail } from "../email";
import { createEmailToken } from "../auth/flow";
import { addMembership, COUNTRIES } from "../domain/setup";
import { getMessages } from "@/i18n/messages";
import { createT } from "@/i18n/t";
import { isLocale } from "@/i18n/config";
import { AdminError, auditStaff, type StaffContext } from "./staff";

export const INVITE_HOURS = 72;

const ROLE_EN: Record<Role, string> = { OWNER: "Owner", ADMIN: "Admin", BOOKKEEPER: "Bookkeeper", WAREHOUSE: "Warehouse", ACCOUNTANT: "Accountant", READ_ONLY: "Read-only" };
export const roleLabelEn = (r: Role) => ROLE_EN[r];

export function nameFromEmail(email: string): string {
  return email
    .split("@")[0]!
    .replace(/[._-]+/g, " ")
    .replace(/\b\p{L}/gu, (m) => m.toUpperCase())
    .trim();
}

/** Invite email in the user's language (falls back to English). */
export async function sendInviteMail(user: { id: string; email: string; name: string; locale: string }, clientName: string, role: Role, invitedBy: string) {
  const token = await createEmailToken(user.id, "INVITE", INVITE_HOURS);
  const t = createT(getMessages(isLocale(user.locale) ? user.locale : "en"));
  const link = `${env.appUrl}/invite?token=${token}`;
  await sendMail({
    to: user.email,
    subject: t("admin.email.inviteSubject", { client: clientName }),
    text: t("admin.email.inviteBody", { name: user.name, client: clientName, role: t(`admin.role.${role}`), by: invitedBy, link, hours: INVITE_HOURS }),
  });
  return link;
}

/** Invite someone (new or existing user) to a client's first administration. */
export async function inviteClientUser(ctx: StaffContext, input: { clientId: string; email: string; role: Role; name?: string | null }) {
  const email = input.email.trim().toLowerCase();
  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    include: { administrations: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const administration = client?.administrations[0];
  if (!client || !administration) throw new AdminError(ctx.t("admin.err.noAdministration"));
  const locale = COUNTRIES[client.country]?.language ?? "en";
  let found = await prisma.user.findUnique({ where: { email } });
  if (found) {
    const existing = await prisma.membership.findFirst({ where: { userId: found.id, administration: { clientId: client.id } } });
    if (existing) throw new AdminError(ctx.t("admin.err.alreadyMember", { email, client: client.name }));
    if (found.status === "DISABLED") throw new AdminError(ctx.t("admin.err.userDisabled", { email }));
  } else {
    found = await prisma.user.create({ data: { email, name: input.name?.trim() || nameFromEmail(email), locale, status: "INVITED" } });
  }
  const user = found;
  await withSystem((tx) => addMembership(tx, user.id, administration.id, input.role));
  if (user.status === "INVITED") {
    await sendInviteMail(user, client.name, input.role, ctx.staff.name);
  } else {
    const t = createT(getMessages(isLocale(user.locale) ? user.locale : "en"));
    await sendMail({
      to: user.email,
      subject: t("admin.email.addedSubject", { client: client.name }),
      text: t("admin.email.addedBody", { name: user.name, client: client.name, role: t(`admin.role.${input.role}`), link: `${env.appUrl}/login` }),
    });
  }
  await auditStaff(ctx, {
    action: "user.invite",
    summary: `Invited ${email} as ${ROLE_EN[input.role]}`,
    clientId: client.id,
    administrationId: administration.id,
    targetType: "user",
    targetId: user.id,
  });
  return { user, client };
}
