import { useEffect, useMemo, useState } from 'react'
import { getSupabaseClient, supabaseConfig } from '../services/supabase'
import { createTaskProofSignedUrl, deleteTaskProof, uploadTaskProof } from '../services/taskProofs'
import {
  buildFallbackMember,
  calculateLevel,
  deriveFamilyGamification,
  type FamilyMemberSeed,
} from '../utils/gamification'
import type {
  FamilyDashboardData,
  FamilyMember,
  NotificationItem,
  NotificationType,
  RewardDraft,
  RewardItem,
  RewardRedemptionRecord,
  RewardRedemptionStatus,
  TaskCompletionRecord,
  TaskCompletionStatus,
  TaskDraft,
  TaskItem,
  TaskPriority,
  TaskRecurrence,
  TaskStatus,
} from '../types'

const initialMemberSeeds = [
  {
    id: 'daniel',
    name: 'דניאל',
    role: 'child',
    xp: 720,
    streak: 5,
    completedTasks: 4,
    totalTasks: 5,
  },
  {
    id: 'noa',
    name: 'נועה',
    role: 'child',
    xp: 540,
    streak: 3,
    completedTasks: 3,
    totalTasks: 4,
  },
  {
    id: 'parent',
    name: 'הורה',
    role: 'parent',
    xp: 1280,
    streak: 7,
    completedTasks: 9,
    totalTasks: 10,
  },
] satisfies Array<Pick<FamilyMember, 'id' | 'name' | 'role' | 'xp' | 'streak' | 'completedTasks' | 'totalTasks'>>

const initialMembers: FamilyMember[] = initialMemberSeeds.map(buildFallbackMember)

type TaskRowRecord = {
  id: string
  title: string
  emoji: string | null
  xp: number | null
  status: string | null
  assigned_to: string
  family_id: string
  due_at: string | null
  priority: string | null
  recurrence: string | null
  requires_photo?: boolean | null
}

type QueryError = {
  code?: string | null
  message: string
}

const updateFallbackMemberXp = (member: FamilyMember, xpDelta: number, completedDelta = 0): FamilyMember => {
  const nextXp = Math.max(0, member.xp + xpDelta)
  const level = calculateLevel(nextXp)
  return {
    ...member,
    xp: nextXp,
    baseXp: nextXp,
    level: level.level,
    xpIntoLevel: level.xpIntoLevel,
    xpToNextLevel: level.xpToNextLevel,
    xpProgress: level.xpProgress,
    completedTasks: Math.max(0, member.completedTasks + completedDelta),
  }
}

const createTempId = (prefix: string) => `${prefix}-${Date.now()}`

const initialTasks: TaskItem[] = [
  {
    id: 'task-1',
    title: 'סידור המיטה',
    emoji: '🛏️',
    xp: 10,
    status: 'approved',
    memberId: 'daniel',
    dueAt: null,
    priority: 'medium',
    recurrence: 'none',
    requiresPhoto: false,
    completionId: null,
    completionStatus: null,
    completionNote: null,
    proofPhotoPath: null,
    proofPhotoUrl: null,
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
  },
  {
    id: 'task-2',
    title: 'סידור החדר',
    emoji: '🧹',
    xp: 20,
    status: 'approved',
    memberId: 'daniel',
    dueAt: null,
    priority: 'medium',
    recurrence: 'none',
    requiresPhoto: false,
    completionId: null,
    completionStatus: null,
    completionNote: null,
    proofPhotoPath: null,
    proofPhotoUrl: null,
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
  },
  {
    id: 'task-3',
    title: 'הכנת ארוחת צהריים',
    emoji: '🍽️',
    xp: 25,
    status: 'pending',
    memberId: 'noa',
    dueAt: null,
    priority: 'medium',
    recurrence: 'none',
    requiresPhoto: false,
    completionId: null,
    completionStatus: null,
    completionNote: null,
    proofPhotoPath: null,
    proofPhotoUrl: null,
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
  },
  {
    id: 'task-4',
    title: 'סידור מגרש',
    emoji: '⚽',
    xp: 30,
    status: 'overdue',
    memberId: 'daniel',
    dueAt: null,
    priority: 'medium',
    recurrence: 'none',
    requiresPhoto: false,
    completionId: null,
    completionStatus: null,
    completionNote: null,
    proofPhotoPath: null,
    proofPhotoUrl: null,
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
  },
  {
    id: 'task-5',
    title: 'מיון כביסה',
    emoji: '🧺',
    xp: 15,
    status: 'completed',
    memberId: 'noa',
    dueAt: null,
    priority: 'medium',
    recurrence: 'none',
    requiresPhoto: false,
    completionId: null,
    completionStatus: null,
    completionNote: null,
    proofPhotoPath: null,
    proofPhotoUrl: null,
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
  },
]

