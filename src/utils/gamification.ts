import type { AchievementProgress, FamilyMember, RewardRedemptionRecord, TaskItem } from '../types'

export type FamilyMemberSeed = Pick<
  FamilyMember,
  'id' | 'name' | 'role' | 'xp' | 'streak' | 'completedTasks' | 'totalTasks'
>

export const XP_PER_LEVEL = 100
export const DAILY_COMPLETION_BONUS_XP = 15

export const GAMIFICATION_ACHIEVEMENTS = [
  {
    code: 'first-completion',
    title: 'First Step',
    description: 'Complete your first task.',
    icon: '🎯',
    xpReward: 10,
    metric: 'approvedCount',
    threshold: 1,
  },
  {
    code: 'five-completions',
    title: 'Task Runner',
    description: 'Complete five tasks.',
    icon: '⚡',
    xpReward: 20,
    metric: 'approvedCount',
    threshold: 5,
  },
  {
    code: 'three-day-streak',
    title: 'On a Roll',
    description: 'Keep a three-day streak.',
    icon: '🔥',
    xpReward: 25,
    metric: 'streak',
    threshold: 3,
  },
  {
    code: 'seven-day-streak',
    title: 'Consistency Star',
    description: 'Keep a seven-day streak.',
    icon: '⭐',
    xpReward: 50,
    metric: 'streak',
    threshold: 7,
  },
  {
    code: 'daily-bonus',
    title: 'Daily Winner',
    description: 'Finish every required daily task on a day.',
    icon: '🏆',
    xpReward: 15,
    metric: 'dailyBonusDays',
    threshold: 1,
  },
] as const

type GamificationMetric = AchievementProgress['metric']

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export const formatDateKey = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return dateFormatter.format(date)
}

