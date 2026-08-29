type StatCardProps = {
  label: string
  value: string
  accent?: string
}

export function StatCard({ label, value, accent = 'bg-indigo-100 text-indigo-700' }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${accent}`}>
        {label}
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  )
}
