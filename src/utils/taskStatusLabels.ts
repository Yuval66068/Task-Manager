import type { TaskItem } from '../types'

export const taskStatusLabels: Record<string, string> = {
  pending: 'ממתין',
  in_progress: 'בביצוע',
  completed: 'הושלם',
  approved: 'אושר',
  rejected: 'נדחה',
  overdue: 'באיחור',
}

export const getTaskStatusLabel = (status: TaskItem['status'] | 'in_progress' | string) =>
  taskStatusLabels[status] ?? 'ממתין'
