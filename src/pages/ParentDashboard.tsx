import { useMemo, useState, type FormEvent } from 'react'
import { StatCard } from '../components/StatCard'
import { AddChildForm } from '../components/AddChildForm'
import { getSupabaseClient } from '../services/supabase'
import { getTaskStatusLabel } from '../utils/taskStatusLabels'
import type {
  FamilyMember,
  RewardDraft,
  RewardItem,
  RewardRedemptionRecord,
  TaskCompletionStatus,
  TaskDraft,
  TaskItem,
  TaskPriority,
  TaskRecurrence,
} from '../types'

type ParentDashboardProps = {
  familyName: string
  familyCode: string | null
  familyOnboardingCompletedAt: string | null
  currentUserName: string
  stats: {
    pendingApproval: number
    completedToday: number
    overdue: number
    totalXp: number
  }
  members: FamilyMember[]
  tasks: TaskItem[]
  rewards: RewardItem[]
  rewardRedemptions: RewardRedemptionRecord[]
  onAddTask: (draft: TaskDraft) => void
  onEditTask: (taskId: string, draft: TaskDraft) => void
  onDeleteTask: (taskId: string) => void
  onReviewTaskCompletion: (taskId: string, status: 'approved' | 'rejected', feedback?: string) => void
  onAddReward: (draft: RewardDraft) => void
  onArchiveReward: (rewardId: string) => void | Promise<void>
  onReviewRewardRedemption: (redemptionId: string, status: 'approved' | 'rejected') => void
  onChildCreated: () => void | Promise<void>
}

