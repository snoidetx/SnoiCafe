import { useRef, useState, type FormEvent } from 'react'
import { Heart, Plus } from 'lucide-react'
import type { Dish, Repository } from '../types'
import { errorKey, useI18n } from '../i18n'
import { localized } from '../lib/domain'
import { DishPhoto, Field, FormError, Modal, Stepper } from './Shared'
export function OrderDialog({
  dish,
  kitchenId,
  repository,
  onClose,
  onSaved,
}: {
  dish: Dish | null
  kitchenId: string
  repository: Repository
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t, language } = useI18n(),
    [quantity, setQuantity] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const clientId = useRef(crypto.randomUUID()),
    submitted = useRef(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitted.current) return
    submitted.current = true
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      const selected_options = Object.fromEntries(
        (dish?.options || []).map((o, i) => [o.name, String(form.get(`option-${i}`) || '')]),
      )
      const name = dish?.name || String(form.get('name') || '').trim()
      if (!name) throw new Error('emptyName')
      await repository.order({
        kitchen_id: kitchenId,
        dish_id: dish?.id || null,
        name,
        quantity,
        notes: String(form.get('notes') || '').trim(),
        selected_options,
        client_id: clientId.current,
      })
      await onSaved()
      onClose()
    } catch (e) {
      setError(t(errorKey(e)))
      submitted.current = false
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={dish ? localized(dish, language) : t('wishName')}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form onSubmit={submit}>
        {dish ? (
          <div className="order-summary">
            <DishPhoto
              path={dish.photo_path}
              name={localized(dish, language)}
              repository={repository}
            />
            <div>
              <span className="soft-label">{t('menuOrder')}</span>
              <strong>
                {Number(dish.price).toFixed(2)} <small>{t('coins')}</small>
              </strong>
            </div>
          </div>
        ) : (
          <Field label={t('wishName')}>
            <input name="name" autoFocus required maxLength={100} placeholder={t('wishHint')} />
          </Field>
        )}
        {dish?.options.map((option, index) => (
          <fieldset className="option-group" key={option.name}>
            <legend>{option.name}</legend>
            <div>
              {option.values.map((value, i) => (
                <label className="option-choice" key={value}>
                  <input
                    type="radio"
                    name={`option-${index}`}
                    value={value}
                    defaultChecked={i === 0}
                    required
                  />
                  {value}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="quantity-line">
          <span>{t('servings')}</span>
          <Stepper value={quantity} onChange={setQuantity} />
        </div>
        <Field label={t('note')}>
          <textarea name="notes" maxLength={500} placeholder={t('noteHint')} rows={3} />
        </Field>
        <FormError message={error} />
        <button className="primary-button full" disabled={busy}>
          {dish ? <Plus size={19} /> : <Heart size={19} />} {busy ? t('saving') : t('addWishlist')}
          {dish && <span className="order-total">{(dish.price * quantity).toFixed(2)}</span>}
        </button>
      </form>
    </Modal>
  )
}
