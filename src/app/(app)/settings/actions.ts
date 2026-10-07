"use server";
import { z } from "zod";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { getI18n } from "@/i18n/server";
import { meAction, MeError } from "./me";

export async function updateProfile(input: { name: string; locale: string }) {
  return meAction(async (me) => {
    const p = z.object({ name: z.string().trim().min(1).max(120), locale: z.enum(LOCALES) }).safeParse(input);
    if (!p.success) throw new MeError(me.t("settings.err.nameRequired"));
    const before = { name: me.user.name, locale: me.user.locale };
    await prisma.user.update({ where: { id: me.user.id }, data: { name: p.data.name.replace(/\s+/g, " "), locale: p.data.locale } });
    if (before.name !== p.data.name || before.locale !== p.data.locale) {
      await audit({
        actor: { type: "USER", id: me.user.id, label: p.data.name },
        action: "user.profile_update",
        summary: `Updated profile${before.locale !== p.data.locale ? ` · language ${LOCALE_NAMES[p.data.locale]}` : ""}`,
        administrationId: me.session.administrationId,
        targetType: "user",
        targetId: me.user.id,
        before,
        after: p.data,
      });
    }
    // Answer in the newly chosen language.
    const { t } = await getI18n(p.data.locale);
    return { message: t("settings.profile.saved") };
  });
}

export async function resetSidebar() {
  return meAction(async (me) => {
    (await cookies()).delete("ll_sidebar");
    return { message: me.t("settings.profile.sidebarReset") };
  });
}
