#!/usr/bin/env node
/**
 * SansFiction MCP server (stdio).
 *
 * A thin, runnable MCP server for the SansFiction books catalog + personal
 * reading library. Tool definitions are local (so `tools/list` works with no
 * network/credentials); tool *calls* proxy to the public REST API at
 * https://sansfiction.com/api/v1.
 *
 * Env:
 *   SANSFICTION_BASE_URL  (default: https://sansfiction.com)
 *   SANSFICTION_TOKEN     bearer token (sf_mcp_...) required only for library tools
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE = (process.env.SANSFICTION_BASE_URL || "https://sansfiction.com").replace(/\/+$/, "");
const TOKEN = process.env.SANSFICTION_TOKEN || "";

const str = { type: "string" };
const num = { type: "number" };

const PUBLIC_TOOLS = [
  {
    name: "search_books",
    description: "Search the public SansFiction catalog by title, author, series, mood, or ISBN.",
    inputSchema: {
      type: "object",
      properties: {
        query: str,
        limit: num,
        searchType: { type: "string", enum: ["all", "author", "series", "mood", "isbn"] },
      },
      required: ["query"],
    },
  },
  {
    name: "get_book",
    description: "Get public metadata for a book by its catalog id or slug.",
    inputSchema: {
      type: "object",
      properties: { book_id: str, edition_id: str },
      required: ["book_id"],
    },
  },
  {
    name: "get_series",
    description: "Get public metadata for a book series and its volumes.",
    inputSchema: { type: "object", properties: { series_id: str }, required: ["series_id"] },
  },
  {
    name: "list_public_collections",
    description: "List public curated collections.",
    inputSchema: { type: "object", properties: { limit: num, offset: num } },
  },
];

const LIBRARY_TOOLS = [
  {
    name: "list_my_books",
    description: "List books in your personal library. Requires SANSFICTION_TOKEN.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["reading", "want", "read", "dnf", "all"] },
        limit: num,
      },
    },
  },
  {
    name: "add_book_to_library",
    description: "Add a book to your library. Requires SANSFICTION_TOKEN.",
    inputSchema: {
      type: "object",
      properties: {
        book_id: str,
        status: { type: "string", enum: ["reading", "want", "read", "dnf"] },
        edition_id: str,
      },
      required: ["book_id"],
    },
  },
  {
    name: "update_library_book",
    description:
      "Update a library book: status, rating, review, started_at, finished_at, or current_page. Requires SANSFICTION_TOKEN.",
    inputSchema: {
      type: "object",
      properties: {
        book_id: str,
        status: { type: "string", enum: ["reading", "want", "read", "dnf"] },
        rating: num,
        review: str,
        started_at: str,
        finished_at: str,
        current_page: num,
      },
      required: ["book_id"],
    },
  },
  {
    name: "remove_book_from_library",
    description: "Remove a book from your library. Requires SANSFICTION_TOKEN.",
    inputSchema: { type: "object", properties: { book_id: str }, required: ["book_id"] },
  },
  {
    name: "search_my_library",
    description: "Search within your personal library. Requires SANSFICTION_TOKEN.",
    inputSchema: {
      type: "object",
      properties: {
        query: str,
        status: { type: "string", enum: ["reading", "want", "read", "dnf", "all"] },
        limit: num,
      },
      required: ["query"],
    },
  },
  {
    name: "list_my_collections",
    description: "List your personal collections. Requires SANSFICTION_TOKEN.",
    inputSchema: { type: "object", properties: { limit: num, query: str } },
  },
  {
    name: "get_reading_stats",
    description: "Get reading stats for a range. Requires SANSFICTION_TOKEN.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["weekly", "monthly", "yearly"] },
        date: str,
        from: str,
        to: str,
        include_logs: { type: "boolean" },
      },
    },
  },
];

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (auth) {
    if (!TOKEN) {
      throw new Error(
        "This tool requires a SansFiction bearer token. Set the SANSFICTION_TOKEN environment variable (generate one at " +
          BASE +
          "/docs/agents)."
      );
    }
    headers.Authorization = `Bearer ${TOKEN}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${text}`);
  return text;
}

const ok = (text) => ({ content: [{ type: "text", text }] });

const server = new Server(
  { name: "sansfiction", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...PUBLIC_TOOLS, ...LIBRARY_TOOLS],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a = {} } = req.params;
  try {
    switch (name) {
      case "search_books":
        return ok(await api(`/api/v1/catalog/search${qs({ q: a.query, limit: a.limit, searchType: a.searchType })}`));
      case "get_book":
        return ok(await api(`/api/v1/catalog/books/${encodeURIComponent(a.book_id)}${qs({ edition_id: a.edition_id })}`));
      case "get_series":
        return ok(await api(`/api/v1/catalog/series/${encodeURIComponent(a.series_id)}`));
      case "list_public_collections":
        return ok(await api(`/api/v1/catalog/collections${qs({ limit: a.limit, offset: a.offset })}`));

      case "list_my_books":
        return ok(await api(`/api/v1/library/books${qs({ status: a.status, limit: a.limit })}`, { auth: true }));
      case "add_book_to_library":
        return ok(
          await api(`/api/v1/library/books`, {
            method: "POST",
            auth: true,
            body: { book_id: a.book_id, status: a.status, edition_id: a.edition_id },
          })
        );
      case "update_library_book":
        return ok(
          await api(`/api/v1/library/books/${encodeURIComponent(a.book_id)}`, {
            method: "PATCH",
            auth: true,
            body: {
              status: a.status,
              rating: a.rating,
              review: a.review,
              started_at: a.started_at,
              finished_at: a.finished_at,
              current_page: a.current_page,
            },
          })
        );
      case "remove_book_from_library":
        return ok(
          await api(`/api/v1/library/books/${encodeURIComponent(a.book_id)}`, { method: "DELETE", auth: true })
        );
      case "search_my_library":
        return ok(
          await api(`/api/v1/library/search${qs({ q: a.query, status: a.status, limit: a.limit })}`, { auth: true })
        );
      case "list_my_collections":
        return ok(await api(`/api/v1/library/collections${qs({ limit: a.limit, query: a.query })}`, { auth: true }));
      case "get_reading_stats":
        return ok(
          await api(
            `/api/v1/library/stats${qs({ scope: a.scope, date: a.date, from: a.from, to: a.to, include_logs: a.include_logs })}`,
            { auth: true }
          )
        );

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return { content: [{ type: "text", text: String(err?.message || err) }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("sansfiction-mcp running on stdio");
