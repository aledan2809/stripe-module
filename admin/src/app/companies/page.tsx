'use client'

import { useState, useEffect } from 'react'

interface Company {
  slug: string; name: string; cui: string; registrationNumber: string
  address: string; email: string; phone: string; bank: string; iban: string
  isVatPayer: boolean; vatRate: number; currency: string; country: string
  stripeEnvironment: 'test' | 'live'; website: string; logoUrl: string
  credentials?: any; projects?: any[]
}

const EMPTY_COMPANY: Company = {
  slug: '', name: '', cui: '', registrationNumber: '',
  address: '', email: '', phone: '', bank: '', iban: '',
  isVatPayer: true, vatRate: 0.19, currency: 'ron', country: 'RO',
  stripeEnvironment: 'test', website: '', logoUrl: '',
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [editing, setEditing] = useState<Company | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null)

  const load = () => fetch('/api/companies').then(r => r.json()).then(setCompanies)
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!editing) return
    setSaving(true)
    setMessage(null)

    // Auto-generate slug from name if new
    if (isNew && !editing.slug) {
      editing.slug = editing.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    }

    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    })

    if (res.ok) {
      setMessage({ type: 'success', text: isNew ? 'Firmă adăugată!' : 'Firmă actualizată!' })
      setEditing(null)
      setIsNew(false)
      load()
    } else {
      setMessage({ type: 'error', text: 'Eroare la salvare' })
    }
    setSaving(false)
  }

  const remove = async (slug: string) => {
    if (!confirm(`Ștergi firma "${slug}"? Se vor elimina și proiectele asignate.`)) return
    await fetch(`/api/companies?slug=${slug}`, { method: 'DELETE' })
    setMessage({ type: 'success', text: 'Firmă ștearsă' })
    load()
  }

  return (
    <>
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="page-title">Firme</h1>
            <p className="page-desc">Administrare firme cu conturi Stripe</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setEditing({ ...EMPTY_COMPANY }); setIsNew(true) }}>
            + Adaugă firmă
          </button>
        </div>
      </div>

      <div className="page-content">
        {/* Stripe guide */}
        <div className="guide">
          <div className="guide-title">📋 De unde iau datele firmei pentru Stripe?</div>
          <ol>
            <li>Deschide <a href="https://dashboard.stripe.com/settings/account" target="_blank" rel="noopener">Stripe Dashboard → Settings → Account details</a></li>
            <li><strong>Business name</strong> → câmpul "Nume firmă" de mai jos</li>
            <li><strong>Support email</strong> → câmpul "Email"</li>
            <li><strong>Country</strong> → câmpul "Țară" (ex: RO)</li>
            <li><strong>Currency</strong> → se setează automat la prima plată, dar poți alege default-ul aici</li>
            <li><strong>CUI, J-number, IBAN</strong> → din actele firmei (nu sunt în Stripe, dar sunt necesare pt. facturare)</li>
          </ol>
          <p className="mt-2">⚠️ Dacă ai mai multe firme, fiecare trebuie să aibă cont Stripe separat. Creează cont nou din <a href="https://dashboard.stripe.com/register" target="_blank" rel="noopener">stripe.com/register</a></p>
        </div>

        {message && (
          <div className={`alert alert-${message.type}`}>{message.text}</div>
        )}

        {/* Company list */}
        {companies.length === 0 && !editing ? (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <p className="text-muted mb-4">Nicio firmă înregistrată</p>
            <button className="btn btn-primary" onClick={() => { setEditing({ ...EMPTY_COMPANY }); setIsNew(true) }}>
              + Adaugă prima firmă
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {companies.map(c => (
              <div key={c.slug} className="company-card">
                <div className="company-info">
                  <div className="company-name">{c.name}</div>
                  <div className="company-detail">
                    {c.cui || '—'} · {c.currency.toUpperCase()} · {c.country}
                    {c.email && ` · ${c.email}`}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <span className={`badge ${c.stripeEnvironment === 'live' ? 'badge-live' : 'badge-test'}`}>
                      {c.stripeEnvironment}
                    </span>
                    {(c.projects?.length ?? 0) > 0 && (
                      <span className="badge badge-none">{c.projects?.length} proiecte</span>
                    )}
                    {c.credentials?.test?.secretKey && (
                      <span className="status-dot green" title="Test keys configured" />
                    )}
                    {c.credentials?.live?.secretKey && (
                      <span className="status-dot green" title="Live keys configured" />
                    )}
                  </div>
                </div>
                <div className="company-actions">
                  <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); setEditing(c); setIsNew(false) }}>
                    Editează
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); remove(c.slug) }}>
                    Șterge
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit modal */}
        {editing && (
          <div className="modal-overlay" onClick={() => { setEditing(null); setIsNew(false) }}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-title">{isNew ? 'Adaugă firmă nouă' : `Editează: ${editing.name}`}</div>

              <div className="form-grid">
                <div className="form-group full">
                  <label className="form-label">Nume firmă *</label>
                  <input className="form-input" value={editing.name} placeholder="Ex: AVE Digital SRL"
                    onChange={e => setEditing({ ...editing, name: e.target.value })} />
                </div>

                {isNew && (
                  <div className="form-group full">
                    <label className="form-label">Slug (auto-generat din nume dacă e gol)</label>
                    <input className="form-input mono" value={editing.slug} placeholder="ex: ave-digital"
                      onChange={e => setEditing({ ...editing, slug: e.target.value })} />
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
                  <input className="form-input mono" value={editing.iban} placeholder="RO49AAAA1B31007593840000"
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

              <div className="flex gap-3 mt-6" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => { setEditing(null); setIsNew(false) }}>Anulează</button>
                <button className="btn btn-primary" onClick={save} disabled={saving || !editing.name}>
                  {saving ? 'Se salvează...' : isNew ? 'Adaugă firma' : 'Salvează'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
