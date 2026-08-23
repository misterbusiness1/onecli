# Paperclip run binding

Paperclip agent calls to `GET /v1/container-config` must present the signed run binding and exact run, agent, company, and selector comparison headers. Verification occurs before `resolveContainerConfigAgent`, so rejected requests perform no identity or credential lookup.

Required headers for an agent run:

- `X-Paperclip-OneCLI-Run-Binding`
- `X-Paperclip-Run-Id`
- `X-Paperclip-Agent-Id`
- `X-Paperclip-Company-Id`

The `agent` query value is comparison input only. The authenticated binding is authoritative. Omitted or mismatched values fail closed.

Legacy Default resolution is outside the agent path and requires the configured `ONECLI_OPERATOR_CONTEXT_TOKEN` in `X-OneCLI-Operator-Context`. Do not provide that token to agent runtimes.

Paperclip and OneCLI share a managed `PAPERCLIP_ONECLI_BINDING_SECRET`; it is never injected into a run. Existing grants and providers are unchanged. Container delivery remains brokered through the gateway: only its run/agent proxy capability and placeholder credential stubs reach the container, never raw managed provider credentials or shared compatibility files.
