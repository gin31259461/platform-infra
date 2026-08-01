import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const snakeCase = /^[a-z][a-z0-9_]*$/;
const baseMigrationPath = fileURLToPath(
  new URL("../../../prisma/migrations/20260801000000_base/migration.sql", import.meta.url),
);
const hostEnrollmentPath = fileURLToPath(
  new URL("../../../scripts/enroll-host.mjs", import.meta.url),
);

describe("PostgreSQL naming", () => {
  it("uses snake_case identifiers and plural table names in the base migration", () => {
    const migration = readFileSync(baseMigrationPath, "utf8");
    const migrationWithoutStringLiterals = migration.replace(/'(?:''|[^'])*'/gs, "''");
    const identifiers = [...migrationWithoutStringLiterals.matchAll(/"([^"]+)"/g)].map(
      ([, identifier]) => identifier,
    );
    const tableNames = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map(
      ([, tableName]) => tableName,
    );

    expect(identifiers.length).toBeGreaterThan(0);
    expect(identifiers.filter((identifier) => !snakeCase.test(identifier))).toEqual([]);
    expect(tableNames.length).toBeGreaterThan(0);
    expect(tableNames.filter((tableName) => !tableName.endsWith("s"))).toEqual([]);
  });

  it("uses snake_case identifiers in Host enrollment SQL", () => {
    const source = readFileSync(hostEnrollmentPath, "utf8");
    const statements = [...source.matchAll(/'(INSERT INTO [^']+)'/g)].map(
      ([, statement]) => statement,
    );
    const identifiers = statements.flatMap((statement) =>
      [...statement.matchAll(/"([^"]+)"/g)].map(([, identifier]) => identifier),
    );

    expect(statements).toHaveLength(5);
    expect(identifiers.filter((identifier) => !snakeCase.test(identifier))).toEqual([]);
  });
});
