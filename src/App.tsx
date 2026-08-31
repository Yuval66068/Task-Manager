import { useEffect, useState, type FormEvent } from 'react'
import familyTasksLogo from './images/1.jpeg'
import { ParentDashboard } from './pages/ParentDashboard'
import { ChildDashboard } from './pages/ChildDashboard'
import { NotificationCenter } from './components/NotificationCenter'
import { useFamilyTasks } from './hooks/useFamilyTasks'
import { getSupabaseClient, supabaseConfig } from './services/supabase'
import { appName, appTagline } from './utils/constants'

function App() {
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authView, setAuthView] = useState<'landing' | 'login'>('landing')
  const [authError, setAuthError] = useState('')
  const [email, setEmail] = useState(import.meta.env.VITE_TEST_PARENT_A_EMAIL ?? '')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResolvingRole, setIsResolvingRole] = useState(false)
  const [resolvedDashboardRole, setResolvedDashboardRole] = useState<'parent' | 'child' | null>(null)

  const {
    familyName,
    stats,
    members,
    tasks,
    rewards,
    rewardRedemptions,
    notifications,
    addTask,
    editTask,
    deleteTask,
    addReward,
    requestReward,
    submitTaskCompletion,
    reviewTaskCompletion,
    reviewRewardRedemption,
    markNotificationRead,
    markAllNotificationsRead,
    currentUserRole,
    currentUserName,
    authReady,
  } = useFamilyTasks()
  const child = members.find((member) => member.role === 'child') ?? members[0]
  const isParentDashboard = resolvedDashboardRole === 'parent' || currentUserRole === 'parent'

  async function resolveAuthenticatedMembershipRole(): Promise<'parent' | 'child' | null> {
    const supabase = getSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return null
    }

    const { data: memberships, error: membershipsError } = await supabase
      .from('family_members')
      .select('role, family_id')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true })

    if (membershipsError || !memberships || memberships.length === 0) {
      return null
    }

    const firstMembershipRole = memberships[0]?.role
    return firstMembershipRole === 'parent' ? 'parent' : 'child'
  }

  useEffect(() => {
    const supabase = getSupabaseClient()

    const syncSessionStatus = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      setIsAuthenticated(Boolean(session))
      if (!session) {
        setResolvedDashboardRole(null)
        setIsCheckingSession(false)
        return
      }

      const nextRole = await resolveAuthenticatedMembershipRole()
      setResolvedDashboardRole(nextRole)
      setIsCheckingSession(false)
    }

    void syncSessionStatus()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(Boolean(session))
      if (!session) {
        setResolvedDashboardRole(null)
        setIsCheckingSession(false)
        return
      }

      void (async () => {
        const nextRole = await resolveAuthenticatedMembershipRole()
        setResolvedDashboardRole(nextRole)
        setIsCheckingSession(false)
      })()
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!email.trim() || !password.trim()) {
      setAuthError('Please enter both email and password.')
      return
    }

    setIsSubmitting(true)
    setIsResolvingRole(true)
    setAuthError('')

    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      setIsSubmitting(false)
      setIsResolvingRole(false)
      setAuthError(error.message)
      setIsAuthenticated(false)
      setResolvedDashboardRole(null)
      return
    }

    const resolvedRole = await resolveAuthenticatedMembershipRole()
    setIsSubmitting(false)
    setIsResolvingRole(false)
    setResolvedDashboardRole(resolvedRole)

    if (resolvedRole === 'parent' || resolvedRole === 'child') {
      setIsAuthenticated(true)
      return
    }

    setAuthError('המשתמש עדיין לא משויך למשפחה')
    setIsAuthenticated(false)
  }

  const handleLogout = async () => {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signOut()

    if (error) {
      setAuthError(error.message)
      return
    }

    setIsAuthenticated(false)
    setIsResolvingRole(false)
    setResolvedDashboardRole(null)
    setAuthError('')
    setAuthView('landing')
    setPassword('')
  }

  const shouldShowRoleLoading = isCheckingSession || !authReady || isResolvingRole || (isAuthenticated && resolvedDashboardRole === null && !authError)

  if (shouldShowRoleLoading) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-4 py-10 text-slate-700">
        <div className="panel-card px-6 py-5 text-sm font-medium">
          Loading session...
        </div>
      </div>
    )
  }

  if (!isAuthenticated || resolvedDashboardRole === null) {
    if (isAuthenticated && resolvedDashboardRole === null && !isResolvingRole) {
      return (
        <div dir="rtl" className="auth-shell min-h-screen px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-lg">
            <div className="auth-card auth-card--parent">
              <div className="auth-card__brand">
                <img src={familyTasksLogo} alt="Family Tasks logo" className="auth-brand-logo" />
                <p className="brand-label">Family Tasks</p>
              </div>

              <div className="auth-card__header">
                <h2>המשתמש עדיין לא משויך למשפחה</h2>
              </div>

              <div className="auth-alert auth-alert--warning">
                {authError || 'המשתמש עדיין לא משויך למשפחה'}
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="auth-submit auth-submit--parent"
              >
                התנתקות
              </button>
            </div>
          </div>
        </div>
      )
    }

    if (authView === 'landing') {
      return (
        <div dir="rtl" className="auth-shell min-h-screen px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="landing-panel card-surface">
              <div className="landing-panel__top">
                <div className="landing-logo-wrap">
                  <img src={familyTasksLogo} alt="Family Tasks logo" className="landing-logo" />
                </div>
                <div className="landing-copy">
                  <p className="landing-kicker">Family Tasks</p>
                  <h1 className="landing-title">{appName}</h1>
                </div>
              </div>

              <div className="landing-hero-grid">
                <div className="landing-message">
                  <p className="eyebrow">משימות קטנות. הישגים גדולים.</p>
                  <p className="supporting-copy">{appTagline}</p>
                </div>

                <div className="landing-metrics" aria-label="Family activity summary">
                  <div className="mini-stat mini-stat--gold">
                    <span className="mini-stat__kicker">XP</span>
                    <strong>+120</strong>
                  </div>
                  <div className="mini-stat mini-stat--violet">
                    <span className="mini-stat__kicker">פרסים</span>
                    <strong>5</strong>
                  </div>
                  <div className="mini-stat mini-stat--sky">
                    <span className="mini-stat__kicker">משימות</span>
                    <strong>18</strong>
                  </div>
                </div>
              </div>

              <div className="auth-choice-grid">
                <button type="button" onClick={() => setAuthView('login')} className="auth-choice auth-choice--parent">
                  <span className="auth-choice__icon">🔐</span>
                  <div>
                    <span className="auth-choice__label">התחברות</span>
                    <span className="auth-choice__meta">כניסה לחשבון</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div dir="rtl" className="auth-shell min-h-screen px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            onClick={() => setAuthView('landing')}
            className="back-link"
          >
            ← חזרה
          </button>

          <div className="auth-card auth-card--parent">
            <div className="auth-card__brand">
              <img src={familyTasksLogo} alt="Family Tasks logo" className="auth-brand-logo" />
              <p className="brand-label">Family Tasks</p>
            </div>

            <div className="auth-card__header">
              <h2>ברוכים הבאים 👋</h2>
              <p>התחברו כדי להיכנס לחשבון המשפחה</p>
            </div>

            <form className="auth-form" onSubmit={handleLogin}>
              <div className="field-group">
                <label htmlFor="auth-email">אימייל</label>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  className="auth-input"
                />
              </div>

              <div className="field-group">
                <label htmlFor="auth-password">סיסמה</label>
                <input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter password"
                  className="auth-input"
                />
              </div>

              {!supabaseConfig.isConfigured && (
                <div className="auth-alert auth-alert--warning">
                  Missing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the frontend environment.
                </div>
              )}

              {authError && <div className="auth-alert auth-alert--error">{authError}</div>}

              <button
                type="submit"
                disabled={isSubmitting || !supabaseConfig.isConfigured}
                className="auth-submit auth-submit--parent"
              >
                {isSubmitting ? 'מתחבר...' : 'התחברות'}
              </button>
            </form>

            <div className="auth-footnote">
              Use one of the existing Supabase test accounts from your local .env file, or enter the matching email/password for your project.
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div dir="rtl" className="app-shell min-h-screen text-slate-800">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 rounded-[1.75rem] border border-white/70 bg-white/80 p-4 shadow-[0_18px_38px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold tracking-[0.08em] text-indigo-600">Family Tasks</p>
            <h1 className="mt-1 text-3xl font-black text-slate-900">{appName}</h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-full bg-gradient-to-r from-indigo-50 to-amber-50 px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-indigo-100">
              {appTagline} · {familyName}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="secondary-button px-3 py-1.5 text-sm"
            >
              Log out
            </button>
          </div>
        </header>

        <main className="grid gap-6 xl:grid-cols-1">
          <NotificationCenter
            notifications={notifications}
            onMarkRead={markNotificationRead}
            onMarkAllRead={markAllNotificationsRead}
          />
          {isParentDashboard ? (
            <ParentDashboard
              familyName={familyName}
              currentUserName={currentUserName}
              stats={stats}
              members={members}
              tasks={tasks}
              rewards={rewards}
              rewardRedemptions={rewardRedemptions}
              onAddTask={addTask}
              onEditTask={editTask}
              onDeleteTask={deleteTask}
              onReviewTaskCompletion={reviewTaskCompletion}
              onAddReward={addReward}
              onReviewRewardRedemption={reviewRewardRedemption}
            />
          ) : (
            <ChildDashboard
              child={child}
              currentUserName={currentUserName}
              tasks={tasks.filter((task) => task.memberId === child.id)}
              onSubmitTaskCompletion={submitTaskCompletion}
              rewards={rewards}
              rewardRedemptions={rewardRedemptions}
              onRequestReward={requestReward}
            />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
