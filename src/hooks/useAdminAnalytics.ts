import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabaseClient, supabaseConfig } from '../services/supabase'

export type AdminAnalyticsSummary = {
  totalExternalFamilies: number
  newFamiliesToday: number
  newFamilies7d: number
  newFamilies30d: number
  openedAppToday: number
  openedApp7d: number
  openedApp30d: number
  loggedInToday: number
  loggedIn7d: number
  loggedIn30d: number
  familiesWithChild: number
  familiesWithTask: number
  familiesWithCompletion: number
  familiesWithRewardRedemption: number
  taskCompletionsToday: number
  taskCompletions7d: number
  taskCompletions30d: number
  activeFamiliesToday: number
  activeFamilies7d: number
  activeFamilies30d: number
  pctAddedChild: number
  pctCreatedTask: number
  pctCompletedTask: number
}

export type AdminFamilyActivity = {
  familyId: string
  familyName: string
  createdAt: string
  childCount: number
  taskCount: number
  completionCount: number
  rewardRedemptionCount: number
  lastAppOpenAt: string | null
  lastLoginAt: string | null
  lastTaskActivityAt: string | null
  lastActivityAt: string | null
}

export type AdminSignupFunnelStage = {
  stage: string
  count: number
  percentageOfSignups: number
  percentageFromPreviousStage: number | null
}

export type AdminRecentSignup = {
  signedUpAt: string
  email: string
  emailConfirmed: boolean
  signedIn: boolean
  profileCreated: boolean
  familyJoined: boolean
  childAdded: boolean
  taskCreated: boolean
}

type AdminAnalyticsState = {
  isLoading: boolean
  isAuthorized: boolean | null
  error: string
  summary: AdminAnalyticsSummary | null
  families: AdminFamilyActivity[]
  signupFunnel: AdminSignupFunnelStage[]
  recentSignups: AdminRecentSignup[]
  lastUpdatedAt: Date | null
}

const REFRESH_INTERVAL_MS = 30_000
const REALTIME_DEBOUNCE_MS = 500

function mapSummaryRow(row: Record<string, unknown>): AdminAnalyticsSummary {
  const numberOf = (value: unknown) => Number(value ?? 0)

  return {
    totalExternalFamilies: numberOf(row.total_external_families),
    newFamiliesToday: numberOf(row.new_families_today),
    newFamilies7d: numberOf(row.new_families_7d),
    newFamilies30d: numberOf(row.new_families_30d),
    openedAppToday: numberOf(row.opened_app_today),
    openedApp7d: numberOf(row.opened_app_7d),
    openedApp30d: numberOf(row.opened_app_30d),
    loggedInToday: numberOf(row.logged_in_today),
    loggedIn7d: numberOf(row.logged_in_7d),
    loggedIn30d: numberOf(row.logged_in_30d),
    familiesWithChild: numberOf(row.families_with_child),
    familiesWithTask: numberOf(row.families_with_task),
    familiesWithCompletion: numberOf(row.families_with_completion),
    familiesWithRewardRedemption: numberOf(row.families_with_reward_redemption),
    taskCompletionsToday: numberOf(row.task_completions_today),
    taskCompletions7d: numberOf(row.task_completions_7d),
    taskCompletions30d: numberOf(row.task_completions_30d),
    activeFamiliesToday: numberOf(row.active_families_today),
    activeFamilies7d: numberOf(row.active_families_7d),
    activeFamilies30d: numberOf(row.active_families_30d),
    pctAddedChild: numberOf(row.pct_added_child),
    pctCreatedTask: numberOf(row.pct_created_task),
    pctCompletedTask: numberOf(row.pct_completed_task),
  }
}

function mapFamilyRow(row: Record<string, unknown>): AdminFamilyActivity {
  return {
    familyId: String(row.family_id ?? ''),
    familyName: String(row.family_name ?? ''),
    createdAt: String(row.created_at ?? ''),
    childCount: Number(row.child_count ?? 0),
    taskCount: Number(row.task_count ?? 0),
    completionCount: Number(row.completion_count ?? 0),
    rewardRedemptionCount: Number(row.reward_redemption_count ?? 0),
    lastAppOpenAt: (row.last_app_open_at as string | null) ?? null,
    lastLoginAt: (row.last_login_at as string | null) ?? null,
    lastTaskActivityAt: (row.last_task_activity_at as string | null) ?? null,
    lastActivityAt: (row.last_activity_at as string | null) ?? null,
  }
}

