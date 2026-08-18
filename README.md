# SansFiction MCP & Agent Skill

[![sansfiction-mcp MCP server](https://glama.ai/mcp/servers/fgbytes/sansfiction-mcp/badges/score.svg)](https://glama.ai/mcp/servers/fgbytes/sansfiction-mcp)

Connect AI agents to [**SansFiction**](https://sansfiction.com) — a digital library for
books, collections, reading journals, and discovery.

The same capabilities are exposed two ways, both authenticated with the same bearer token:

- **MCP server** (Streamable HTTP): `https://sansfiction.com/api/mcp`
- **REST API** (v1): `https://sansfiction.com/api/v1`

## Quick start (MCP)

```bash
claude mcp add --transport http sansfiction https://sansfiction.com/api/mcp
```

Or point any MCP client at the streamable-HTTP endpoint above. Public catalog tools
need no auth; personal library tools require a bearer token (generate one at
[sansfiction.com/docs/agents](https://sansfiction.com/docs/agents)).

## Quick start (REST)

```bash
# Public catalog — no auth
curl "https://sansfiction.com/api/v1/catalog/search?q=dune&limit=5"

# Personal library — bearer token
curl -H "Authorization: Bearer $SF_TOKEN" \
  "https://sansfiction.com/api/v1/library/books?status=reading"
```

## Capabilities

**Public catalog (no auth)**

- `GET /api/v1/catalog/search?q=…&searchType=all|author|series|mood|isbn`
- `GET /api/v1/catalog/books/{bookId}`
- `GET /api/v1/catalog/series/{seriesId}`
- `GET /api/v1/catalog/collections`

**Personal library (bearer token)**

- `GET/POST /api/v1/library/books` · `PATCH/DELETE /api/v1/library/books/{bookId}`
- `GET /api/v1/library/search`
- `GET /api/v1/library/collections` · `GET /api/v1/library/collections/{id}` · `POST …/items`
- `GET /api/v1/library/stats`

## Discovery

- Agent Skill: [`SKILL.md`](./SKILL.md) — also served at
  `https://sansfiction.com/.well-known/agent-skills/sansfiction-catalog/SKILL.md`
- MCP Registry manifest: [`server.json`](./server.json)
- OpenAPI: `https://sansfiction.com/openapi.json`
- MCP server card: `https://sansfiction.com/.well-known/mcp/server-card.json`

## Authentication

Generate a personal access token (`sf_mcp_…`) while signed in at
[sansfiction.com/docs/agents](https://sansfiction.com/docs/agents). The same token
authenticates both the MCP server and the REST API. Rate limits: 60 req/min
anonymous, 180 req/min authenticated.

## License

The SansFiction service is proprietary. This repository documents its public agent
interface for discovery and integration.

## Run locally as an MCP server (stdio)

This repo also ships a small stdio MCP server that proxies to the hosted REST API,
so you can run it anywhere an MCP client expects a local command:

```bash
npx sansfiction-mcp
# or
npm install && node index.js
```

Environment variables:

- `SANSFICTION_TOKEN` — bearer token (`sf_mcp_…`) for the personal-library tools
  (generate at https://sansfiction.com/docs/agents). Public catalog tools need none.
- `SANSFICTION_BASE_URL` — override the API base (default `https://sansfiction.com`).

Tools: `search_books`, `get_book`, `get_series`, `list_public_collections`,
`list_my_books`, `add_book_to_library`, `update_library_book`,
`remove_book_from_library`, `search_my_library`, `list_my_collections`,
`get_reading_stats`.

### Glama build configuration

- **Build steps:** `["npm install"]`
- **CMD arguments:** `["mcp-proxy","--","node","index.js"]`

`tools/list` requires no network or credentials, so the introspection check passes
without a token.
