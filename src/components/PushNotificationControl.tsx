import { useEffect, useState } from 'react'
import {
  enablePushNotifications,
  getExistingPushSubscriptionState,
  isPushSupported,
  reclaimExistingPushSubscription,
} from '../services/pushNotifications'
import { getSupabaseClient } from '../services/supabase'

type PushState = 'idle' | 'processing' | 'enabled' | 'denied' | 'unavailable'

/**
 * Compact, shared enable-push-notifications control used by both parent and
 * child dashboards. Does not prompt for permission automatically — the
 * enable action only runs from an explicit user click (user gesture).
 *
 * Tracks the currently authenticated user id so that whenever the session
 * changes (login, logout, or a different family member logging in on the
 * same device/browser), an existing browser PushSubscription is silently
 * re-registered for the newly authenticated user. This prevents a stale
 * subscription owned by a previous account from being displayed as
 * "enabled" for someone who never registered it themselves.
 */
export function PushNotificationControl() {
  const [state, setState] = useState<PushState>('idle')
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    const supabase = getSupabaseClient()

    supabase.auth.getUser().then(({ data }) => {
      if (isMounted) {
        setUserId(data.user?.id ?? null)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) {
        return
      }

      const nextUserId = session?.user?.id ?? null
      setUserId(nextUserId)

      if (!nextUserId) {
        // Logged out: clear this device's local Push UI state for the
        // previous account. Do NOT unsubscribe the browser subscription —
        // the next authenticated user may silently reclaim it.
        setState('idle')
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!userId) {
      return
    }

    let cancelled = false

    async function restoreStateForCurrentUser() {
      if (!isPushSupported()) {
        if (!cancelled) setState('unavailable')
        return
      }

      const { hasSubscription, permission } = await getExistingPushSubscriptionState()
      if (cancelled) return

      if (permission === 'denied') {
        setState('denied')
        return
      }

      if (!hasSubscription) {
        setState('idle')
        return
      }

      // A browser PushSubscription already exists. It may belong to a
      // different account that previously used this device, so it must be
      // silently re-registered for the current user before it can be
      // considered "enabled" for them.
      setState('processing')
      const reclaimed = await reclaimExistingPushSubscription()
      if (cancelled) return

      setState(reclaimed ? 'enabled' : 'idle')
    }

    void restoreStateForCurrentUser()

    return () => {
      cancelled = true
    }
  }, [userId])

  const handleEnable = async () => {
    setState('processing')
    try {
      await enablePushNotifications()
      setState('enabled')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown-error'
      console.error('Failed to enable push notifications.', error)
      if (message === 'permission-denied') {
        setState('denied')
      } else {
        setState('unavailable')
      }
    }
  }

  if (state === 'unavailable') {
    return (
      <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500">
        התראות עדיין אינן זמינות במכשיר הזה.
      </span>
    )
  }

  if (state === 'denied') {
    return (
      <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600">
        ההתראות חסומות במכשיר
      </span>
    )
  }

  if (state === 'enabled') {
    return (
      <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
        התראות פעילות ✓
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void handleEnable()}
      disabled={state === 'processing'}
      className="secondary-button px-3 py-1.5 text-xs sm:text-sm"
    >
      {state === 'processing' ? 'מפעיל התראות...' : 'הפעל התראות 🔔'}
    </button>
  )
}
