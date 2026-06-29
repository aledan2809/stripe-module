'use client'

import { useState, useEffect } from 'react'

interface EmailCfg {
  smtp: { host: string; port: number; secure: boolean; user: string; fromDefault: string; hasPass: boolean }
  verified: boolean
  verifiedAt: string | null
}

export default function EmailPage() {
  const [cfg, setCfg] = useState<EmailCfg | null>(null)
  const [form, setForm] = useState({ host: '', port: 587, secure: false, user: '', fromDefault: '', pass: '' })
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const data: EmailCfg = await fetch('/api/email-config').then(r => r.json())
    setCfg(data)
    setForm({
      host: data.smtp.host, port: data.smtp.port, secure: data.smtp.secure,
      user: data.smtp.user, fromDefault: data.smtp.fromDefault, pass: '',
    })
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    setBusy(true)
    const res = await fetch('/api/email-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setBusy(false)
    if (res.ok) { setMessage({ type: 'success', text: 'Config SMTP salvat. Verificarea anterioară a fost resetată — apasă „Verifică".' }); setForm({ ...form, pass: '' }); load() }
    else setMessage({ type: 'error', text: 'Salvare eșuată' })
  }

  const verify = async () => {
    setBusy(true)
    setMessage({ type: 'info', text: 'Se verifică transportul + trimite test la adresa fromDefault…' })
    const res = await fetch('/api/email-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify' }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (data.ok) { setMessage({ type: 'success', text: `✓ SMTP verificat — test trimis la ${form.fromDefault}.` }); load() }
    else setMessage({ type: 'error', text: `Verificare eșuată: ${data.error || 'eroare necunoscută'}` })
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Email (SMTP broker)</h1>
        <p className="page-desc">Transport unic pentru facturile trimise clienților (Resend). Parola e write-only + criptată at-rest.</p>
      </div>
      <div className="page-content">
        <div className="guide">
          <div className="guide-title">ℹ️ Cum funcționează</div>
          <ul>
            <li>Transport recomandat: <strong>Resend</strong> — host <code>smtp.resend.com</code>, port <code>587</code>, user <code>resend</code>, parola = cheia API <code>re_…</code>.</li>
            <li>Domeniul din <code>fromDefault</code> trebuie <strong>verificat în Resend</strong> (techbiz.ae ✓).</li>
            <li>Niciun email per-proiect nu pleacă până „Verifică" nu trece (fail-closed).</li>
          </ul>
        </div>

        {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

        <div className="card">
          <div className="card-header">
            <div className="card-title">Configurare SMTP</div>
            <div>
              {cfg?.verified
                ? <span className="text-green" style={{ fontWeight: 600 }}>✓ Verificat{cfg.verifiedAt ? ` · ${new Date(cfg.verifiedAt).toLocaleString('ro-RO')}` : ''}</span>
                : <span className="text-yellow" style={{ fontWeight: 600 }}>⚠ Neverificat</span>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Host</label>
              <input className="form-input" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} placeholder="smtp.resend.com" />
            </div>
            <div className="form-group">
              <label className="form-label">Port</label>
              <input className="form-input" type="number" value={form.port} onChange={e => setForm({ ...form, port: Number(e.target.value) || 587 })} />
            </div>
            <div className="form-group">
              <label className="form-label">User</label>
              <input className="form-input" value={form.user} onChange={e => setForm({ ...form, user: e.target.value })} placeholder="resend" />
            </div>
            <div className="form-group">
              <label className="form-label">From implicit (BCC default)</label>
              <input className="form-input" value={form.fromDefault} onChange={e => setForm({ ...form, fromDefault: e.target.value })} placeholder="invoice@techbiz.ae" />
            </div>
            <div className="form-group">
              <label className="form-label">Parolă / cheie API {cfg?.smtp.hasPass && <span className="text-green" style={{ fontSize: 11 }}>(setată — lasă gol ca să păstrezi)</span>}</label>
              <input className="form-input mono" type="password" value={form.pass} onChange={e => setForm({ ...form, pass: e.target.value })} placeholder={cfg?.smtp.hasPass ? '•••••••• (nesch.)' : 're_…'} />
            </div>
            <div className="form-group">
              <label className="form-label">Secure (TLS direct)</label>
              <div className="switch-container">
                <span className={!form.secure ? 'text-yellow' : 'text-muted'} style={{ fontSize: 12, fontWeight: 600 }}>STARTTLS</span>
                <label className="switch"><input type="checkbox" checked={form.secure} onChange={e => setForm({ ...form, secure: e.target.checked })} /><span className="switch-slider" /></label>
                <span className={form.secure ? 'text-green' : 'text-muted'} style={{ fontSize: 12, fontWeight: 600 }}>SSL</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-4" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={verify} disabled={busy}>Verifică (test la {form.fromDefault || 'fromDefault'})</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || !form.host}>{busy ? '…' : 'Salvează'}</button>
          </div>
        </div>
      </div>
    </>
  )
}
