import { useState } from 'react'
import { Check, Clock3, Heart, RotateCcw, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { localized } from '../lib/domain'
import type { FoodRequest, Status } from '../types'
import { Empty } from './Shared'
export function Requests({
  requests,
  history,
  chef,
  userId,
  onStatus,
  onBrowse,
  disabled,
}: {
  requests: FoodRequest[]
  history: boolean
  chef: boolean
  userId: string
  onStatus: (id: string, status: Status) => Promise<void>
  onBrowse: () => void
  disabled: boolean
}) {
  const { t, language } = useI18n(),
    [filter, setFilter] = useState<'all' | 'completed' | 'cancelled'>('all'),
    [busy, setBusy] = useState('')
  const items = requests.filter((r) =>
    history
      ? r.status !== 'pending' && (filter === 'all' || filter === r.status)
      : r.status === 'pending',
  )
  async function status(r: FoodRequest, next: Status) {
    if (next === 'cancelled' && !window.confirm(t('cancelConfirm'))) return
    setBusy(r.id)
    try {
      await onStatus(r.id, next)
    } finally {
      setBusy('')
    }
  }
  return (
    <section className="requests-page">
      <div className="page-title">
        <div className="page-icon">{history ? <Clock3 /> : <Heart />}</div>
        <h2>{t(history ? 'history' : 'wishlist')}</h2>
        <p>{history ? t('latestHistory') : t('requestCount', { n: items.length })}</p>
      </div>
      {history && (
        <div className="filter-pills">
          {(['all', 'completed', 'cancelled'] as const).map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              className={filter === f ? 'selected' : ''}
              onClick={() => setFilter(f)}
            >
              {t(f === 'all' ? 'showAll' : f)}
            </button>
          ))}
        </div>
      )}
      {!items.length ? (
        <Empty
          icon={history ? <Clock3 size={30} /> : <Heart size={30} />}
          title={t(history ? 'noHistory' : 'noWishlist')}
          body={t(history ? 'noHistoryBody' : 'noWishlistBody')}
          action={
            <button className="primary-button" onClick={onBrowse}>
              {t('browse')}
            </button>
          }
        />
      ) : (
        <div className="requests-list">
          {items.map((r) => (
            <article className="request-card" key={r.id}>
              <div className="request-top">
                <span className="request-kind">
                  {r.dish_id ? t('menuOrder') : '✨ ' + t('customWish')}
                </span>
                <span className={`status-label ${r.status}`}>{t(r.status)}</span>
              </div>
              <h3>
                {localized(r, language)} <small>× {r.quantity}</small>
              </h3>
              <p className="request-owner">{t('by', { name: r.customer_name })}</p>
              {Object.keys(r.selected_options).length > 0 && (
                <div className="request-options">
                  {Object.entries(r.selected_options).map(([key, value]) => (
                    <span key={key}>
                      {key}: {value}
                    </span>
                  ))}
                </div>
              )}
              {r.notes && <p className="request-note">“{r.notes}”</p>}
              <div className="request-footer">
                <time dateTime={r.created_at}>
                  {new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(r.created_at))}
                </time>
                <div>
                  {r.status === 'pending' && (chef || r.created_by === userId) && (
                    <button
                      className="text-button muted"
                      onClick={() => void status(r, 'cancelled')}
                      disabled={disabled || !!busy}
                    >
                      <X size={14} />
                      {t('cancelRequest')}
                    </button>
                  )}
                  {chef && (r.status === 'pending' || r.status === 'completed') && (
                    <button
                      className={r.status === 'pending' ? 'small-button filled' : 'text-button'}
                      onClick={() =>
                        void status(r, r.status === 'pending' ? 'completed' : 'pending')
                      }
                      disabled={disabled || !!busy}
                    >
                      {r.status === 'pending' ? <Check size={16} /> : <RotateCcw size={14} />}{' '}
                      {t(r.status === 'pending' ? 'complete' : 'undo')}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
