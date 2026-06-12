'use client'

import { useState, useEffect } from 'react'

const LEGAL_ADMIN_URL = 'https://legal.knowbest.ro'

interface FieldDiff { field: string; legal: string; stripe: string; status: 'same' | 'differs' | 'legal-empty' | 'stripe-empty' }
interface CompanyReconcile { slug: string; name: string; inLegal: boolean; inStripe: boolean; source?: string; fields: FieldDiff[]; flags: string[] }
interface Recon { companies: CompanyReconcile[]; summary: { withFlags: number; total: number } }
interface BillerSug { appSlug: string; suggestedCompany: string; billerName: string }

export default function LegalSyncPage() {
  const [recon, setRecon] = useState<Recon | null>(null)
  const [billers, setBillers] = useState<{ appSlug: string; billerSlug: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ changes: any[]; billerSuggestions: BillerSug[] } | null>(null)
  const [applying, setApplying] = useState(false)
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = async () => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/legal/sync', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Legal unreachable'); setRecon(null) }
      else { setRecon(d.reconciliation); setBillers(d.billers || []) }
    } catch (e: any) { setErr(e.message) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const copy = async (id: string, value: string) => {
    if (!value) return
    try { await navigator.clipboard.writeText(value) } catch {
      const ta = document.createElement('textarea'); ta.value = value; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopied(id); setTimeout(() => setCopied(c => (c === id ? null : c)), 1500)
  }

  const doPreview = async () => {
    setMsg(null)
    const r = await fetch('/api/legal/sync?preview=1', { method: 'POST' })
    const d = await r.json()
    if (!r.ok) { setMsg({ type: 'error', text: d.error || 'Preview eșuat' }); return }
    setPreview({ changes: d.changes, billerSuggestions: d.billerSuggestions })
  }

  const doApply = async () => {
    setApplying(true)
    const r = await fetch('/api/legal/sync', { method: 'POST' })
    const d = await r.json()
    setApplying(false)
    if (!r.ok) { setMsg({ type: 'error', text: d.error || 'Sync eșuat' }); return }
    setMsg({ type: 'success', text: `Sync aplicat: ${d.upserted} firme actualizate din Legal.` })
    setPreview(null)
    load()
  }

  // copy-all block for a company (the good Stripe values, to paste into Legal)
  const copyAllForLegal = (c: CompanyReconcile) => {
    const lines = c.fields
      .filter(f => f.stripe && (f.status === 'legal-empty' || f.status === 'differs'))
      .map(f => `${f.field}: ${f.stripe}`)
    copy(`all-${c.slug}`, lines.join('\n'))
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Legal Sync</h1>
        <p className="page-desc">Legal e sursa de adevăr. Firmele + maparea proiect→biller se sincronizează de acolo; discrepanțele se semnalează aici.</p>
      </div>

      <div className="page-content">
        <div className="guide">
          <div className="guide-title">ℹ️ Cum funcționează</div>
          <ul>
            <li><strong>Legal → Stripe</strong>: butonul „Sync din Legal" importă firmele (nume, CUI, adresă, monedă...) — <strong>fără</strong> să atingă cheile Stripe.</li>
            <li><strong>Stripe → Legal</strong>: niciodată automat. Dacă Stripe are date mai bune/lipsă în Legal, le <strong>copiezi</strong> de aici și le pui manual în Legal (datele juridice trec prin verificarea ta).</li>
          </ul>
        </div>

        <div className="flex gap-3 items-center">
          <button className="btn btn-primary" onClick={doPreview} disabled={loading || !!err}>🔄 Sync din Legal (preview)</button>
          <button className="btn btn-secondary" onClick={load}>↻ Reîncarcă</button>
          {recon && <span className={`badge ${recon.summary.withFlags ? 'badge-test' : 'badge-live'}`}>{recon.summary.withFlags} firme cu discrepanțe / {recon.summary.total}</span>}
        </div>

        {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
        {err && <div className="alert alert-error">Legal indisponibil: {err}</div>}

        {/* Preview modal */}
        {preview && (
          <div className="modal-overlay" onClick={() => setPreview(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 560 }}>
              <div className="modal-title">Preview sync din Legal</div>
              <div className="text-sm mb-4">
                {preview.changes.filter(c => c.action === 'create').length} create ·{' '}
                {preview.changes.filter(c => c.action === 'update').length} update ·{' '}
                {preview.changes.filter(c => c.action === 'unchanged').length} neschimbate
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {preview.changes.map(c => (
                  <div key={c.slug} className="flex justify-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                    <span><strong>{c.slug}</strong> <span className="text-muted text-sm">{c.action}</span></span>
                    <span className="text-sm text-muted">{c.fields.join(', ')}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted mt-4">Mapările proiect→biller propuse ({preview.billerSuggestions.length}) se confirmă separat în Proiecte (nu se aplică aici).</p>
              <div className="flex gap-3 mt-4" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setPreview(null)}>Anulează</button>
                <button className="btn btn-primary" onClick={doApply} disabled={applying}>{applying ? 'Se aplică...' : '✓ Aplică sync'}</button>
              </div>
            </div>
          </div>
        )}

        {/* Reconciliation */}
        {recon && recon.companies.map(c => (
          <div key={c.slug} className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <div className="card-title">{c.name}</div>
                {c.source === 'legal' && <span className="badge badge-live">Legal</span>}
                {!c.inLegal && <span className="badge badge-test">absent în Legal</span>}
                {!c.inStripe && <span className="badge badge-test">doar în Legal</span>}
              </div>
              {c.fields.some(f => f.stripe && (f.status === 'legal-empty' || f.status === 'differs')) && (
                <button className="btn btn-secondary btn-sm" onClick={() => copyAllForLegal(c)}>
                  {copied === `all-${c.slug}` ? '✓ Copiat tot' : '📋 Copiază tot pt Legal'}
                </button>
              )}
            </div>

            {c.flags.length > 0 && (
              <div className="alert alert-error" style={{ marginBottom: 12 }}>
                {c.flags.map((f, i) => <div key={i}>⚠️ {f}</div>)}
              </div>
            )}

            {c.fields.length > 0 && (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: 6 }}>Câmp</th><th style={{ padding: 6 }}>Legal</th><th style={{ padding: 6 }}>Stripe</th><th style={{ padding: 6 }}></th>
                </tr></thead>
                <tbody>
                  {c.fields.map(f => (
                    <tr key={f.field} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 6, fontWeight: 600 }}>{f.field}</td>
                      <td style={{ padding: 6, color: f.status === 'legal-empty' ? 'var(--text-muted)' : undefined }}>{f.legal || '—'}</td>
                      <td style={{ padding: 6, color: f.status === 'differs' ? '#f59e0b' : undefined }}>{f.stripe || '—'}</td>
                      <td style={{ padding: 6 }}>
                        {f.stripe && (f.status === 'legal-empty' || f.status === 'differs') && (
                          <button className="btn btn-secondary btn-sm" onClick={() => copy(`${c.slug}-${f.field}`, f.stripe)}>
                            {copied === `${c.slug}-${f.field}` ? '✓' : '📋'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {(!c.inLegal || c.fields.some(f => f.status === 'legal-empty' || f.status === 'differs')) && (
              <p className="text-sm mt-2">
                <a href={`${LEGAL_ADMIN_URL}/admin`} target="_blank" rel="noopener" style={{ color: 'var(--stripe-purple)' }}>
                  → Deschide Legal admin pentru a {c.inLegal ? 'completa' : 'crea'} entitatea
                </a>
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
