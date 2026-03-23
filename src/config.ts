import type { StripeModuleConfig } from './types'

export const DEFAULT_CONFIG: StripeModuleConfig = {
  currency: 'ron',
  country: 'RO',
  paymentMethods: ['card'],
  apiVersion: '2025-12-15.clover',
}

let moduleConfig: StripeModuleConfig = { ...DEFAULT_CONFIG }

export function configureStripeModule(config: Partial<StripeModuleConfig>): void {
  moduleConfig = { ...moduleConfig, ...config }
}

export function getConfig(): StripeModuleConfig {
  return moduleConfig
}
