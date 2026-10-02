import { IS_MINITOOL } from '../minitool'
import { readDeviceCredential } from '../composables/useDeviceCredential'
import type { OnboardingEvent } from '../../shared/onboarding-metrics'

/** Best-effort occurrence count. No auth, identifiers, retry, queue or business dependency. */
export function reportOnboarding(event: OnboardingEvent): void {
  if (IS_MINITOOL) return
  try {
    const credential = readDeviceCredential()
    const familyStatus = credential === null ? 'unjoined' : credential.familyStatus
    if (familyStatus === undefined) return // Legacy membership must first be confirmed.
    const base = import.meta.env.VITE_API_BASE || 'https://api.starquiz.link'
    void fetch(`${base}/api/metrics/onboarding`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
      body: JSON.stringify({ event, family_status: familyStatus }),
    }).catch(() => {})
  } catch {
    // Even storage failures or a throwing transport must never interrupt an action.
  }
}
