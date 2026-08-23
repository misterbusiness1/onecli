import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import test from "node:test";

const client = new URL(
  "./paperclip-container-config-client.mjs",
  import.meta.url,
);

function run(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [client.pathname], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("actual client transports the authenticated Paperclip context headers", async () => {
  let observed;
  const server = createServer((request, response) => {
    observed = { url: request.url, headers: request.headers };
    response.setHeader("content-type", "application/json");
    response.end('{"env":{}}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const result = await run({
      PATH: process.env.PATH,
      ONECLI_URL: `http://127.0.0.1:${address.port}`,
      ONECLI_API_KEY: "api-proof",
      ONECLI_AGENT: "occ-plugin-engineer",
      PAPERCLIP_ONECLI_RUNTIME_BINDING: "binding-proof",
      PAPERCLIP_RUN_ID: "run-1",
      PAPERCLIP_AGENT_ID: "agent-1",
      PAPERCLIP_COMPANY_ID: "company-1",
    });
    assert.equal(result.code, 0);
    assert.equal(
      observed.url,
      "/v1/container-config?agent=occ-plugin-engineer",
    );
    assert.equal(
      observed.headers["x-paperclip-onecli-run-binding"],
      "binding-proof",
    );
    assert.equal(observed.headers["x-paperclip-run-id"], "run-1");
    assert.equal(observed.headers["x-paperclip-agent-id"], "agent-1");
    assert.equal(observed.headers["x-paperclip-company-id"], "company-1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("unbound execution fails closed before a OneCLI request", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.end("unexpected");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const result = await run({
      PATH: process.env.PATH,
      ONECLI_URL: `http://127.0.0.1:${address.port}`,
      ONECLI_API_KEY: "api-proof",
    });
    assert.equal(result.code, 78);
    assert.equal(requests, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
