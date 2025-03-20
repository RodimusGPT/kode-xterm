/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Fix SSR errors with SSH2
    config.resolve.alias = {
      ...config.resolve.alias,
      'ssh2': false
    };
    return config;
  }
};

module.exports = nextConfig;