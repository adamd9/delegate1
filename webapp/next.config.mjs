import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Required for monorepo: trace files from the repo root so hoisted node_modules are included
  outputFileTracingRoot: path.join(__dirname, '../'),
};

export default nextConfig;
