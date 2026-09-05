/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Image remotePatterns for Cloudflare R2 are added in Phase 2 (T2), when the
  // bucket exists. Declaring a wildcard host before then is an open redirect
  // surface on the image optimizer for no benefit.
};

export default nextConfig;
