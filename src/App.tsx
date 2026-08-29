import { useEffect, useState, type FormEvent } from 'react'
import { ParentDashboard } from './pages/ParentDashboard'
import { ChildDashboard } from './pages/ChildDashboard'
import { NotificationCenter } from './components/NotificationCenter'
import { useFamilyTasks } from './hooks/useFamilyTasks'
import { getSupabaseClient, supabaseConfig } from './services/supabase'
import { appName, appTagline } from './utils/constants'

function App() {
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authError, setAuthError] = useState('')
  const [email, setEmail] = useState(import.meta.env.VITE_TEST_PARENT_A_EMAIL ?? '')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

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
    authReady,
  } = useFamilyTasks()
  const child = members.find((member) => member.role === 'child') ?? members[0]
  const isParentDashboard = currentUserRole === 'parent'

  useEffect(() => {
    const supabase = getSupabaseClient()

    const syncSessionStatus = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      setIsAuthenticated(Boolean(session))
      setIsCheckingSession(false)
    }

    void syncSessionStatus()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(Boolean(session))
      setIsCheckingSession(false)
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
    setAuthError('')

    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    setIsSubmitting(false)

    if (error) {
      setAuthError(error.message)
      setIsAuthenticated(false)
      return
    }

    setIsAuthenticated(true)
  }

  const handleLogout = async () => {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signOut()

    if (error) {
      setAuthError(error.message)
      return
    }

    setIsAuthenticated(false)
    setAuthError('')
  }

  if (isCheckingSession || !authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-700">
        <div className="rounded-2xl bg-white px-6 py-5 text-sm font-medium shadow-sm ring-1 ring-slate-200">
          Loading session...
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-800">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm font-medium text-indigo-600">Family Tasks</p>
          <h1 className="mt-2 text-3xl font-black text-slate-900">{appName}</h1>
          <p className="mt-2 text-sm text-slate-600">{appTagline}</p>

          <form className="mt-6 space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">אימייל</label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none ring-0 transition focus:border-indigo-400 focus:bg-white"
                placeholder="name@example.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">סיסמה</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none ring-0 transition focus:border-indigo-400 focus:bg-white"
                placeholder="Enter password"
              />
            </div>

            {!supabaseConfig.isConfigured && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Missing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the frontend environment.
              </div>
            )}

            {authError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !supabaseConfig.isConfigured}
              className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSubmitting ? 'Logging in...' : 'Log in'}
            </button>
          </form>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Use one of the existing Supabase test accounts from your local .env file, or enter the matching email/password for your project.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div dir="rtl" className="min-h-screen bg-slate-100 text-slate-800">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-indigo-600">Family Tasks</p>
            <h1 className="mt-1 text-3xl font-black text-slate-900">{appName}</h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600">
              {appTagline} · {familyName}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
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
