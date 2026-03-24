'use client'

import { useState, useEffect } from 'react'

interface ProjectInfo { slug: string; path: string }
interface Mapping { projectSlug: string; projectPath: string; companySlug: string; environment: 'test' | 'live' }
interface Company { slug: string; name: string }

export default function ProjectsPage() {
  const [available, setAvailable] = useState<ProjectInfo[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [assigned, setAssigned] = useState<string[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null)
  const [filter, setFilter] = useState('')

  const load = async () => {
    const [projData, compData] = await Promise.all([
      fetch('/api/projects').then(r => r.json()),
      fetch('/api/companies').then(r => r.json()),
    ])
    setAvailable(projData.available)
    setMappings(projData.mappings)
    setAssigned(projData.assigned)
    setCompanies(compData)
  }

  useEffect(() => { load() }, [])

  const assignProject = async (project: ProjectInfo, companySlug: string) => {
    const mapping: Mapping = {
      projectSlug: project.slug,
      projectPath: project.path,
      companySlug,
      environment: 'test', // Default to test
    }
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapping),
    })
    setMessage({ type: 'success', text: `${project.slug} asignat la ${companySlug}` })
    load()
  }

  const unassignProject = async (projectSlug: string) => {
    await fetch(`/api/projects?projectSlug=${projectSlug}`, { method: 'DELETE' })
    setMessage({ type: 'success', text: `${projectSlug} dezasignat` })
    load()
  }

  const toggleEnvironment = async (mapping: Mapping) => {
    const newEnv = mapping.environment === 'test' ? 'live' : 'test'

    if (newEnv === 'live' && !confirm(
      `⚠️ Treci proiectul "${mapping.projectSlug}" pe PRODUCȚIE (Live)?\n\n` +
      `Asigură-te că:\n` +
      `• Ai chei Live configurate pentru firma "${mapping.companySlug}"\n` +
      `• Ai testat complet în mod Test\n` +
      `• Webhook-urile sunt configurate pentru producție în Stripe Dashboard`
    )) return

    const updated = { ...mapping, environment: newEnv }
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
    setMessage({ type: 'success', text: `${mapping.projectSlug} → ${newEnv.toUpperCase()}` })
    load()
  }

  const unassignedProjects = available.filter(
    p => !assigned.includes(p.slug) && p.slug.toLowerCase().includes(filter.toLowerCase())
  )

  // Group mappings by company
  const mappingsByCompany: Record<string, Mapping[]> = {}
  for (const m of mappings) {
    if (!mappingsByCompany[m.companySlug]) mappingsByCompany[m.companySlug] = []
    mappingsByCompany[m.companySlug].push(m)
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Proiecte</h1>
        <p className="page-desc">Asignează proiecte la firme și controlează mediul (Test / Live)</p>
      </div>

      <div className="page-content">
        {/* Guide */}
        <div className="guide">
          <div className="guide-title">ℹ️ Cum funcționează asignarea proiectelor</div>
          <ul>
            <li><strong>Fiecare proiect</strong> poate fi asignat la <strong>o singură firmă</strong> (exclusiv)</li>
            <li><strong>Mod Test</strong> — folosește cheile <code>sk_test_</code> / <code>pk_test_</code> din Stripe</li>
            <li><strong>Mod Live</strong> — folosește cheile <code>sk_live_</code> / <code>pk_live_</code> (bani reali!)</li>
            <li>Switch-ul <strong>Test ↔ Live</strong> se poate face oricând per proiect</li>
            <li>Proiectele sunt detectate automat din <code>C:/Projects/</code></li>
          </ul>
        </div>

        {message && (
          <div className={`alert alert-${message.type}`}>{message.text}</div>
        )}

        {/* Assigned projects grouped by company */}
        {companies.map(company => {
          const companyMappings = mappingsByCompany[company.slug] || []
          return (
            <div key={company.slug} className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">{company.name}</div>
                  <div className="card-subtitle">{companyMappings.length} proiecte asignate</div>
                </div>
              </div>

              {companyMappings.length === 0 ? (
                <p className="text-muted text-sm">Niciun proiect asignat acestei firme</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {companyMappings.map(m => (
                    <div key={m.projectSlug} className="mapping-card">
                      <div>
                        <div className="project-name">{m.projectSlug}</div>
                        <div className="text-sm text-muted">{m.projectPath}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Test/Live switch */}
                        <div className="switch-container">
                          <span className={`switch-label ${m.environment === 'test' ? 'text-yellow' : 'text-muted'}`} style={{ fontSize: 12, fontWeight: 600 }}>TEST</span>
                          <label className="switch">
                            <input type="checkbox" checked={m.environment === 'live'}
                              onChange={() => toggleEnvironment(m)} />
                            <span className="switch-slider" />
                          </label>
                          <span className={`switch-label ${m.environment === 'live' ? 'text-green' : 'text-muted'}`} style={{ fontSize: 12, fontWeight: 600 }}>LIVE</span>
                        </div>
                        <button className="btn btn-danger btn-sm" onClick={() => unassignProject(m.projectSlug)}>
                          Dezasignează
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Unassigned projects */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Proiecte disponibile</div>
              <div className="card-subtitle">Proiecte din C:/Projects/ neasignate la nicio firmă</div>
            </div>
          </div>

          <input className="form-input w-full mb-4" placeholder="Caută proiect..."
            value={filter} onChange={e => setFilter(e.target.value)} />

          {companies.length === 0 ? (
            <div className="alert alert-info">Adaugă mai întâi o firmă în pagina Firme.</div>
          ) : unassignedProjects.length === 0 ? (
            <p className="text-muted text-sm">
              {filter ? 'Niciun proiect găsit' : 'Toate proiectele sunt asignate'}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Proiect</th>
                    <th>Cale</th>
                    <th style={{ width: 200 }}>Asignează la firma</th>
                  </tr>
                </thead>
                <tbody>
                  {unassignedProjects.map(p => (
                    <tr key={p.slug}>
                      <td style={{ fontWeight: 500 }}>{p.slug}</td>
                      <td className="text-muted text-sm">{p.path}</td>
                      <td>
                        <select className="form-select w-full"
                          defaultValue=""
                          onChange={e => {
                            if (e.target.value) assignProject(p, e.target.value)
                            e.target.value = ''
                          }}>
                          <option value="">Selectează...</option>
                          {companies.map(c => (
                            <option key={c.slug} value={c.slug}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
