import type { ReactNode } from 'react'

export const metadata = {
  title: 'Walking Skeleton',
  description: 'Exemplo end-to-end do claude-clean-starter',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
