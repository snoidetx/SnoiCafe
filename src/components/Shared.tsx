import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ImageOff, Minus, Plus, X, LoaderCircle, ChefHat } from 'lucide-react'
import { useI18n } from '../i18n'
import type { Repository } from '../types'

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId()
  useEffect(() => {
    const node = ref.current
    node?.showModal()
    return () => node?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal-top">
        <h2 id={id}>{title}</h2>
        <CloseButton onClick={onClose} />
      </div>
      {children}
    </dialog>
  )
}
export function CloseButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n()
  return (
    <button className="icon-button subtle" type="button" aria-label={t('close')} onClick={onClick}>
      <X size={20} />
    </button>
  )
}
export function Busy() {
  const { t } = useI18n()
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" />
      {t('loading')}
    </div>
  )
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}
export function FormError({ message }: { message: string }) {
  return message ? (
    <p className="form-error" role="alert">
      {message}
    </p>
  ) : null
}
export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-illustration">{icon || <ChefHat size={34} />}</div>
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action}
    </div>
  )
}
export function Stepper({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <div className="stepper">
      <button
        type="button"
        className="icon-button subtle"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
        aria-label={t('less')}
      >
        <Minus size={17} />
      </button>
      <output>{value}</output>
      <button
        type="button"
        className="icon-button subtle"
        disabled={value >= 20}
        onClick={() => onChange(value + 1)}
        aria-label={t('more')}
      >
        <Plus size={17} />
      </button>
    </div>
  )
}
const foodEmoji: Record<string, string> = {
  pasta: '🍝',
  chicken: '🍗',
  tomato: '🍅',
  noodles: '🍜',
  pancakes: '🥞',
  tea: '🧋',
}
export function DishPhoto({
  path,
  name,
  repository,
}: {
  path: string
  name: string
  repository: Repository
}) {
  const { t } = useI18n(),
    [url, setUrl] = useState(''),
    [failed, setFailed] = useState(false)
  useEffect(() => {
    setUrl('')
    setFailed(false)
    if (path.startsWith('demo:')) return
    let live = true,
      local = ''
    repository
      .photo(path)
      .then((value) => {
        local = value
        if (live) setUrl(value)
        else if (value.startsWith('blob:')) URL.revokeObjectURL(value)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
      if (local.startsWith('blob:')) URL.revokeObjectURL(local)
    }
  }, [path, repository])
  if (path.startsWith('demo:'))
    return (
      <div className={`dish-photo demo-food food-${path.slice(5)}`} role="img" aria-label={name}>
        <span>{foodEmoji[path.slice(5)] || '🍽️'}</span>
      </div>
    )
  return (
    <div className="dish-photo">
      {url && !failed ? (
        <img src={url} alt={name} loading="lazy" onError={() => setFailed(true)} />
      ) : failed ? (
        <ImageOff aria-label={t('photoUnavailable')} />
      ) : (
        <span className="photo-loading" />
      )}
    </div>
  )
}
export function LanguageButton() {
  const { language, setLanguage, t } = useI18n()
  return (
    <button
      type="button"
      className="language-button"
      onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
      aria-label={t('language')}
    >
      {language === 'en' ? '中文' : 'EN'}
    </button>
  )
}
