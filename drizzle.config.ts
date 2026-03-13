import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

export default defineConfig({
    dialect: "postgresql",
    schema: process.env.NODE_ENV === "production" ? "./dist/db/schema.js" : "./src/db/schema.ts",
    out: "./drizzle/migrations",
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
    verbose: true,
    strict: true,
});
