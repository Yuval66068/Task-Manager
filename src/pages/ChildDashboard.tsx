import { useEffect, useMemo, useState } from 'react'
import type { AchievementProgress, FamilyMember, RewardItem, RewardRedemptionRecord, TaskItem } from '../types'

type ChildDashboardProps = {
  child: FamilyMember
  currentUserName: string
  tasks: TaskItem[]
  onSubmitTaskCompletion: (taskId: string, proofFile?: File) => void | Promise<void>
  rewards: RewardItem[]
  rewardRedemptions: RewardRedemptionRecord[]
  onRequestReward: (rewardId: string) => void | Promise<void>
}

type BurstState = {
  gainedXp: number
  levelUp: boolean
  unlockedAchievements: AchievementProgress[]
  dailyCelebration: boolean
}

const statusStyles: Record<TaskItem['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  approved: 'bg-indigo-100 text-indigo-700',
  rejected: 'bg-rose-100 text-rose-700',
  overdue: 'bg-rose-100 text-rose-700',
}

const storageKeyForChild = (childId: string) => `task-manager:gamification:${childId}`

const formatAchievementProgress = (achievement: AchievementProgress) => {
  const current = Math.min(achievement.currentValue, achievement.threshold)
  return `${current}/${achievement.threshold}`
}

