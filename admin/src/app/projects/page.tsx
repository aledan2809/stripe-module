'use client'

import { useState, useEffect } from 'react'

interface ProjectInfo { slug: string; path: string }
interface EcoGroup { name: string; projects: ProjectInfo[] }
interface Mapping {
  projectSlug: string; projectPath: string
  subscriptionCompany: string; subscriptionEnv: 'test' | 'live'
  serviceCompany: string; serviceEnv: 'test' | 'live'
  brokerCompany?: string; brokerEnv?: 'test' | 'live'; brokerEnabled?: boolean
  apiKey?: string; callbackSecret?: string
}
interface Company { slug: string; name: string }

const EMPTY_MAPPING: Omit<Mapping, 'projectSlug' | 'projectPath'> = {
  subscriptionCompany: '', subscriptionEnv: 'test',
  serviceCompany: '', serviceEnv: 'test',
  brokerCompany: '', brokerEnv: 'test', brokerEnabled: true,
}

export default function ProjectsPage() {
  const [available, setAvailable] = useState<ProjectInfo[]>([])
  const [groups, setGroups] = useState<EcoGroup[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [editing, setEditing] = useState<Mapping | null>(null)
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [brokerKeys, setBrokerKeys] = useState<{ apiKey: string; callbackSecret: string } | null>(null)
  const [groupSel, setGroupSel] = useState<Record<string, { company: string; env: 'test' | 'live' }>>({})
  const [assignedKeys, setAssignedKeys] = useState<{ ecosystem: string; rows: { projectSlug: string; apiKey: string; callbackSecret: string }[] } | null>(null)
  const [assignMode, setAssignMode] = useState<'group' | 'project'>('project')

  const load = async () => {
    const [projData, compData] = await Promise.all([
      fetch('/api/projects').then(r => r.json()),
      fetch('/api/companies').then(r => r.json()),
    ])
    setAvailable(projData.available)
    setGroups(projData.groups || [])
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

  const saveMapping = async (regenerateBrokerKeys = false) => {
    if (!editing) return
    setSaving(true)
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editing, regenerateBrokerKeys }),
    })
    const data = await res.json().catch(() => ({}))
    if (data?.brokerKeys?.apiKey) {
      // Surface the freshly generated keys once — the user copies them into the consumer app env.
      setBrokerKeys(data.brokerKeys)
      setMessage({ type: 'success', text: `Chei broker generate pentru ${editing.projectSlug} — copiază-le acum (nu se mai afișează).` })
      setSaving(false)
      load()
      return
    }
    const a = brokerAssignment(editing)
    setMessage({ type: 'success', text: a
      ? `✓ ${editing.projectSlug} asignat la ${a.firmName} (${a.env.toUpperCase()}). Confirmarea rămâne în „Proiecte configurate" + sub grup.`
      : `Configurare salvată pentru ${editing.projectSlug}` })
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

  const assignEcosystem = async (groupName: string) => {
    const sel = groupSel[groupName]
    if (!sel?.company) { setMessage({ type: 'error', text: 'Alege o firmă pentru grup.' }); return }
    const grp = groups.find(g => g.name === groupName)
    const count = grp?.projects.length || 0
    if (!confirm(
      `Asignezi TOATE cele ${count} proiecte din „${groupName}" la firma ${getCompanyName(sel.company)} (${(sel.env || 'test').toUpperCase()})?\n\n` +
      `Dacă un proiect nu se potrivește (ex: Tutor ≠ Offer), folosește modul „Pe proiect" și asignează individual.`
    )) return
    setSaving(true)
    const res = await fetch('/api/ecosystems/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ecosystem: groupName, brokerCompany: sel.company, brokerEnv: sel.env || 'test' }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setMessage({ type: 'error', text: data?.error || 'Asignare eșuată' }); return }
    setAssignedKeys({ ecosystem: groupName, rows: data.assigned })
    setMessage({ type: 'success', text: `✓ ${data.count} proiecte din „${groupName}" asignate la ${getCompanyName(sel.company)} (${(sel.env || 'test').toUpperCase()}). Confirmarea apare sub fiecare grup + copiază cheile acum.` })
    load()
  }

  const getCompanyName = (slug: string) => companies.find(c => c.slug === slug)?.name || slug || '—'
  const mappingFor = (slug: string) => mappings.find(m => m.projectSlug === slug)
  // Single source of truth shown inline so the user can SEE the association persisted.
  const brokerAssignment = (m?: Mapping) => {
    if (!m) return null
    if (m.brokerCompany) return { firmName: getCompanyName(m.brokerCompany), env: (m.brokerEnv || 'test'), kind: 'broker' as const }
    if (m.subscriptionCompany) return { firmName: getCompanyName(m.subscriptionCompany), env: m.subscriptionEnv, kind: 'abonament' as const }
    if (m.serviceCompany) return { firmName: getCompanyName(m.serviceCompany), env: m.serviceEnv, kind: 'servicii' as const }
    return null
  }

  const configuredProjects = mappings.filter(m => m.subscriptionCompany || m.serviceCompany)
  // Chips turn green on ANY assignment (incl. broker-only — the go-live path), so the ✓ reliably confirms it stuck.
  const assignedSlugs = mappings.filter(m => m.brokerCompany || m.subscriptionCompany || m.serviceCompany).map(m => m.projectSlug)

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

        {/* Ecosystem assignment keys — shown once; one apiKey + callbackSecret per project */}
        {assignedKeys && (
          <div className="card" style={{ border: '1px solid #f59e0b66', background: 'rgba(245, 158, 11, 0.08)' }}>
            <div className="card-header">
              <div className="card-title" style={{ color: '#f59e0b' }}>🔑 Chei broker — „{assignedKeys.ecosystem}" ({assignedKeys.rows.length} proiecte) — copiază-le ACUM</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setAssignedKeys(null)}>Am copiat</button>
            </div>
            <p className="text-sm text-muted mb-4">Fiecare proiect are propria cheie. Trec în env-ul app-ului consumator respectiv. Nu se mai afișează după ce închizi.</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: 6 }}>Proiect</th><th style={{ padding: 6 }}>STRIPE_BROKER_PROJECT_KEY</th><th style={{ padding: 6 }}>STRIPE_BROKER_CALLBACK_SECRET</th>
                </tr></thead>
                <tbody>
                  {assignedKeys.rows.map(r => (
                    <tr key={r.projectSlug} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 6, fontWeight: 600 }}>{r.projectSlug}</td>
                      <td style={{ padding: 6 }}><input className="form-input mono" readOnly value={r.apiKey} onFocus={e => e.target.select()} style={{ fontSize: 11 }} /></td>
                      <td style={{ padding: 6 }}><input className="form-input mono" readOnly value={r.callbackSecret} onFocus={e => e.target.select()} style={{ fontSize: 11 }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Broker keys — shown once after generation; user copies them into the consumer app env */}
        {brokerKeys && (
          <div className="card" style={{ border: '1px solid #f59e0b66', background: 'rgba(245, 158, 11, 0.08)' }}>
            <div className="card-header">
              <div className="card-title" style={{ color: '#f59e0b' }}>🔑 Chei broker generate — copiază-le ACUM</div>
              <button className="btn btn-secondary btn-sm" onClick={() => { setBrokerKeys(null); setEditing(null) }}>Am copiat</button>
            </div>
            <p className="text-sm text-muted mb-4">
              Trec în env-ul app-ului consumator. Nu se mai afișează după ce închizi.
            </p>
            <div className="form-group full">
              <label className="form-label">X-Project-Key (<code>STRIPE_BROKER_PROJECT_KEY</code>)</label>
              <input className="form-input mono" readOnly value={brokerKeys.apiKey} onFocus={e => e.target.select()} />
            </div>
            <div className="form-group full">
              <label className="form-label">Callback Secret (<code>STRIPE_BROKER_CALLBACK_SECRET</code>)</label>
              <input className="form-input mono" readOnly value={brokerKeys.callbackSecret} onFocus={e => e.target.select()} />
            </div>
          </div>
        )}

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

        {/* Add project — grouped by ecosystem */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Adaugă / asignează proiect</div>
              <div className="card-subtitle">
                {assignMode === 'group'
                  ? 'Mod GRUP — asignezi tot ecosistemul la o firmă deodată (atenție: bagă și proiecte nepotrivite).'
                  : 'Mod PROIECT — click pe un proiect ca să-l asignezi individual la o firmă.'}
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-sm text-muted">Asignare:</span>
              <button className={`btn btn-sm ${assignMode === 'project' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setAssignMode('project')}>Pe proiect</button>
              <button className={`btn btn-sm ${assignMode === 'group' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setAssignMode('group')}>Pe grup</button>
            </div>
          </div>

          {companies.length === 0 ? (
            <div className="alert alert-info">Adaugă mai întâi o firmă în pagina Firme.</div>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map(group => {
                const isDiscovered = group.name.startsWith('Alte proiecte')
                const sel = groupSel[group.name] || { company: '', env: 'test' as const }
                return (
                <div key={group.name}>
                  <div className="flex justify-between items-center" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#a78bfa' }}>
                      {group.name} <span className="text-muted" style={{ fontWeight: 400 }}>({group.projects.length})</span>
                    </div>
                    {/* Ecosystem-level assignment: map ALL projects in this group to one company */}
                    {assignMode === 'group' && !isDiscovered && (
                      <div className="flex gap-2 items-center">
                        <select className="form-select" style={{ width: 200, padding: '4px 8px', fontSize: 12 }}
                          value={sel.company}
                          onChange={e => setGroupSel({ ...groupSel, [group.name]: { ...sel, company: e.target.value } })}>
                          <option value="">— asignează grupul la firmă —</option>
                          {companies.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                        </select>
                        <div className="switch-container" style={{ transform: 'scale(0.85)' }}>
                          <span className={sel.env !== 'live' ? 'text-yellow' : 'text-muted'} style={{ fontSize: 11, fontWeight: 600 }}>TEST</span>
                          <label className="switch" style={{ width: 36, height: 20 }}>
                            <input type="checkbox" checked={sel.env === 'live'}
                              onChange={e => setGroupSel({ ...groupSel, [group.name]: { ...sel, env: e.target.checked ? 'live' : 'test' } })} />
                            <span className="switch-slider" />
                          </label>
                          <span className={sel.env === 'live' ? 'text-green' : 'text-muted'} style={{ fontSize: 11, fontWeight: 600 }}>LIVE</span>
                        </div>
                        <button className="btn btn-primary btn-sm" disabled={saving || !sel.company}
                          onClick={() => assignEcosystem(group.name)}>
                          Asignează grupul
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                    {group.projects.map(p => {
                      const isConfigured = assignedSlugs.includes(p.slug)
                      const a = brokerAssignment(mappingFor(p.slug))
                      return (
                        <button key={p.slug}
                          className={`btn btn-sm ${isConfigured ? 'btn-success' : 'btn-secondary'}`}
                          title={a ? `${a.firmName} (${a.env.toUpperCase()}) · ${p.path}` : (p.path || 'nedescoperit pe acest host')}
                          onClick={() => openConfig(p)}>
                          {p.slug}{isConfigured ? ' ✓' : ''}
                        </button>
                      )
                    })}
                  </div>

                  {/* Inline confirmation: which projects in THIS group are already mapped, and to which firm */}
                  {(() => {
                    const assigned = group.projects
                      .map(p => ({ slug: p.slug, a: brokerAssignment(mappingFor(p.slug)) }))
                      .filter(x => x.a)
                    if (assigned.length === 0) return null
                    return (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {assigned.map(({ slug, a }) => (
                          <div key={slug} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ color: '#34d399' }}>✓</span>
                            <strong>{slug}</strong>
                            <span className="text-muted">→</span>
                            <span>{a!.firmName}</span>
                            <span className={a!.env === 'live' ? 'text-green' : 'text-yellow'} style={{ fontWeight: 600 }}>({a!.env.toUpperCase()})</span>
                            <span className="text-muted" style={{ fontSize: 11 }}>· {a!.kind}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              )})}
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

              {/* Broker config — consumer app creates checkouts without holding Stripe keys */}
              <div style={{
                border: '1px solid #f59e0b33', borderRadius: 10, padding: 16, marginBottom: 16,
                background: 'rgba(245, 158, 11, 0.05)',
              }}>
                <div className="flex items-center gap-2 mb-4">
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#f59e0b' }}>Checkout Broker</span>
                </div>
                <p className="text-sm text-muted mb-4">
                  App-ul consumator creează checkout-uri prin broker (POST <code>/api/checkout</code>) cu un <strong>project-key</strong>,
                  fără să dețină vreo cheie Stripe. Cheia firmei alese aici rămâne DOAR în broker.
                </p>
                <div className="form-group">
                  <label className="form-label">Firma a cărei cheie Stripe o folosește brokerul</label>
                  <select className="form-select" value={editing.brokerCompany || ''}
                    onChange={e => setEditing({ ...editing, brokerCompany: e.target.value })}>
                    <option value="">— Fără broker —</option>
                    {companies.map(c => (
                      <option key={c.slug} value={c.slug}>{c.name}</option>
                    ))}
                  </select>
                </div>
                {editing.brokerCompany && (
                  <div className="form-group mt-4">
                    <label className="form-label">Mediu broker</label>
                    <div className="switch-container">
                      <span className={editing.brokerEnv !== 'live' ? 'text-yellow' : 'text-muted'} style={{ fontSize: 13, fontWeight: 600 }}>TEST</span>
                      <label className="switch">
                        <input type="checkbox" checked={editing.brokerEnv === 'live'}
                          onChange={e => setEditing({ ...editing, brokerEnv: e.target.checked ? 'live' : 'test' })} />
                        <span className="switch-slider" />
                      </label>
                      <span className={editing.brokerEnv === 'live' ? 'text-green' : 'text-muted'} style={{ fontSize: 13, fontWeight: 600 }}>LIVE</span>
                    </div>
                    {editing.apiKey && (
                      <div className="mt-4">
                        <span className="text-sm text-muted">Project-key activ: <code>{editing.apiKey.substring(0, 16)}…</code> · callback-secret setat.</span>
                        <button className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }}
                          onClick={() => { if (confirm('Regenerezi cheile broker? Cele vechi (din env-ul app-ului consumator) nu mai funcționează.')) saveMapping(true) }}>
                          ↻ Regenerează chei
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setEditing(null)}>Anulează</button>
                <button className="btn btn-primary" onClick={() => saveMapping(false)} disabled={saving || (!editing.subscriptionCompany && !editing.serviceCompany && !editing.brokerCompany)}>
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
