'use client'

import { useState, useEffect } from 'react'

interface LogEntry {
  invoiceId: string
  projectSlug: string
  invoiceNumber: string
  to: string
  bcc: string
  status: 'PENDING' | 'SENT' | 'FAILED' | 'BLOCKED_UNVERIFIED'
  error?: string
  at: string
}

const STATUS_COLOR: Record<LogEntry['status'], string> = {
  SENT: '#34d399', FAILED: '#f87171', BLOCKED_UNVERIFIED: '#f59e0b', PENDING: '#9ca3af',
}

export default function InvoiceEmailsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const data = await fetch('/api/invoice-emails').then(r => r.json()).catch(() => ({ entries: [] }))
    setEntries(data.entries || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Facturi trimise</h1>
        <p className="page-desc">Log al emailurilor de factură trimise clienților (+ BCC de control). Sursa idempotenței.</p>
      </div>
      <div className="page-content">
        <div className="card">
          <div className="card-header">
            <div className="card-title">{entries.length} înregistrări</div>
            <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>↻ Reîmprospătează</button>
          </div>
          {loading ? (
            <p className="text-muted">Se încarcă…</p>
          ) : entries.length === 0 ? (
            <p className="text-muted" style={{ padding: 16 }}>Niciun email trimis încă.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: 8 }}>Dată</th>
                  <th style={{ padding: 8 }}>Proiect</th>
                  <th style={{ padding: 8 }}>Factură</th>
                  <th style={{ padding: 8 }}>Către</th>
                  <th style={{ padding: 8 }}>BCC</th>
                  <th style={{ padding: 8 }}>Status</th>
                  <th style={{ padding: 8 }}>Eroare</th>
                </tr></thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.invoiceId} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{new Date(e.at).toLocaleString('ro-RO')}</td>
                      <td style={{ padding: 8, fontWeight: 600 }}>{e.projectSlug || '—'}</td>
                      <td style={{ padding: 8 }}>{e.invoiceNumber || '—'}</td>
                      <td style={{ padding: 8 }}>{e.to || '—'}</td>
                      <td style={{ padding: 8 }}>{e.bcc || '—'}</td>
                      <td style={{ padding: 8 }}><span style={{ color: STATUS_COLOR[e.status], fontWeight: 600 }}>{e.status}</span></td>
                      <td style={{ padding: 8, color: '#f87171', fontSize: 12 }}>{e.error || ''}</td>
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
