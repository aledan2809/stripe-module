'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function Dashboard() {
  const [companies, setCompanies] = useState<any[]>([])
  const [mappings, setMappings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/companies').then(r => r.json()),
      fetch('/api/projects').then(r => r.json()),
    ]).then(([comps, projs]) => {
      setCompanies(comps)
      setMappings(projs.mappings || [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="page-header"><p className="text-muted">Se încarcă...</p></div>

  const totalProjects = mappings.length
  const testProjects = mappings.filter((m: any) => m.environment === 'test').length
  const liveProjects = mappings.filter((m: any) => m.environment === 'live').length

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-desc">Administrare firme, proiecte și credențiale Stripe</p>
      </div>

      <div className="page-content">
        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--stripe-purple)' }}>{companies.length}</div>
            <div className="text-muted text-sm">Firme înregistrate</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700 }}>{totalProjects}</div>
            <div className="text-muted text-sm">Proiecte asignate</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--yellow)' }}>{testProjects}</div>
            <div className="text-muted text-sm">Mod test</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--green)' }}>{liveProjects}</div>
            <div className="text-muted text-sm">Mod live</div>
          </div>
        </div>

        {/* Companies overview */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Firme</div>
              <div className="card-subtitle">Firmele înregistrate și proiectele lor</div>
            </div>
            <Link href="/companies" className="btn btn-primary btn-sm">+ Adaugă firmă</Link>
          </div>

          {companies.length === 0 ? (
            <p className="text-muted">Nicio firmă înregistrată. <Link href="/companies">Adaugă prima firmă</Link>.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {companies.map((c: any) => (
                <div key={c.slug} className="company-card" onClick={() => window.location.href = '/companies'}>
                  <div className="company-info">
                    <div className="company-name">{c.name}</div>
                    <div className="company-detail">
                      {c.cui || 'CUI necompletat'} · {c.currency.toUpperCase()} · {c.country}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <span className={`badge ${c.stripeEnvironment === 'live' ? 'badge-live' : 'badge-test'}`}>
                        {c.stripeEnvironment}
                      </span>
                      {c.projects?.length > 0 && (
                        <span className="badge badge-none">{c.projects.length} proiecte</span>
                      )}
                    </div>
                  </div>
                  <div className="company-actions">
                    <span className={`status-dot ${c.credentials?.test?.secretKey ? 'green' : 'gray'}`} title="Test keys" />
                    <span className={`status-dot ${c.credentials?.live?.secretKey ? 'green' : 'gray'}`} title="Live keys" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick guide */}
        <div className="guide">
          <div className="guide-title">🚀 Ghid rapid de setup</div>
          <ol>
            <li><strong>Adaugă firma</strong> → pagina <Link href="/companies">Firme</Link> (nume, CUI, adresă)</li>
            <li><strong>Configurează cheile Stripe</strong> → pagina <Link href="/credentials">Credențiale</Link> (din Stripe Dashboard)</li>
            <li><strong>Asignează proiecte</strong> → pagina <Link href="/projects">Proiecte</Link> (selectează firma pentru fiecare proiect)</li>
            <li><strong>Testează conexiunea</strong> → butonul "Test conexiune" din Credențiale</li>
            <li><strong>Switch la producție</strong> → când ești gata, schimbă modul din Test în Live</li>
          </ol>
        </div>
      </div>
    </>
  )
}
