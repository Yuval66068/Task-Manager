import { useState, type FormEvent } from 'react'
import { getSupabaseClient } from '../services/supabase'

type AddChildFormProps = {
  onChildCreated: () => void | Promise<void>
}

const MAX_FULL_NAME_LENGTH = 100
const MAX_USERNAME_LENGTH = 30
const PIN_PATTERN = /^\d{6}$/

/**
 * Compact "הוסף ילד" (add child) action for the parent dashboard. Calls the
 * existing create-child Edge Function using the parent's own Supabase
 * session -- sends only { fullName, childUsername, pin }, never familyId,
 * parent id, role, or synthetic email. The PIN is never persisted anywhere
 * client-side (no localStorage/sessionStorage/URL) and is cleared from
 * state immediately after every submit attempt, success or failure.
 */
export function AddChildForm({ onChildCreated }: AddChildFormProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [childUsername, setChildUsername] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const resetForm = () => {
    setFullName('')
    setChildUsername('')
    setPin('')
    setConfirmPin('')
  }

  const handleClose = () => {
    resetForm()
    setError('')
    setSuccess('')
    setIsOpen(false)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    const trimmedFullName = fullName.trim()
    const trimmedUsername = childUsername.trim()

    if (!trimmedFullName || trimmedFullName.length > MAX_FULL_NAME_LENGTH) {
      setError('יש להזין שם ילד/ה תקין (עד 100 תווים)')
      return
    }

    if (!trimmedUsername || trimmedUsername.length > MAX_USERNAME_LENGTH) {
      setError('יש להזין שם משתמש תקין (עד 30 תווים)')
      return
    }

    if (!PIN_PATTERN.test(pin)) {
      setError('קוד ה-PIN חייב להיות בדיוק 6 ספרות')
      setPin('')
      setConfirmPin('')
      return
    }

    if (pin !== confirmPin) {
      setError('קודי ה-PIN אינם תואמים')
      setPin('')
      setConfirmPin('')
      return
    }

    setIsSubmitting(true)

    try {
      const supabase = getSupabaseClient()
      const { data, error: invokeError } = await supabase.functions.invoke('create-child', {
        body: {
          fullName: trimmedFullName,
          childUsername: trimmedUsername,
          pin,
        },
      })

      // Clear PIN values immediately after the attempt, success or failure.
      setPin('')
      setConfirmPin('')

      if (invokeError) {
        setError('לא ניתן היה ליצור את חשבון הילד/ה. ייתכן ששם המשתמש כבר קיים במשפחה.')
        setIsSubmitting(false)
        return
      }

      if (data?.error) {
        setError(typeof data.error === 'string' ? data.error : 'לא ניתן היה ליצור את חשבון הילד/ה.')
        setIsSubmitting(false)
        return
      }

      setSuccess('חשבון הילד/ה נוצר בהצלחה!')
      resetForm()
      setIsSubmitting(false)
      await onChildCreated()
      setIsOpen(false)
      setSuccess('')
    } catch {
      setPin('')
      setConfirmPin('')
      setError('לא ניתן היה ליצור את חשבון הילד/ה. נסו שוב.')
      setIsSubmitting(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
      >
        + הוסף ילד
      </button>
    )
  }

  return (
    <div className="panel-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-900">הוסף ילד</h3>
        <button type="button" onClick={handleClose} className="text-sm font-semibold text-slate-500 hover:text-slate-700">
          ביטול
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          שם הילד
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={MAX_FULL_NAME_LENGTH}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-600">
          שם משתמש
          <input
            value={childUsername}
            onChange={(event) => setChildUsername(event.target.value)}
            maxLength={MAX_USERNAME_LENGTH}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-600">
          PIN בן 6 ספרות
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-600">
          אימות PIN
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={confirmPin}
            onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-indigo-400 focus:bg-white"
          />
        </label>

        {error && (
          <div className="sm:col-span-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="sm:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="sm:col-span-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'מוסיף ילד...' : 'הוסף ילד'}
        </button>
      </form>
    </div>
  )
}