function mapSignupFunnelRow(row: Record<string, unknown>): AdminSignupFunnelStage {
  return {
    stage: String(row.stage ?? ''),
    count: Number(row.count ?? 0),
    percentageOfSignups: Number(row.percentage_of_signups ?? 0),
    percentageFromPreviousStage:
      row.percentage_from_previous_stage === null || row.percentage_from_previous_stage === undefined
        ? null
        : Number(row.percentage_from_previous_stage),
  }
}

function mapRecentSignupRow(row: Record<string, unknown>): AdminRecentSignup {
  return {
    signedUpAt: String(row.signed_up_at ?? ''),
    email: String(row.email ?? ''),
    emailConfirmed: Boolean(row.email_confirmed),
    signedIn: Boolean(row.signed_in),
    profileCreated: Boolean(row.profile_created),
    familyJoined: Boolean(row.family_joined),
    childAdded: Boolean(row.child_added),
    taskCreated: Boolean(row.task_created),
  }
}

export function useAdminAnalytics() {
  const [state, setState] = useState<AdminAnalyticsState>({
    isLoading: true,
    isAuthorized: null,
    error: '',
    summary: null,
    families: [],
    signupFunnel: [],
    recentSignups: [],
    lastUpdatedAt: null,
  })
  const debounceRef = useRef<number | null>(null)

  const fetchAnalytics = useCallback(async () => {
    if (!supabaseConfig.isConfigured) {
      setState((current) => ({ ...current, isLoading: false, isAuthorized: false, error: '' }))
      return
    }

    const supabase = getSupabaseClient()

    const [summaryResult, familiesResult, signupFunnelResult, recentSignupsResult] = await Promise.all([
      supabase.rpc('get_admin_analytics_summary'),
      supabase.rpc('get_admin_family_activity'),
      supabase.rpc('get_admin_signup_funnel'),
      supabase.rpc('get_admin_recent_signups'),
    ])

    if (summaryResult.error || familiesResult.error || signupFunnelResult.error || recentSignupsResult.error) {
      // Both RPCs raise 'not authorized' for non-admins; treat any error as
      // unauthorized rather than leaking details about the failure reason.
      setState((current) => ({
        ...current,
        isLoading: false,
        isAuthorized: false,
        error: '',
        summary: null,
        families: [],
        signupFunnel: [],
        recentSignups: [],
      }))
      return
    }

    const summaryRow = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data
    const summary = summaryRow ? mapSummaryRow(summaryRow as Record<string, unknown>) : null
    const families = Array.isArray(familiesResult.data)
      ? familiesResult.data.map((row) => mapFamilyRow(row as Record<string, unknown>))
      : []
    const signupFunnel = Array.isArray(signupFunnelResult.data)
      ? signupFunnelResult.data.map((row) => mapSignupFunnelRow(row as Record<string, unknown>))
      : []
    const recentSignups = Array.isArray(recentSignupsResult.data)
      ? recentSignupsResult.data.map((row) => mapRecentSignupRow(row as Record<string, unknown>))
      : []

    setState({
      isLoading: false,
      isAuthorized: true,
      error: '',
      summary,
      families,
      signupFunnel,
      recentSignups,
      lastUpdatedAt: new Date(),
    })
  }, [])

  const scheduleDebouncedRefetch = useCallback(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
    }

    debounceRef.current = window.setTimeout(() => {
      void fetchAnalytics()
    }, REALTIME_DEBOUNCE_MS)
  }, [fetchAnalytics])

  useEffect(() => {
    queueMicrotask(() => {
      void fetchAnalytics()
    })

    if (!supabaseConfig.isConfigured) {
      return
    }

    const supabase = getSupabaseClient()

    // Realtime is used only as a signal to refetch the authoritative admin
    // RPCs -- the raw payload is never treated as the source of truth.
    const channel = supabase
      .channel('admin-analytics-events')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'analytics_events' },
        () => {
          scheduleDebouncedRefetch()
        },
      )
      .subscribe()

    const intervalId = window.setInterval(() => {
      void fetchAnalytics()
    }, REFRESH_INTERVAL_MS)

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
      }
      window.clearInterval(intervalId)
      void supabase.removeChannel(channel)
    }
  }, [fetchAnalytics, scheduleDebouncedRefetch])

  return {
    ...state,
    refresh: fetchAnalytics,
  }
}
