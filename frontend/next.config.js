/** @type {import('next').NextConfig} */
const nextConfig = {
  // /api/* is forwarded to the backend by src/app/api/[...path]/route.ts, which reads
  // BACKEND_URL at runtime. A rewrite here would freeze the address at build time.
};

module.exports = nextConfig;
