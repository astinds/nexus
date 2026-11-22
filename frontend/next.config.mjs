/** @type {import('next').NextConfig} */
// No native @next/swc-android-arm64 binary is published, so Android/arm64 builds
// must run SWC from the WASM package and must not spawn webpack build workers
// (the worker child process dies with EPIPE on this platform).
const useWasmSwc =
  process.env.NEXUS_SWC_WASM === '1' || process.platform === 'android';

const nextConfig = {
  reactStrictMode: true,
  ...(useWasmSwc
    ? {
        experimental: {
          useWasmBinary: true,
          webpackBuildWorker: false,
          // Forked worker child processes die on this platform (EPIPE), so run
          // the page-data/type-check workers as threads instead.
          workerThreads: true,
        },
      }
    : {}),
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination:
          (process.env.API_BACKEND_URL || 'http://127.0.0.1:8000') + '/api/:path*',
      },
    ];
  },
};

export default nextConfig;
