import { createHmac, timingSafeEqual } from "node:crypto";

export const WHOP_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function isWhopWebhookTimestampFresh(
  timestamp: string,
  now = Date.now(),
): boolean {
  const timestampSeconds = Number(timestamp);
  return (
    Number.isFinite(timestampSeconds) &&
    Math.abs(now / 1000 - timestampSeconds) <=
      WHOP_WEBHOOK_TOLERANCE_SECONDS
  );
}

export function verifyWhopWebhookSignature(
  rawBody: Buffer,
  webhookId: string,
  timestamp: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const signedPayload = `${webhookId}.${timestamp}.${rawBody.toString("utf8")}`;
  const expected = createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("base64");
  const signatures = signatureHeader
    .trim()
    .split(/\s+/)
    .flatMap((part) => {
      const [version, value] = part.split(",", 2);
      return version === "v1" && value ? [value] : [];
    });

  return signatures.some((signature) => {
    const received = Buffer.from(signature, "base64");
    const calculated = Buffer.from(expected, "base64");
    return (
      received.length === calculated.length &&
      timingSafeEqual(received, calculated)
    );
  });
}