const initialRewards: RewardItem[] = [
  {
    id: 'reward-1',
    familyId: 'demo-family',
    title: 'Extra bedtime story',
    description: 'Choose a longer bedtime story tonight.',
    xpCost: 30,
    isActive: true,
    createdBy: 'parent',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'reward-2',
    familyId: 'demo-family',
    title: 'Movie night pick',
    description: 'Pick the family movie for Friday night.',
    xpCost: 50,
    isActive: true,
    createdBy: 'parent',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

const initialRewardRedemptions: RewardRedemptionRecord[] = [
  {
    id: 'reward-request-1',
    userId: 'daniel',
    rewardId: 'reward-1',
    status: 'approved',
    requestedAt: new Date().toISOString(),
    reviewedBy: 'parent',
    reviewedAt: new Date().toISOString(),
    xpCostSnapshot: 30,
    rewardTitle: initialRewards[0].title,
    rewardDescription: initialRewards[0].description,
    rewardFamilyId: initialRewards[0].familyId,
  },
]

const initialNotifications: NotificationItem[] = [
  {
    id: 'notification-1',
    familyId: 'demo-family',
    recipientId: 'daniel',
    actorId: 'parent',
    type: 'task_assigned',
    message: 'משימה חדשה: סידור המיטה',
    isRead: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    taskId: 'task-1',
    rewardId: null,
  },
  {
    id: 'notification-2',
    familyId: 'demo-family',
    recipientId: 'parent',
    actorId: 'daniel',
    type: 'task_completed',
    message: 'דניאל שלח את "סידור החדר" לאישור',
    isRead: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    taskId: 'task-2',
    rewardId: null,
  },
]

const toTaskStatus = (value: string | null | undefined): TaskStatus => {
  switch (value) {
    case 'approved':
      return 'approved'
    case 'completed':
      return 'completed'
    case 'rejected':
      return 'rejected'
    case 'overdue':
      return 'overdue'
    case 'pending':
    default:
      return 'pending'
  }
}

const toTaskPriority = (value: string | null | undefined): TaskPriority => {
  switch (value) {
    case 'low':
      return 'low'
    case 'high':
      return 'high'
    case 'medium':
    default:
      return 'medium'
  }
}

const toTaskRecurrence = (value: string | null | undefined): TaskRecurrence => {
  switch (value) {
    case 'daily':
      return 'daily'
    case 'weekly':
      return 'weekly'
    case 'monthly':
      return 'monthly'
    case 'none':
    default:
      return 'none'
  }
}

const toTaskCompletionStatus = (value: string | null | undefined): TaskCompletionStatus | null => {
  switch (value) {
    case 'pending':
    case 'submitted':
    case 'approved':
    case 'rejected':
      return value
    default:
      return null
  }
}

const toRewardRedemptionStatus = (value: string | null | undefined): RewardRedemptionStatus => {
  switch (value) {
    case 'approved':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'pending':
    default:
      return 'pending'
  }
}

const toNotificationType = (value: string | null | undefined): NotificationType => {
  switch (value) {
    case 'task_assigned':
    case 'task_completed':
    case 'task_approved':
    case 'task_rejected':
    case 'task_deadline':
    case 'task_overdue':
    case 'reward_requested':
    case 'reward_approved':
    case 'reward_rejected':
    case 'reward_redeemed':
    case 'family_invite':
      return value
    default:
      return 'task_assigned'
  }
}

type NotificationRowRecord = {
  id: string
  family_id: string
  recipient_id: string
  actor_id: string | null
  type: string | null
  message: string
  is_read: boolean | null
  created_at: string
  updated_at: string
  task_id?: string | null
  reward_id?: string | null
}

const mapNotificationRow = (row: NotificationRowRecord): NotificationItem => ({
  id: row.id,
  familyId: row.family_id,
  recipientId: row.recipient_id,
  actorId: row.actor_id,
  type: toNotificationType(row.type),
  message: row.message,
  isRead: Boolean(row.is_read),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  taskId: row.task_id ?? null,
  rewardId: row.reward_id ?? null,
})

const fetchNotifications = async (familyId: string, recipientId: string) => {
  const supabase = getSupabaseClient()
  const selectColumns =
    'id, family_id, recipient_id, actor_id, type, message, is_read, created_at, updated_at, task_id, reward_id'
  const firstResult = await supabase
    .from('notifications')
    .select(selectColumns)
    .eq('family_id', familyId)
    .eq('recipient_id', recipientId)
    .order('created_at', { ascending: false })
    .limit(50)

  let notificationRows: NotificationRowRecord[] | null
  let notificationError: QueryError | null

  if (
    firstResult.error &&
    (firstResult.error.code === '42703' ||
      /column .*task_id|column .*reward_id/i.test(firstResult.error.message))
  ) {
    const fallbackResult = await supabase
      .from('notifications')
      .select('id, family_id, recipient_id, actor_id, type, message, is_read, created_at, updated_at')
      .eq('family_id', familyId)
      .eq('recipient_id', recipientId)
      .order('created_at', { ascending: false })
      .limit(50)

    notificationRows = fallbackResult.data
    notificationError = fallbackResult.error
  } else {
    notificationRows = firstResult.data
    notificationError = firstResult.error
  }

  if (notificationError || !notificationRows) {
    return null
  }

  return notificationRows.map(mapNotificationRow)
}

const mapSupabaseFamily = async (familyId: string, recipientId: string) => {
  const supabase = getSupabaseClient()

  const { data: familyRow, error: familyError } = await supabase
    .from('families')
    .select('id, name')
    .eq('id', familyId)
    .maybeSingle()

  if (familyError || !familyRow) {
    return null
  }

  const { data: familyMembers, error: membersError } = await supabase
    .from('family_members')
    .select('user_id, role')
    .eq('family_id', familyId)

  if (membersError || !familyMembers) {
    return null
  }

  const userIds = familyMembers.map((member) => member.user_id)
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('id', userIds)

  if (profileError || !profiles) {
    return null
  }

  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]))

  const baseMembers: FamilyMemberSeed[] = familyMembers.map((member) => {
    const profile = profileMap.get(member.user_id)
    const completedTasks = 0
    const totalTasks = 0

    return {
      id: member.user_id,
      name: profile?.full_name ?? 'Unknown member',
      role: member.role === 'parent' ? 'parent' : 'child',
      xp: 0,
      streak: 0,
      completedTasks,
      totalTasks,
    }
  })

  const firstTaskRows = await supabase
    .from('tasks')
    .select('id, title, emoji, xp, status, assigned_to, family_id, due_at, priority, recurrence, requires_photo')
    .eq('family_id', familyId)

  let taskRows: TaskRowRecord[] | null
  let tasksError: QueryError | null

  if (
    firstTaskRows.error &&
    (firstTaskRows.error.code === '42703' || /column .*requires_photo/i.test(firstTaskRows.error.message))
  ) {
    const fallbackTaskRows = await supabase
      .from('tasks')
      .select('id, title, emoji, xp, status, assigned_to, family_id, due_at, priority, recurrence')
      .eq('family_id', familyId)

    taskRows = fallbackTaskRows.data
    tasksError = fallbackTaskRows.error
  } else {
    taskRows = firstTaskRows.data
    tasksError = firstTaskRows.error
  }

  if (tasksError || !taskRows) {
    return null
  }

  const taskIds = taskRows.map((task) => task.id)
  const { data: completionRows, error: completionsError } = taskIds.length
    ? await supabase
        .from('task_completions')
        .select('id, task_id, child_id, status, completion_note, proof_photo_url, submitted_at, reviewed_by, reviewed_at')
        .in('task_id', taskIds)
    : { data: [], error: null }

  if (completionsError) {
    return null
  }

  const { data: rewardRows, error: rewardError } = await supabase
    .from('rewards')
    .select('id, family_id, title, description, xp_cost, is_active, created_by, created_at, updated_at')
    .eq('family_id', familyId)

  if (rewardError || !rewardRows) {
    return null
  }

  const rewardIds = rewardRows.map((reward) => reward.id)
  const { data: rewardRedemptionRows, error: rewardRedemptionError } = rewardIds.length
    ? await supabase
        .from('user_rewards')
        .select('id, user_id, reward_id, status, requested_at, reviewed_by, reviewed_at, xp_cost_snapshot')
        .in('reward_id', rewardIds)
    : { data: [], error: null }

  if (rewardRedemptionError) {
    return null
  }

  const completionEntries = await Promise.all(
    (completionRows ?? []).map(async (completion) => {
      let proofPhotoUrl: string | null = null

      if (completion.proof_photo_url) {
        try {
          proofPhotoUrl = await createTaskProofSignedUrl(completion.proof_photo_url)
        } catch (error) {
          console.error('Failed to create signed proof URL:', error)
        }
      }

      return [
        completion.task_id,
        {
          id: completion.id,
          taskId: completion.task_id,
          childId: completion.child_id,
          status: toTaskCompletionStatus(completion.status) ?? 'pending',
          completionNote: completion.completion_note ?? null,
          proofPhotoPath: completion.proof_photo_url ?? null,
          proofPhotoUrl,
          submittedAt: completion.submitted_at ?? null,
          reviewedBy: completion.reviewed_by ?? null,
          reviewedAt: completion.reviewed_at ?? null,
        } satisfies TaskCompletionRecord,
      ] as const
    }),
  )

  const completionMap = new Map(completionEntries)
  const rewards: RewardItem[] = rewardRows.map((reward) => ({
    id: reward.id,
    familyId: reward.family_id,
    title: reward.title,
    description: reward.description ?? null,
    xpCost: reward.xp_cost ?? 0,
    isActive: Boolean(reward.is_active),
    createdBy: reward.created_by,
    createdAt: reward.created_at,
    updatedAt: reward.updated_at,
  }))
  const rewardMap = new Map(rewards.map((reward) => [reward.id, reward]))
  const rewardRedemptions: RewardRedemptionRecord[] = (rewardRedemptionRows ?? [])
    .map((redemption) => {
      const reward = rewardMap.get(redemption.reward_id)

      return {
        id: redemption.id,
        userId: redemption.user_id,
        rewardId: redemption.reward_id,
        status: toRewardRedemptionStatus(redemption.status),
        requestedAt: redemption.requested_at,
        reviewedBy: redemption.reviewed_by ?? null,
        reviewedAt: redemption.reviewed_at ?? null,
        xpCostSnapshot: redemption.xp_cost_snapshot ?? reward?.xpCost ?? 0,
        rewardTitle: reward?.title ?? 'פרס שנמחק',
        rewardDescription: reward?.description ?? null,
        rewardFamilyId: reward?.familyId ?? familyId,
      } satisfies RewardRedemptionRecord
    })
    .filter((value): value is RewardRedemptionRecord => Boolean(value))
  const notifications = await fetchNotifications(familyId, recipientId)

  if (!notifications) {
    return null
  }

  const tasks: TaskItem[] = taskRows.map((task) => {
    const completion = completionMap.get(task.id)

    return {
      id: task.id,
      title: task.title,
      emoji: task.emoji || '✅',
      xp: task.xp ?? 0,
      status: toTaskStatus(task.status),
      memberId: task.assigned_to,
      dueAt: task.due_at ?? null,
      priority: toTaskPriority(task.priority),
      recurrence: toTaskRecurrence(task.recurrence),
      requiresPhoto: Boolean(task.requires_photo),
      completionId: completion?.id ?? null,
      completionStatus: completion?.status ?? null,
      completionNote: completion?.completionNote ?? null,
      proofPhotoPath: completion?.proofPhotoPath ?? null,
      proofPhotoUrl: completion?.proofPhotoUrl ?? null,
      submittedAt: completion?.submittedAt ?? null,
      reviewedBy: completion?.reviewedBy ?? null,
      reviewedAt: completion?.reviewedAt ?? null,
    }
  })

  const members = deriveFamilyGamification(baseMembers, tasks, rewardRedemptions)

  return {
    familyName: familyRow.name,
    members,
    tasks,
    rewards,
    rewardRedemptions,
    notifications,
  }
}

