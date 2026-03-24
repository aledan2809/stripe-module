import { NextRequest, NextResponse } from 'next/server'
import { syncPlans, getPlanMapping } from '../server/sync'
import type { PlanDefinition } from '../server/sync'

export interface SyncRouteOptions {
  /**
   * Auth check. Return false to reject.
   */
  authorize?: (request: NextRequest) => Promise<boolean>
}

/**
 * Create a Next.js route handler for plan sync.
 *
 * POST /api/stripe/sync — sync plans to Stripe
 * GET /api/stripe/sync?project=blochub — get current mapping
 *
 * POST body: { project: string, plans: PlanDefinition[] }
 */
export function syncRoute(options: SyncRouteOptions = {}) {
  return {
    async POST(request: NextRequest) {
      try {
        if (options.authorize) {
          const authorized = await options.authorize(request)
          if (!authorized) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
          }
        }

        const { project, plans } = await request.json() as {
          project: string
          plans: PlanDefinition[]
        }

        if (!project || !plans?.length) {
          return NextResponse.json(
            { error: 'project and plans[] required' },
            { status: 400 }
          )
        }

        const result = await syncPlans(project, plans)
        return NextResponse.json(result)
      } catch (error: any) {
        console.error('Stripe sync error:', error)
        return NextResponse.json(
          { error: error.message || 'Sync failed' },
          { status: 500 }
        )
      }
    },

    async GET(request: NextRequest) {
      try {
        if (options.authorize) {
          const authorized = await options.authorize(request)
          if (!authorized) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
          }
        }

        const { searchParams } = new URL(request.url)
        const project = searchParams.get('project')

        if (!project) {
          return NextResponse.json(
            { error: 'project query param required' },
            { status: 400 }
          )
        }

        const mapping = await getPlanMapping(project)
        return NextResponse.json({ project, mapping })
      } catch (error: any) {
        console.error('Stripe mapping error:', error)
        return NextResponse.json(
          { error: error.message || 'Failed to get mapping' },
          { status: 500 }
        )
      }
    },
  }
}
