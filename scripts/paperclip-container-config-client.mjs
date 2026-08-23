#!/usr/bin/env node

const required = [
  "ONECLI_URL",
  "ONECLI_AGENT",
  "PAPERCLIP_ONECLI_RUNTIME_BINDING",
  "PAPERCLIP_RUN_ID",
  "PAPERCLIP_AGENT_ID",
  "PAPERCLIP_COMPANY_ID",
];

const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length > 0) {
  process.stderr.write(
    `OneCLI capability unavailable: missing ${missing.join(", ")}\n`,
  );
  process.exitCode = 78;
} else {
  const url = new URL("/v1/container-config", process.env.ONECLI_URL);
  url.searchParams.set("agent", process.env.ONECLI_AGENT.trim());
  const response = await fetch(url, {
    headers: {
      "X-Paperclip-OneCLI-Run-Binding":
        process.env.PAPERCLIP_ONECLI_RUNTIME_BINDING.trim(),
      "X-Paperclip-Run-Id": process.env.PAPERCLIP_RUN_ID.trim(),
      "X-Paperclip-Agent-Id": process.env.PAPERCLIP_AGENT_ID.trim(),
      "X-Paperclip-Company-Id": process.env.PAPERCLIP_COMPANY_ID.trim(),
    },
  });
  if (!response.ok) {
    process.stderr.write(
      `OneCLI container configuration rejected (${response.status})\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(await response.text());
  }
}
