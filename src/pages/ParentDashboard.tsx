import { useMemo, useState, type FormEvent } from 'react'
import { StatCard } from '../components/StatCard'
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
}

const statusLabels: Record<TaskItem['status'], string> = {
  pending: 'ממתין',
  completed: 'הושלם',
  approved: 'אושר',
  rejected: 'נדחה',
  overdue: 'באיחור',
}

export function ParentDashboard({
  familyName,
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
}: ParentDashboardProps) {
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState('✅')
  const [xp, setXp] = useState(10)
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [recurrence, setRecurrence] = useState<TaskRecurrence>('none')
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
  const [editRequiresPhoto, setEditRequiresPhoto] = useState(false)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [rewardTitle, setRewardTitle] = useState('')
  const [rewardDescription, setRewardDescription] = useState('')
  const [rewardXpCost, setRewardXpCost] = useState(20)
  const [rewardActionError, setRewardActionError] = useState('')
  const [archivingRewardId, setArchivingRewardId] = useState<string | null>(null)

  const childMembers = members.filter((member) => member.role === 'child')
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

    onAddTask({
      title,
      emoji,
      xp,
      assignedTo: selectedChildId,
      dueAt: buildDueAt(dueDate, dueTime),
      priority,
      recurrence,
      requiresPhoto,
    })

    setTitle('')
    setEmoji('✅')
    setXp(10)
    setAssignedTo(childMembers[0]?.id ?? '')
    setDueDate('')
    setDueTime('')
    setPriority('medium')
    setRecurrence('none')
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

      <form onSubmit={handleSubmit} className="panel-card p-5">
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
              <option value="none">ללא</option>
              <option value="daily">יומית</option>
              <option value="weekly">שבועית</option>
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
          {tasks.map((task) => {
            const assignee = members.find((member) => member.id === task.memberId)
            const isEditing = editingTaskId === task.id
            const dueLabel = formatDueDateTime(task.dueAt)
            const priorityLabel = formatPriority(task.priority)
            const recurrenceLabel = formatRecurrence(task.recurrence)
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
                    {statusLabels[task.status]}
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
                        <option value="none">ללא</option>
                        <option value="daily">יומית</option>
                        <option value="weekly">שבועית</option>
                        <option value="monthly">חודשית</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-600">
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
          })}
        </div>
      </div>
    </section>
  )
}
