/** @type {import('next').NextConfig} */
const nextConfig = {
  // Suppress heartbeat logs for Twilio API routes
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  // Custom server configuration to suppress specific route logs
  experimental: {
    serverComponentsExternalPackages: [],
  },
};

export default nextConfig;
