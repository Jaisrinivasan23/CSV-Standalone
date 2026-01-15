import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone', // Required for AWS Lambda deployment
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'topmate-staging.s3.ap-south-1.amazonaws.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.s3.*.amazonaws.com',
        pathname: '/**',
      },
    ],
    unoptimized: process.env.DISABLE_IMAGE_OPTIMIZATION === 'true',
  },
};

export default nextConfig;
