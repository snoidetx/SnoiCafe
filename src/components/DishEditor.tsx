import { useEffect, useState, type FormEvent } from 'react'
import { Archive, Camera, Check, ImagePlus } from 'lucide-react'
import { errorKey, useI18n } from '../i18n'
import type { Dish, KitchenData, Repository } from '../types'
import {
  localized,
  optionsText,
  orderedCategories,
  parseOptions,
  preparePhoto,
} from '../lib/domain'
import { DishPhoto, Field, FormError, Modal } from './Shared'
export function DishEditor({
  dish,
  data,
  repository,
  onClose,
  onSaved,
}: {
  dish?: Dish
  data: KitchenData
  repository: Repository
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t, language } = useI18n(),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    let newPhoto = ''
    try {
      const name = String(form.get('name') || '').trim()
      if (!name) throw new Error('emptyName')
      const options = parseOptions(String(form.get('options') || ''))
      if (!file && !dish?.photo_path) throw new Error('photoRequired')
      if (file) newPhoto = await repository.upload(data.kitchen.id, await preparePhoto(file))
      await repository.saveDish({
        id: dish?.id || crypto.randomUUID(),
        kitchen_id: data.kitchen.id,
        name,
        name_zh: String(form.get('name_zh') || '').trim(),
        description: String(form.get('description') || '').trim(),
        description_zh: String(form.get('description_zh') || '').trim(),
        category_id: String(form.get('category_id') || '') || null,
        price: Number(form.get('price') || 0),
        photo_path: newPhoto || dish!.photo_path,
        options,
        available: form.get('available') === 'on',
        archived: false,
      })
      // The record is saved before retiring its previous photo. Failure only leaves an orphan.
      const retired = dish?.photo_path
      newPhoto = ''
      if (file && retired && !retired.startsWith('demo:'))
        await repository.removePhoto(retired).catch(() => {})
      await onSaved()
      onClose()
    } catch (e) {
      if (newPhoto) await repository.removePhoto(newPhoto).catch(() => {})
      setError(t(errorKey(e)))
    } finally {
      setBusy(false)
    }
  }
  async function archive() {
    if (!dish || !confirm(t('archiveConfirm'))) return
    setBusy(true)
    try {
      await repository.saveDish({ ...dish, archived: true, available: false })
      await onSaved()
      onClose()
    } catch (e) {
      setError(t(errorKey(e)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={dish ? t('edit') + ' · ' + localized(dish, language) : t('addDish')}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form onSubmit={save}>
        <label className="photo-picker">
          {preview ? (
            <img src={preview} alt={t('photo')} />
          ) : dish ? (
            <DishPhoto path={dish.photo_path} name={dish.name} repository={repository} />
          ) : (
            <span className="upload-placeholder">
              <Camera size={34} />
            </span>
          )}
          <span>
            <ImagePlus size={18} />
            {dish || file ? t('replacePhoto') : t('choosePhoto')}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        <p className="field-help">{t('photoHelp')}</p>
        <Field label={t('dishName')}>
          <input name="name" required maxLength={100} defaultValue={dish?.name} />
        </Field>
        <Field label={t('chineseName')}>
          <input name="name_zh" maxLength={100} defaultValue={dish?.name_zh} />
        </Field>
        <Field label={t('description')}>
          <textarea name="description" rows={2} maxLength={1000} defaultValue={dish?.description} />
        </Field>
        <Field label={t('chineseDescription')}>
          <textarea
            name="description_zh"
            rows={2}
            maxLength={1000}
            defaultValue={dish?.description_zh}
          />
        </Field>
        <div className="form-columns">
          <Field label={t('category')}>
            <select name="category_id" defaultValue={dish?.category_id || ''}>
              <option value="">{t('uncategorized')}</option>
              {orderedCategories(data.categories).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {localized(c, language)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('price')}>
            <input
              name="price"
              type="number"
              min="0"
              max="999999"
              step="0.01"
              defaultValue={dish?.price || 0}
              required
            />
          </Field>
        </div>
        <Field label={t('optionalFields')} hint={t('optionsHelp')}>
          <textarea name="options" rows={3} defaultValue={optionsText(dish?.options || [])} />
        </Field>
        <label className="checkbox-line">
          <input type="checkbox" name="available" defaultChecked={dish?.available ?? true} />
          {t('available')}
        </label>
        <FormError message={error} />
        <button className="primary-button full" disabled={busy}>
          <Check size={18} />
          {busy ? t('saving') : t('save')}
        </button>
        {dish && (
          <button
            type="button"
            className="danger-button full"
            onClick={() => void archive()}
            disabled={busy}
          >
            <Archive size={16} />
            {t('archive')}
          </button>
        )}
      </form>
    </Modal>
  )
}
