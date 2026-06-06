import { hasTailwindConfig, hasTailwindClasses, usesTailwind } from "./tailwind-inliner.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Manual smoke test — run with: npx tsx src/core/tailwind-inliner.test.ts
const twHtml = '<body class="flex min-h-screen"><h1 class="text-5xl font-display">Hi</h1></body>';
const vanillaHtml = '<body><h1 style="font-size:2rem">Hi</h1></body>';

console.log("hasTailwindClasses(twHtml):", hasTailwindClasses(twHtml));     // true
console.log("hasTailwindClasses(vanillaHtml):", hasTailwindClasses(vanillaHtml)); // false
console.log("usesTailwind + classes:", usesTailwind(twHtml));               // true
console.log("usesTailwind vanilla:", usesTailwind(vanillaHtml));            // false

// Check against Mino page
const minoHtml = readFileSync(resolve(process.cwd(), "inputs/mino/index.html"), "utf-8");
console.log("hasTailwindConfig in Mino:", hasTailwindConfig(minoHtml)); // true
