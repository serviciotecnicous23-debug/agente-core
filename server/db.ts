import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL no esta configurada. Setea la URL de la Postgres compartida con la web del ministerio."
  );
}

// `max: 5` porque este servicio es liviano; no necesita un pool grande.
const client = postgres(databaseUrl, { max: 5 });

export const db = drizzle(client, { schema });
export { schema };
