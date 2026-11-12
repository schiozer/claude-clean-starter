import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js'

/** CSP do app; no `next dev` o React precisa de `eval` (só lá entra `'unsafe-eval'`). */
const csp = (isDev) =>
  [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    'frame-src https://iframe.mediadelivery.net',
    "frame-ancestors 'none'",
  ].join('; ')

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  // A ajuda lê docs/ajuda/ em tempo de execução (gerado por `npm run docs:gerar`): entra no bundle.
  outputFileTracingIncludes: {
    '/api/ajuda/**': ['./docs/ajuda/**'],
    '/ajuda/**': ['./docs/ajuda/**'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp(phase === PHASE_DEVELOPMENT_SERVER) },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
})

export default nextConfig
