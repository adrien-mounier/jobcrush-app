/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3001";

// The web app proxies /api/* to the Fastify API — same-origin in the browser, so the
// httpOnly session cookie and SSE work with zero CORS configuration.
const nextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
