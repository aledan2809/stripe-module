import './globals.css'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Stripe Admin — Company & Project Manager',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro">
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <Link href="/" className="nav-logo">
              <span>⬡</span> Stripe Module
            </Link>
            <div className="nav-links">
              <Link href="/" className="nav-link">Dashboard</Link>
              <Link href="/companies" className="nav-link">Firme</Link>
              <Link href="/projects" className="nav-link">Proiecte</Link>
              <Link href="/credentials" className="nav-link">Credențiale</Link>
            </div>
          </div>
        </nav>
        <div className="container">
          {children}
        </div>
      </body>
    </html>
  )
}
