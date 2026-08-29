export type UserRole = 'parent' | 'child'

export type TaskStatus = 'pending' | 'completed' | 'approved' | 'rejected' | 'overdue'
export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'
export type TaskCompletionStatus = 'pending' | 'submitted' | 'approved' | 'rejected'
export type RewardRedemptionStatus = 'pending' | 'approved' | 'rejected'
export type NotificationType =
  | 'task_assigned'
  | 'task_completed'
  | 'task_approved'
  | 'task_rejected'
  | 'task_deadline'
  | 'task_overdue'
  | 'reward_requested'
  | 'reward_approved'
  | 'reward_rejected'
  | 'reward_redeemed'
  | 'family_invite'

export type AchievementMetric = 'approvedCount' | 'streak' | 'dailyBonusDays'

export type AchievementProgress = {
  code: string
  title: string
  description: string
  icon: string
  xpReward: number
  metric: AchievementMetric
  threshold: number
  currentValue: number
  progress: number
  unlocked: boolean
  unlockedAt: string | null
}

export type TaskCompletionRecord = {
  id: string
  taskId: string
  childId: string
  status: TaskCompletionStatus
  completionNote: string | null
  proofPhotoPath: string | null
  proofPhotoUrl: string | null
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
}

export type RewardItem = {
  id: string
  familyId: string
  title: string
  description: string | null
  xpCost: number
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type RewardRedemptionRecord = {
  id: string
  userId: string
  rewardId: string
  status: RewardRedemptionStatus
  requestedAt: string
  reviewedBy: string | null
  reviewedAt: string | null
  xpCostSnapshot: number
  rewardTitle: string
  rewardDescription: string | null
  rewardFamilyId: string
}

export type NotificationItem = {
  id: string
  familyId: string
  recipientId: string
  actorId: string | null
  type: NotificationType
  message: string
  isRead: boolean
  createdAt: string
  updatedAt: string
  taskId: string | null
  rewardId: string | null
}

export type TaskDraft = {
  title: string
  emoji: string
  xp: number
  assignedTo: string
  dueAt?: string | null
  priority?: TaskPriority
  recurrence?: TaskRecurrence
  requiresPhoto?: boolean
}

export type TaskUpdateDraft = TaskDraft

export type RewardDraft = {
  title: string
  description?: string
  xpCost: number
}

export type FamilyMember = {
  id: string
  name: string
  role: UserRole
  xp: number
  streak: number
  completedTasks: number
  totalTasks: number
  level: number
  xpIntoLevel: number
  xpToNextLevel: number
  xpProgress: number
  baseXp: number
  dailyBonusXp: number
  achievementXp: number
  achievementCount: number
  dailyBonusDays: number
  dailyCelebration: boolean
  rewardXpSpent: number
  rewardRedemptionCount: number
  achievements: AchievementProgress[]
}

export type TaskItem = {
  id: string
  title: string
  emoji: string
  xp: number
  status: TaskStatus
  memberId: string
  dueAt: string | null
  priority: TaskPriority
  recurrence: TaskRecurrence
  requiresPhoto: boolean
  completionId: string | null
  completionStatus: TaskCompletionStatus | null
  completionNote: string | null
  proofPhotoPath: string | null
  proofPhotoUrl: string | null
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
}

export type DashboardStat = {
  pendingApproval: number
  completedToday: number
  overdue: number
  totalXp: number
}

export type FamilyDashboardData = {
  familyName: string
  taskCount: number
  completionRate: number
  stats: DashboardStat
  members: FamilyMember[]
  tasks: TaskItem[]
  rewards: RewardItem[]
  rewardRedemptions: RewardRedemptionRecord[]
  notifications: NotificationItem[]
}
