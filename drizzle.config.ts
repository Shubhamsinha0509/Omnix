import { defineConfig } from 'drizzle-kit';
import { loadEnvConfig } from '@next/env';

// drizzle-kit doesn't read .env by itself — load it the same way Next.js does.
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/mydb',
  },
  tablesFilter: ['!pg_stat_monitor*', '!pg_stat_statements*'],
});
