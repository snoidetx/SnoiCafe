import { useEffect, useState, type FormEvent } from 'react'
import { Archive, Camera, Check, ImagePlus } from 'lucide-react'
import { errorKey, useI18n, type TranslationKey } from '../i18n'
import type { Dish, KitchenData, Repository } from '../types'
import {
  localized,
  localizedNames,
  optionsText,
  orderedCategories,
  parseOptions,
} from '../lib/domain'
import { PHOTO_ACCEPT, preparePhoto } from '../lib/photos'
import { DishPhoto, Field, FormError, Modal } from './Shared'
import { BilingualFields } from './BilingualFields'
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
    [photo, setPhoto] = useState<Blob | null>(null),
    [preview, setPreview] = useState(''),
    [processing, setProcessing] = useState(false),
    [photoError, setPhotoError] = useState<TranslationKey | ''>(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!file) return
    let active = true
    let url = ''
    void preparePhoto(file)
      .then((blob) => {
        if (!active) return
        url = URL.createObjectURL(blob)
        setPhoto(blob)
        setPreview(url)
      })
      .catch((e: unknown) => {
        if (active) setPhotoError(errorKey(e))
      })
      .finally(() => {
        if (active) setProcessing(false)
      })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [file])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || processing || (file && !photo)) return
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    let newPhoto = ''
    try {
      const names = localizedNames(form, language)
      const options = parseOptions(String(form.get('options') || ''))
      if (!file && !dish?.photo_path) throw new Error('photoRequired')
      if (photo) newPhoto = await repository.upload(data.kitchen.id, photo)
      await repository.saveDish({
        id: dish?.id || crypto.randomUUID(),
        kitchen_id: data.kitchen.id,
        ...names,
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
            <DishPhoto
              path={dish.photo_path}
              name={localized(dish, language)}
              repository={repository}
            />
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
            accept={PHOTO_ACCEPT}
            aria-label={t('choosePhoto')}
            disabled={busy || processing}
            onChange={(e) => {
              const selected = e.target.files?.[0]
              e.target.value = '' // Allow retrying the same file after an error.
              if (!selected) return
              setPhoto(null)
              setPreview('')
              setPhotoError('')
              setError('')
              setProcessing(true)
              setFile(selected)
            }}
          />
        </label>
        <p className="field-help" role="status" aria-live="polite">
          {t(processing ? 'processingPhoto' : 'photoHelp')}
        </p>
        <FormError message={photoError ? t(photoError) : ''} />
        <BilingualFields value={dish} kind="dish" />
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
        <button className="primary-button full" disabled={busy || processing || !!(file && !photo)}>
          <Check size={18} />
          {busy ? t('saving') : t('save')}
        </button>
        {dish && (
          <button
            type="button"
            className="danger-button full"
            onClick={() => void archive()}
            disabled={busy || processing}
          >
            <Archive size={16} />
            {t('archive')}
          </button>
        )}
      </form>
    </Modal>
  )
}
