# Paperclip run binding

Paperclip agent calls to `GET /v1/container-config` must present the signed run binding and exact run, agent, company, and selector comparison headers. Verification occurs before `resolveContainerConfigAgent`, so rejected requests perform no identity or credential lookup.

Required headers for an agent run:

- `X-Paperclip-OneCLI-Run-Binding`
- `X-Paperclip-Run-Id`
- `X-Paperclip-Agent-Id`
- `X-Paperclip-Company-Id`

The `agent` query value is comparison input only. The authenticated binding is authoritative. Omitted or mismatched values fail closed.

Legacy Default resolution is outside the agent path and requires the configured `ONECLI_OPERATOR_CONTEXT_TOKEN` in `X-OneCLI-Operator-Context`. Do not provide that token to agent runtimes.

Paperclip and OneCLI share a managed `PAPERCLIP_ONECLI_BINDING_SECRET`; it is never injected into a run. Existing grants and providers are unchanged. The shipped agent client does not read or send `ONECLI_API_KEY` or operator authority: the signed, run-scoped binding is its only container-config credential.

For a bound request, OneCLI creates a distinct opaque `aor_` gateway lease. Only its SHA-256 digest is stored. The persisted row binds the Paperclip run/company/agent to the selected OneCLI agent and the project→organization relation read from OneCLI's database. The gateway validates that row on every CONNECT and tunneled request, including expiry and revocation, before using cached policy. Lease expiry is never more than 300 seconds away. Paperclip renews the lease during a long active run and treats terminal revocation as part of the run completion barrier. The persistent `agent.accessToken` remains available only to the positively authorized operator path and is never selected or returned for a bound runtime.

## Compatible deployment order

1. Apply the OneCLI capability-table migration, then deploy the OneCLI API and gateway from the same artifact. Existing operator clients continue to use persistent agent tokens and the positively configured operator context; no bound runtime is enabled yet.
2. Deploy the shipped onecli-cli client that sends exactly one capability-bearing `/v1/container-config` request without management `Authorization`.
3. Deploy Paperclip lease renewal/revocation and immutable runtime context injection. Agents without `ONECLI_AGENT` continue to spawn but perform no OneCLI network request.
4. Enable bound agent runtime wrappers, then remove legacy agent-side Default lookup. Operator Default resolution remains available only through the external operator token.

Rollback is ordered in reverse: stop new bound spawns, let active leases revoke or expire (maximum 300 seconds), restore Paperclip and onecli-cli, then restore the prior OneCLI API/gateway. Keep the additive capability table during rollback; drop it only in a later approved cleanup after no new binary references it. No provider mutation, grant widening, or WooCommerce scope change is involved.
