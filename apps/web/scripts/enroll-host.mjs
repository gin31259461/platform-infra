import { createHash, randomBytes, randomUUID } from "node:crypto";
import process from "node:process";

import pg from "pg";

const allowedOptions = new Set([
  "display-name",
  "host-id",
  "project-path",
  "runner-record-id",
  "stack-id",
  "stack-name",
  "workload",
]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parseOptions(values) {
  const options = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error("Options must use --name value pairs");
    const name = flag.slice(2);
    if (!allowedOptions.has(name) || options.has(name)) throw new Error(`Unsupported or duplicate option: ${flag}`);
    options.set(name, value);
  }
  for (const name of allowedOptions) {
    if (!options.has(name)) throw new Error(`Missing required option: --${name}`);
  }
  return Object.fromEntries(options);
}

async function readSecret() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const options = parseOptions(process.argv.slice(2));
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(options["host-id"])) throw new Error("Invalid Host ID");
  if (!/^[^\u0000-\u001f\u007f]{1,120}$/.test(options["display-name"])) throw new Error("Invalid Host display name");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(options["stack-id"])) throw new Error("Invalid Stack ID");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options["project-path"])) throw new Error("Invalid GitLab project path");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(options["runner-record-id"])) throw new Error("Invalid Runner Record ID");
  const expectedStackName = `gitlab-runners/${options.workload}`;
  if (!["frontend", "dotnet"].includes(options.workload) || options["stack-name"] !== expectedStackName) {
    throw new Error("Stack name and workload must identify a supported Runner Stack");
  }

  const secret = await readSecret();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret)) {
    throw new Error("Credential secret must be 43-128 base64url characters supplied on standard input");
  }

  const credentialId = `hac_${randomBytes(18).toString("base64url")}`;
  const tokenDigest = createHash("sha256").update(secret, "utf8").digest("hex");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const now = new Date();
    await client.query(
      'INSERT INTO "runner_hosts" ("id", "display_name", "enrolled_at", "created_at", "updated_at") VALUES ($1, $2, $3, $3, $3)',
      [options["host-id"], options["display-name"], now],
    );
    await client.query(
      'INSERT INTO "runner_stacks" ("id", "canonical_name", "workload", "host_id", "created_at", "updated_at") VALUES ($1, $2, $3, $4, $5, $5)',
      [options["stack-id"], options["stack-name"], options.workload, options["host-id"], now],
    );
    await client.query(
      'INSERT INTO "runner_record_refs" ("id", "runner_stack_id", "gitlab_runner_id", "project_path") VALUES ($1, $2, $3, $4)',
      [randomUUID(), options["stack-id"], options["runner-record-id"], options["project-path"]],
    );
    await client.query(
      'INSERT INTO "agent_credentials" ("id", "runner_host_id", "runner_stack_id", "token_digest", "created_at") VALUES ($1, $2, $3, $4, $5)',
      [credentialId, options["host-id"], options["stack-id"], tokenDigest, now],
    );
    await client.query(
      'INSERT INTO "audit_events" ("id", "correlation_id", "actor_id", "event_type", "target_type", "target_id", "payload", "occurred_at") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [randomUUID(), randomUUID(), "bootstrap-cli", "runner-host.enrolled", "runner-host", options["host-id"], JSON.stringify({ credentialId, stackId: options["stack-id"] }), now],
    );
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    throw new Error("Enrollment failed; no records were created");
  } finally {
    await client.end();
  }

  process.stdout.write(`${JSON.stringify({ credentialId, hostId: options["host-id"] })}\n`);
}

main().catch((error) => fail(error instanceof Error ? error.message : "Enrollment failed"));
