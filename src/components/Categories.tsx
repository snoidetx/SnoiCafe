import { useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Category, Repository } from '../types'
import { useI18n, errorKey } from '../i18n'
import { localized, orderedCategories } from '../lib/domain'
import { Field, FormError, Modal } from './Shared'
export function Categories({
  categories,
  kitchenId,
  repository,
  onClose,
  onSaved,
}: {
  categories: Category[]
  kitchenId: string
  repository: Repository
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t, language } = useI18n(),
    [editing, setEditing] = useState<Category | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [formKey, setFormKey] = useState(0)
  const sorted = orderedCategories(categories)
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
      await onSaved()
      setEditing(null)
      setFormKey((k) => k + 1)
    } catch (e) {
      setError(t(errorKey(e)))
    } finally {
      setBusy(false)
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const values = new FormData(e.currentTarget)
    void run(async () => {
      const name = String(values.get('name') || '').trim()
      if (!name) throw new Error('emptyName')
      await repository.saveCategory({
        id: editing?.id || crypto.randomUUID(),
        kitchen_id: kitchenId,
        name,
        name_zh: String(values.get('name_zh') || '').trim(),
        emoji: String(values.get('emoji') || '🍽️'),
        position: editing?.position ?? (sorted.at(-1)?.position ?? -1) + 1,
      })
    })
  }
  function move(index: number, delta: number) {
    const next = [...sorted]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    void run(async () => {
      for (let i = 0; i < next.length; i++)
        await repository.saveCategory({ ...next[i], position: i })
    })
  }
  return (
    <Modal
      title={t('categories')}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="category-editor-list">
        {sorted.map((c, i) => (
          <div className="category-editor-row" key={c.id}>
            <span>
              {c.emoji} {localized(c, language)}
            </span>
            <div>
              <button
                type="button"
                className="icon-button subtle"
                onClick={() => move(i, -1)}
                disabled={busy || i === 0}
                aria-label={`${t('up')} ${localized(c, language)}`}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                className="icon-button subtle"
                onClick={() => move(i, 1)}
                disabled={busy || i === sorted.length - 1}
                aria-label={`${t('down')} ${localized(c, language)}`}
              >
                <ArrowDown size={16} />
              </button>
              <button
                type="button"
                className="icon-button subtle"
                disabled={busy}
                onClick={() => {
                  setEditing(c)
                  setFormKey((k) => k + 1)
                }}
                aria-label={`${t('edit')} ${localized(c, language)}`}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className="icon-button danger"
                disabled={busy}
                onClick={() => {
                  if (confirm(t('deleteCategoryConfirm')))
                    void run(() => repository.deleteCategory(c.id))
                }}
                aria-label={`${t('deleteCategory')} ${localized(c, language)}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <form key={formKey} onSubmit={submit} className="settings-section">
        <h3>{editing ? t('edit') : t('addCategory')}</h3>
        <div className="emoji-name">
          <Field label={t('emoji')}>
            <input name="emoji" maxLength={12} defaultValue={editing?.emoji || '🍽️'} required />
          </Field>
          <Field label={t('categoryName')}>
            <input name="name" maxLength={60} required defaultValue={editing?.name} />
          </Field>
        </div>
        <Field label={t('categoryChinese')}>
          <input name="name_zh" maxLength={60} defaultValue={editing?.name_zh} />
        </Field>
        <FormError message={error} />
        <button className="primary-button full" disabled={busy}>
          {editing ? <Check size={17} /> : <Plus size={17} />} {busy ? t('saving') : t('save')}
        </button>
      </form>
    </Modal>
  )
}
