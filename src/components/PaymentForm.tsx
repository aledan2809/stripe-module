'use client'

import { useState, useEffect } from 'react'
import {
  PaymentElement,
  Elements,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { loadStripe, type Stripe as StripeJS } from '@stripe/stripe-js'
import type { PaymentFormProps, PaymentFormLabels } from '../types'
import { DEFAULT_LABELS } from '../types'

// Cache stripe instances by publishable key
const stripeCache = new Map<string, Promise<StripeJS | null>>()

function getStripePromise(publishableKey: string) {
  if (!stripeCache.has(publishableKey)) {
    stripeCache.set(publishableKey, loadStripe(publishableKey))
  }
  return stripeCache.get(publishableKey)!
}

function CheckoutForm({
  amount,
  currencyLabel,
  labels,
  returnUrl,
  onSuccess,
}: {
  amount: number
  currencyLabel: string
  labels: PaymentFormLabels
  returnUrl?: string
  onSuccess?: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return

    setLoading(true)
    setError(null)

    const { error: submitError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: returnUrl || `${window.location.origin}/payments/success`,
      },
      redirect: 'if_required',
    })

    if (submitError) {
      setError(submitError.message || labels.error)
      setLoading(false)
    } else {
      setSuccess(true)
      setLoading(false)
      onSuccess?.()
    }
  }

  if (success) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem 0' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          {labels.success}
        </h3>
        <p style={{ color: '#6b7280' }}>{labels.successDescription}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{
        backgroundColor: '#eff6ff',
        borderRadius: '0.5rem',
        padding: '1rem',
      }}>
        <p style={{ fontSize: '0.875rem', color: '#1e40af' }}>
          {labels.amountLabel}{' '}
          <span style={{ fontWeight: 700, fontSize: '1.125rem' }}>
            {amount.toFixed(2)} {currencyLabel}
          </span>
        </p>
      </div>

      <PaymentElement />

      {error && (
        <div style={{
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '0.5rem',
          padding: '1rem',
          color: '#b91c1c',
          fontSize: '0.875rem',
        }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || loading}
        style={{
          width: '100%',
          padding: '0.75rem 1.5rem',
          backgroundColor: !stripe || loading ? '#93c5fd' : '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: '0.5rem',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: !stripe || loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? labels.processing : `${labels.payButton} ${amount.toFixed(2)} ${currencyLabel}`}
      </button>

      <p style={{ fontSize: '0.75rem', textAlign: 'center', color: '#9ca3af' }}>
        {labels.securityNote}
      </p>
    </form>
  )
}

/**
 * Generic Stripe Payment Form component.
 * Works with any Next.js project — no BlocHub dependencies.
 */
export function PaymentForm({
  createIntentUrl,
  createIntentBody,
  amount,
  currencyLabel = 'RON',
  publishableKey,
  returnUrl,
  onSuccess,
  onCancel,
  labels: customLabels,
}: PaymentFormProps) {
  const labels = { ...DEFAULT_LABELS, ...customLabels }
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function createPaymentIntent() {
      try {
        const response = await fetch(createIntentUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createIntentBody),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Payment initialization failed')
        }

        setClientSecret(data.clientSecret)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    createPaymentIntent()
  }, [createIntentUrl, JSON.stringify(createIntentBody)])

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ color: '#6b7280' }}>{labels.processing}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{
              padding: '0.5rem 1rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              background: 'white',
              cursor: 'pointer',
            }}
          >
            {labels.backButton}
          </button>
        )}
      </div>
    )
  }

  if (!clientSecret) return null

  const stripePromise = getStripePromise(publishableKey)

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>{labels.title}</h3>
        <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>{labels.subtitle}</p>
      </div>
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret,
          appearance: {
            theme: 'stripe',
            variables: {
              colorPrimary: '#2563eb',
            },
          },
        }}
      >
        <CheckoutForm
          amount={amount}
          currencyLabel={currencyLabel}
          labels={labels}
          returnUrl={returnUrl}
          onSuccess={onSuccess}
        />
      </Elements>
    </div>
  )
}
