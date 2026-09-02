import { useEffect, useRef, useState, type FormEvent } from 'react'
import familyTasksLogo from './images/1.jpeg'
import { ParentDashboard } from './pages/ParentDashboard'
import { ChildDashboard } from './pages/ChildDashboard'
import { NotificationCenter } from './components/NotificationCenter'
import { PushNotificationControl } from './components/PushNotificationControl'
import { useFamilyTasks } from './hooks/useFamilyTasks'
import { getSupabaseClient, supabaseConfig } from './services/supabase'
import { appName, appTagline } from './utils/constants'

const PIN_PATTERN = /^\d{6}$/

function App() {
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authView, setAuthView] = useState<'landing' | 'login' | 'signup' | 'pending-confirmation' | 'child-login'>('landing')
  const [authError, setAuthError] = useState('')
  const [email, setEmail] = useState(import.meta.env.VITE_TEST_PARENT_A_EMAIL ?? '')
  const [password, setPassword] = useState('')
  const [signupFullName, setSignupFullName] = useState('')
  const [signupFamilyName, setSignupFamilyName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResolvingRole, setIsResolvingRole] = useState(false)
  const [resolvedDashboardRole, setResolvedDashboardRole] = useState<'parent' | 'child' | null>(null)
  const [authenticatedUserId, setAuthenticatedUserId] = useState<string | null>(null)
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState('')
  const [childLoginFamilyCode, setChildLoginFamilyCode] = useState('')
  const [childLoginUsername, setChildLoginUsername] = useState('')
  const [childLoginPin, setChildLoginPin] = useState('')
  const [childLoginError, setChildLoginError] = useState('')
  const [isChildLoginSubmitting, setIsChildLoginSubmitting] = useState(false)
  const onboardingInFlightRef = useRef(false)

  const {
    familyName,
    familyCode,
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
    archiveReward,
    requestReward,
    submitTaskCompletion,
    reviewTaskCompletion,
    reviewRewardRedemption,
    markNotificationRead,
    markAllNotificationsRead,
    currentUserRole,
    currentUserName,
    authReady,
    refreshFamilyData,
  } = useFamilyTasks()
  const child = members.find((member) => member.id === authenticatedUserId && member.role === 'child')
  const isParentDashboard = resolvedDashboardRole === 'parent' || currentUserRole === 'parent'

  async function resolveAuthenticatedMembershipRole(): Promise<'parent' | 'child' | null> {
    const supabase = getSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setAuthenticatedUserId(null)
      return null
    }

    setAuthenticatedUserId(user.id)

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

  async function completeParentOnboardingIfNeeded() {
    if (onboardingInFlightRef.current) {
      return
    }

    const supabase = getSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return
    }

    const { data: memberships, error: membershipsError } = await supabase
      .from('family_members')
      .select('id')
      .eq('user_id', user.id)

    if (membershipsError) {
      return
    }

    if (memberships && memberships.length > 0) {
      return
    }

    const fullName = user.user_metadata?.onboarding_full_name?.toString().trim()
    const familyNameValue = user.user_metadata?.onboarding_family_name?.toString().trim()

    if (!fullName || !familyNameValue) {
      return
    }

    onboardingInFlightRef.current = true

    try {
      const { error } = await supabase.rpc('onboard_parent_family', {
        p_full_name: fullName,
        p_family_name: familyNameValue,
      })

      if (error && !String(error.message).toLowerCase().includes('already belongs to a family')) {
        setAuthError(error.message)
      }
    } finally {
      onboardingInFlightRef.current = false
    }
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
        setAuthenticatedUserId(null)
        setIsCheckingSession(false)
        return
      }

      const nextRole = await resolveAuthenticatedMembershipRole()
      setResolvedDashboardRole(nextRole)
      await completeParentOnboardingIfNeeded()
      setIsCheckingSession(false)
    }

    void syncSessionStatus()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(Boolean(session))
      if (!session) {
        setResolvedDashboardRole(null)
        setAuthenticatedUserId(null)
        setIsCheckingSession(false)
        onboardingInFlightRef.current = false
        return
      }

      void (async () => {
        const nextRole = await resolveAuthenticatedMembershipRole()
        setResolvedDashboardRole(nextRole)
        await completeParentOnboardingIfNeeded()
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

  const handleChildLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const familyCode = childLoginFamilyCode.trim().toUpperCase()
    const username = childLoginUsername.trim()

    if (!familyCode || familyCode.length !== 6 || !username || !PIN_PATTERN.test(childLoginPin)) {
      setChildLoginError('יש למלא קוד משפחה, שם משתמש וקוד PIN בן 6 ספרות')
      setChildLoginPin('')
      return
    }

    setIsChildLoginSubmitting(true)
    setChildLoginError('')
    setIsResolvingRole(true)

    const supabase = getSupabaseClient()

    try {
      const { data, error } = await supabase.functions.invoke('child-login', {
        body: {
          familyCode,
          childUsername: username,
          pin: childLoginPin,
        },
      })

      // PIN is never kept around after the attempt, success or failure.
      setChildLoginPin('')

      if (error || data?.error || !data?.access_token || !data?.refresh_token) {
        setChildLoginError('קוד המשפחה, שם המשתמש או קוד ה-PIN שגויים')
        setIsChildLoginSubmitting(false)
        setIsResolvingRole(false)
        return
      }

      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      })

      if (setSessionError) {
        setChildLoginError('קוד המשפחה, שם המשתמש או קוד ה-PIN שגויים')
        setIsChildLoginSubmitting(false)
        setIsResolvingRole(false)
        return
      }

      // The existing onAuthStateChange listener resolves the role and
      // routes to the exact authenticated child's ChildDashboard -- no
      // parallel session/routing system is introduced here.
      setIsAuthenticated(true)
      setIsChildLoginSubmitting(false)
    } catch {
      setChildLoginPin('')
      setChildLoginError('קוד המשפחה, שם המשתמש או קוד ה-PIN שגויים')
      setIsChildLoginSubmitting(false)
      setIsResolvingRole(false)
    }
  }

  const handleSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const fullName = signupFullName.trim()
    const familyNameValue = signupFamilyName.trim()
    const normalizedEmail = signupEmail.trim()

    if (!fullName || !familyNameValue || !normalizedEmail || !signupPassword.trim()) {
      setAuthError('יש למלא את כל השדות')
      return
    }

    if (signupPassword.length < 8) {
      setAuthError('הסיסמה חייבת להכיל לפחות 8 תווים')
      return
    }

    if (signupPassword !== signupConfirmPassword) {
      setAuthError('הסיסמאות אינן תואמות')
      return
    }

    setIsSubmitting(true)
    setAuthError('')

    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: signupPassword,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          onboarding_full_name: fullName,
          onboarding_family_name: familyNameValue,
        },
      },
    })

    if (error) {
      setAuthError(error.message)
      setIsSubmitting(false)
      return
    }

    if (data.session) {
      await completeParentOnboardingIfNeeded()
      setIsAuthenticated(true)
      setIsSubmitting(false)
      setAuthView('landing')
      return
    }

    setPendingConfirmationEmail(normalizedEmail)
    setAuthView('pending-confirmation')
    setIsSubmitting(false)
  }

  const handleResendVerification = async () => {
    if (!pendingConfirmationEmail) {
      return
    }

    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: pendingConfirmationEmail,
    })

    if (error) {
      setAuthError(error.message)
      return
    }

    setAuthError('הודעת האימות נשלחה שוב. בדקו את תיבת הדואר הנכנס.')
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
    setAuthenticatedUserId(null)
    setAuthError('')
    setPendingConfirmationEmail('')
    setAuthView('landing')
    setPassword('')
    setSignupFullName('')
    setSignupFamilyName('')
    setSignupEmail('')
    setSignupPassword('')
    setSignupConfirmPassword('')
  }

  const isAwaitingRealFamilyData =
    isAuthenticated && (!authReady || !resolvedDashboardRole || !familyName || !currentUserName)
  const shouldShowRoleLoading =
    isCheckingSession || !authReady || isResolvingRole || isAwaitingRealFamilyData || (isAuthenticated && resolvedDashboardRole === null && !authError)

  if (shouldShowRoleLoading) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-4 py-10 text-slate-700">
        <div className="panel-card px-6 py-5 text-sm font-medium">
          טוען את המשפחה...
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
                    <span className="auth-choice__label">התחברות הורה</span>
                    <span className="auth-choice__meta">כניסה לחשבון</span>
                  </div>
                </button>
                <button type="button" onClick={() => setAuthView('child-login')} className="auth-choice auth-choice--parent">
                  <span className="auth-choice__icon">🧒</span>
                  <div>
                    <span className="auth-choice__label">התחברות ילד</span>
                    <span className="auth-choice__meta">קוד משפחה + שם משתמש + PIN</span>
                  </div>
                </button>
                <button type="button" onClick={() => setAuthView('signup')} className="auth-choice auth-choice--gold">
                  <span className="auth-choice__icon">✨</span>
                  <div>
                    <span className="auth-choice__label">יצירת משפחה</span>
                    <span className="auth-choice__meta">פתיחת חשבון חדש</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    if (authView === 'signup') {
      return (
        <div dir="rtl" className="auth-shell min-h-screen px-4 py-8 sm:px-6">
          <div className="mx-auto max-w-lg">
            <button type="button" onClick={() => setAuthView('landing')} className="back-link">
              ← חזרה
            </button>

            <div className="auth-card auth-card--parent">
              <div className="auth-card__brand">
                <img src={familyTasksLogo} alt="Family Tasks logo" className="auth-brand-logo" />
                <p className="brand-label">Family Tasks</p>
              </div>

              <div className="auth-card__header">
                <h2>יצירת משפחה חדשה</h2>
                <p>צרו את המשפחה שלכם וצרו חשבון הורה</p>
              </div>

              <form className="auth-form" onSubmit={handleSignup}>
                <div className="field-group">
                  <label htmlFor="signup-full-name">שם פרטי</label>
                  <input
                    id="signup-full-name"
                    type="text"
                    value={signupFullName}
                    onChange={(event) => setSignupFullName(event.target.value)}
                    className="auth-input"
                    placeholder="שם ההורה"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="signup-family-name">שם המשפחה</label>
                  <input
                    id="signup-family-name"
                    type="text"
                    value={signupFamilyName}
                    onChange={(event) => setSignupFamilyName(event.target.value)}
                    className="auth-input"
                    placeholder="שם המשפחה החדשה"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="signup-email">אימייל</label>
                  <input
                    id="signup-email"
                    type="email"
                    value={signupEmail}
                    onChange={(event) => setSignupEmail(event.target.value)}
                    className="auth-input"
                    placeholder="name@example.com"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="signup-password">סיסמה</label>
                  <input
                    id="signup-password"
                    type="password"
                    value={signupPassword}
                    onChange={(event) => setSignupPassword(event.target.value)}
                    className="auth-input"
                    placeholder="לפחות 8 תווים"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="signup-confirm-password">אישור סיסמה</label>
                  <input
                    id="signup-confirm-password"
                    type="password"
                    value={signupConfirmPassword}
                    onChange={(event) => setSignupConfirmPassword(event.target.value)}
                    className="auth-input"
                    placeholder="הקלידו שוב את הסיסמה"
                  />
                </div>

                {authError && <div className="auth-alert auth-alert--error">{authError}</div>}

                <button
                  type="submit"
                  disabled={isSubmitting || !supabaseConfig.isConfigured}
                  className="auth-submit auth-submit--parent"
                >
                  {isSubmitting ? 'יוצר משפחה...' : 'צור משפחה'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )
    }

    if (authView === 'child-login') {
      return (
        <div dir="rtl" className="auth-shell min-h-screen px-4 py-8 sm:px-6">
          <div className="mx-auto max-w-lg">
            <button type="button" onClick={() => setAuthView('landing')} className="back-link">
              ← חזרה
            </button>

            <div className="auth-card auth-card--parent">
              <div className="auth-card__brand">
                <img src={familyTasksLogo} alt="Family Tasks logo" className="auth-brand-logo" />
                <p className="brand-label">Family Tasks</p>
              </div>

              <div className="auth-card__header">
                <h2>התחברות ילד</h2>
                <p>הזינו קוד משפחה, שם משתמש וקוד PIN</p>
              </div>

              <form className="auth-form" onSubmit={handleChildLogin}>
                <div className="field-group">
                  <label htmlFor="child-login-family-code">קוד משפחה</label>
                  <input
                    id="child-login-family-code"
                    type="text"
                    value={childLoginFamilyCode}
                    onChange={(event) => setChildLoginFamilyCode(event.target.value.toUpperCase().slice(0, 6))}
                    maxLength={6}
                    className="auth-input"
                    placeholder="ABC234"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="child-login-username">שם משתמש</label>
                  <input
                    id="child-login-username"
                    type="text"
                    value={childLoginUsername}
                    onChange={(event) => setChildLoginUsername(event.target.value.slice(0, 30))}
                    maxLength={30}
                    className="auth-input"
                    placeholder="שם המשתמש שלך"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="child-login-pin">PIN</label>
                  <input
                    id="child-login-pin"
                    type="password"
                    inputMode="numeric"
                    value={childLoginPin}
                    onChange={(event) => setChildLoginPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6}
                    className="auth-input"
                    placeholder="6 ספרות"
                  />
                </div>

                {childLoginError && <div className="auth-alert auth-alert--error">{childLoginError}</div>}

                <button
                  type="submit"
                  disabled={isChildLoginSubmitting || !supabaseConfig.isConfigured}
                  className="auth-submit auth-submit--parent"
                >
                  {isChildLoginSubmitting ? 'מתחבר...' : 'התחברות'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )
    }

    if (authView === 'pending-confirmation') {
      return (
        <div dir="rtl" className="auth-shell min-h-screen px-4 py-8 sm:px-6">
          <div className="mx-auto max-w-lg">
            <button type="button" onClick={() => setAuthView('landing')} className="back-link">
              ← חזרה
            </button>

            <div className="auth-card auth-card--parent">
              <div className="auth-card__brand">
                <img src={familyTasksLogo} alt="Family Tasks logo" className="auth-brand-logo" />
                <p className="brand-label">Family Tasks</p>
              </div>

              <div className="auth-card__header">
                <h2>כמעט סיימנו</h2>
                <p>שלחנו קישור אישור לכתובת: {pendingConfirmationEmail}</p>
              </div>

              <div className="auth-alert auth-alert--warning">
                כדי להשלים את יצירת המשפחה, יש לאשר את כתובת האימייל שלכם.
              </div>

              {authError && <div className="auth-alert auth-alert--error">{authError}</div>}

              <button type="button" onClick={handleResendVerification} className="auth-submit auth-submit--parent">
                שלח קישור שוב
              </button>
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

  if (!isParentDashboard && !child) {
    console.error(
      '[App] Authenticated user resolved as role=child via family_members, but no matching FamilyMember record was found for userId=',
      authenticatedUserId,
    )

    return (
      <div dir="rtl" className="auth-shell min-h-screen px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-lg">
          <div className="auth-card auth-card--parent">
            <div className="auth-card__brand">
              <img src={familyTasksLogo} alt="Family Tasks logo" className="auth-brand-logo" />
              <p className="brand-label">Family Tasks</p>
            </div>

            <div className="auth-card__header">
              <h2>לא ניתן לטעון את פרופיל הילד/ה</h2>
            </div>

            <div className="auth-alert auth-alert--warning">
              אירעה שגיאה בטעינת נתוני המשתמש. נסו להתחבר מחדש או פנו לתמיכה.
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
            <PushNotificationControl />
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
              familyCode={familyCode}
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
              onArchiveReward={archiveReward}
              onReviewRewardRedemption={reviewRewardRedemption}
              onChildCreated={refreshFamilyData}
            />
          ) : (
            child && (
              <ChildDashboard
                child={child}
                currentUserName={currentUserName}
                tasks={tasks.filter((task) => task.memberId === child.id)}
                onSubmitTaskCompletion={submitTaskCompletion}
                rewards={rewards}
                rewardRedemptions={rewardRedemptions}
                onRequestReward={requestReward}
              />
            )
          )}
        </main>
      </div>
    </div>
  )
}

export default App
