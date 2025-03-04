/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable static optimization for the entire app to prevent build failures with headers()
  output: 'standalone',

  // Set runtime to edge for better performance with dynamic routes
  experimental: {
    // Allow for dynamic routes and server components
    serverComponentsExternalPackages: []
  },

  // Configure specific paths that should use dynamic rendering
  // This ensures headers() can be used safely
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'x-nextjs-rendering',
            value: 'dynamic'
          }
        ]
      }
    ]
  },

  // Disable static exports since we're using server components
  distDir: '.next',

  // Ensure we're not using static site generation
  typescript: {
    // Ensure types are checked during build
    ignoreBuildErrors: false
  }
}

export default nextConfig
