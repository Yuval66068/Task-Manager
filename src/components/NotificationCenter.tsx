import { useMemo, useState } from 'react'
import type { NotificationItem } from '../types'

type NotificationCenterProps = {
  notifications: NotificationItem[]
  onMarkRead: (notificationId: string) => void | Promise<void>
  onMarkAllRead: () => void | Promise<void>
}

const typeLabels: Record<NotificationItem['type'], string> = {
  task_assigned: 'משימה חדשה',
  task_completed: 'נשלח לאישור',
  task_approved: 'משימה אושרה',
  task_rejected: 'משימה נדחתה',
  task_deadline: 'מועד מתקרב',
  task_overdue: 'באיחור',
  reward_requested: 'בקשת פרס',
  reward_approved: 'פרס אושר',
  reward_rejected: 'פרס נדחה',
  reward_redeemed: 'פרס נוצל',
  family_invite: 'הזמנה למשפחה',
}

const formatTimestamp = (value: string) =>
  new Date(value).toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

export function NotificationCenter({ notifications, onMarkRead, onMarkAllRead }: NotificationCenterProps) {
  const [actionError, setActionError] = useState('')

  const unreadCount = useMemo(() => notifications.filter((notification) => !notification.isRead).length, [notifications])

  const handleMarkRead = async (notificationId: string) => {
    try {
      setActionError('')
      await onMarkRead(notificationId)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update notifications.')
    }
  }

  const handleMarkAllRead = async () => {
    try {
      setActionError('')
      await onMarkAllRead()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update notifications.')
    }
  }

  return (
    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-black text-slate-900">התראות</h2>
            {unreadCount > 0 && (
              <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-700">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {unreadCount > 0 ? `${unreadCount} התראות עדיין לא נקראו` : 'אין התראות חדשות'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0}
          className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          סמן הכל כנקרא
        </button>
      </div>

      {actionError && (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {actionError}
        </div>
      )}

      {notifications.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">עדיין אין התראות להצגה.</p>
      ) : (
        <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
          {notifications.map((notification) => {
            const unread = !notification.isRead
            return (
              <article
                key={notification.id}
                className={`rounded-2xl border p-3 transition ${
                  unread ? 'border-indigo-200 bg-indigo-50/70' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
                        {typeLabels[notification.type]}
                      </span>
                      {unread && <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" aria-hidden="true" />}
                    </div>
                    <p className="mt-2 text-sm font-medium text-slate-900">{notification.message}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatTimestamp(notification.createdAt)}</p>
                  </div>

                  {unread && (
                    <button
                      type="button"
                      onClick={() => void handleMarkRead(notification.id)}
                      className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      סמן כנקרא
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
