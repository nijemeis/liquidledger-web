import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Passkey } from "@prisma/client";
import { env } from "../env";

export async function registrationOptions(opts: {
  userId: string;
  email: string;
  name: string;
  existing: Pick<Passkey, "credentialId" | "transports">[];
}) {
  return generateRegistrationOptions({
    rpName: env.rpName,
    rpID: env.rpId,
    userName: opts.email,
    userDisplayName: opts.name,
    userID: new TextEncoder().encode(opts.userId),
    attestationType: "none",
    excludeCredentials: opts.existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

export async function verifyRegistration(response: RegistrationResponseJSON, expectedChallenge: string) {
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: env.webauthnOrigins,
    expectedRPID: env.rpId,
    requireUserVerification: true,
  });
  if (!v.verified || !v.registrationInfo) return null;
  const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey),
    counter: BigInt(credential.counter),
    transports: (response.response.transports ?? []) as string[],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
  };
}

export async function authenticationOptions(allow?: Pick<Passkey, "credentialId" | "transports">[]) {
  return generateAuthenticationOptions({
    rpID: env.rpId,
    userVerification: "required",
    allowCredentials: allow?.map((c) => ({ id: c.credentialId, transports: c.transports as AuthenticatorTransportFuture[] })),
  });
}

export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  passkey: Pick<Passkey, "credentialId" | "publicKey" | "counter" | "transports">,
) {
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: env.webauthnOrigins,
    expectedRPID: env.rpId,
    requireUserVerification: true,
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(passkey.publicKey),
      counter: Number(passkey.counter),
      transports: passkey.transports as AuthenticatorTransportFuture[],
    },
  });
  if (!v.verified) return null;
  return { newCounter: BigInt(v.authenticationInfo.newCounter) };
}

export function passkeyName(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iPhone|iPad/.test(ua)) return "iPhone or iPad";
  if (/Android/.test(ua)) return "Android device";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows device";
  return "Passkey";
}
