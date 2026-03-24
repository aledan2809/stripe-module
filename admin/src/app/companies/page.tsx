'use client'

import { useState, useEffect } from 'react'

interface Company {
  slug: string; name: string; cui: string; registrationNumber: string
  address: string; email: string; phone: string; bank: string; iban: string
  isVatPayer: boolean; vatRate: number; currency: string; country: string
  stripeEnvironment: 'test' | 'live'; website: string; logoUrl: string
  credentials?: any; projects?: any[]
}

interface StripeKeys { secretKey: string; publishableKey: string; webhookSecret: string }
interface Creds { test: StripeKeys; live: StripeKeys }

const EMPTY_KEYS: StripeKeys = { secretKey: '', publishableKey: '', webhookSecret: '' }

const EMPTY_COMPANY: Company = {
  slug: '', name: '', cui: '', registrationNumber: '',
  address: '', email: '', phone: '', bank: '', iban: '',
  isVatPayer: true, vatRate: 0.19, currency: 'ron', country: 'RO',
  stripeEnvironment: 'test', website: '', logoUrl: '',
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [editing, setEditing] = useState<Company | null>(null)
  const [creds, setCreds] = useState<Creds>({ test: { ...EMPTY_KEYS }, live: { ...EMPTY_KEYS } })
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoResult, setAutoResult] = useState<any>(null)
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null)
  const [testingEnv, setTestingEnv] = useState<'test' | 'live' | null>(null)
  const [testResult, setTestResult] = useState<{ env: string; ok: boolean; error?: string } | null>(null)

  const load = () => fetch('/api/companies').then(r => r.json()).then(setCompanies)
  useEffect(() => { load() }, [])

  // Open new company modal
  const openNew = () => {
    setEditing({ ...EMPTY_COMPANY })
    setCreds({ test: { ...EMPTY_KEYS }, live: { ...EMPTY_KEYS } })
    setIsNew(true)
    setAutoResult(null)
    setTestResult(null)
    setMessage(null)
  }

  // Open edit company modal — load credentials too
  const openEdit = async (c: Company) => {
    setEditing({ ...c })
    setIsNew(false)
    setAutoResult(null)
    setTestResult(null)
    setMessage(null)
    // Load credentials
    const res = await fetch(`/api/credentials?slug=${c.slug}`)
    const data = await res.json()
    setCreds(data)
  }

  // Auto-setup: paste Secret Key → auto-fill everything from Stripe
  const autoSetup = async (secretKey: string) => {
    if (!secretKey || secretKey.length < 10) return
    setAutoLoading(true)
    setAutoResult(null)

    const res = await fetch('/api/auto-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secretKey }),
    })
    const data = await res.json()
    setAutoLoading(false)

    if (data.ok) {
      setAutoResult(data)
      const env = data.environment as 'test' | 'live'

      // Auto-fill company from Stripe account
      setEditing(prev => prev ? {
        ...prev,
        name: prev.name || data.account.businessName || '',
        email: prev.email || data.account.email || '',
        phone: prev.phone || data.account.phone || '',
        website: prev.website || data.account.website || '',
        country: data.account.country || prev.country,
        currency: data.account.currency || prev.currency,
        stripeEnvironment: env,
      } : prev)

      // Set the secret key in the right environment slot
      setCreds(prev => ({
        ...prev,
        [env]: { ...prev[env], secretKey },
      }))
    } else {
      setAutoResult({ ok: false, error: data.error })
    }
  }

  // Test connection for an environment
  const testConnection = async (env: 'test' | 'live') => {
    const key = creds[env].secretKey
    if (!key) {
      setTestResult({ env, ok: false, error: 'Cheia secretă nu e completată' })
      return
    }
    setTestingEnv(env)
    setTestResult(null)

    const res = await fetch('/api/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secretKey: key }),
    })
    const data = await res.json()
    setTestResult({ env, ok: data.ok, error: data.error })
    setTestingEnv(null)
  }

  // Save company + credentials together
  const save = async () => {
    if (!editing) return
    setSaving(true)
    setMessage(null)

    // Auto-generate slug
    const company = { ...editing }
    if (isNew && !company.slug) {
      company.slug = company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    }

    // Save company
    const compRes = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(company),
    })

    if (!compRes.ok) {
      setMessage({ type: 'error', text: 'Eroare la salvarea firmei' })
      setSaving(false)
      return
    }

    // Save credentials
    await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: company.slug, credentials: creds }),
    })

    setMessage({ type: 'success', text: isNew ? 'Firmă adăugată cu succes!' : 'Firmă actualizată!' })
    setEditing(null)
    setIsNew(false)
    setSaving(false)
    load()
  }

  // Delete company
  const remove = async (slug: string, name: string) => {
    if (!confirm(`Ștergi firma "${name}"?\n\nSe vor elimina și:\n• Proiectele asignate\n• Credențialele Stripe`)) return
    await fetch(`/api/companies?slug=${slug}`, { method: 'DELETE' })
    setMessage({ type: 'success', text: `Firma "${name}" a fost ștearsă` })
    load()
  }

  const maskKey = (key: string) => {
    if (!key) return '—'
    if (key.length < 12) return '••••'
    return key.substring(0, 8) + '••••' + key.substring(key.length - 4)
  }

  const closeModal = () => { setEditing(null); setIsNew(false); setAutoResult(null); setTestResult(null) }

  return (
    <>
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="page-title">Firme</h1>
            <p className="page-desc">Administrare firme și credențiale Stripe — totul într-un singur loc</p>
          </div>
          <button className="btn btn-primary" onClick={openNew}>+ Adaugă firmă</button>
        </div>
      </div>

      <div className="page-content">
        {/* Guide */}
        <div className="guide">
          <div className="guide-title">⚡ Setup rapid — un singur pas</div>
          <ol>
            <li>Click <strong>"Adaugă firmă"</strong></li>
            <li>Lipește <strong>Secret Key</strong> din <a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noopener">Stripe Dashboard → Developers → API Keys</a></li>
            <li>Datele firmei se completează <strong>automat</strong> din contul Stripe</li>
            <li>Adaugă manual doar <strong>CUI, IBAN, bancă</strong> (nu sunt în Stripe)</li>
            <li>Salvează — gata!</li>
          </ol>
        </div>

        {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

        {/* Company list */}
        {companies.length === 0 && !editing ? (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <p className="text-muted mb-4">Nicio firmă înregistrată</p>
            <button className="btn btn-primary" onClick={openNew}>+ Adaugă prima firmă</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {companies.map(c => (
              <div key={c.slug} className="company-card">
                <div className="company-info">
                  <div className="company-name">{c.name}</div>
                  <div className="company-detail">
                    {c.slug} · {c.cui || 'CUI necompletat'} · {c.currency.toUpperCase()} · {c.country}
                    {c.email && ` · ${c.email}`}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <span className={`badge ${c.stripeEnvironment === 'live' ? 'badge-live' : 'badge-test'}`}>
                      {c.stripeEnvironment}
                    </span>
                    {(c.projects?.length ?? 0) > 0 && (
                      <span className="badge badge-none">{c.projects?.length} proiecte</span>
                    )}
                    <span className="flex items-center gap-2 text-sm text-muted">
                      <span className={`status-dot ${c.credentials?.test?.secretKey ? 'green' : 'gray'}`} />Test
                      <span className={`status-dot ${c.credentials?.live?.secretKey ? 'green' : 'gray'}`} />Live
                    </span>
                  </div>
                </div>
                <div className="company-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>Editează</button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(c.slug, c.name)}>Șterge</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ─── MODAL: New / Edit ─── */}
        {editing && (
          <div className="modal-overlay" onClick={closeModal}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 700, maxHeight: '90vh' }}>
              <div className="modal-title">{isNew ? '🆕 Adaugă firmă nouă' : `✏️ Editează: ${editing.name}`}</div>

              {/* ── STEP 1: Secret Key auto-setup ── */}
              <div className="card mb-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-focus)' }}>
                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--stripe-purple)', fontWeight: 600 }}>
                    🔑 Lipește Secret Key din Stripe → completez automat tot
                  </label>
                  <div className="flex gap-2">
                    <input className="form-input mono" style={{ flex: 1 }}
                      placeholder="sk_test_... sau sk_live_..."
                      onPaste={e => {
                        setTimeout(() => autoSetup((e.target as HTMLInputElement).value), 50)
                      }}
                      onChange={e => {
                        const v = e.target.value
                        // Detect environment and store key
                        if (v.startsWith('sk_test_')) {
                          setCreds(p => ({ ...p, test: { ...p.test, secretKey: v } }))
                        } else if (v.startsWith('sk_live_')) {
                          setCreds(p => ({ ...p, live: { ...p.live, secretKey: v } }))
                        }
                      }}
                      defaultValue={creds.test.secretKey || creds.live.secretKey || ''}
                    />
                    <button className="btn btn-primary btn-sm" disabled={autoLoading}
                      onClick={() => autoSetup(creds.test.secretKey || creds.live.secretKey)}>
                      {autoLoading ? '...' : '⚡ Detectează'}
                    </button>
                  </div>
                </div>

                {/* Auto-setup result */}
                {autoResult && (
                  <div className={`alert mt-2 ${autoResult.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 0 }}>
                    {autoResult.ok ? (
                      <div>
                        <strong>✓ Cont Stripe detectat!</strong>
                        <span className={`badge ml-2 badge-${autoResult.environment}`} style={{ marginLeft: 8 }}>{autoResult.environment}</span>
                        <div className="text-sm mt-2">
                          {autoResult.account.businessName && <div>Firmă: <strong>{autoResult.account.businessName}</strong></div>}
                          <div>ID: {autoResult.account.id} · {autoResult.account.country} · {autoResult.account.currency?.toUpperCase()}</div>
                          {autoResult.account.email && <div>Email: {autoResult.account.email}</div>}
                          <div>
                            Plăți: {autoResult.account.chargesEnabled ? '✓' : '✗'} ·
                            Payouts: {autoResult.account.payoutsEnabled ? '✓' : '✗'}
                          </div>
                        </div>
                        <p className="text-sm mt-2" style={{ opacity: 0.8 }}>
                          ↑ Datele de mai sus au fost completate automat. Adaugă manual CUI, IBAN și bancă.
                        </p>
                      </div>
                    ) : (
                      <div><strong>✗ Eroare:</strong> {autoResult.error}</div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Publishable Key ── */}
              <div className="form-grid mb-4">
                <div className="form-group full">
                  <label className="form-label">Publishable Key (din aceeași pagină Stripe → API Keys)</label>
                  <input className="form-input mono"
                    placeholder="pk_test_... sau pk_live_..."
                    value={creds[editing.stripeEnvironment]?.publishableKey || ''}
                    onChange={e => {
                      const env = editing.stripeEnvironment
                      setCreds(p => ({ ...p, [env]: { ...p[env], publishableKey: e.target.value } }))
                    }}
                  />
                </div>
                <div className="form-group full">
                  <label className="form-label">Webhook Secret (Developers → Webhooks → Signing secret)</label>
                  <input className="form-input mono" type="password"
                    placeholder="whsec_..."
                    value={creds[editing.stripeEnvironment]?.webhookSecret || ''}
                    onChange={e => {
                      const env = editing.stripeEnvironment
                      setCreds(p => ({ ...p, [env]: { ...p[env], webhookSecret: e.target.value } }))
                    }}
                  />
                </div>
              </div>

              {/* ── Company details ── */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--text-label)' }}>Date firmă</h3>
              </div>

              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Nume firmă *</label>
                  <input className="form-input" value={editing.name} placeholder="Ex: AVE Digital SRL"
                    onChange={e => setEditing({ ...editing, name: e.target.value })} />
                </div>

                {isNew && (
                  <div className="form-group">
                    <label className="form-label">Slug (auto din nume)</label>
                    <input className="form-input mono" value={editing.slug} placeholder="auto-generat"
                      onChange={e => setEditing({ ...editing, slug: e.target.value })} />
                  </div>
                )}

                {!isNew && (
                  <div className="form-group">
                    <label className="form-label">Slug</label>
                    <input className="form-input mono" value={editing.slug} disabled style={{ opacity: 0.5 }} />
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">CUI</label>
                  <input className="form-input" value={editing.cui} placeholder="RO12345678"
                    onChange={e => setEditing({ ...editing, cui: e.target.value })} />
                </div>

                <div className="form-group">
                  <label className="form-label">Nr. înregistrare (J)</label>
                  <input className="form-input" value={editing.registrationNumber} placeholder="J40/1234/2020"
                    onChange={e => setEditing({ ...editing, registrationNumber: e.target.value })} />
                </div>

                <div className="form-group full">
                  <label className="form-label">Adresă</label>
                  <input className="form-input" value={editing.address} placeholder="Str. Exemplu nr. 1, București"
                    onChange={e => setEditing({ ...editing, address: e.target.value })} />
                </div>

                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" value={editing.email} placeholder="contact@firma.ro"
                    onChange={e => setEditing({ ...editing, email: e.target.value })} />
                </div>

                <div className="form-group">
                  <label className="form-label">Telefon</label>
                  <input className="form-input" value={editing.phone} placeholder="+40 7xx xxx xxx"
                    onChange={e => setEditing({ ...editing, phone: e.target.value })} />
                </div>

                <div className="form-group">
                  <label className="form-label">Bancă</label>
                  <input className="form-input" value={editing.bank} placeholder="ING Bank"
                    onChange={e => setEditing({ ...editing, bank: e.target.value })} />
                </div>

                <div className="form-group">
                  <label className="form-label">IBAN</label>
                  <input className="form-input mono" value={editing.iban} placeholder="RO49AAAA1B31..."
                    onChange={e => setEditing({ ...editing, iban: e.target.value })} />
                </div>

                <div className="form-group">
                  <label className="form-label">Monedă</label>
                  <select className="form-select" value={editing.currency}
                    onChange={e => setEditing({ ...editing, currency: e.target.value })}>
                    <option value="ron">RON</option>
                    <option value="eur">EUR</option>
                    <option value="usd">USD</option>
                    <option value="gbp">GBP</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Țară</label>
                  <select className="form-select" value={editing.country}
                    onChange={e => setEditing({ ...editing, country: e.target.value })}>
                    <option value="RO">România</option>
                    <option value="DE">Germania</option>
                    <option value="US">SUA</option>
                    <option value="GB">UK</option>
                    <option value="FR">Franța</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Plătitor TVA</label>
                  <div className="switch-container mt-2">
                    <label className="switch">
                      <input type="checkbox" checked={editing.isVatPayer}
                        onChange={e => setEditing({ ...editing, isVatPayer: e.target.checked })} />
                      <span className="switch-slider" />
                    </label>
                    <span className="switch-label">{editing.isVatPayer ? 'Da' : 'Nu'}</span>
                  </div>
                </div>

                {editing.isVatPayer && (
                  <div className="form-group">
                    <label className="form-label">Cotă TVA</label>
                    <select className="form-select" value={editing.vatRate}
                      onChange={e => setEditing({ ...editing, vatRate: parseFloat(e.target.value) })}>
                      <option value={0.19}>19%</option>
                      <option value={0.09}>9%</option>
                      <option value={0.05}>5%</option>
                      <option value={0}>0%</option>
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Website</label>
                  <input className="form-input" value={editing.website} placeholder="https://firma.ro"
                    onChange={e => setEditing({ ...editing, website: e.target.value })} />
                </div>

                <div className="form-group">
                  <label className="form-label">Logo URL</label>
                  <input className="form-input" value={editing.logoUrl} placeholder="https://..."
                    onChange={e => setEditing({ ...editing, logoUrl: e.target.value })} />
                </div>
              </div>

              {/* ── Keys summary ── */}
              {!isNew && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--text-label)' }}>Chei Stripe configurate</h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Secret Key (test)</label>
                      <div className="flex gap-2">
                        <input className="form-input mono" type="password" value={creds.test.secretKey}
                          placeholder="sk_test_..."
                          onChange={e => setCreds(p => ({ ...p, test: { ...p.test, secretKey: e.target.value } }))} />
                        <button className="btn btn-sm btn-secondary" disabled={testingEnv !== null}
                          onClick={() => testConnection('test')}>
                          {testingEnv === 'test' ? '...' : '⚡'}
                        </button>
                      </div>
                      {creds.test.secretKey && <span className="text-sm text-muted">{maskKey(creds.test.secretKey)}</span>}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Secret Key (live)</label>
                      <div className="flex gap-2">
                        <input className="form-input mono" type="password" value={creds.live.secretKey}
                          placeholder="sk_live_..."
                          onChange={e => setCreds(p => ({ ...p, live: { ...p.live, secretKey: e.target.value } }))} />
                        <button className="btn btn-sm btn-secondary" disabled={testingEnv !== null}
                          onClick={() => testConnection('live')}>
                          {testingEnv === 'live' ? '...' : '⚡'}
                        </button>
                      </div>
                      {creds.live.secretKey && <span className="text-sm text-muted">{maskKey(creds.live.secretKey)}</span>}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Publishable Key (test)</label>
                      <input className="form-input mono" value={creds.test.publishableKey}
                        placeholder="pk_test_..."
                        onChange={e => setCreds(p => ({ ...p, test: { ...p.test, publishableKey: e.target.value } }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Publishable Key (live)</label>
                      <input className="form-input mono" value={creds.live.publishableKey}
                        placeholder="pk_live_..."
                        onChange={e => setCreds(p => ({ ...p, live: { ...p.live, publishableKey: e.target.value } }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Webhook Secret (test)</label>
                      <input className="form-input mono" type="password" value={creds.test.webhookSecret}
                        placeholder="whsec_..."
                        onChange={e => setCreds(p => ({ ...p, test: { ...p.test, webhookSecret: e.target.value } }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Webhook Secret (live)</label>
                      <input className="form-input mono" type="password" value={creds.live.webhookSecret}
                        placeholder="whsec_..."
                        onChange={e => setCreds(p => ({ ...p, live: { ...p.live, webhookSecret: e.target.value } }))} />
                    </div>
                  </div>

                  {testResult && (
                    <div className={`alert mt-2 ${testResult.ok ? 'alert-success' : 'alert-error'}`}>
                      {testResult.ok
                        ? `✓ Conexiune ${testResult.env.toUpperCase()} reușită!`
                        : `✗ ${testResult.env.toUpperCase()}: ${testResult.error}`}
                    </div>
                  )}
                </div>
              )}

              {/* ── Actions ── */}
              <div className="flex gap-3 mt-6" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={closeModal}>Anulează</button>
                <button className="btn btn-primary" onClick={save} disabled={saving || !editing.name}>
                  {saving ? 'Se salvează...' : isNew ? '✓ Adaugă firma' : '✓ Salvează modificările'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
