#!/usr/bin/env node
/**
 * Copies the launch film and its poster next to the hosted bundle.
 *
 * They live in ../brag-output rather than public/, so the 2.6 MB mp4 is stored
 * once in the repository instead of once per build input. Missing files are a
 * hard error: a preview whose "watch the film" button 404s is worse than one
 * that never offered it.
 */
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-hosted");
const media = path.resolve(root, "..", "brag-output");

if (!existsSync(path.join(out, "index.html"))) {
  throw new Error("Missing hosted build: run vite build --outDir dist-hosted first");
}

for (const file of ["brag.mp4", "brag.jpg"]) {
  const from = path.join(media, file);
  if (!existsSync(from)) throw new Error("Missing hosted build input: " + from);
  copyFileSync(from, path.join(out, file));
}

// Deploy config travels with the bundle, so `vercel deploy dist-hosted` is the
// whole command -- no project settings to remember or re-enter.
const vercelConfig = path.join(root, "vercel.json");
if (existsSync(vercelConfig)) copyFileSync(vercelConfig, path.join(out, "vercel.json"));

console.log("Prepared hosted build: dist-hosted/ with brag.mp4, brag.jpg and vercel.json");
