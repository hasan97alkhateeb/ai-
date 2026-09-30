import express, { Router, type IRouter } from "express";
import { applyWhopWebhookEvent, type WhopWebhookEvent } from "../lib/practice-billing";
import {
  isWhopWebhookTimestampFresh,
  verifyWhopWebhookSignature,
} from "../lib/whop-webhook-signature";

const router: IRouter = Router();

router.post(
  "/",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res): Promise<void> => {
    const secret = process.env.WHOP_WEBHOOK_SECRET;
    if (!secret) {
      res.status(503).json({ error: "Whop webhook signing is not configured." });
      return;
    }

    const webhookId = req.get("webhook-id");
    const timestamp = req.get("webhook-timestamp");
    const signature = req.get("webhook-signature");
    const timestampSeconds = Number(timestamp);
    if (
      !webhookId ||
      !timestamp ||
      !signature ||
      !isWhopWebhookTimestampFresh(timestamp)
    ) {
      res.status(400).json({ error: "Invalid Whop webhook headers." });
      return;
    }

    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Whop webhook body must be raw JSON." });
      return;
    }

    if (
      !verifyWhopWebhookSignature(
        req.body,
        webhookId,
        timestamp,
        signature,
        secret,
      )
    ) {
      res.status(401).json({ error: "Invalid Whop webhook signature." });
      return;
    }

    let event: WhopWebhookEvent;
    try {
      const parsed: unknown = JSON.parse(req.body.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Invalid event object");
      }
      const value = parsed as Record<string, unknown>;
      if (
        value.id !== webhookId ||
        typeof value.type !== "string" ||
        !value.type ||
        !value.data ||
        typeof value.data !== "object" ||
        Array.isArray(value.data)
      ) {
        throw new Error("Invalid event fields");
      }
      event = {
        id: value.id,
        type: value.type,
        ...(typeof value.timestamp === "string" ||
        typeof value.timestamp === "number"
          ? { timestamp: value.timestamp }
          : {}),
        data: value.data as Record<string, unknown>,
      };
    } catch {
      res.status(400).json({ error: "Invalid Whop webhook payload." });
      return;
    }

    try {
      const result = await applyWhopWebhookEvent(
        event,
        new Date(timestampSeconds * 1000),
      );
      req.log.info(
        { eventId: event.id, eventType: event.type, result },
        "Whop webhook handled",
      );
      res.status(200).json({ received: true });
    } catch (error) {
      req.log.error(
        {
          eventId: event.id,
          eventType: event.type,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Whop webhook processing failed",
      );
      res.status(500).json({ error: "Whop webhook processing failed." });
    }
  },
);

export default router;