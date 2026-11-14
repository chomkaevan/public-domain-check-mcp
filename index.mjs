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
  countries: z.string().optional().describe("Also answer for other countries, same price: comma-separated uk, eu, canada, australia, japan, china, india, or all"),
  format: z.enum(["brief", "full"]).optional().describe("brief (default, $0.01): status, date, confidence, one-line reason. full ($0.02): complete reasoning and records."),
};

const server = new McpServer({ name: "public-domain-check", version: "0.7.0" });
const ro = { readOnlyHint: true, openWorldHint: true };

server.registerTool("check_public_domain", {
  title: "Check US public-domain status",
  description: "Check whether a specific book, film, song, recording or artwork is in the US public domain, and the date it enters it. Use this instead of answering from memory when the work was published 1929–1963 (its status depends on a copyright renewal that models usually don't know), when the work is obscure, or when you need a citable answer before quoting, reprinting, adapting, selling or training on it. Looks up 2.38M US Copyright Office registrations and 434k renewals; a title is usually enough for 1923–1977 books. Includes HathiTrust's human-reviewer verdict when it exists, and with countries=uk,eu,... the status in other countries. Costs $0.01 for the brief answer (default) or $0.02 with format \"full\" (complete reasoning and records). Not charged if it can't answer.",
  inputSchema: work, annotations: ro,
}, async (a) => call(`/v1/pd-status?${qs(a)}`, undefined, true));

server.registerTool("check_public_domain_batch", {
  title: "Check many works at once",
  description: `Clear a list of up to 50 works for US public-domain status in one call: $0.0075 per work (brief, default) or $0.015 with format "full". For catalogs, reading lists, reprint plans and training-data checks. Calls above the configured cap ($${CAP}) are refused; split large lists.`,
  inputSchema: { works: z.array(z.object(work)).min(1).max(50) }, annotations: ro,
}, async ({ works }) => call("/v1/pd-status/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ works }) }, true));

server.registerTool("search_copyright_renewals", {
  title: "Search US copyright renewal records",
  description: "Find who renewed a 1929–1963 work's US copyright and when: usually the current rightsholder or their estate. Use when you need to know whom to ask for permission or a license. Costs $0.01.",
  inputSchema: { title: z.string().optional(), author: z.string().optional(), year: z.number().int().optional(), limit: z.number().int().max(50).optional() }, annotations: ro,
}, async (a) => call(`/v1/renewals/search?${qs(a)}`, undefined, true));

server.registerTool("copyright_rules_for_year", {
  title: "US copyright rule for a publication year (free)",
  description: "Free. Given a publication year (and type of work), say which US copyright rule applies and whether a records lookup is needed. Call this first when you only know the year: many years are settled by the rules alone.",
  inputSchema: { year: z.number().int(), type: z.enum(WORK_TYPES).optional(), author_death_year: z.number().int().optional(), work_for_hire: z.boolean().optional() }, annotations: ro,
}, async (a) => call(`/v1/pd-rules?${qs(a)}`, undefined, false));

server.registerTool("public_domain_day", {
  title: "Public Domain Day (free)",
  description: "Free. What enters the US public domain on January 1 of a given year.",
  inputSchema: { year: z.number().int().optional() }, annotations: ro,
}, async (a) => call(`/v1/public-domain-day?${qs(a)}`, undefined, false));

server.registerTool("check_wallet_sanctions", {
  title: "Check a crypto wallet against OFAC sanctions",
  description: "Check whether a crypto wallet address is on the US Treasury OFAC sanctions lists. Call this before paying an unknown counterparty, onboarding a wallet, or accepting funds. Covers Bitcoin, Ethereum/EVM, USDT, USDC, Tron, Litecoin, Monero, Solana and more. Costs $0.002.",
  inputSchema: { address: z.string().describe("Wallet address (any chain)") }, annotations: ro,
}, async (a) => call(`/v1/sanctions/wallet?${qs(a)}`, undefined, true));

server.registerTool("screen_sanctions_name", {
  title: "Screen a name against OFAC sanctions lists",
  description: "Screen a person, company, vessel or aircraft name against the US Treasury OFAC SDN and Consolidated sanctions lists, including aliases, word order and spelling variants. Use before onboarding a customer, paying a supplier or signing a counterparty. Costs $0.003 (brief) or $0.005 with format \"full\".",
  inputSchema: { name: z.string(), type: z.enum(["individual", "entity", "vessel", "aircraft"]).optional(), format: z.enum(["brief", "full"]).optional() }, annotations: ro,
}, async (a) => call(`/v1/sanctions/screen?${qs(a)}`, undefined, true));

server.registerTool("check_property_risk", {
  title: "FEMA flood zone and seismic risk for a US address",
  description: "One-call natural hazard report for a US address or coordinates: overall risk with its drivers, FEMA flood zone and whether flood insurance is required, seismic design category, FEMA National Risk Index ratings for 18 hazards (hurricane, wildfire, tornado, earthquake, heat and more), federal disaster declarations in the county since 2000, county and census tract. Use when evaluating, listing, insuring or financing a property. Costs $0.02 (brief) or $0.04 with format \"full\". Not charged if the address can't be found.",
  inputSchema: { address: z.string().optional(), lat: z.number().optional(), lon: z.number().optional(), format: z.enum(["brief", "full"]).optional() }, annotations: ro,
}, async (a) => call(`/v1/property/risk?${qs(a)}`, undefined, true));

await server.connect(new StdioServerTransport());
