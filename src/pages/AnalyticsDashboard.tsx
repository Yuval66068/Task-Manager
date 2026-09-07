import { useAdminAnalytics } from '../hooks/useAdminAnalytics'
import type { AdminFamilyActivity } from '../hooks/useAdminAnalytics'

function formatDateTime(value: string | null) {
  if (!value) {
    return 'אין נתונים'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() === 0) {
    return 'אין נתונים'
  }

  return parsed.toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return 'אין נתונים'
  }

  return parsed.toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatClock(value: Date | null) {
  if (!value) {
    return '--:--'
  }

  return value.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

function KpiCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className={`rounded-2xl p-3 ring-1 ring-slate-200 ${accent}`}>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
    </div>
  )
}

function FunnelStep({ label, value, isLast }: { label: string; value: number; isLast?: boolean }) {
  return (
    <div className="flex flex-1 items-center gap-2">
      <div className="flex-1 rounded-2xl bg-slate-50 p-3 text-center ring-1 ring-slate-200">
        <p className="text-xs font-semibold text-slate-600">{label}</p>
        <p className="mt-1 text-xl font-black text-slate-900">{value}</p>
      </div>
      {!isLast && <span className="text-slate-400">←</span>}
    </div>
  )
}

function FamilyRow({ family }: { family: AdminFamilyActivity }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold text-slate-800">{family.familyName || 'ללא שם'}</p>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {formatDate(family.createdAt)}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs text-slate-600">
        <div>
          <p className="font-bold text-slate-800">{family.childCount}</p>
          <p>ילדים</p>
        </div>
        <div>
          <p className="font-bold text-slate-800">{family.taskCount}</p>
          <p>משימות</p>
        </div>
        <div>
          <p className="font-bold text-slate-800">{family.completionCount}</p>
          <p>הושלמו</p>
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        פעילות אחרונה: {formatDateTime(family.lastActivityAt)}
      </p>
    </div>
  )
}

export function AnalyticsDashboard() {
  const { isLoading, isAuthorized, summary, families, lastUpdatedAt, refresh } = useAdminAnalytics()

  if (isLoading) {
    return (
      <div dir="rtl" className="app-shell flex min-h-screen items-center justify-center px-4 py-10 text-slate-700">
        <div className="panel-card px-6 py-5 text-sm font-medium">טוען נתוני Analytics...</div>
      </div>
    )
  }

  if (!isAuthorized) {
    return (
      <div dir="rtl" className="app-shell flex min-h-screen items-center justify-center px-4 py-10 text-slate-700">
        <div className="panel-card px-6 py-5 text-sm font-medium">אין לך הרשאה לצפות בנתוני Analytics</div>
      </div>
    )
  }

  return (
    <div dir="rtl" className="app-shell min-h-screen text-slate-800">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <header className="mb-6 flex items-center justify-between gap-3 rounded-[1.5rem] border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
          <div>
            <p className="text-xs font-semibold tracking-[0.08em] text-indigo-600">Family Tasks Analytics</p>
            <h1 className="mt-1 text-xl font-black text-slate-900">לוח בקרה פרטי</h1>
            <p className="mt-1 text-xs text-slate-500">עודכן לאחרונה: {formatClock(lastUpdatedAt)}</p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="secondary-button px-3 py-1.5 text-sm"
          >
            רענון
          </button>
        </header>

        {summary && (
          <div className="space-y-6">
            <section className="panel-card p-5">
              <h2 className="text-sm font-bold text-slate-900">משפחות חיצוניות</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiCard label="משפחות חיצוניות" value={summary.totalExternalFamilies} accent="bg-indigo-50" />
                <KpiCard label="פעילות היום" value={summary.activeFamiliesToday} accent="bg-emerald-50" />
                <KpiCard label="פעילות 7 ימים" value={summary.activeFamilies7d} accent="bg-sky-50" />
                <KpiCard label="פעילות 30 ימים" value={summary.activeFamilies30d} accent="bg-amber-50" />
              </div>
            </section>

            <section className="panel-card p-5">
              <h2 className="text-sm font-bold text-slate-900">משפחות חדשות</h2>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <KpiCard label="היום" value={summary.newFamiliesToday} accent="bg-violet-50" />
                <KpiCard label="7 ימים" value={summary.newFamilies7d} accent="bg-violet-50" />
                <KpiCard label="30 ימים" value={summary.newFamilies30d} accent="bg-violet-50" />
              </div>
            </section>

            <section className="panel-card p-5">
              <h2 className="text-sm font-bold text-slate-900">משפך הפעלה</h2>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <FunnelStep label="נרשמו" value={summary.totalExternalFamilies} />
                <FunnelStep label="הוסיפו ילד" value={summary.familiesWithChild} />
                <FunnelStep label="יצרו משימה" value={summary.familiesWithTask} />
                <FunnelStep label="השלימו משימה" value={summary.familiesWithCompletion} isLast />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-center text-xs text-slate-600">
                <div>{summary.pctAddedChild}% הוסיפו ילד</div>
                <div>{summary.pctCreatedTask}% יצרו משימה</div>
                <div>{summary.pctCompletedTask}% השלימו משימה</div>
              </div>
            </section>

            <section className="panel-card p-5">
              <h2 className="text-sm font-bold text-slate-900">שימוש</h2>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <p className="text-xs font-semibold text-slate-600">פתיחות אפליקציה</p>
                  <p className="mt-1 text-sm text-slate-700">
                    היום: {summary.openedAppToday} · 7 ימים: {summary.openedApp7d} · 30 ימים: {summary.openedApp30d}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <p className="text-xs font-semibold text-slate-600">כניסות</p>
                  <p className="mt-1 text-sm text-slate-700">
                    היום: {summary.loggedInToday} · 7 ימים: {summary.loggedIn7d} · 30 ימים: {summary.loggedIn30d}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <p className="text-xs font-semibold text-slate-600">השלמות משימות</p>
                  <p className="mt-1 text-sm text-slate-700">
                    היום: {summary.taskCompletionsToday} · 7 ימים: {summary.taskCompletions7d} · 30 ימים:{' '}
                    {summary.taskCompletions30d}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <p className="text-xs font-semibold text-slate-600">מימושי פרסים</p>
                  <p className="mt-1 text-sm text-slate-700">{summary.familiesWithRewardRedemption} משפחות מימשו פרס</p>
                </div>
              </div>
            </section>
          </div>
        )}

        <section className="panel-card mt-6 p-5">
          <h2 className="text-sm font-bold text-slate-900">פעילות משפחות</h2>
          <div className="mt-3 space-y-3">
            {families.length === 0 ? (
              <p className="text-sm text-slate-500">אין עדיין נתוני פעילות.</p>
            ) : (
              families.map((family) => <FamilyRow key={family.familyId} family={family} />)
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
