/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // Privy can talk to a Farcaster mini-app host; this app never runs in
    // one, so the optional peer isn't installed. Resolve it to nothing.
    config.resolve.alias = { ...(config.resolve.alias ?? {}), "@farcaster/mini-app-solana": false };
    return config;
  }
};

export default nextConfig;
