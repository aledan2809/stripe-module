'use client'

import { useState, useEffect } from 'react'

interface ProjectInfo { slug: string; path: string }
interface Mapping {
  projectSlug: string; projectPath: string
  subscriptionCompany: string; subscriptionEnv: 'test' | 'live'
  serviceCompany: string; serviceEnv: 'test' | 'live'
}
interface Company { slug: string; name: string }

const EMPTY_MAPPING: Omit<Mapping, 'projectSlug' | 'projectPath'> = {
  subscriptionCompany: '', subscriptionEnv: 'test',
  serviceCompany: '', serviceEnv: 'test',
}

export default function ProjectsPage() {
  const [available, setAvailable] = useState<ProjectInfo[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [editing, setEditing] = useState<Mapping | null>(null)
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null)
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const [projData, compData] = await Promise.all([
      fetch('/api/projects').then(r => r.json()),
      fetch('/api/companies').then(r => r.json()),
    ])
    setAvailable(projData.available)
    setMappings(projData.mappings)
    setCompanies(compData)
  }

  useEffect(() => { load() }, [])

  const openConfig = (project: ProjectInfo) => {
    const existing = mappings.find(m => m.projectSlug === project.slug)
    setEditing(existing || {
      projectSlug: project.slug,
      projectPath: project.path,
      ...EMPTY_MAPPING,
    })
    setMessage(null)
  }

  const saveMapping = async () => {
    if (!editing) return
    setSaving(true)
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    })
    setMessage({ type: 'success', text: `Configurare salvată pentru ${editing.projectSlug}` })
    setEditing(null)
    setSaving(false)
    load()
  }

  const removeMapping = async (projectSlug: string) => {
    if (!confirm(`Elimini configurarea Stripe pentru "${projectSlug}"?`)) return
    await fetch(`/api/projects?projectSlug=${projectSlug}`, { method: 'DELETE' })
    setMessage({ type: 'success', text: `${projectSlug} dezasignat` })
    load()
  }

  const toggleEnv = async (mapping: Mapping, type: 'subscription' | 'service') => {
    const envField = type === 'subscription' ? 'subscriptionEnv' : 'serviceEnv'
    const current = mapping[envField]
    const newEnv = current === 'test' ? 'live' : 'test'

    if (newEnv === 'live' && !confirm(
      `⚠️ Treci ${type === 'subscription' ? 'ABONAMENTUL' : 'PLĂȚILE SERVICII'} pe PRODUCȚIE (Live) pentru "${mapping.projectSlug}"?\n\n` +
      `Bani REALI vor fi procesați!`
    )) return

    const updated = { ...mapping, [envField]: newEnv }
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
    setMessage({ type: 'success', text: `${mapping.projectSlug} ${type} → ${newEnv.toUpperCase()}` })
    load()
  }

  const getCompanyName = (slug: string) => companies.find(c => c.slug === slug)?.name || slug || '—'

  const configuredProjects = mappings.filter(m => m.subscriptionCompany || m.serviceCompany)
  const configuredSlugs = configuredProjects.map(m => m.projectSlug)
  const unconfiguredProjects = available.filter(
    p => !configuredSlugs.includes(p.slug) && p.slug.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Proiecte</h1>
        <p className="page-desc">Configurare Stripe per proiect — abonamente SaaS + plăți servicii</p>
      </div>

      <div className="page-content">
        {/* Guide */}
        <div className="guide">
          <div className="guide-title">ℹ️ Cele 2 tipuri de încasări per proiect</div>
          <ul>
            <li>
              <strong style={{ color: '#a78bfa' }}>Abonament SaaS</strong> — clientul plătește pentru folosirea aplicației.
              Banii vin la <strong>firma ta</strong>.
              <br/><span style={{ opacity: 0.8 }}>Ex: Administratorul BlocHub plătește abonamentul la Class RDA Impex SRL</span>
            </li>
            <li>
              <strong style={{ color: '#34d399' }}>Plăți servicii</strong> — utilizatorii finali plătesc prin aplicație pentru servicii.
              Banii vin la <strong>clientul tău</strong> (sau la tine, depinde de model).
              <br/><span style={{ opacity: 0.8 }}>Ex: Proprietarii plătesc întreținerea prin BlocHub → banii merg la asociația de proprietari</span>
            </li>
          </ul>
          <p className="mt-2">Fiecare tip poate avea <strong>firmă Stripe diferită</strong> și <strong>mediu separat</strong> (Test/Live).</p>
        </div>

        {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

        {/* Configured projects */}
        {configuredProjects.length > 0 && (
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Proiecte configurate</div>
                <div className="card-subtitle">{configuredProjects.length} proiecte cu Stripe activ</div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {configuredProjects.map(m => (
                <div key={m.projectSlug} style={{
                  background: 'var(--bg-input)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: 16,
                }}>
                  {/* Project header */}
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>{m.projectSlug}</div>
                      <div className="text-sm text-muted">{m.projectPath}</div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditing({ ...m })}>Editează</button>
                      <button className="btn btn-danger btn-sm" onClick={() => removeMapping(m.projectSlug)}>Elimină</button>
                    </div>
                  </div>

                  {/* Two columns: Subscription + Service */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {/* Subscription */}
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#a78bfa' }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#a78bfa' }}>Abonament SaaS</span>
                      </div>
                      {m.subscriptionCompany ? (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>{getCompanyName(m.subscriptionCompany)}</div>
                          <div className="flex items-center gap-2 mt-2">
                            <div className="switch-container">
                              <span className={`switch-label ${m.subscriptionEnv === 'test' ? 'text-yellow' : 'text-muted'}`} style={{ fontSize: 11, fontWeight: 600 }}>TEST</span>
                              <label className="switch" style={{ width: 40, height: 22 }}>
                                <input type="checkbox" checked={m.subscriptionEnv === 'live'}
                                  onChange={() => toggleEnv(m, 'subscription')} />
                                <span className="switch-slider" />
                              </label>
                              <span className={`switch-label ${m.subscriptionEnv === 'live' ? 'text-green' : 'text-muted'}`} style={{ fontSize: 11, fontWeight: 600 }}>LIVE</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <span className="text-sm text-muted">Neconfigurat</span>
                      )}
                    </div>

                    {/* Service */}
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#34d399' }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#34d399' }}>Plăți servicii</span>
                      </div>
                      {m.serviceCompany ? (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>{getCompanyName(m.serviceCompany)}</div>
                          <div className="flex items-center gap-2 mt-2">
                            <div className="switch-container">
                              <span className={`switch-label ${m.serviceEnv === 'test' ? 'text-yellow' : 'text-muted'}`} style={{ fontSize: 11, fontWeight: 600 }}>TEST</span>
                              <label className="switch" style={{ width: 40, height: 22 }}>
                                <input type="checkbox" checked={m.serviceEnv === 'live'}
                                  onChange={() => toggleEnv(m, 'service')} />
                                <span className="switch-slider" />
                              </label>
                              <span className={`switch-label ${m.serviceEnv === 'live' ? 'text-green' : 'text-muted'}`} style={{ fontSize: 11, fontWeight: 600 }}>LIVE</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <span className="text-sm text-muted">Neconfigurat — fără plăți servicii</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unconfigured projects */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Proiecte disponibile</div>
              <div className="card-subtitle">Click pe un proiect pentru a configura Stripe</div>
            </div>
          </div>

          <input className="form-input w-full mb-4" placeholder="Caută proiect..."
            value={filter} onChange={e => setFilter(e.target.value)} />

          {companies.length === 0 ? (
            <div className="alert alert-info">Adaugă mai întâi o firmă în pagina Firme.</div>
          ) : unconfiguredProjects.length === 0 ? (
            <p className="text-muted text-sm">
              {filter ? 'Niciun proiect găsit' : 'Toate proiectele sunt configurate'}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {unconfiguredProjects.map(p => (
                <div key={p.slug}
                  onClick={() => openConfig(p)}
                  style={{
                    padding: '10px 16px', cursor: 'pointer', borderRadius: 8,
                    border: '1px solid var(--border)', transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--stripe-purple)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  <span style={{ fontWeight: 500 }}>{p.slug}</span>
                  <span className="text-sm text-muted" style={{ marginLeft: 12 }}>{p.path}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── Config Modal ─── */}
        {editing && (
          <div className="modal-overlay" onClick={() => setEditing(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 600 }}>
              <div className="modal-title">Configurare Stripe: {editing.projectSlug}</div>

              {/* Subscription config */}
              <div style={{
                border: '1px solid #7c3aed33', borderRadius: 10, padding: 16, marginBottom: 16,
                background: 'rgba(167, 139, 250, 0.05)',
              }}>
                <div className="flex items-center gap-2 mb-4">
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#a78bfa' }} />
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#a78bfa' }}>Abonament SaaS</span>
                </div>
                <p className="text-sm text-muted mb-4">
                  Firma care primește banii pentru abonamentul la aplicație (de la clientul tău)
                </p>
                <div className="form-group">
                  <label className="form-label">Firma care încasează abonamentul</label>
                  <select className="form-select" value={editing.subscriptionCompany}
                    onChange={e => setEditing({ ...editing, subscriptionCompany: e.target.value })}>
                    <option value="">— Selectează firma —</option>
                    {companies.map(c => (
                      <option key={c.slug} value={c.slug}>{c.name}</option>
                    ))}
                  </select>
                </div>
                {editing.subscriptionCompany && (
                  <div className="form-group mt-4">
                    <label className="form-label">Mediu</label>
                    <div className="switch-container">
                      <span className={editing.subscriptionEnv === 'test' ? 'text-yellow' : 'text-muted'} style={{ fontSize: 13, fontWeight: 600 }}>TEST</span>
                      <label className="switch">
                        <input type="checkbox" checked={editing.subscriptionEnv === 'live'}
                          onChange={e => setEditing({ ...editing, subscriptionEnv: e.target.checked ? 'live' : 'test' })} />
                        <span className="switch-slider" />
                      </label>
                      <span className={editing.subscriptionEnv === 'live' ? 'text-green' : 'text-muted'} style={{ fontSize: 13, fontWeight: 600 }}>LIVE</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Service config */}
              <div style={{
                border: '1px solid #10b98133', borderRadius: 10, padding: 16, marginBottom: 16,
                background: 'rgba(52, 211, 153, 0.05)',
              }}>
                <div className="flex items-center gap-2 mb-4">
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#34d399' }} />
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#34d399' }}>Plăți servicii</span>
                </div>
                <p className="text-sm text-muted mb-4">
                  Firma prin care se procesează plățile de la utilizatorii finali (întreținere, servicii, etc.)
                  <br/>Poate fi aceeași firmă ca la abonament, sau o firmă diferită (a clientului tău).
                </p>
                <div className="form-group">
                  <label className="form-label">Firma care procesează plățile servicii</label>
                  <select className="form-select" value={editing.serviceCompany}
                    onChange={e => setEditing({ ...editing, serviceCompany: e.target.value })}>
                    <option value="">— Nu are plăți servicii —</option>
                    {companies.map(c => (
                      <option key={c.slug} value={c.slug}>{c.name}</option>
                    ))}
                  </select>
                </div>
                {editing.serviceCompany && (
                  <div className="form-group mt-4">
                    <label className="form-label">Mediu</label>
                    <div className="switch-container">
                      <span className={editing.serviceEnv === 'test' ? 'text-yellow' : 'text-muted'} style={{ fontSize: 13, fontWeight: 600 }}>TEST</span>
                      <label className="switch">
                        <input type="checkbox" checked={editing.serviceEnv === 'live'}
                          onChange={e => setEditing({ ...editing, serviceEnv: e.target.checked ? 'live' : 'test' })} />
                        <span className="switch-slider" />
                      </label>
                      <span className={editing.serviceEnv === 'live' ? 'text-green' : 'text-muted'} style={{ fontSize: 13, fontWeight: 600 }}>LIVE</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setEditing(null)}>Anulează</button>
                <button className="btn btn-primary" onClick={saveMapping} disabled={saving || (!editing.subscriptionCompany && !editing.serviceCompany)}>
                  {saving ? 'Se salvează...' : '✓ Salvează configurarea'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