const normalizeToMidnight = (value: Date) => {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

const getApprovedDateKey = (task: TaskItem) => {
  const source = task.reviewedAt ?? task.submittedAt
  return source ? formatDateKey(source) : null
}

const isApprovedTask = (task: TaskItem) => task.status === 'approved' || task.status === 'completed'

const getMetricValue = (metric: GamificationMetric, approvedCount: number, streak: number, dailyBonusDays: number) => {
  switch (metric) {
    case 'streak':
      return streak
    case 'dailyBonusDays':
      return dailyBonusDays
    case 'approvedCount':
    default:
      return approvedCount
  }
}

export function calculateLevel(totalXp: number) {
  const safeXp = Math.max(0, totalXp)
  const level = Math.max(1, Math.floor(safeXp / XP_PER_LEVEL) + 1)
  const xpIntoLevel = safeXp % XP_PER_LEVEL
  const xpToNextLevel = XP_PER_LEVEL - xpIntoLevel

  return {
    level,
    xpIntoLevel,
    xpToNextLevel,
    xpProgress: xpIntoLevel / XP_PER_LEVEL,
  }
}

function calculateStreak(approvedDateKeys: Set<string>, now: Date) {
  let streak = 0
  const cursor = normalizeToMidnight(now)

  while (true) {
    const key = formatDateKey(cursor)
    if (!key || !approvedDateKeys.has(key)) {
      break
    }

    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  return streak
}

function calculateDailyBonusDays(tasks: TaskItem[]) {
  const requiredDailyTasks = tasks.filter((task) => task.recurrence === 'daily')
  if (requiredDailyTasks.length === 0) {
    return { bonusDays: 0, bonusDateKeys: new Set<string>() }
  }

  const requiredDailyTaskIds = new Set(requiredDailyTasks.map((task) => task.id))
  const approvalsByDate = new Map<string, Set<string>>()

  for (const task of requiredDailyTasks) {
    if (!isApprovedTask(task)) {
      continue
    }

    const dateKey = getApprovedDateKey(task)
    if (!dateKey) {
      continue
    }

    const bucket = approvalsByDate.get(dateKey) ?? new Set<string>()
    bucket.add(task.id)
    approvalsByDate.set(dateKey, bucket)
  }

  let bonusDays = 0
  const bonusDateKeys = new Set<string>()
  for (const approvedTaskIds of approvalsByDate.values()) {
    if (approvedTaskIds.size === requiredDailyTaskIds.size) {
      bonusDays += 1
      const matchedDate = [...approvalsByDate.entries()].find(([, value]) => value === approvedTaskIds)?.[0]
      if (matchedDate) {
        bonusDateKeys.add(matchedDate)
      }
    }
  }

  return { bonusDays, bonusDateKeys }
}

function getLatestApprovedDate(tasks: TaskItem[]) {
  const approvedDates = tasks
    .filter(isApprovedTask)
    .map(getApprovedDateKey)
    .filter((value): value is string => Boolean(value))
    .sort()

  return approvedDates[approvedDates.length - 1] ?? null
}

function getApprovedRewardRedemptions(memberId: string, redemptions: RewardRedemptionRecord[]) {
  return redemptions.filter((redemption) => redemption.userId === memberId && redemption.status === 'approved')
}

export function deriveMemberGamification(
  member: FamilyMemberSeed,
  tasks: TaskItem[],
  rewardRedemptions: RewardRedemptionRecord[] = [],
  now = new Date(),
): FamilyMember {
  const memberTasks = tasks.filter((task) => task.memberId === member.id)
  const approvedTasks = memberTasks.filter(isApprovedTask)
  const approvedCount = approvedTasks.length
  const baseXp = approvedTasks.reduce((sum, task) => sum + task.xp, 0)
  const approvedDateKeys = new Set(
    approvedTasks
      .map(getApprovedDateKey)
      .filter((value): value is string => Boolean(value)),
  )
  const streak = calculateStreak(approvedDateKeys, now)
  const { bonusDays: dailyBonusDays, bonusDateKeys } = calculateDailyBonusDays(memberTasks)
  const dailyBonusXp = dailyBonusDays * DAILY_COMPLETION_BONUS_XP

  const achievements: AchievementProgress[] = GAMIFICATION_ACHIEVEMENTS.map((definition) => {
    const currentValue = getMetricValue(definition.metric, approvedCount, streak, dailyBonusDays)
    const progress = Math.min(currentValue / definition.threshold, 1)
    const unlocked = currentValue >= definition.threshold
    return {
      ...definition,
      currentValue,
      progress,
      unlocked,
      unlockedAt: unlocked ? getLatestApprovedDate(memberTasks) : null,
    }
  })

  const achievementXp = achievements.filter((achievement) => achievement.unlocked).reduce((sum, achievement) => sum + achievement.xpReward, 0)
  const approvedRewardRedemptions = getApprovedRewardRedemptions(member.id, rewardRedemptions)
  const rewardXpSpent = approvedRewardRedemptions.reduce((sum, redemption) => sum + redemption.xpCostSnapshot, 0)
  const totalXp = Math.max(0, baseXp + dailyBonusXp + achievementXp - rewardXpSpent)
  const level = calculateLevel(totalXp)
  const dailyCelebration = bonusDateKeys.has(formatDateKey(now) ?? '')

  return {
    ...member,
    xp: totalXp,
    streak,
    completedTasks: approvedCount,
    totalTasks: memberTasks.length,
    level: level.level,
    xpIntoLevel: level.xpIntoLevel,
    xpToNextLevel: level.xpToNextLevel,
    xpProgress: level.xpProgress,
    baseXp,
    dailyBonusXp,
    achievementXp,
    achievementCount: achievements.filter((achievement) => achievement.unlocked).length,
    dailyBonusDays,
    dailyCelebration,
    rewardXpSpent,
    rewardRedemptionCount: approvedRewardRedemptions.length,
    achievements,
  }
}

export function deriveFamilyGamification(
  members: FamilyMemberSeed[],
  tasks: TaskItem[],
  rewardRedemptions: RewardRedemptionRecord[] = [],
  now = new Date(),
) {
  return members.map((member) => deriveMemberGamification(member, tasks, rewardRedemptions, now))
}

export function buildFallbackMember(member: FamilyMemberSeed): FamilyMember {
  const level = calculateLevel(member.xp)
  return {
    ...member,
    level: level.level,
    xpIntoLevel: level.xpIntoLevel,
    xpToNextLevel: level.xpToNextLevel,
    xpProgress: level.xpProgress,
    baseXp: member.xp,
    dailyBonusXp: 0,
    achievementXp: 0,
    achievementCount: 0,
    dailyBonusDays: 0,
    dailyCelebration: false,
    rewardXpSpent: 0,
    rewardRedemptionCount: 0,
    achievements: [],
  }
}
