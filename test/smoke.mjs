/**
 * CI smoke test: spawn the stdio server, run the MCP handshake, and assert that
 * tools/list returns the expected tools. No network or token required.
 */
import { spawn } from "node:child_process";

const EXPECTED_MIN_TOOLS = 11;
const child = spawn("node", ["index.js"], { stdio: ["pipe", "pipe", "inherit"] });

const messages = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ci-smoke", version: "1.0.0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
];

let out = "";
let done = false;

const finish = (code, msg) => {
  if (done) return;
  done = true;
  clearTimeout(timer);
  if (msg) console.log(msg);
  child.kill();
  process.exit(code);
};

const timer = setTimeout(() => finish(1, "FAIL: timed out waiting for tools/list"), 15000);

child.on("error", (e) => finish(1, `FAIL: could not start server: ${e.message}`));

child.stdout.on("data", (chunk) => {
  out += chunk;
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let m;
    try {
      m = JSON.parse(t);
    } catch {
      continue;
    }
    if (m.id === 2) {
      const tools = m.result?.tools ?? [];
      const missingDesc = tools
        .flatMap((tool) =>
          Object.entries(tool.inputSchema?.properties ?? {})
            .filter(([, p]) => !p.description)
            .map(([name]) => `${tool.name}.${name}`)
        );
      if (tools.length < EXPECTED_MIN_TOOLS) {
        return finish(1, `FAIL: expected >= ${EXPECTED_MIN_TOOLS} tools, got ${tools.length}`);
      }
      if (missingDesc.length) {
        return finish(1, `FAIL: parameters missing descriptions: ${missingDesc.join(", ")}`);
      }
      return finish(0, `OK: ${tools.length} tools, all parameters documented`);
    }
  }
});

for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