export function ParentDashboard({
  familyName,
  familyCode,
  familyOnboardingCompletedAt,
  currentUserName,
  stats,
  members,
  tasks,
  rewards,
  rewardRedemptions,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onReviewTaskCompletion,
  onAddReward,
  onArchiveReward,
  onReviewRewardRedemption,
  onChildCreated,
}: ParentDashboardProps) {
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState('✅')
  const [xp, setXp] = useState(10)
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [recurrence, setRecurrence] = useState<TaskRecurrence>('none')
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([])
  const [requiresPhoto, setRequiresPhoto] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editEmoji, setEditEmoji] = useState('✅')
  const [editXp, setEditXp] = useState(10)
  const [editAssignedTo, setEditAssignedTo] = useState('')
  const [editDueDate, setEditDueDate] = useState('')
  const [editDueTime, setEditDueTime] = useState('')
  const [editPriority, setEditPriority] = useState<TaskPriority>('medium')
  const [editRecurrence, setEditRecurrence] = useState<TaskRecurrence>('none')
  const [editSelectedWeekdays, setEditSelectedWeekdays] = useState<number[]>([])
  const [editRequiresPhoto, setEditRequiresPhoto] = useState(false)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [rewardTitle, setRewardTitle] = useState('')
  const [rewardDescription, setRewardDescription] = useState('')
  const [rewardXpCost, setRewardXpCost] = useState(20)
  const [rewardActionError, setRewardActionError] = useState('')
  const [archivingRewardId, setArchivingRewardId] = useState<string | null>(null)
  const [familyCodeCopied, setFamilyCodeCopied] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [isInviting, setIsInviting] = useState(false)
  const childMembers = members.filter((member) => member.role === 'child')
  const [selectedOnboardingChildId, setSelectedOnboardingChildId] = useState(childMembers[0]?.id ?? '')
  const [onboardingSuggestionMode, setOnboardingSuggestionMode] = useState(false)
  const [onboardingSuccess, setOnboardingSuccess] = useState(false)
  const [resetPinTargetId, setResetPinTargetId] = useState(childMembers[0]?.id ?? '')
  const isOnboardingVisible = familyOnboardingCompletedAt === null && !onboardingSuccess
  const selectedOnboardingChildIdForFlow = childMembers.length === 1 ? childMembers[0].id : selectedOnboardingChildId || childMembers[0]?.id || ''
  const [resetPinNew, setResetPinNew] = useState('')
  const [resetPinConfirm, setResetPinConfirm] = useState('')
  const [resetPinError, setResetPinError] = useState('')
  const [resetPinSuccess, setResetPinSuccess] = useState('')
  const [isResettingPin, setIsResettingPin] = useState(false)

  const handleCopyFamilyCode = async () => {
    if (!familyCode) {
      return
    }

    try {
      await navigator.clipboard.writeText(familyCode)
      setFamilyCodeCopied(true)
      setTimeout(() => setFamilyCodeCopied(false), 2000)
    } catch {
      // Clipboard access can fail (permissions/unsupported browser) --
      // fail silently rather than crash; the code is still visible on screen.
    }
  }

  const [showApprovedTaskHistory, setShowApprovedTaskHistory] = useState(false)

  const activeTasks = useMemo(() => tasks.filter((task) => task.status !== 'approved'), [tasks])
  const approvedTaskHistory = useMemo(() => tasks.filter((task) => task.status === 'approved'), [tasks])
  const rewardRequests = useMemo(() => rewardRedemptions.filter((redemption) => redemption.status === 'pending'), [rewardRedemptions])
  const rewardHistory = useMemo(
    () => rewardRedemptions.filter((redemption) => redemption.status !== 'pending'),
    [rewardRedemptions],
  )

  const formatDueDateTime = (dueAt: string | null) => {
    if (!dueAt) {
      return null
    }

    const dueDateTime = new Date(dueAt)
    if (Number.isNaN(dueDateTime.getTime())) {
      return null
    }

    const date = dueDateTime.toLocaleDateString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    const time = dueDateTime.toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    })

    return `${date} · ${time}`
  }

  const formatPriority = (value: TaskPriority) => {
    switch (value) {
      case 'low':
        return 'נמוכה'
      case 'high':
        return 'גבוהה'
      case 'medium':
      default:
        return 'בינונית'
    }
  }

  const formatRecurrence = (value: TaskRecurrence) => {
    switch (value) {
      case 'daily':
        return 'יומית'
      case 'weekly':
        return 'שבועית'
      case 'monthly':
        return 'חודשית'
      case 'none':
      default:
        return 'ללא'
    }
  }

  const weekdayNames = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']

  const toggleWeekday = (day: number, current: number[], setCurrent: (next: number[]) => void) => {
    const next = current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort((left, right) => left - right)
    setCurrent(next)
  }

  const formatWeekdayList = (days: number[] | null | undefined) => {
    if (!days || days.length === 0) {
      return ''
    }

    return [...new Set(days)]
      .sort((left, right) => left - right)
      .map((day) => weekdayNames[day] ?? '')
      .filter(Boolean)
      .join(', ')
  }

  const formatCompletionStatus = (value: TaskCompletionStatus | null) => {
    switch (value) {
      case 'submitted':
        return 'ממתין לאישור'
      case 'approved':
        return 'אושר'
      case 'rejected':
        return 'נדחה'
      case 'pending':
      default:
        return 'לא נשלח'
    }
  }

  const formatRewardStatus = (value: RewardRedemptionRecord['status']) => {
    switch (value) {
      case 'approved':
        return 'אושר'
      case 'rejected':
        return 'נדחה'
      case 'pending':
      default:
        return 'ממתין'
    }
  }

  const openTaskFormForOnboarding = (preFilledTitle = '') => {
    const targetChildId = selectedOnboardingChildIdForFlow
    if (!targetChildId) {
      return
    }

    setAssignedTo(targetChildId)
    setTitle(preFilledTitle)
    setDueDate('')
    setDueTime('')
    setPriority('medium')
    setRecurrence('none')
    setSelectedWeekdays([])
    setRequiresPhoto(false)
    setOnboardingSuggestionMode(true)
    setOnboardingSuccess(false)

    window.setTimeout(() => {
      const taskForm = document.getElementById('task-form-panel')
      taskForm?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const firstTaskField = taskForm?.querySelector('input, select, textarea') as HTMLElement | null
      firstTaskField?.focus()
    }, 50)
  }

  const handleInviteSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedEmail = inviteEmail.trim().toLowerCase()

    if (!trimmedEmail) {
      setInviteError('יש להזין כתובת אימייל')
      setInviteSuccess('')
      return
    }

    setIsInviting(true)
    setInviteError('')
    setInviteSuccess('')

    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.functions.invoke('family-invite', {
        body: {
          email: trimmedEmail,
        },
      })

      if (error || data?.error) {
        setInviteError(typeof data?.error === 'string' ? data.error : 'לא ניתן היה לשלוח את ההזמנה')
        setIsInviting(false)
        return
      }

      setInviteSuccess('ההזמנה נשלחה בהצלחה')
      setInviteEmail('')
      setIsInviting(false)
    } catch {
      setInviteError('לא ניתן היה לשלוח את ההזמנה. נסו שוב.')
      setIsInviting(false)
    }
  }

  const handleResetChildPin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const targetChildId = resetPinTargetId || childMembers[0]?.id || ''

    if (!targetChildId) {
      setResetPinError('אין ילדים זמינים לאיפוס PIN')
      setResetPinSuccess('')
      return
    }

    if (!/^\d{6}$/.test(resetPinNew)) {
      setResetPinError('יש להזין PIN חדש בן 6 ספרות')
      setResetPinSuccess('')
      return
    }

    if (resetPinNew !== resetPinConfirm) {
      setResetPinError('קודי ה-PIN אינם תואמים')
      setResetPinSuccess('')
      return
    }

    setIsResettingPin(true)
    setResetPinError('')
    setResetPinSuccess('')

    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.functions.invoke('reset-child-pin', {
        body: {
          childUserId: targetChildId,
          newPin: resetPinNew,
        },
      })

      if (error || data?.error) {
        setResetPinError(typeof data?.error === 'string' ? data.error : 'לא ניתן היה לאפס את ה-PIN')
        setIsResettingPin(false)
        return
      }

      setResetPinNew('')
      setResetPinConfirm('')
      setResetPinSuccess('ה-PIN עודכן בהצלחה')
      setIsResettingPin(false)
    } catch {
      setResetPinError('לא ניתן היה לאפס את ה-PIN. נסו שוב.')
      setIsResettingPin(false)
    }
  }

  const handleRewardSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!rewardTitle.trim()) {
      return
    }

    onAddReward({
      title: rewardTitle,
      description: rewardDescription,
      xpCost: rewardXpCost,
    })

    setRewardTitle('')
    setRewardDescription('')
    setRewardXpCost(20)
  }

  const handleArchiveReward = async (rewardId: string) => {
    const confirmed = window.confirm('להסיר את הפרס? הוא לא יוצג יותר לילדים.')
    if (!confirmed) {
      return
    }

    setRewardActionError('')
    setArchivingRewardId(rewardId)

    try {
      await onArchiveReward(rewardId)
    } catch (error) {
      setRewardActionError(error instanceof Error ? error.message : 'לא הצלחנו להסיר את הפרס. נסה שוב.')
    } finally {
      setArchivingRewardId(null)
    }
  }

  const handleRewardDecision = async (redemptionId: string, decision: 'approved' | 'rejected') => {
    try {
      setRewardActionError('')
      await onReviewRewardRedemption(redemptionId, decision)
    } catch (error) {
      setRewardActionError(error instanceof Error ? error.message : 'Could not review reward redemption.')
    }
  }

  const buildDueAt = (dateValue: string, timeValue: string) => {
    if (!dateValue) {
      return null
    }

    const base = new Date(`${dateValue}T${timeValue || '00:00'}:00`)
    if (Number.isNaN(base.getTime())) {
      return null
    }

    return base.toISOString()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!title.trim()) {
      return
    }

    const selectedChildId = assignedTo || childMembers[0]?.id || ''
    if (!selectedChildId) {
      return
    }

    if (recurrence === 'weekly' && selectedWeekdays.length === 0) {
      setSelectedWeekdays([])
    }

    onAddTask({
      title,
      emoji,
      xp,
      assignedTo: selectedChildId,
      dueAt: buildDueAt(dueDate, dueTime),
      priority,
      recurrence,
      recurrenceDays: recurrence === 'weekly' ? selectedWeekdays : undefined,
      requiresPhoto,
    })

    if (onboardingSuggestionMode) {
      setOnboardingSuccess(true)
      setOnboardingSuggestionMode(false)
    }

    setTitle('')
    setEmoji('✅')
    setXp(10)
    setAssignedTo(childMembers[0]?.id ?? '')
    setDueDate('')
    setDueTime('')
    setPriority('medium')
    setRecurrence('none')
    setSelectedWeekdays([])
    setRequiresPhoto(false)
  }

  const startEditing = (task: TaskItem) => {
    setEditingTaskId(task.id)
    setEditTitle(task.title)
    setEditEmoji(task.emoji)
    setEditXp(task.xp)
    setEditAssignedTo(task.memberId)
    setEditPriority(task.priority)
    setEditRecurrence(task.recurrence)
    setEditSelectedWeekdays(task.recurrenceDays ?? [])
    setEditRequiresPhoto(task.requiresPhoto)

    if (task.dueAt) {
      const dueDateTime = new Date(task.dueAt)
      if (!Number.isNaN(dueDateTime.getTime())) {
        setEditDueDate(dueDateTime.toISOString().slice(0, 10))
        setEditDueTime(dueDateTime.toISOString().slice(11, 16))
      } else {
        setEditDueDate('')
        setEditDueTime('')
      }
    } else {
      setEditDueDate('')
      setEditDueTime('')
    }
  }

  const saveEdit = () => {
    if (!editingTaskId) {
      return
    }

    const selectedChildId = editAssignedTo || childMembers[0]?.id || ''
    if (!selectedChildId) {
      return
    }

    onEditTask(editingTaskId, {
      title: editTitle,
      emoji: editEmoji,
      xp: editXp,
      assignedTo: selectedChildId,
      dueAt: buildDueAt(editDueDate, editDueTime),
      priority: editPriority,
      recurrence: editRecurrence,
      recurrenceDays: editRecurrence === 'weekly' ? editSelectedWeekdays : undefined,
      requiresPhoto: editRequiresPhoto,
    })

    setEditingTaskId(null)
    setEditTitle('')
    setEditEmoji('✅')
    setEditXp(10)
    setEditAssignedTo(childMembers[0]?.id ?? '')
    setEditDueDate('')
    setEditDueTime('')
    setEditPriority('medium')
    setEditRecurrence('none')
    setEditRequiresPhoto(false)
  }

  return (
    <section className="dashboard-stack family-dashboard parent-dashboard">
      <div className="family-hero-card">
        <div className="family-hero-card__glow" aria-hidden="true" />
        <div className="family-hero-card__top">
          <div>
            <p className="family-hero-card__eyebrow">לוח הורה</p>
            <h2 className="family-hero-card__title">שלום, {currentUserName || 'הורה'}! 👋</h2>
            <p className="family-hero-card__subtitle">{familyName}</p>
            {familyCode && (
              <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                <span>
                  קוד המשפחה: <strong className="tracking-widest">{familyCode}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyFamilyCode()}
                  className="rounded-full border border-slate-300 px-2.5 py-0.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  {familyCodeCopied ? 'הועתק ✓' : 'העתק'}
                </button>
              </div>
            )}
          </div>
          <div className="family-hero-card__chip">Family Tasks</div>
        </div>

        <div className="family-hero-card__stats">
          <div className="family-hero-card__metric family-hero-card__metric--primary">
            <span>משימות ממתינות לאישור</span>
            <strong>{stats.pendingApproval}</strong>
          </div>
          <div className="family-hero-card__metric family-hero-card__metric--secondary">
            <span>XP משפחתי</span>
            <strong>{stats.totalXp.toLocaleString('he-IL')}</strong>
          </div>
        </div>
      </div>

      <div className="summary-grid">
        <StatCard
          label="משימות ממתינות לאישור"
          value={String(stats.pendingApproval)}
          accent="bg-amber-100 text-amber-700"
        />
        <StatCard
          label="משימות שהושלמו"
          value={String(stats.completedToday)}
          accent="bg-emerald-100 text-emerald-700"
        />
        <StatCard label="משימות באיחור" value={String(stats.overdue)} accent="bg-rose-100 text-rose-700" />
        <StatCard label="XP" value={stats.totalXp.toLocaleString('he-IL')} accent="bg-violet-100 text-violet-700" />
      </div>

      {isOnboardingVisible && (
        <section className="panel-card p-5">
          <div className="space-y-4">
            <h3 className="text-lg font-black text-slate-900">
              👋 ברוכים הבאים ל-Family Tasks!
              <br />
              בואו נגדיר את המשימה הראשונה של המשפחה.
            </h3>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-700">👦 למי נרצה להוסיף משימה?</p>

              {childMembers.length === 0 ? (
                <AddChildForm
                  onChildCreated={async () => {
                    await onChildCreated()
                    setSelectedOnboardingChildId(childMembers[0]?.id ?? '')
                  }}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {childMembers.map((member) => {
                    const isSelected = selectedOnboardingChildIdForFlow === member.id
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => {
                          setSelectedOnboardingChildId(member.id)
                        }}
                        className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300'
                        }`}
                      >
                        {member.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {(childMembers.length > 0 && selectedOnboardingChildIdForFlow) && (
              <div className="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                <p className="text-sm font-semibold text-indigo-800">מעולה! עכשיו בואו נוסיף משימה.</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    '🧹 סידור חדר',
                    '🍽️ פינוי מדיח',
                    '🛏️ סידור מיטה',
                    '🧸 סידור צעצועים',
                    '🗑️ הורדת זבל',
                    '📚 הכנת תיק',
                    '➕ משימה אחרת',
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        if (suggestion === '➕ משימה אחרת') {
                          openTaskFormForOnboarding('')
                          return
                        }

                        openTaskFormForOnboarding(suggestion.replace(/^\S+\s/, '').trim())
                      }}
                      className="rounded-full border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {onboardingSuccess && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          🎉 מעולה!
          <br />
          המשימה הראשונה של המשפחה נוצרה.
        </div>
      )}

      {!isOnboardingVisible && (
        <div className="flex justify-end">
          <AddChildForm onChildCreated={onChildCreated} />
        </div>
      )}

      <section className="panel-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">הזמנה להורה נוסף</h3>
          <span className="metric-pill bg-sky-100 text-sky-700">שיתוף משפחתי</span>
        </div>

        <form onSubmit={handleInviteSubmit} className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            אימייל הורה
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="parent@example.com"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
            />
          </label>

          <button
            type="submit"
            disabled={isInviting}
            className="self-end rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isInviting ? 'שולח...' : 'שלח הזמנה'}
          </button>
        </form>

        {inviteError && (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {inviteError}
          </div>
        )}

        {inviteSuccess && (
          <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {inviteSuccess}
          </div>
        )}
      </section>

      {childMembers.length > 0 && (
        <section className="panel-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-slate-900">איפוס PIN</h3>
            <span className="metric-pill bg-amber-100 text-amber-700">אבטחה</span>
          </div>

          <form onSubmit={handleResetChildPin} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
            <label className="flex flex-col gap-1 text-sm text-slate-600">
              ילד
              <select
                value={resetPinTargetId || childMembers[0]?.id || ''}
                onChange={(event) => setResetPinTargetId(event.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
              >
                {childMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm text-slate-600">
              PIN חדש
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={resetPinNew}
                onChange={(event) => setResetPinNew(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-slate-600">
              אישור PIN חדש
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={resetPinConfirm}
                onChange={(event) => setResetPinConfirm(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
              />
            </label>

            <button
              type="submit"
              disabled={isResettingPin}
              className="rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isResettingPin ? 'מעדכן...' : 'איפוס PIN'}
            </button>
          </form>

          {resetPinError && (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {resetPinError}
            </div>
          )}

          {resetPinSuccess && (
            <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {resetPinSuccess}
            </div>
          )}
        </section>
      )}

      {childMembers.length === 0 && (
        <section className="panel-card p-5">
          <h3 className="text-lg font-bold text-slate-900">אין עדיין ילדים במשפחה</h3>
          <p className="mt-2 text-sm text-slate-600">הזמינו ילד/ה או הוסיפו לילד/ה חדש/ה כדי להתחיל את לוח המשימות.</p>
        </section>
      )}

      <section className="panel-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">פרסים</h3>
          <span className="metric-pill bg-violet-100 text-violet-700">{rewards.filter((reward) => reward.isActive).length} פעילים</span>
        </div>

        {rewardActionError && (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {rewardActionError}
          </div>
        )}

        <form onSubmit={handleRewardSubmit} className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm text-slate-600 sm:col-span-1">
            שם הפרס
            <input
              value={rewardTitle}
              onChange={(event) => setRewardTitle(event.target.value)}
              placeholder="לדוגמה: בחירת סרט"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-600 sm:col-span-1">
            תיאור
            <input
              value={rewardDescription}
              onChange={(event) => setRewardDescription(event.target.value)}
              placeholder="תיאור קצר אופציונלי"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
            />
          </label>

          <div className="flex flex-col gap-1 text-sm text-slate-600 sm:col-span-1">
            <label>עלות XP</label>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                step={5}
                value={rewardXpCost}
                onChange={(event) => setRewardXpCost(Number(event.target.value || 0))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
              />
              <button
                type="submit"
                className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                + הוסף פרס
              </button>
            </div>
          </div>
        </form>

        <div className="mt-4 space-y-3">
          {rewards.filter((reward) => reward.isActive).length === 0 ? (
            <p className="text-sm text-slate-500">אין עדיין פרסים משפחתיים.</p>
          ) : (
            rewards
              .filter((reward) => reward.isActive)
              .map((reward) => (
                <div key={reward.id} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900">{reward.title}</p>
                      {reward.description && <p className="mt-1 text-xs text-slate-500">{reward.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">
                        {reward.xpCost} XP
                      </span>
                      <button
                        type="button"
                        onClick={() => handleArchiveReward(reward.id)}
                        disabled={archivingRewardId === reward.id}
                        className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {archivingRewardId === reward.id ? 'מסיר...' : 'הסר פרס'}
                      </button>
                    </div>
                  </div>
                </div>
              ))
          )}
        </div>
      </section>

      <section className="panel-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">בקשות מימוש פרסים</h3>
          <span className="metric-pill bg-amber-100 text-amber-700">{rewardRequests.length} ממתינות</span>
        </div>

        <div className="mt-4 space-y-3">
          {rewardRequests.length === 0 ? (
            <p className="text-sm text-slate-500">אין כרגע בקשות פרסים פתוחות.</p>
          ) : (
            rewardRequests.map((request) => {
              const child = members.find((member) => member.id === request.userId)
              return (
                <div key={request.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-800">{request.rewardTitle}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {child?.name ?? 'לא ידוע'} · {request.xpCostSnapshot} XP
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                      {formatRewardStatus(request.status)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void handleRewardDecision(request.id, 'approved')
                      }}
                      className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-400"
                    >
                      אשר
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleRewardDecision(request.id, 'rejected')
                      }}
                      className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-200"
                    >
                      דחה
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      <section className="panel-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">היסטוריית מימוש</h3>
          <span className="metric-pill bg-emerald-100 text-emerald-700">{rewardHistory.length} רשומות</span>
        </div>

        <div className="mt-4 space-y-3">
          {rewardHistory.length === 0 ? (
            <p className="text-sm text-slate-500">אין עדיין היסטוריית מימוש.</p>
          ) : (
            rewardHistory.map((entry) => {
              const child = members.find((member) => member.id === entry.userId)
              return (
                <div key={entry.id} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-800">{entry.rewardTitle}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {child?.name ?? 'לא ידוע'} · {new Date(entry.requestedAt).toLocaleDateString('he-IL')}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        entry.status === 'approved'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {formatRewardStatus(entry.status)}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      <form id="task-form-panel" onSubmit={handleSubmit} className="panel-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">הוספת משימה</h3>
          <span className="metric-pill bg-sky-100 text-sky-700">לשבוע זה</span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            משימה
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="לדוגמה: סידור השולחן"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-600">
            אימוג'י
            <input
              value={emoji}
              onChange={(event) => setEmoji(event.target.value)}
              maxLength={2}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-600">
            XP
            <input
              type="number"
              min={5}
              step={5}
              value={xp}
              onChange={(event) => setXp(Number(event.target.value || 0))}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-600">
            משויך ל
            <select
              value={assignedTo || childMembers[0]?.id || ''}
              onChange={(event) => setAssignedTo(event.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
            >
              {members
                .filter((member) => member.role === 'child')
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-600">
            תאריך יעד
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-600">
            שעה
            <input
              type="time"
              value={dueTime}
              onChange={(event) => setDueTime(event.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-600">
            עדיפות
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriority)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
            >
              <option value="low">נמוכה</option>
              <option value="medium">בינונית</option>
              <option value="high">גבוהה</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-600">
            חזרה
            <select
              value={recurrence}
              onChange={(event) => setRecurrence(event.target.value as TaskRecurrence)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
            >
              <option value="none">חד-פעמית</option>
              <option value="daily">כל יום</option>
              <option value="weekly">ימים מסוימים</option>
              <option value="monthly">חודשית</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={requiresPhoto}
              onChange={(event) => setRequiresPhoto(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            נדרשת תמונה
          </label>
        </div>

        {recurrence === 'weekly' && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-slate-500">ימים נבחרים</p>
            <div className="grid grid-cols-7 gap-2">
              {weekdayNames.map((label, dayIndex) => {
                const isSelected = selectedWeekdays.includes(dayIndex)
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleWeekday(dayIndex, selectedWeekdays, setSelectedWeekdays)}
                    className={`rounded-xl border px-2 py-3 text-sm font-bold transition ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {selectedWeekdays.length > 0 && (
              <p className="mt-2 text-xs text-slate-600">החזרה תתבצע ב-{formatWeekdayList(selectedWeekdays)}</p>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          {recurrence === 'weekly' && selectedWeekdays.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
              🔁 {formatWeekdayList(selectedWeekdays)}
            </span>
          )}
        </div>

        <button
          type="submit"
          className="primary-button mt-4 px-4 py-2 text-sm"
        >
          + הוסף משימה
        </button>
      </form>

      <div className="panel-card p-5">
        <p className="text-sm font-semibold tracking-[0.08em] text-slate-500">היום במשפחה</p>
        <div className="mt-5 space-y-4">
          {members
            .filter((member) => member.role === 'child')
            .map((member) => {
              const width = member.totalTasks > 0 ? `${Math.round((member.completedTasks / member.totalTasks) * 100)}%` : '0%'
              const accent = member.id === 'daniel' ? 'bg-emerald-500' : 'bg-sky-500'

              return (
                <div key={member.id}>
                  <div className="flex items-center justify-between text-sm text-slate-700">
                    <span>{member.name}</span>
                    <span>
                      {member.completedTasks} מתוך {member.totalTasks}
                    </span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200">
                    <div className={`h-full rounded-full ${accent}`} style={{ width }} />
                  </div>
                </div>
              )
            })}
        </div>
      </div>

      <div className="panel-card p-5">
        <h3 className="text-lg font-bold text-slate-900">ממתינות לאישור</h3>
        <div className="mt-4 space-y-3">
          {tasks.filter((task) => task.completionStatus === 'submitted').length === 0 ? (
            <p className="text-sm text-slate-500">אין כרגע משימות שמחכות לאישור.</p>
          ) : (
            tasks
              .filter((task) => task.completionStatus === 'submitted')
              .map((task) => {
                const assignee = members.find((member) => member.id === task.memberId)
                const reviewNote = reviewNotes[task.id] ?? ''
                return (
                  <div key={task.id} className="rounded-[1.5rem] border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-orange-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-bold text-slate-800">
                          {task.emoji} {task.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {assignee?.name ?? 'לא משויך'} · {formatCompletionStatus(task.completionStatus)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">+{task.xp} XP</p>
                        {task.completionStatus === 'submitted' && task.proofPhotoUrl && (
                          <img
                            src={task.proofPhotoUrl}
                            alt="Temporary proof"
                            className="mt-3 h-36 w-full rounded-xl object-cover"
                          />
                        )}
                        {task.completionNote && (
                          <p className="mt-2 text-xs text-slate-600">משוב: {task.completionNote}</p>
                        )}
                      </div>
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                        ממתין
                      </span>
                    </div>

                    <textarea
                      value={reviewNote}
                      onChange={(event) => setReviewNotes((current) => ({ ...current, [task.id]: event.target.value }))}
                      placeholder="משוב אופציונלי"
                      className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-400"
                      rows={2}
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onReviewTaskCompletion(task.id, 'approved', reviewNote)
                          setReviewNotes((current) => ({ ...current, [task.id]: '' }))
                        }}
                        className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-200"
                      >
                        אשר
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onReviewTaskCompletion(task.id, 'rejected', reviewNote)
                          setReviewNotes((current) => ({ ...current, [task.id]: '' }))
                        }}
                        className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-200"
                      >
                        דחה
                      </button>
                    </div>
                  </div>
                )
              })
          )}
        </div>
      </div>

      <div className="panel-card p-5">
        <h3 className="text-lg font-bold text-slate-900">משימות משפחתיות</h3>
        <div className="mt-4 space-y-3">
          {activeTasks.length === 0 ? (
            <p className="text-sm text-slate-500">אין כרגע משימות פעילות.</p>
          ) : (
            activeTasks.map((task) => {
              const assignee = members.find((member) => member.id === task.memberId)
              const isEditing = editingTaskId === task.id
              const dueLabel = formatDueDateTime(task.dueAt)
              const priorityLabel = formatPriority(task.priority)
              const recurrenceLabel =
                task.recurrence === 'weekly' && task.recurrenceDays.length > 0
                  ? `🔁 ${formatWeekdayList(task.recurrenceDays)}`
                  : formatRecurrence(task.recurrence)
              const completionLabel = formatCompletionStatus(task.completionStatus)

              return (
                <div key={task.id} className="rounded-[1.5rem] border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-indigo-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-base font-bold text-slate-800">
                        {task.emoji} {task.title}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {assignee?.name ?? 'לא משויך'} · +{task.xp} XP
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${task.completionStatus === 'submitted' ? 'bg-amber-100 text-amber-700' : task.completionStatus === 'approved' ? 'bg-emerald-100 text-emerald-700' : task.completionStatus === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-700'}`}>
                          {completionLabel}
                        </span>
                        {dueLabel && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">⏰ {dueLabel}</span>}
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-700">{priorityLabel}</span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{recurrenceLabel}</span>
                        {task.requiresPhoto && (
                          <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-fuchsia-700">נדרשת תמונה</span>
                        )}
                      </div>
                      {task.completionNote && (
                        <p className="mt-2 text-xs text-slate-600">משוב: {task.completionNote}</p>
                      )}
                      {task.completionStatus === 'submitted' && task.proofPhotoUrl && (
                        <img
                          src={task.proofPhotoUrl}
                          alt="Temporary proof"
                          className="mt-3 h-36 w-full rounded-xl object-cover"
                        />
                      )}
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      task.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-700'
                        : task.status === 'rejected'
                          ? 'bg-rose-100 text-rose-700'
                          : task.status === 'completed'
                            ? 'bg-indigo-100 text-indigo-700'
                            : task.status === 'overdue'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-slate-200 text-slate-700'
                    }`}>
                      {getTaskStatusLabel(task.status)}
                    </span>
                  </div>

                  {isEditing && (
                    <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-2">
                      <input
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm"
                      />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <input
                          value={editEmoji}
                          maxLength={2}
                          onChange={(event) => setEditEmoji(event.target.value)}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm"
                        />
                        <input
                          type="number"
                          min={5}
                          step={5}
                          value={editXp}
                          onChange={(event) => setEditXp(Number(event.target.value || 0))}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm"
                        />
                        <select
                          value={editAssignedTo || childMembers[0]?.id || ''}
                          onChange={(event) => setEditAssignedTo(event.target.value)}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm"
                        >
                          {members
                            .filter((member) => member.role === 'child')
                            .map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <input
                          type="date"
                          value={editDueDate}
                          onChange={(event) => setEditDueDate(event.target.value)}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm"
                        />
                        <input
                          type="time"
                          value={editDueTime}
                          onChange={(event) => setEditDueTime(event.target.value)}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <select
                          value={editPriority}
                          onChange={(event) => setEditPriority(event.target.value as TaskPriority)}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm"
                        >
                          <option value="low">נמוכה</option>
                          <option value="medium">בינונית</option>
                          <option value="high">גבוהה</option>
                        </select>
                        <select
                          value={editRecurrence}
                          onChange={(event) => setEditRecurrence(event.target.value as TaskRecurrence)}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm"
                        >
                          <option value="none">חד-פעמית</option>
                          <option value="daily">כל יום</option>
                          <option value="weekly">ימים מסוימים</option>
                          <option value="monthly">חודשית</option>
                        </select>
                      </div>
                      {editRecurrence === 'weekly' && (
                        <div className="mt-2">
                          <p className="mb-2 text-[10px] font-semibold tracking-[0.08em] text-slate-500">ימים נבחרים</p>
                          <div className="grid grid-cols-7 gap-1">
                            {weekdayNames.map((label, dayIndex) => {
                              const isSelected = editSelectedWeekdays.includes(dayIndex)
                              return (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() => toggleWeekday(dayIndex, editSelectedWeekdays, setEditSelectedWeekdays)}
                                  className={`rounded-md border px-2 py-2 text-xs font-bold ${
                                    isSelected
                                      ? 'border-indigo-600 bg-indigo-600 text-white'
                                      : 'border-slate-200 bg-slate-50 text-slate-700'
                                  }`}
                                >
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={editRequiresPhoto}
                          onChange={(event) => setEditRequiresPhoto(event.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        נדרשת תמונה
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveEdit}
                          className="rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white"
                        >
                          שמור
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTaskId(null)}
                          className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700"
                        >
                          ביטול
                        </button>
                      </div>
                    </div>
                  )}

                  {!isEditing && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEditing(task)}
                        className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        ערוך
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteTask(task.id)}
                        className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-200"
                      >
                        מחק
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {approvedTaskHistory.length > 0 && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <button
              type="button"
              onClick={() => setShowApprovedTaskHistory((current) => !current)}
              className="flex w-full items-center justify-between text-right text-sm font-semibold text-slate-700"
            >
              <span>היסטוריית משימות ({approvedTaskHistory.length})</span>
              <span>{showApprovedTaskHistory ? '▲' : '▼'}</span>
            </button>

            {showApprovedTaskHistory && (
              <div className="mt-3 space-y-2">
                {approvedTaskHistory.map((task) => {
                  const assignee = members.find((member) => member.id === task.memberId)
                  return (
                    <div key={task.id} className="rounded-xl border border-emerald-200 bg-white p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-800">{task.emoji} {task.title}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{assignee?.name ?? 'לא משויך'} · +{task.xp} XP</p>
                        </div>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          {getTaskStatusLabel(task.status)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
