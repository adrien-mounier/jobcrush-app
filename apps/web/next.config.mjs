/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3001";

// The web app proxies /api/* to the Fastify API — same-origin in the browser, so the
// httpOnly session cookie and SSE work with zero CORS configuration.
const nextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
  // #377 (ADR-0018): "Your CV, reviewed" is now the profile's check mode. The old address forwards
  // there; the page itself stays on disk until #386 retires it, unreachable.
  async redirects() {
    return [{ source: "/review", destination: "/profile/check", permanent: false }];
  },
};

export default nextConfig;
