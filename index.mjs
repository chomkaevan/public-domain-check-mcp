#!/usr/bin/env node
// public-domain-check-mcp: local (stdio) MCP server for Claude Desktop, Cursor, Windsurf and any
// MCP client. It calls the Public Domain Check API and pays per call from YOUR wallet with x402
// (USDC on Base). Free tools work without a wallet.
//
// Env:
//   WALLET_PRIVATE_KEY   0x… key of a wallet holding a little USDC on Base (needed for paid tools)
//   MAX_PRICE_PER_CALL   hard cap in USD per call (default 0.25)
//   SERVICE_URL          default https://public-domain-check-production.up.railway.app
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const env = process.env;
const BASE = (env.SERVICE_URL || "https://public-domain-check-production.up.railway.app").replace(/\/$/, "");
const NETWORK = env.NETWORK || "eip155:8453";
const CAP = Number(env.MAX_PRICE_PER_CALL || "0.25");
const WORK_TYPES = ["book", "periodical", "musical_composition", "sound_recording", "film", "drama", "artwork", "photograph", "map", "other"];

let payFetch = null;
if (env.WALLET_PRIVATE_KEY) {
  const signer = toClientEvmSigner(privateKeyToAccount(env.WALLET_PRIVATE_KEY));
  const spendControls = env.ALLOWED_ASSET // for tests on a local chain with a stand-in token
    ? { allowedAssets: [{ network: NETWORK, asset: env.ALLOWED_ASSET, maxAmountPerPayment: String(Math.round(CAP * 1e6)) }] }
    : { maxAmountPerPayment: `$${CAP}` };
  payFetch = wrapFetchWithPayment(fetch, x402Client.fromConfig({ schemes: [{ network: NETWORK, client: new ExactEvmScheme(signer) }], spendControls }));
}

const reply = (obj, isError = false) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }], ...(isError ? { isError } : { structuredContent: obj }) });

async function call(path, init, paid) {
  if (paid && !payFetch) return reply({ error: "This tool is paid (a few cents in USDC on Base). Set WALLET_PRIVATE_KEY in the MCP server config. Free tools: copyright_rules_for_year, public_domain_day." }, true);
  try {
    const res = await (paid ? payFetch : fetch)(`${BASE}${path}`, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return reply({ http_status: res.status, ...body }, true);
    const receipt = res.headers.get("payment-response");
    if (receipt) {
      const r = decodePaymentResponseHeader(receipt);
      body.payment = { transaction: r.transaction, network: r.network };
    }
    return reply(body);
  } catch (e) {
    return reply({ error: String(e?.message || e) }, true);
  }
}

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString();
const work = {
  title: z.string().describe("Title of the work"),
  author: z.string().optional().describe("Author, composer or creator"),
  year: z.number().int().optional().describe("Year of first publication (inferred for 1923–1977 books)"),
  type: z.enum(WORK_TYPES).optional().describe("Kind of work (default book)"),
  author_death_year: z.number().int().optional(),
  work_for_hire: z.boolean().optional(),
  origin: z.enum(["us", "foreign", "unknown"]).optional(),
};

const server = new McpServer({ name: "public-domain-check", version: "0.3.0" });
const ro = { readOnlyHint: true, openWorldHint: true };

server.registerTool("check_public_domain", {
  title: "Check US public-domain status",
  description: "Is a book, film, song, recording or artwork in the US public domain? Returns status, the date it enters the public domain, reasoning and the matching US Copyright Office registration/renewal. For 1923–1977 books a title alone is usually enough. Costs $0.02 (paid automatically in USDC). Not charged if more information is needed.",
  inputSchema: work, annotations: ro,
}, async (a) => call(`/v1/pd-status?${qs(a)}`, undefined, true));

server.registerTool("check_public_domain_batch", {
  title: "Check many works at once",
  description: `Check up to 50 works in one call at $0.015 each. Calls above the configured cap ($${CAP}) are refused; split large lists.`,
  inputSchema: { works: z.array(z.object(work)).min(1).max(50) }, annotations: ro,
}, async ({ works }) => call("/v1/pd-status/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ works }) }, true));

server.registerTool("search_copyright_renewals", {
  title: "Search US copyright renewal records",
  description: "Search 434k US Copyright Office renewal records (1950–1991+) by title/author: who renewed a work and when (the likely rightsholder). Costs $0.01.",
  inputSchema: { title: z.string().optional(), author: z.string().optional(), year: z.number().int().optional(), limit: z.number().int().max(50).optional() }, annotations: ro,
}, async (a) => call(`/v1/renewals/search?${qs(a)}`, undefined, true));

server.registerTool("copyright_rules_for_year", {
  title: "US copyright rule for a publication year (free)",
  description: "Free. Which US copyright rule applies to a work of a given type and publication year, and whether a record lookup is needed to decide.",
  inputSchema: { year: z.number().int(), type: z.enum(WORK_TYPES).optional(), author_death_year: z.number().int().optional(), work_for_hire: z.boolean().optional() }, annotations: ro,
}, async (a) => call(`/v1/pd-rules?${qs(a)}`, undefined, false));

server.registerTool("public_domain_day", {
  title: "Public Domain Day (free)",
  description: "Free. What enters the US public domain on January 1 of a given year.",
  inputSchema: { year: z.number().int().optional() }, annotations: ro,
}, async (a) => call(`/v1/public-domain-day?${qs(a)}`, undefined, false));

await server.connect(new StdioServerTransport());
