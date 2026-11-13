# Public Domain Check: MCP server

Is this book, film, song or artwork in the US public domain, and when does it enter it? This MCP server answers that question for AI agents. It's backed by:

- **2.38 million** US Copyright Office registrations (1923–1977)
- **434,000** renewal records, linked to their registrations
- the US copyright term rules

Paid tools cost a few cents per call, paid in USDC through [x402](https://x402.org). There's no account or API key.

- **Remote MCP (Streamable HTTP):** `https://public-domain-check-production.up.railway.app/mcp`
- **HTTP API and docs:** https://public-domain-check-production.up.railway.app ([llms.txt](https://public-domain-check-production.up.railway.app/llms.txt), [OpenAPI](https://public-domain-check-production.up.railway.app/openapi.json))

## Tools

| Tool | Price | What it does |
|---|---|---|
| `check_public_domain` | $0.01 (brief) / $0.02 (full) | Returns the status (public domain, likely public domain, in copyright, or undetermined), the public-domain date, the confidence, a one-line reason and the record IDs. Full mode adds the complete reasoning and records. For 1923–1977 books, a title is enough. |
| `check_public_domain_batch` | $0.0075 per work (brief) / $0.015 (full) | Checks up to 50 works per call. Local wrapper only. |
| `search_copyright_renewals` | $0.01 | Shows who renewed a work's copyright and when, which usually points to the rightsholder. |
| `copyright_rules_for_year` | free | Tells you which rule applies to a publication year, and whether a record lookup is needed. |
| `public_domain_day` | free | Lists what enters the US public domain on January 1. |

You're never charged when a request is invalid or the service needs more information.

**Brief answers by default.** `check_public_domain` returns a short answer: the status, the date, the confidence, a one-line reason, and the record IDs. That's about 80% fewer tokens for your agent to read. For the complete reasoning and records ($0.02), pass `format: "full"` (local wrapper) or call `check_public_domain_full` (remote MCP).

## Use it

### Claude Desktop, Cursor, Windsurf, and other MCP clients

Add this to your MCP config:

```json
{
  "mcpServers": {
    "public-domain-check": {
      "command": "npx",
      "args": ["-y", "public-domain-check-mcp"],
      "env": {
        "WALLET_PRIVATE_KEY": "0x...",
        "MAX_PRICE_PER_CALL": "0.25"
      }
    }
  }
}
```

- **`WALLET_PRIVATE_KEY`** is the private key of a wallet that holds a little USDC on Base. Use a dedicated wallet with a few dollars in it, not your main wallet.
- **Without a key,** the free tools still work.
- **`MAX_PRICE_PER_CALL`** is a hard cap, in US dollars, enforced on your machine. The wrapper refuses any call that costs more.

### Agents with built-in x402 support

These include `@x402/mcp`, Coinbase AgentKit, and other x402-aware frameworks. Connect to the remote URL above. Paid tools return an x402 payment request, and your client pays it and retries.

### Example answer

```json
{
  "status": "in_copyright",
  "confidence": "high",
  "public_domain_date": "2035-01-01",
  "reasoning": [
    "Published 1939; works published 1929–1963 needed a renewal filed in the 28th year (1966–1967) ...",
    "Found the original registration A125939 (1939-02-06) and its renewal R399023 (1966-12-12)."
  ],
  "registration": {
    "renewal": {
      "id": "R399023",
      "claimants": [{ "name": "Helga Greene", "role": "executor" }]
    }
  }
}
```

## Data and limits

- **Sources:** US Copyright Office records from the *Catalog of Copyright Entries*, plus renewal records. Both were transcribed by the New York Public Library and released under CC0.
- **Limits:** US law only. The answers are informational, not legal advice.

## License

MIT
