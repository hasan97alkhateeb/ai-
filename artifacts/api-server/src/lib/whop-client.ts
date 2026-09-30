import { WhopClient } from "@whop/sdk";

let clientPromise: Promise<WhopClient> | null = null;

async function initWhopClient(): Promise<WhopClient> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const replitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (!hostname || !replitToken) {
    throw new Error(
      "Whop credentials are unavailable. Check that the Whop integration is connected.",
    );
  }

  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=whop`,
    {
      headers: {
        Accept: "application/json",
        X_REPLIT_TOKEN: replitToken,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to load Whop credentials (${response.status}).`);
  }

  const data = (await response.json()) as {
    items?: Array<{ settings?: { api_key?: string } }>;
  };
  const apiKey = data.items?.[0]?.settings?.api_key;
  if (!apiKey) {
    throw new Error("The connected Whop integration has no API credentials.");
  }

  return new WhopClient({ token: apiKey });
}

export function getWhopClient(): Promise<WhopClient> {
  if (!clientPromise) {
    clientPromise = initWhopClient().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }

  return clientPromise;
}