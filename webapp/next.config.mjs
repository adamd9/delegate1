/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // Required for static export: disable server-side image optimisation
  images: { unoptimized: true },
};

export default nextConfig;