export function ChildDashboard({
  child,
  currentUserName,
  tasks,
  onSubmitTaskCompletion,
  rewards,
  rewardRedemptions,
  onRequestReward,
}: ChildDashboardProps) {
  const [selectedProofs, setSelectedProofs] = useState<Record<string, { file: File; previewUrl: string } | null>>({})
  const [submissionError, setSubmissionError] = useState('')
  const [submissionSuccess, setSubmissionSuccess] = useState('')
  const [rewardError, setRewardError] = useState('')
  const [burst, setBurst] = useState<BurstState | null>(null)

  useEffect(() => {
    return () => {
      Object.values(selectedProofs).forEach((entry) => {
        if (entry) {
          URL.revokeObjectURL(entry.previewUrl)
        }
      })
    }
  }, [selectedProofs])

  useEffect(() => {
    const previous = window.localStorage.getItem(storageKeyForChild(child.id))
    const currentSnapshot = {
      xp: child.xp,
      level: child.level,
      achievementCount: child.achievementCount,
      dailyBonusDays: child.dailyBonusDays,
    }

    if (previous) {
      const parsed = JSON.parse(previous) as typeof currentSnapshot
      const gainedXp = currentSnapshot.xp - parsed.xp
      const levelUp = currentSnapshot.level > parsed.level
      const unlockedAchievements = child.achievements.filter((achievement) => achievement.unlocked).slice(
        parsed.achievementCount,
      )
      const dailyCelebration = child.dailyBonusDays > parsed.dailyBonusDays || child.dailyCelebration

      if (gainedXp > 0 || levelUp || unlockedAchievements.length > 0 || dailyCelebration) {
        queueMicrotask(() => {
          setBurst({
            gainedXp: Math.max(0, gainedXp),
            levelUp,
            unlockedAchievements,
            dailyCelebration,
          })
        })

        window.localStorage.setItem(storageKeyForChild(child.id), JSON.stringify(currentSnapshot))
        return
      }
    }

    window.localStorage.setItem(storageKeyForChild(child.id), JSON.stringify(currentSnapshot))
  }, [child.achievementCount, child.achievements, child.dailyBonusDays, child.dailyCelebration, child.id, child.level, child.xp])

  useEffect(() => {
    if (!submissionSuccess) {
      return
    }

    const timeout = window.setTimeout(() => setSubmissionSuccess(''), 2500)
    return () => window.clearTimeout(timeout)
  }, [submissionSuccess])

  useEffect(() => {
    if (!burst) {
      return
    }

    const timeout = window.setTimeout(() => setBurst(null), 2800)
    return () => window.clearTimeout(timeout)
  }, [burst])

  const progressWidth = `${Math.min(child.xpProgress * 100, 100)}%`
  const tasksToCelebrate = useMemo(
    () => tasks.filter((task) => task.recurrence === 'daily' && task.status === 'approved'),
    [tasks],
  )

  const formatDueDateTime = (dueAt: string | null) => {
    if (!dueAt) {
      return null
    }

    const dueDateTime = new Date(dueAt)
    if (Number.isNaN(dueDateTime.getTime())) {
      return null
    }

    return `${dueDateTime.toLocaleDateString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })} · ${dueDateTime.toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    })}`
  }

  const priorityLabel = {
    low: 'נמוכה',
    medium: 'בינונית',
    high: 'גבוהה',
  } satisfies Record<string, string>

  const formatCompletionStatus = (value: TaskItem['completionStatus']) => {
    switch (value) {
      case 'submitted':
        return 'נשלח לאישור'
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

  const childRewardHistory = useMemo(
    () => rewardRedemptions.filter((entry) => entry.userId === child.id),
    [child.id, rewardRedemptions],
  )

  const clearProof = (taskId: string) => {
    setSelectedProofs((current) => {
      const entry = current[taskId]
      if (entry) {
        URL.revokeObjectURL(entry.previewUrl)
      }

      const next = { ...current }
      delete next[taskId]
      return next
    })
  }

  const handleFileChange = (taskId: string, file?: File | null) => {
    setSubmissionError('')
    clearProof(taskId)

    if (!file) {
      return
    }

    const previewUrl = URL.createObjectURL(file)
    setSelectedProofs((current) => ({
      ...current,
      [taskId]: { file, previewUrl },
    }))
  }

  const handleSubmit = async (task: TaskItem) => {
    try {
      setSubmissionError('')
      await onSubmitTaskCompletion(task.id, selectedProofs[task.id]?.file)
      setSubmissionSuccess('המשימה נשלחה לאישור בהצלחה!')
      clearProof(task.id)
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : 'Could not submit the task.')
    }
  }

  const handleRewardRequest = async (rewardId: string) => {
    try {
      setRewardError('')
      await onRequestReward(rewardId)
    } catch (error) {
      setRewardError(error instanceof Error ? error.message : 'Could not request the reward.')
    }
  }

  return (
    <section className="dashboard-stack family-dashboard child-dashboard">
      {burst && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="relative w-full max-w-md overflow-hidden rounded-[2rem] bg-white p-6 text-center shadow-2xl ring-1 ring-slate-200">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 via-white to-lime-50" />
            <div className="relative">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-4xl text-white shadow-lg animate-gamification-pop">
                ✓
              </div>
              <p className="mt-4 text-2xl font-black text-slate-900">{burst.levelUp ? 'Level up!' : 'כל הכבוד!'}</p>
              <p className="mt-2 text-lg font-bold text-emerald-700">+{burst.gainedXp} XP</p>
              <p className="mt-1 text-sm text-slate-600">ההתקדמות עודכנה והפרס נשמר.</p>

              {(burst.levelUp || burst.dailyCelebration) && (
                <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                  {burst.levelUp ? 'עלית רמה!' : 'השלמת את כל המשימות היומיות!'}
                </div>
              )}

              {burst.unlockedAchievements.length > 0 && (
                <div className="mt-4 space-y-2 text-right">
                  {burst.unlockedAchievements.map((achievement) => (
                    <div key={achievement.code} className="rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      {achievement.icon} {achievement.title}
                    </div>
                  ))}
                </div>
              )}

              <div className="absolute inset-0">
                {Array.from({ length: Math.min(8, Math.max(3, Math.ceil(burst.gainedXp / 10))) }).map((_, index) => (
                  <span
                    key={index}
                    className="absolute text-emerald-500 animate-gamification-float"
                    style={{
                      left: `${12 + ((index * 13) % 72)}%`,
                      top: `${72 - (index % 3) * 8}%`,
                      animationDelay: `${index * 120}ms`,
                    }}
                  >
                    +
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="child-hero-card">
        <div className="child-hero-card__visual" aria-hidden="true">
          <span>🏆</span>
        </div>

        <div className="child-hero-card__content">
          <div className="child-hero-card__header-row">
            <p>שלום, {currentUserName || child.name}! 👋</p>
            <div className="child-hero-card__badge">🔥 {child.streak} ימים</div>
          </div>

          <div className="child-hero-card__main-row">
            <div>
              <p className="child-hero-card__level">Level {child.level}</p>
              <p className="child-hero-card__meta">
                {child.xp} XP · {child.xpToNextLevel} XP עד הרמה הבאה
              </p>
            </div>
            <div className="child-hero-card__xp-pill">⭐ {child.xp} XP</div>
          </div>

          <div className="child-hero-card__progress">
            <div
              className="child-hero-card__progress-bar"
              style={{ width: progressWidth }}
            />
          </div>

          <div className="child-hero-card__chips">
            <span>Base {child.baseXp} XP</span>
            {child.dailyBonusXp > 0 && <span className="success">Daily +{child.dailyBonusXp} XP</span>}
            {child.achievementXp > 0 && <span className="purple">Achievements +{child.achievementXp} XP</span>}
          </div>
        </div>
      </div>

      {submissionSuccess && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {submissionSuccess}
        </div>
      )}

      {child.dailyCelebration && (
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-center shadow-sm">
          <p className="text-lg font-black text-emerald-700">🎉 Daily celebration!</p>
          <p className="mt-1 text-sm text-emerald-700">השלמת את כל המשימות היומיות שלך להיום.</p>
        </div>
      )}

      {tasksToCelebrate.length > 0 && (
        <div className="rounded-3xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">
          משימות יומיות שהושלמו: {tasksToCelebrate.length}
        </div>
      )}

      {rewards.filter((reward) => reward.isActive).length > 0 && (() => {
        const nextReward = rewards.filter((reward) => reward.isActive)[0]
        return (
          <div className="treasure-card">
            <div className="treasure-card__badge">🎁 ארון הפרסים</div>
            <div className="treasure-card__body">
              <div className="treasure-card__visual" aria-hidden="true">
                <div className="treasure-chest">
                  <div className="treasure-chest__spark treasure-chest__spark--one">✦</div>
                  <div className="treasure-chest__spark treasure-chest__spark--two">✦</div>
                  <div className="treasure-chest__spark treasure-chest__spark--three">✦</div>
                  <div className="treasure-chest__lid" />
                  <div className="treasure-chest__body">
                    <div className="treasure-chest__stripe" />
                    <div className="treasure-chest__buckle" />
                  </div>
                </div>
              </div>
              <div className="treasure-card__content">
                <p className="treasure-card__label">המטרה הבאה</p>
                <h3>{nextReward.title}</h3>
                <div className="treasure-card__meta">
                  <span>{nextReward.xpCost} XP</span>
                  <span>{child.xp >= nextReward.xpCost ? 'זמין' : 'עוד קצת'}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      <div className="panel-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">פרסים זמינים</h3>
          <span className="metric-pill bg-violet-100 text-violet-700">{rewards.filter((reward) => reward.isActive).length} פעילים</span>
        </div>

        {rewardError && (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {rewardError}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {rewards.filter((reward) => reward.isActive).length === 0 ? (
            <p className="text-sm text-slate-500">אין כרגע פרסים זמינים.</p>
          ) : (
            rewards
              .filter((reward) => reward.isActive)
              .map((reward) => {
                const hasPendingRequest = rewardRedemptions.some(
                  (entry) => entry.userId === child.id && entry.rewardId === reward.id && entry.status === 'pending',
                )
                const canRequest = child.xp >= reward.xpCost && !hasPendingRequest

                return (
                  <div key={reward.id} className="rounded-[1.5rem] border border-violet-100 bg-gradient-to-r from-violet-50 via-white to-pink-50 p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-800">{reward.title}</p>
                        {reward.description && <p className="mt-1 text-xs text-slate-500">{reward.description}</p>}
                      </div>
                      <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-200">
                        {reward.xpCost} XP
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500">
                        {hasPendingRequest ? 'בקשה נשלחה' : child.xp >= reward.xpCost ? 'זמין למימוש' : 'אין מספיק XP'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          void handleRewardRequest(reward.id)
                        }}
                        disabled={!canRequest}
                        className="primary-button px-3 py-1.5 text-xs"
                      >
                        {hasPendingRequest ? 'ממתין' : 'ממש פרס'}
                      </button>
                    </div>
                  </div>
                )
              })
          )}
        </div>
      </div>

      <div className="panel-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">היסטוריית פרסים שלי</h3>
          <span className="metric-pill bg-emerald-100 text-emerald-700">{childRewardHistory.length} בקשות</span>
        </div>

        <div className="mt-4 space-y-3">
          {childRewardHistory.length === 0 ? (
            <p className="text-sm text-slate-500">אין עדיין היסטוריית פרסים.</p>
          ) : (
            childRewardHistory.map((entry) => (
              <div key={entry.id} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-800">{entry.rewardTitle}</p>
                    <p className="mt-1 text-xs text-slate-500">{entry.xpCostSnapshot} XP</p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      entry.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-700'
                        : entry.status === 'rejected'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {formatRewardStatus(entry.status)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {submissionError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submissionError}</div>
      )}

      <div className="panel-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">הישגים</h3>
          <span className="metric-pill bg-amber-100 text-amber-700">{child.achievementCount} הושגו</span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {child.achievements.map((achievement) => (
            <div
              key={achievement.code}
              className={`rounded-2xl p-4 shadow-sm ring-1 transition ${
                achievement.unlocked
                  ? 'bg-emerald-50 ring-emerald-100'
                  : 'bg-slate-50 ring-slate-200'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{achievement.icon}</span>
                  <div>
                    <p className="font-bold text-slate-900">{achievement.title}</p>
                    <p className="text-xs text-slate-500">{achievement.description}</p>
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  achievement.unlocked ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                }`}>
                  {achievement.unlocked ? `+${achievement.xpReward} XP` : 'Locked'}
                </span>
              </div>

              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>{formatAchievementProgress(achievement)}</span>
                  <span>{achievement.metric === 'streak' ? 'streak' : achievement.metric === 'dailyBonusDays' ? 'daily bonus' : 'completions'}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      achievement.unlocked ? 'bg-emerald-500' : 'bg-slate-400'
                    }`}
                    style={{ width: `${Math.min(achievement.progress * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel-card p-5">
        <h3 className="text-lg font-bold text-slate-900">המשימות שלך היום</h3>
        <ul className="mt-4 space-y-3">
          {tasks.map((task) => {
            const dueLabel = formatDueDateTime(task.dueAt)
            const completionLabel = formatCompletionStatus(task.completionStatus)
            const canSubmit = task.status !== 'approved' && task.completionStatus !== 'submitted'
            const proof = selectedProofs[task.id]

            return (
              <li key={task.id} className="rounded-[1.5rem] border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-indigo-50 p-3 text-right text-slate-700 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    {task.emoji} {task.title}
                  </span>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusStyles[task.status]}`}>
                    {task.status}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${
                      task.completionStatus === 'submitted'
                        ? 'bg-amber-100 text-amber-700'
                        : task.completionStatus === 'approved'
                          ? 'bg-emerald-100 text-emerald-700'
                          : task.completionStatus === 'rejected'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {completionLabel}
                  </span>
                  {dueLabel && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">⏰ {dueLabel}</span>}
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-700">{priorityLabel[task.priority]}</span>
                  {task.recurrence !== 'none' && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                      {task.recurrence === 'daily' ? 'יומית' : task.recurrence === 'weekly' ? 'שבועית' : 'חודשית'}
                    </span>
                  )}
                  {task.requiresPhoto && <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-fuchsia-700">נדרשת תמונה</span>}
                </div>

                {task.completionNote && <p className="mt-2 text-xs text-slate-600">משוב: {task.completionNote}</p>}

                {task.requiresPhoto && canSubmit && (
                  <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-3">
                    {proof?.previewUrl ? (
                      <img src={proof.previewUrl} alt="Proof preview" className="h-44 w-full rounded-xl object-cover" />
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
                        בחר או צלם תמונה לפני השליחה
                      </div>
                    )}

                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500">
                        בחר תמונה
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(event) => handleFileChange(task.id, event.target.files?.[0] ?? null)}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => handleFileChange(task.id, null)}
                        className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        נקה בחירה
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between">
                  <span className="font-bold text-emerald-700">+{task.xp} XP</span>
                  {canSubmit && (
                    <button
                      type="button"
                      onClick={() => handleSubmit(task)}
                      disabled={task.requiresPhoto && !proof}
                      className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {task.requiresPhoto ? 'שלח עם תמונה' : 'סמן הושלם'}
                    </button>
                  )}
                  {!canSubmit && (
                    <span className="rounded-full bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">
                      {completionLabel}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
