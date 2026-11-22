// ARM64 Android runner.
//
// No native @next/swc-android-arm64 binary is published, so Next.js must use the
// WASM SWC build. Next only passes `experimental.useWasmBinary` to *some*
// loadBindings() call sites: `getBinaryMetadata()` calls loadBindings() with no
// argument, falls back to the missing native binary and exits the process.
//
// loadBindings() caches its first call in a module-level promise, so loading the
// WASM bindings here first makes every later call (including the argument-less
// ones) reuse them.
//
// This only runs on Android (or when NEXUS_SWC_WASM=1 is explicitly set) so that
// Linux/Vercel builds use native SWC cleanly with no experimental flags.
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const swc = require('next/dist/build/swc');

const isAndroid = process.platform === 'android';
const forceWasm = process.env.NEXUS_SWC_WASM === '1';

if (isAndroid || forceWasm) {
  await swc.loadBindings(true);
}

process.argv = [process.argv[0], 'next', ...process.argv.slice(2)];
require('next/dist/bin/next');
