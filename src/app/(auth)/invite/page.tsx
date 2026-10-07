import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";
import { currentChallenge, inviteDetails } from "@/lib/auth/flow";
import { LinkInvalid } from "../reset/reset-form";
import { InviteFlow } from "./invite-flow";

export const metadata: Metadata = { title: "Accept your invite", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const d = token ? await inviteDetails(token) : null;
  if (!d) {
    // Accepting the invite sets the enrolment cookie, which re-renders this page
    // with the (now used) token: carry on with the 2FA set-up for that user.
    const ch = await currentChallenge(["enroll"]);
    if (ch && ch.user.status === "INVITED") return <InviteFlow token="" email={ch.user.email} name={ch.user.name} title="" text="" role="" enrolling />;
    return <LinkInvalid kind="invite" />;
  }
  const { t } = await getI18n();
  const role = t(`settings.role.${d.role}`);
  const text = d.trial
    ? t("auth.inviteTrialText")
    : d.inviter
      ? t("auth.inviteText", { inviter: d.inviter, role })
      : t("auth.inviteTextNoInviter", { role });
  return <InviteFlow token={token} email={d.email} name={d.name} title={t("auth.inviteTitle", { company: d.company })} text={text} role={role} />;
}
