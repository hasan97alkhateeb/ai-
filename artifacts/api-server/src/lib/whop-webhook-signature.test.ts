import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  isWhopWebhookTimestampFresh,
  verifyWhopWebhookSignature,
} from "./whop-webhook-signature.js";

const secret = "test-webhook-signing-secret";
const webhookId = "evt_test_123";
const timestamp = "1790698800";
const rawBody = Buffer.from(
  JSON.stringify({
    id: webhookId,
    type: "membership.activated",
    data: { id: "mem_test_123" },
  }),
);

function sign(body: Buffer, id: string, time: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${id}.${time}.${body.toString("utf8")}`, "utf8")
    .digest("base64");
  return `v1,${signature}`;
}

test("accepts the Whop Standard Webhooks signature", () => {
  assert.equal(
    verifyWhopWebhookSignature(
      rawBody,
      webhookId,
      timestamp,
      sign(rawBody, webhookId, timestamp),
      secret,
    ),
    true,
  );
});

test("rejects a changed body and a wrong signing secret", () => {
  const signature = sign(rawBody, webhookId, timestamp);
  assert.equal(
    verifyWhopWebhookSignature(
      Buffer.from(`${rawBody.toString("utf8")} `),
      webhookId,
      timestamp,
      signature,
      secret,
    ),
    false,
  );
  assert.equal(
    verifyWhopWebhookSignature(
      rawBody,
      webhookId,
      timestamp,
      signature,
      "different-secret",
    ),
    false,
  );
});

test("accepts only timestamps within the five-minute replay window", () => {
  const now = 1_790_698_800_000;
  assert.equal(isWhopWebhookTimestampFresh("1790698800", now), true);
  assert.equal(isWhopWebhookTimestampFresh("1790698499", now), false);
  assert.equal(isWhopWebhookTimestampFresh("invalid", now), false);
});