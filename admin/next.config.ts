import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Allow reading data files from parent directory
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
}

export default nextConfig