export function useFamilyTasks() {
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [rewards, setRewards] = useState<RewardItem[]>([])
  const [rewardRedemptions, setRewardRedemptions] = useState<RewardRedemptionRecord[]>([])
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [familyName, setFamilyName] = useState('')
  const [currentUserName, setCurrentUserName] = useState('')
  const [activeFamilyId, setActiveFamilyId] = useState<string | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<'parent' | 'child' | null>(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    let isMounted = true

    const applyDemoFallback = () => {
      if (!isMounted) {
        return
      }

      setCurrentUserRole(null)
      setMembers(initialMembers)
      setTasks(initialTasks)
      setRewards(initialRewards)
      setRewardRedemptions(initialRewardRedemptions)
      setNotifications(initialNotifications)
      setFamilyName('משפחת כהן')
    }

    const loadFromSupabase = async (sessionValue?: { user: { id: string } } | null) => {
      const supabase = getSupabaseClient()

      if (!supabaseConfig.isConfigured) {
        if (isMounted) {
          setAuthReady(true)
          applyDemoFallback()
        }
        return
      }

      const session = sessionValue ?? (await supabase.auth.getSession()).data.session

      if (!session) {
        if (isMounted) {
          setAuthReady(true)
          applyDemoFallback()
        }
        return
      }

      const { data: currentProfile, error: currentProfileError } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', session.user.id)
        .maybeSingle()

      if (isMounted) {
        setCurrentUserName(currentProfileError || !currentProfile ? '' : (currentProfile.full_name ?? '').trim())
      }

      const { data: memberships, error: membershipsError } = await supabase
        .from('family_members')
        .select('family_id, role')
        .eq('user_id', session.user.id)
        .order('joined_at', { ascending: true })

      const membershipRole = memberships?.[0]?.role
      const nextRole = membershipRole === 'parent' ? 'parent' : membershipRole === 'child' ? 'child' : null

      if (isMounted) {
        setCurrentUserRole(nextRole)
      }

      if (membershipsError || !memberships || memberships.length === 0) {
        if (isMounted) {
          setAuthReady(true)
          setCurrentUserRole(null)
          setMembers([])
          setTasks([])
          setRewards([])
          setRewardRedemptions([])
          setNotifications([])
          setFamilyName('')
          setActiveFamilyId(null)
        }
        return
      }

      const firstFamilyId = memberships[0].family_id
      const resolved = await mapSupabaseFamily(firstFamilyId, session.user.id)

      if (isMounted) {
        setAuthReady(true)

        if (resolved) {
          setActiveFamilyId(firstFamilyId)
          setFamilyName(resolved.familyName)
          setMembers(resolved.members)
          setTasks(resolved.tasks)
          setRewards(resolved.rewards)
          setRewardRedemptions(resolved.rewardRedemptions)
          setNotifications(resolved.notifications)
        } else {
          setMembers([])
          setTasks([])
          setRewards([])
          setRewardRedemptions([])
          setNotifications([])
          setFamilyName('')
          setActiveFamilyId(null)
        }
      }
    }

    const resolveAuthState = async () => {
      const supabase = getSupabaseClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!isMounted) {
        return
      }

      if (!session) {
        setAuthReady(true)
        applyDemoFallback()
        return
      }

      await loadFromSupabase(session)
    }

    void resolveAuthState()

    const {
      data: { subscription },
    } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
      if (!isMounted) {
        return
      }

      if (!session) {
        setAuthReady(true)
        applyDemoFallback()
        return
      }

      void loadFromSupabase(session)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      return
    }

    queueMicrotask(() => {
      setMembers((currentMembers) => deriveFamilyGamification(currentMembers, tasks, rewardRedemptions))
    })
  }, [tasks, rewardRedemptions, activeFamilyId])

  const totalXp = useMemo(() => members.reduce((sum, member) => sum + member.xp, 0), [members])
  const completionRate = useMemo(() => {
    const totalCompleted = members.reduce((sum, member) => sum + member.completedTasks, 0)
    const totalPlanned = members.reduce((sum, member) => sum + member.totalTasks, 0)
    if (totalPlanned === 0) {
      return 0
    }
    return Math.round((totalCompleted / totalPlanned) * 100)
  }, [members])

  const addTask = async (draft: TaskDraft) => {
    const trimmedTitle = draft.title.trim() || 'משימה חדשה'
    const normalizedPriority = toTaskPriority(draft.priority)
    const normalizedRecurrence = toTaskRecurrence(draft.recurrence)
    const dueAt = draft.dueAt && draft.dueAt.trim() ? draft.dueAt : null
    const requiresPhoto = Boolean(draft.requiresPhoto)
    const newTask: TaskItem = {
      id: createTempId('task'),
      title: trimmedTitle,
      emoji: draft.emoji || '✅',
      xp: Number.isFinite(draft.xp) ? Math.max(0, draft.xp) : 10,
      status: 'pending',
      memberId: draft.assignedTo,
      dueAt,
      priority: normalizedPriority,
      recurrence: normalizedRecurrence,
      requiresPhoto,
      completionId: null,
      completionStatus: null,
      completionNote: null,
      proofPhotoPath: null,
      proofPhotoUrl: null,
      submittedAt: null,
      reviewedBy: null,
      reviewedAt: null,
    }

    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      setTasks((current) => [newTask, ...current])
      return
    }

    const supabase = getSupabaseClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setTasks((current) => [newTask, ...current])
      return
    }

    const buildInsertPayload = (withMetadata: boolean) => ({
      family_id: activeFamilyId,
      title: trimmedTitle,
      emoji: newTask.emoji,
      xp: newTask.xp,
      assigned_to: draft.assignedTo,
      created_by: session.user.id,
      status: 'pending',
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      requires_photo: requiresPhoto,
      ...(withMetadata
        ? {
            priority: normalizedPriority,
            recurrence: normalizedRecurrence,
          }
        : {}),
    })

    const firstResult = await supabase
      .from('tasks')
      .insert(buildInsertPayload(true))
      .select('id, title, emoji, xp, status, assigned_to, family_id, due_at, priority, recurrence, requires_photo')

    let resultData: TaskRowRecord[] | null
    let resultError: QueryError | null

    if (
      firstResult.error &&
      (firstResult.error.code === '42703' ||
        /column .*priority|column .*recurrence|column .*requires_photo/i.test(firstResult.error.message))
    ) {
      const fallbackResult = await supabase
        .from('tasks')
        .insert(buildInsertPayload(false))
        .select('id, title, emoji, xp, status, assigned_to, family_id, due_at, priority, recurrence')

      resultData = fallbackResult.data
      resultError = fallbackResult.error
    } else {
      resultData = firstResult.data
      resultError = firstResult.error
    }

    if (resultError) {
      console.error('Failed to create task:', {
        error: resultError,
        familyId: activeFamilyId,
        draft,
      })
      return
    }

    const serverTask = resultData?.[0]
    if (!serverTask) {
      setTasks((current) => [newTask, ...current])
      await refreshNotifications()
      return
    }

    const nextTask: TaskItem = {
      id: serverTask.id,
      title: serverTask.title,
      emoji: serverTask.emoji || '✅',
      xp: serverTask.xp ?? 0,
      status: toTaskStatus(serverTask.status),
      memberId: serverTask.assigned_to,
      dueAt: serverTask.due_at ?? null,
      priority: toTaskPriority(serverTask.priority),
      recurrence: toTaskRecurrence(serverTask.recurrence),
      requiresPhoto: Boolean(serverTask.requires_photo),
      completionId: null,
      completionStatus: null,
      completionNote: null,
      proofPhotoPath: null,
      proofPhotoUrl: null,
      submittedAt: null,
      reviewedBy: null,
      reviewedAt: null,
    }

    setTasks((current) => [nextTask, ...current])
    await refreshNotifications()
  }

  const updateTaskStatus = async (taskId: string, status: TaskStatus) => {
    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      setTasks((current) =>
        current.map((task) => {
          if (task.id !== taskId) {
            return task
          }

          const previousStatus = task.status
          const memberId = task.memberId

          if (previousStatus !== 'approved' && status === 'approved') {
            setMembers((currentMembers) =>
              currentMembers.map((member) =>
                member.id === memberId ? updateFallbackMemberXp(member, task.xp, 1) : member,
              ),
            )
          }

          return { ...task, status }
        }),
      )
      return
    }

    const supabase = getSupabaseClient()
    const { error } = await supabase
      .from('tasks')
      .update({ status })
      .eq('id', taskId)
      .eq('family_id', activeFamilyId)

    if (!error) {
      setTasks((current) =>
        current.map((task) => {
          if (task.id !== taskId) {
            return task
          }

          const previousStatus = task.status
          const memberId = task.memberId

          if (previousStatus !== 'approved' && status === 'approved') {
            setMembers((currentMembers) =>
              currentMembers.map((member) =>
                member.id === memberId ? updateFallbackMemberXp(member, task.xp, 1) : member,
              ),
            )
          }

          return { ...task, status }
        }),
      )
    }
  }

  const editTask = async (taskId: string, draft: TaskDraft) => {
    const trimmedTitle = draft.title.trim() || 'משימה חדשה'
    const normalizedPriority = toTaskPriority(draft.priority)
    const normalizedRecurrence = toTaskRecurrence(draft.recurrence)
    const dueAt = draft.dueAt && draft.dueAt.trim() ? draft.dueAt : null
    const requiresPhoto = Boolean(draft.requiresPhoto)
    const nextTask = {
      title: trimmedTitle,
      emoji: draft.emoji || '✅',
      xp: Number.isFinite(draft.xp) ? Math.max(0, draft.xp) : 10,
      assignedTo: draft.assignedTo,
      dueAt,
      priority: normalizedPriority,
      recurrence: normalizedRecurrence,
      requiresPhoto,
    }

    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? {
                ...task,
                title: nextTask.title,
                emoji: nextTask.emoji,
                xp: nextTask.xp,
                memberId: nextTask.assignedTo,
                dueAt: nextTask.dueAt,
                priority: nextTask.priority,
                recurrence: nextTask.recurrence,
                requiresPhoto: nextTask.requiresPhoto,
                completionId: task.completionId,
                completionStatus: task.completionStatus,
                completionNote: task.completionNote,
                proofPhotoPath: task.proofPhotoPath,
                proofPhotoUrl: task.proofPhotoUrl,
                submittedAt: task.submittedAt,
                reviewedBy: task.reviewedBy,
                reviewedAt: task.reviewedAt,
              }
            : task,
        ),
      )
      return
    }

    const supabase = getSupabaseClient()
    const buildUpdatePayload = (withMetadata: boolean) => ({
      title: nextTask.title,
      emoji: nextTask.emoji,
      xp: nextTask.xp,
      assigned_to: nextTask.assignedTo,
      due_at: nextTask.dueAt ? new Date(nextTask.dueAt).toISOString() : null,
      requires_photo: nextTask.requiresPhoto,
      ...(withMetadata
        ? {
            priority: nextTask.priority,
            recurrence: nextTask.recurrence,
          }
        : {}),
    })

    const firstResult = await supabase
      .from('tasks')
      .update(buildUpdatePayload(true))
      .eq('id', taskId)
      .eq('family_id', activeFamilyId)
      .select('id, title, emoji, xp, status, assigned_to, family_id, due_at, priority, recurrence, requires_photo')

    let resultData: TaskRowRecord[] | null
    let resultError: QueryError | null

    if (
      firstResult.error &&
      (firstResult.error.code === '42703' ||
        /column .*priority|column .*recurrence|column .*requires_photo/i.test(firstResult.error.message))
    ) {
      const fallbackResult = await supabase
        .from('tasks')
        .update(buildUpdatePayload(false))
        .eq('id', taskId)
        .eq('family_id', activeFamilyId)
        .select('id, title, emoji, xp, status, assigned_to, family_id, due_at, priority, recurrence')

      resultData = fallbackResult.data
      resultError = fallbackResult.error
    } else {
      resultData = firstResult.data
      resultError = firstResult.error
    }

    if (!resultError) {
      const updatedTask = resultData?.[0]
      setTasks((current) =>
        current.map((task) => {
          if (task.id !== taskId) {
            return task
          }

          if (!updatedTask) {
            return {
              ...task,
              title: nextTask.title,
              emoji: nextTask.emoji,
              xp: nextTask.xp,
              memberId: nextTask.assignedTo,
              dueAt: nextTask.dueAt,
              priority: nextTask.priority,
              recurrence: nextTask.recurrence,
              requiresPhoto: nextTask.requiresPhoto,
              completionId: task.completionId,
              completionStatus: task.completionStatus,
              completionNote: task.completionNote,
              proofPhotoPath: task.proofPhotoPath,
              proofPhotoUrl: task.proofPhotoUrl,
              submittedAt: task.submittedAt,
              reviewedBy: task.reviewedBy,
              reviewedAt: task.reviewedAt,
            }
          }

          return {
            ...task,
            title: updatedTask.title,
            emoji: updatedTask.emoji || '✅',
            xp: updatedTask.xp ?? task.xp,
            memberId: updatedTask.assigned_to,
            dueAt: updatedTask.due_at ?? null,
            priority: toTaskPriority(updatedTask.priority),
            recurrence: toTaskRecurrence(updatedTask.recurrence),
            requiresPhoto: Boolean(updatedTask.requires_photo),
            completionId: task.completionId,
            completionStatus: task.completionStatus,
            completionNote: task.completionNote,
            proofPhotoPath: task.proofPhotoPath,
            proofPhotoUrl: task.proofPhotoUrl,
            submittedAt: task.submittedAt,
            reviewedBy: task.reviewedBy,
            reviewedAt: task.reviewedAt,
          }
        }),
      )
      await refreshNotifications()
    }
  }

  const deleteTask = async (taskId: string) => {
    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      setTasks((current) => current.filter((task) => task.id !== taskId))
      return
    }

    const supabase = getSupabaseClient()
    const { error } = await supabase.from('tasks').delete().eq('id', taskId).eq('family_id', activeFamilyId)

    if (!error) {
      setTasks((current) => current.filter((task) => task.id !== taskId))
    }
  }

  const submitTaskCompletion = async (taskId: string, proofFile?: File) => {
    const nextCompletionId = `${taskId}-completion`
    const task = tasks.find((item) => item.id === taskId)

    if (!task) {
      return
    }

    if (task.requiresPhoto && !proofFile) {
      console.error('Task requires a photo proof before completion can be submitted.')
      return
    }

    const nextSubmittedAt = new Date().toISOString()
    const nextCompletionStatus: TaskCompletionStatus = 'submitted'

    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? {
                ...task,
                completionId: nextCompletionId,
                completionStatus: nextCompletionStatus,
                completionNote: null,
                proofPhotoPath: null,
                proofPhotoUrl: null,
                submittedAt: nextSubmittedAt,
                reviewedBy: null,
                reviewedAt: null,
              }
            : task,
        ),
      )
      return
    }

    const supabase = getSupabaseClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? {
                ...task,
                completionId: nextCompletionId,
                completionStatus: nextCompletionStatus,
                completionNote: null,
                proofPhotoPath: null,
                proofPhotoUrl: null,
                submittedAt: nextSubmittedAt,
                reviewedBy: null,
                reviewedAt: null,
              }
            : task,
        ),
      )
      return
    }

    let proofPhotoPath = null
    let proofPhotoUrl = null

    if (proofFile && task.requiresPhoto) {
      let uploadedProofPath: string | null = null
      try {
        uploadedProofPath = await uploadTaskProof(activeFamilyId, taskId, session.user.id, nextCompletionId, proofFile)
        proofPhotoUrl = await createTaskProofSignedUrl(uploadedProofPath)
        proofPhotoPath = uploadedProofPath
        if (task.proofPhotoPath && task.proofPhotoPath !== uploadedProofPath) {
          try {
            await deleteTaskProof(task.proofPhotoPath)
          } catch (deleteError) {
            console.error('Failed to clear previous proof before resubmission:', deleteError)
          }
        }
      } catch (error) {
        if (uploadedProofPath) {
          try {
            await deleteTaskProof(uploadedProofPath)
          } catch (deleteError) {
            console.error('Failed to clear uploaded proof after error:', deleteError)
          }
        }
        console.error('Failed to upload proof image:', error)
        return
      }
    }

    const payload = {
      task_id: taskId,
      child_id: session.user.id,
      status: nextCompletionStatus,
      completion_note: null,
      submitted_at: nextSubmittedAt,
      reviewed_by: null,
      reviewed_at: null,
      proof_photo_url: proofPhotoPath,
    }

    const result = await supabase
      .from('task_completions')
      .upsert(payload, { onConflict: 'task_id,child_id' })
      .select('id, task_id, child_id, status, completion_note, proof_photo_url, submitted_at, reviewed_by, reviewed_at')
      .single()

    if (result.error) {
      if (proofPhotoPath) {
        try {
          await deleteTaskProof(proofPhotoPath)
        } catch (deleteError) {
          console.error('Failed to clear uploaded proof after submit error:', deleteError)
        }
      }
      console.error('Failed to submit task completion:', {
        error: result.error,
        taskId,
        childId: session.user.id,
      })
      return
    }

    const completion = result.data
    setTasks((current) =>
      current.map((item) =>
        item.id === taskId
          ? {
              ...item,
              completionId: completion.id,
              completionStatus: toTaskCompletionStatus(completion.status),
              completionNote: completion.completion_note ?? null,
              proofPhotoPath: completion.proof_photo_url ?? proofPhotoPath,
              proofPhotoUrl: proofPhotoUrl ?? completion.proof_photo_url ?? null,
              submittedAt: completion.submitted_at ?? new Date().toISOString(),
              reviewedBy: completion.reviewed_by ?? null,
              reviewedAt: completion.reviewed_at ?? null,
            }
          : item,
      ),
    )
    await refreshNotifications()
  }

  const reviewTaskCompletion = async (taskId: string, decision: 'approved' | 'rejected', feedback?: string) => {
    const task = tasks.find((item) => item.id === taskId)
    if (!task || !task.completionStatus || task.completionStatus !== 'submitted') {
      return
    }

    const previousStatus = task.status

    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      setTasks((current) =>
        current.map((item) =>
          item.id === taskId
            ? {
                ...item,
                status: decision,
                completionStatus: decision,
                completionNote: feedback?.trim() || item.completionNote,
                reviewedBy: 'local-parent',
                reviewedAt: new Date().toISOString(),
              }
            : item,
        ),
      )

      if (previousStatus !== 'approved' && decision === 'approved') {
        setMembers((currentMembers) =>
          currentMembers.map((member) =>
            member.id === task.memberId ? updateFallbackMemberXp(member, task.xp, 1) : member,
          ),
        )
      }
      return
    }

    const supabase = getSupabaseClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session || !task.completionId) {
      return
    }

    const reviewedAt = new Date().toISOString()
    const { data, error } = await supabase
      .from('task_completions')
      .update({
        status: decision,
        completion_note: feedback?.trim() || task.completionNote || null,
        reviewed_by: session.user.id,
        reviewed_at: reviewedAt,
        proof_photo_url: null,
      })
      .eq('id', task.completionId)
      .select('id, task_id, child_id, status, completion_note, proof_photo_url, submitted_at, reviewed_by, reviewed_at')
      .single()

    if (error) {
      console.error('Failed to review task completion:', {
        error,
        taskId,
        completionId: task.completionId,
        decision,
      })
      return
    }

    if (task.proofPhotoPath) {
      try {
        await deleteTaskProof(task.proofPhotoPath)
      } catch (deleteError) {
        console.error('Failed to delete task proof after review:', {
          error: deleteError,
          taskId,
          proofPhotoPath: task.proofPhotoPath,
        })
      }
    }

    const { error: taskUpdateError } = await supabase
      .from('tasks')
      .update({ status: decision })
      .eq('id', taskId)
      .eq('family_id', activeFamilyId)

    if (taskUpdateError) {
      console.error('Failed to update task status after completion review:', {
        error: taskUpdateError,
        taskId,
        decision,
      })
      return
    }

    const updatedTask: TaskItem = {
      ...task,
      status: decision,
      completionStatus: toTaskCompletionStatus(data.status),
      completionNote: data.completion_note ?? null,
      proofPhotoPath: null,
      proofPhotoUrl: null,
      submittedAt: data.submitted_at ?? task.submittedAt,
      reviewedBy: data.reviewed_by ?? null,
      reviewedAt: data.reviewed_at ?? reviewedAt,
    }

    setTasks((current) =>
      current.map((item) => {
        if (item.id !== taskId) {
          return item
        }

        return updatedTask
      }),
    )

    if (previousStatus !== 'approved' && decision === 'approved') {
      setMembers((currentMembers) =>
        currentMembers.map((member) =>
          member.id === task.memberId ? updateFallbackMemberXp(member, task.xp, 1) : member,
        ),
      )
    }

    await refreshNotifications()
  }

  const addReward = async (draft: RewardDraft) => {
    const title = draft.title.trim() || 'פרס חדש'
    const description = draft.description?.trim() || null
    const xpCost = Number.isFinite(draft.xpCost) ? Math.max(0, draft.xpCost) : 0

    const newReward: RewardItem = {
      id: createTempId('reward'),
      familyId: activeFamilyId ?? 'demo-family',
      title,
      description,
      xpCost,
      isActive: true,
      createdBy: 'local-parent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      setRewards((current) => [newReward, ...current])
      return
    }

    const supabase = getSupabaseClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setRewards((current) => [newReward, ...current])
      return
    }

    const { data, error } = await supabase
      .from('rewards')
      .insert({
        family_id: activeFamilyId,
        title,
        description,
        xp_cost: xpCost,
        is_active: true,
        created_by: session.user.id,
      })
      .select('id, family_id, title, description, xp_cost, is_active, created_by, created_at, updated_at')
      .single()

    if (error || !data) {
      console.error('Failed to create reward:', { error, draft, familyId: activeFamilyId })
      return
    }

    setRewards((current) => [
      {
        id: data.id,
        familyId: data.family_id,
        title: data.title,
        description: data.description ?? null,
        xpCost: data.xp_cost ?? 0,
        isActive: Boolean(data.is_active),
        createdBy: data.created_by,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
      ...current,
    ])
    await refreshNotifications()
  }

  const requestReward = async (rewardId: string) => {
    const reward = rewards.find((item) => item.id === rewardId)
    if (!reward || !reward.isActive) {
      return
    }

    const supabase = getSupabaseClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      const fallbackUserId = members.find((member) => member.role === 'child')?.id ?? 'local-child'
      const pendingExists = rewardRedemptions.some(
        (redemption) => redemption.rewardId === rewardId && redemption.userId === fallbackUserId && redemption.status === 'pending',
      )
      if (pendingExists) {
        return
      }

      setRewardRedemptions((current) => [
        {
          id: `reward-request-${Date.now()}`,
          userId: fallbackUserId,
          rewardId,
          status: 'pending',
          requestedAt: new Date().toISOString(),
          reviewedBy: null,
          reviewedAt: null,
          xpCostSnapshot: reward.xpCost,
          rewardTitle: reward.title,
          rewardDescription: reward.description,
          rewardFamilyId: reward.familyId,
        },
        ...current,
      ])
      await refreshNotifications()
      return
    }

    const pendingExists = rewardRedemptions.some(
      (redemption) => redemption.rewardId === rewardId && redemption.userId === session.user.id && redemption.status === 'pending',
    )
    if (pendingExists) {
      return
    }

    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      setRewardRedemptions((current) => [
        {
          id: `reward-request-${Date.now()}`,
          userId: session.user.id,
          rewardId,
          status: 'pending',
          requestedAt: new Date().toISOString(),
          reviewedBy: null,
          reviewedAt: null,
          xpCostSnapshot: reward.xpCost,
          rewardTitle: reward.title,
          rewardDescription: reward.description,
          rewardFamilyId: reward.familyId,
        },
        ...current,
      ])
      await refreshNotifications()
      return
    }

    const { data, error } = await supabase
      .from('user_rewards')
      .insert({
        user_id: session.user.id,
        reward_id: reward.id,
        status: 'pending',
        requested_at: new Date().toISOString(),
        reviewed_by: null,
        reviewed_at: null,
        xp_cost_snapshot: reward.xpCost,
        redeemed_by: session.user.id,
      })
      .select('id, user_id, reward_id, status, requested_at, reviewed_by, reviewed_at, xp_cost_snapshot')
      .single()

    if (error || !data) {
      console.error('Failed to request reward:', { error, rewardId, familyId: activeFamilyId })
      throw new Error(error?.message || 'Could not request reward.')
    }

    setRewardRedemptions((current) => [
      {
        id: data.id,
        userId: data.user_id,
        rewardId: data.reward_id,
        status: toRewardRedemptionStatus(data.status),
        requestedAt: data.requested_at,
        reviewedBy: data.reviewed_by ?? null,
        reviewedAt: data.reviewed_at ?? null,
        xpCostSnapshot: data.xp_cost_snapshot ?? reward.xpCost,
        rewardTitle: reward.title,
        rewardDescription: reward.description,
        rewardFamilyId: reward.familyId,
      },
      ...current,
    ])
    await refreshNotifications()
  }

  const reviewRewardRedemption = async (redemptionId: string, decision: 'approved' | 'rejected') => {
    const redemption = rewardRedemptions.find((item) => item.id === redemptionId)
    if (!redemption || redemption.status !== 'pending') {
      return
    }

    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      const reviewedAt = new Date().toISOString()
      setRewardRedemptions((current) =>
        current.map((item) =>
          item.id === redemptionId
            ? {
                ...item,
                status: decision,
                reviewedBy: 'local-parent',
                reviewedAt,
              }
            : item,
        ),
      )

      if (decision === 'approved') {
        setMembers((currentMembers) =>
          currentMembers.map((member) =>
            member.id === redemption.userId ? updateFallbackMemberXp(member, -redemption.xpCostSnapshot, 0) : member,
          ),
        )
      }
      return
    }

    const supabase = getSupabaseClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      return
    }

    const reviewedAt = new Date().toISOString()
    const { data, error } = await supabase
      .from('user_rewards')
      .update({
        status: decision,
        reviewed_by: session.user.id,
        reviewed_at: reviewedAt,
      })
      .eq('id', redemptionId)
      .select('id, user_id, reward_id, status, requested_at, reviewed_by, reviewed_at, xp_cost_snapshot')
      .single()

    if (error || !data) {
      console.error('Failed to review reward redemption:', { error, redemptionId, decision })
      throw new Error(error?.message || 'Could not review reward redemption.')
    }

    setRewardRedemptions((current) =>
      current.map((item) =>
        item.id === redemptionId
          ? {
              ...item,
              status: toRewardRedemptionStatus(data.status),
              reviewedBy: data.reviewed_by ?? null,
              reviewedAt: data.reviewed_at ?? reviewedAt,
              xpCostSnapshot: data.xp_cost_snapshot ?? item.xpCostSnapshot,
            }
          : item,
      ),
    )
    await refreshNotifications()
  }

  const refreshNotifications = async () => {
    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      return
    }

    const supabase = getSupabaseClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      return
    }

    const fetchedNotifications = await fetchNotifications(activeFamilyId, session.user.id)
    if (fetchedNotifications) {
      setNotifications(fetchedNotifications)
    }
  }

  const markNotificationRead = async (notificationId: string) => {
    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId ? { ...notification, isRead: true } : notification,
        ),
      )
      return
    }

    const supabase = getSupabaseClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      return
    }

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('family_id', activeFamilyId)
      .eq('recipient_id', session.user.id)

    if (error) {
      console.error('Failed to mark notification as read:', { error, notificationId })
      throw new Error(error.message || 'Could not mark the notification as read.')
    }

    await refreshNotifications()
  }

  const markAllNotificationsRead = async () => {
    if (!supabaseConfig.isConfigured || !activeFamilyId) {
      setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })))
      return
    }

    const supabase = getSupabaseClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      return
    }

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('family_id', activeFamilyId)
      .eq('recipient_id', session.user.id)
      .eq('is_read', false)

    if (error) {
      console.error('Failed to mark all notifications as read:', { error })
      throw new Error(error.message || 'Could not mark notifications as read.')
    }

    await refreshNotifications()
  }

  const dashboard: FamilyDashboardData = {
    familyName,
    taskCount: tasks.length,
    completionRate,
    stats: {
      pendingApproval: tasks.filter((task) => task.completionStatus === 'submitted').length,
      completedToday: tasks.filter((task) => task.status === 'completed' || task.status === 'approved').length,
      overdue: tasks.filter((task) => task.status === 'overdue').length,
      totalXp,
    },
    members,
    tasks,
    rewards,
    rewardRedemptions,
    notifications,
  }

  return {
    ...dashboard,
    currentUserRole,
    currentUserName,
    authReady,
    addTask,
    editTask,
    deleteTask,
    updateTaskStatus,
    submitTaskCompletion,
    reviewTaskCompletion,
    addReward,
    requestReward,
    reviewRewardRedemption,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
  }
}
