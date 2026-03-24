'use client'

import { useState, useEffect } from 'react'

interface StripeKeys { secretKey: string; publishableKey: string; webhookSecret: string }
interface Creds { test: StripeKeys; live: StripeKeys }
interface Company { slug: string; name: string; stripeEnvironment: string }

interface TestResult {
  ok: boolean
  mode?: string
  account?: {
    id: string; businessName: string; country: string
    currency: string; email: string; chargesEnabled: boolean; payoutsEnabled: boolean
  }
  error?: string
}

export default function CredentialsPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [creds, setCreds] = useState<Creds | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<'test' | 'live' | null>(null)
  const [testResult, setTestResult] = useState<{ env: string; result: TestResult } | null>(null)
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/companies').then(r => r.json()).then(setCompanies)
  }, [])

  const loadCreds = async (slug: string) => {
    const res = await fetch(`/api/credentials?slug=${slug}`)
    const data = await res.json()
    setCreds(data)
    setSelected(slug)
    setTestResult(null)
    setMessage(null)
  }

  const saveCreds = async () => {
    if (!selected || !creds) return
    setSaving(true)
    await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: selected, credentials: creds }),
    })
    setMessage({ type: 'success', text: 'Credențiale salvate!' })
    setSaving(false)
  }

  const testConnection = async (env: 'test' | 'live') => {
    if (!creds) return
    setTesting(env)
    setTestResult(null)

    const keys = env === 'test' ? creds.test : creds.live
    if (!keys.secretKey) {
      setTestResult({ env, result: { ok: false, error: `Cheia secretă ${env} nu e configurată` } })
      setTesting(null)
      return
    }

    const res = await fetch('/api/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secretKey: keys.secretKey }),
    })
    const result = await res.json()
    setTestResult({ env, result })
    setTesting(null)
  }

  const maskKey = (key: string) => {
    if (!key) return ''
    if (key.length < 12) return '••••'
    return key.substring(0, 7) + '••••••••' + key.substring(key.length - 4)
  }

  const updateKey = (env: 'test' | 'live', field: keyof StripeKeys, value: string) => {
    if (!creds) return
    setCreds({
      ...creds,
      [env]: { ...creds[env], [field]: value },
    })
  }

  const renderKeySection = (env: 'test' | 'live', label: string, color: string) => {
    if (!creds) return null
    const keys = creds[env]
    const prefix = env === 'test' ? 'sk_test_ / pk_test_' : 'sk_live_ / pk_live_'

    return (
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-3">
            <span className={`badge badge-${env === 'test' ? 'test' : 'live'}`}>{label}</span>
            <span className="text-sm text-muted">Prefixuri: <code>{prefix}</code></span>
          </div>
          <div className="flex gap-2">
            <button
              className={`btn btn-sm ${testResult?.env === env && testResult.result.ok ? 'btn-success' : 'btn-secondary'}`}
              onClick={() => testConnection(env)}
              disabled={testing !== null}
            >
              {testing === env ? 'Se testează...' : '⚡ Test conexiune'}
            </button>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-group full">
            <label className="form-label">Secret Key ({env})</label>
            <input className="form-input mono" type="password"
              value={keys.secretKey}
              placeholder={`sk_${env}_...`}
              onChange={e => updateKey(env, 'secretKey', e.target.value)} />
            {keys.secretKey && (
              <span className="text-sm text-muted">{maskKey(keys.secretKey)}</span>
            )}
          </div>

          <div className="form-group full">
            <label className="form-label">Publishable Key ({env})</label>
            <input className="form-input mono"
              value={keys.publishableKey}
              placeholder={`pk_${env}_...`}
              onChange={e => updateKey(env, 'publishableKey', e.target.value)} />
          </div>

          <div className="form-group full">
            <label className="form-label">Webhook Secret ({env})</label>
            <input className="form-input mono" type="password"
              value={keys.webhookSecret}
              placeholder="whsec_..."
              onChange={e => updateKey(env, 'webhookSecret', e.target.value)} />
          </div>
        </div>

        {/* Test result */}
        {testResult?.env === env && (
          <div className={`alert mt-4 ${testResult.result.ok ? 'alert-success' : 'alert-error'}`}>
            {testResult.result.ok ? (
              <div>
                <strong>✓ Conexiune reușită!</strong>
                <div className="text-sm mt-2">
                  <div>Cont: <strong>{testResult.result.account?.businessName}</strong> ({testResult.result.account?.id})</div>
                  <div>Țară: {testResult.result.account?.country} · Monedă: {testResult.result.account?.currency?.toUpperCase()}</div>
                  <div>Email: {testResult.result.account?.email}</div>
                  <div>
                    Plăți: {testResult.result.account?.chargesEnabled ? '✓ Active' : '✗ Inactive'} ·
                    Payouts: {testResult.result.account?.payoutsEnabled ? '✓ Active' : '✗ Inactive'}
                  </div>
                  <div>Mod: <strong className={testResult.result.mode === 'test' ? 'text-yellow' : 'text-green'}>
                    {testResult.result.mode?.toUpperCase()}
                  </strong></div>
                </div>
              </div>
            ) : (
              <div>
                <strong>✗ Conexiune eșuată</strong>
                <div className="text-sm mt-2">{testResult.result.error}</div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Credențiale Stripe</h1>
        <p className="page-desc">Configurează cheile API Stripe pentru fiecare firmă (Test + Live)</p>
      </div>

      <div className="page-content">
        {/* Stripe guide */}
        <div className="guide">
          <div className="guide-title">🔑 De unde iau cheile Stripe?</div>
          <ol>
            <li>Deschide <a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noopener">Stripe Dashboard → Developers → API Keys</a></li>
            <li><strong>Publishable key</strong> (<code>pk_test_...</code>) → copiaz-o în câmpul "Publishable Key"</li>
            <li><strong>Secret key</strong> (<code>sk_test_...</code>) → click "Reveal test key" → copiaz-o în câmpul "Secret Key"</li>
            <li>Pentru <strong>Webhook Secret</strong>: Developers → Webhooks → Add endpoint → copiază <code>whsec_...</code></li>
            <li>Pentru <strong>chei Live</strong>: dezactivează "Test mode" din Stripe Dashboard și repetă pașii</li>
          </ol>
          <p className="mt-2">
            ⚠️ <strong>Secret Key</strong> nu trebuie expusă niciodată în frontend!
            Doar <strong>Publishable Key</strong> e sigură pentru client-side.
          </p>
        </div>

        {/* Company selector */}
        <div className="card">
          <div className="card-title mb-4">Selectează firma</div>
          {companies.length === 0 ? (
            <p className="text-muted">Adaugă mai întâi o firmă în pagina Firme.</p>
          ) : (
            <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
              {companies.map(c => (
                <button key={c.slug}
                  className={`btn ${selected === c.slug ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => loadCreds(c.slug)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

        {/* Credentials editor */}
        {selected && creds && (
          <>
            {renderKeySection('test', 'Test Mode', 'yellow')}
            {renderKeySection('live', 'Live Mode', 'green')}

            <div className="flex" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={saveCreds} disabled={saving}>
                {saving ? 'Se salvează...' : '💾 Salvează credențialele'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
