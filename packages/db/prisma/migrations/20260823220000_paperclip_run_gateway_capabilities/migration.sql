CREATE TABLE "paperclip_run_gateway_capabilities" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "paperclip_company_id" TEXT NOT NULL,
    "paperclip_agent_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paperclip_run_gateway_capabilities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "paperclip_run_gateway_capabilities_token_hash_key"
    ON "paperclip_run_gateway_capabilities"("token_hash");
CREATE UNIQUE INDEX "paperclip_run_gateway_capabilities_run_id_paperclip_company_key"
    ON "paperclip_run_gateway_capabilities"("run_id", "paperclip_company_id", "paperclip_agent_id", "agent_id");
CREATE INDEX "paperclip_run_gateway_capabilities_run_id_paperclip_company_idx"
    ON "paperclip_run_gateway_capabilities"("run_id", "paperclip_company_id", "paperclip_agent_id");
CREATE INDEX "paperclip_run_gateway_capabilities_agent_id_expires_at_idx"
    ON "paperclip_run_gateway_capabilities"("agent_id", "expires_at");

ALTER TABLE "paperclip_run_gateway_capabilities"
    ADD CONSTRAINT "paperclip_run_gateway_capabilities_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
