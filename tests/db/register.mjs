import { register } from "node:module";

// Lets the real server code (lib/, app/**/actions.js, route handlers) run under plain Node against a real
// MongoDB: see loader.mjs. Run with: npm run test:db
register("./loader.mjs", import.meta.url);
