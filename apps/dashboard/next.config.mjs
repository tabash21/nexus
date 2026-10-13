/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['kafkajs', 'pg'],
  transpilePackages: ['@nexus/contracts', '@nexus/database'],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    return config;
  },
};

export default nextConfig;
