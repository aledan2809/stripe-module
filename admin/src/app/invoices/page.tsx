'use client'

import { useState, useEffect, useCallback } from 'react'

interface Invoice {
  id: string
  number: string | null
  status: string | null
  customerEmail: string | null
  customerName: string | null
  amountDue: number
  amountPaid: number
  currency: string
  created: number
  hostedInvoiceUrl: string | null
  invoicePdf: string | null
}
interface Company { slug: string; name: string }

const STATUS_COLOR: Record<string, string> = {
  paid: '#34d399', open: '#f59e0b', draft: '#9ca3af', void: '#f87171', uncollectible: '#f87171',
}

export default function InvoicesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [company, setCompany] = useState('')
  const [env, setEnv] = useState<'test' | 'live'>('live')
  const [status, setStatus] = useState('')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/invoices').then(r => r.json()).then(d => setCompanies(d.companies || []))
  }, [])

  const fetchInvoices = useCallback(async (append = false) => {
    if (!company) return
    setLoading(true); setError('')
    const q = new URLSearchParams({ company, env })
    if (status) q.set('status', status)
    if (append && next) q.set('starting_after', next)
    const data = await fetch(`/api/invoices?${q}`).then(r => r.json()).catch(() => ({ error: 'fetch failed' }))
    setLoading(false)
    if (data.error) { setError(data.error); if (!append) { setInvoices([]); setHasMore(false) } ; return }
    setInvoices(prev => append ? [...prev, ...data.invoices] : data.invoices)
    setHasMore(!!data.hasMore)
    setNext(data.next)
  }, [company, env, status, next])

  // Reload from the top whenever the filters change.
  useEffect(() => { setNext(null); if (company) fetchInvoices(false) /* eslint-disable-next-line */ }, [company, env, status])

  const money = (minor: number, cur: string) => `${(minor / 100).toFixed(2)} ${(cur || '').toUpperCase()}`

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Facturi Stripe</h1>
        <p className="page-desc">Facturile emise pe contul fiecărei firme (read-only, aduse din Stripe). Distinct de „Facturi trimise" (log emailuri).</p>
      </div>
      <div className="page-content">
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
              <select className="form-select" style={{ width: 220 }} value={company} onChange={e => setCompany(e.target.value)}>
                <option value="">— alege firma —</option>
                {companies.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
              <div className="switch-container">
                <span className={env === 'test' ? 'text-yellow' : 'text-muted'} style={{ fontSize: 12, fontWeight: 600 }}>TEST</span>
                <label className="switch"><input type="checkbox" checked={env === 'live'} onChange={e => setEnv(e.target.checked ? 'live' : 'test')} /><span className="switch-slider" /></label>
                <span className={env === 'live' ? 'text-green' : 'text-muted'} style={{ fontSize: 12, fontWeight: 600 }}>LIVE</span>
              </div>
              <select className="form-select" style={{ width: 150 }} value={status} onChange={e => setStatus(e.target.value)}>
                <option value="">toate statusurile</option>
                <option value="paid">paid</option>
                <option value="open">open</option>
                <option value="draft">draft</option>
                <option value="void">void</option>
                <option value="uncollectible">uncollectible</option>
              </select>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => { setNext(null); fetchInvoices(false) }} disabled={loading || !company}>↻ Reîmprospătează</button>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {!company ? (
            <p className="text-muted" style={{ padding: 16 }}>Alege o firmă ca să vezi facturile.</p>
          ) : loading && invoices.length === 0 ? (
            <p className="text-muted" style={{ padding: 16 }}>Se încarcă…</p>
          ) : invoices.length === 0 ? (
            <p className="text-muted" style={{ padding: 16 }}>Nicio factură pentru filtrul curent.</p>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: 8 }}>Dată</th>
                    <th style={{ padding: 8 }}>Nr</th>
                    <th style={{ padding: 8 }}>Client</th>
                    <th style={{ padding: 8 }}>Sumă</th>
                    <th style={{ padding: 8 }}>Status</th>
                    <th style={{ padding: 8 }}>Link-uri</th>
                  </tr></thead>
                  <tbody>
                    {invoices.map(inv => (
                      <tr key={inv.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{new Date(inv.created * 1000).toLocaleDateString('ro-RO')}</td>
                        <td style={{ padding: 8 }}>{inv.number || '—'}</td>
                        <td style={{ padding: 8 }}>{inv.customerName || inv.customerEmail || '—'}</td>
                        <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{money(inv.amountPaid || inv.amountDue, inv.currency)}</td>
                        <td style={{ padding: 8 }}><span style={{ color: STATUS_COLOR[inv.status || ''] || 'var(--text-muted)', fontWeight: 600 }}>{inv.status || '—'}</span></td>
                        <td style={{ padding: 8 }}>
                          {inv.hostedInvoiceUrl && <a href={inv.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#635bff' }}>Vezi</a>}
                          {inv.hostedInvoiceUrl && inv.invoicePdf && ' · '}
                          {inv.invoicePdf && <a href={inv.invoicePdf} target="_blank" rel="noopener noreferrer" style={{ color: '#635bff' }}>PDF</a>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasMore && (
                <div className="flex justify-center mt-4">
                  <button className="btn btn-secondary btn-sm" onClick={() => fetchInvoices(true)} disabled={loading}>{loading ? '…' : 'Mai multe'}</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
