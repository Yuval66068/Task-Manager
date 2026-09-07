import { getSupabaseClient, supabaseConfig } from '../services/supabase'

export type AnalyticsEventName =
  | 'app_open'
  | 'login'

export async function trackEvent(
  eventName: AnalyticsEventName,
  familyId?: string | null,
) {
  if (!supabaseConfig.isConfigured) {
    return
  }

  try {
    const supabase = getSupabaseClient()

    const {
      data: { session },
    } = await supabase.auth.getSession()

    const userId = session?.user.id

    if (!userId) {
      return
    }

    let resolvedFamilyId = familyId ?? null

    if (!resolvedFamilyId) {
      const { data: membership, error: membershipError } = await supabase
        .from('family_members')
        .select('family_id')
        .eq('user_id', userId)
        .maybeSingle()

      if (!membershipError) {
        resolvedFamilyId = membership?.family_id ?? null
      }
    }

    const { error } = await supabase
      .from('analytics_events')
      .insert({
        family_id: resolvedFamilyId,
        user_id: userId,
        event_name: eventName,
      })

    if (error) {
      console.warn('Analytics event failed:', eventName, error.message)
    }
  } catch (error) {
    console.warn('Analytics event failed:', eventName, error)
  }
}