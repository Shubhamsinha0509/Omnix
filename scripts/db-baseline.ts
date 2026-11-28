/**
 * Marks the baseline migration (drizzle/0000_baseline.sql) as already applied, on a
 * database that was built with `db:push` before migrations existed (D58).
 *
 *   npm run db:baseline
 *
 * Without this, `db:migrate` would try to create tables that are already there. It only
 * records the baseline after checking that every table and column in it already exists
 * with the same nullability, so it can't hide a difference; on a fresh database it does
 * nothing and says to run `db:migrate` instead. Safe to run twice.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
require("@next/env").loadEnvConfig(root, true, { info() {}, error() {} });

type Snapshot = {
  tables: Record<string, { name: string; schema: string; columns: Record<string, { name: string; notNull: boolean }> }>;
};

async function main() {
  const folder = path.join(root, "drizzle");
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const baseline = journal.entries.find((entry) => entry.idx === 0);
  if (!baseline) throw new Error("drizzle/meta/_journal.json has no first migration.");
  const sqlText = fs.readFileSync(path.join(folder, `${baseline.tag}.sql`), "utf8");
  const hash = crypto.createHash("sha256").update(sqlText).digest("hex");
  const snapshot = JSON.parse(fs.readFileSync(path.join(folder, "meta", "0000_snapshot.json"), "utf8")) as Snapshot;

  const sql = require("postgres")(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    const [{ exists: hasUsers }] = await sql`select to_regclass('public.users') is not null as exists`;
    if (!hasUsers) {
      console.log("This database is empty. Nothing to baseline: run `npm run db:migrate` to create everything.");
      return;
    }

    await sql`create schema if not exists drizzle`;
    await sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
    const recorded = await sql`select hash from drizzle.__drizzle_migrations`;
    if (recorded.length > 0) {
      console.log(`Already using migrations (${recorded.length} recorded). Nothing to do.`);
      return;
    }

    // The database must already be exactly what the baseline would create.
    const columns = await sql`
      select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public'`;
    const actual = new Map<string, Map<string, boolean>>();
    for (const c of columns) {
      if (!actual.has(c.table_name)) actual.set(c.table_name, new Map());
      actual.get(c.table_name)!.set(c.column_name, c.is_nullable === "NO");
    }
    const problems: string[] = [];
    for (const table of Object.values(snapshot.tables)) {
      const have = actual.get(table.name);
      if (!have) {
        problems.push(`table ${table.name} is missing`);
        continue;
      }
      for (const column of Object.values(table.columns)) {
        if (!have.has(column.name)) problems.push(`${table.name}.${column.name} is missing`);
        else if (have.get(column.name) !== column.notNull) {
          problems.push(`${table.name}.${column.name} is ${have.get(column.name) ? "NOT NULL" : "nullable"} here`);
        }
      }
    }
    if (problems.length > 0) {
      console.error(`Not baselined: this database differs from the baseline.\n- ${problems.join("\n- ")}\nBring it in line first (npm run db:push), then run this again.`);
      process.exitCode = 1;
      return;
    }

    await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${baseline.when})`;
    console.log(`Baselined: ${Object.keys(snapshot.tables).length} tables match ${baseline.tag}, recorded as applied. From now on use npm run db:generate and npm run db:migrate.`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
