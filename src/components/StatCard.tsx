type StatCardProps = {
  label: string
  value: string
  accent?: string
}

export function StatCard({ label, value, accent = 'bg-indigo-100 text-indigo-700' }: StatCardProps) {
  const tone = accent.includes('amber')
    ? 'amber'
    : accent.includes('emerald')
      ? 'emerald'
      : accent.includes('rose')
        ? 'rose'
        : accent.includes('violet')
          ? 'violet'
          : 'indigo'

  const icon = tone === 'amber' ? '✦' : tone === 'emerald' ? '✓' : tone === 'rose' ? '⏰' : tone === 'violet' ? '★' : '◎'

  return (
    <div className="stat-card">
      <div className={`stat-card__visual stat-card__visual--${tone}`} aria-hidden="true">
        <span>{icon}</span>
      </div>
      <div className="stat-card__content">
        <div className={`stat-card__badge ${accent}`}>
          {label}
        </div>
        <p className="stat-card__value">{value}</p>
      </div>
    </div>
  )
}
