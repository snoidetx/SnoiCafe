import { useState, type FormEvent } from 'react'
import {
  ArchiveRestore,
  Copy,
  Download,
  KeyRound,
  LogOut,
  Save,
  UserMinus,
  Users,
} from 'lucide-react'
import type { KitchenData, Repository } from '../types'
import { errorKey, useI18n } from '../i18n'
import { appUrl } from '../lib/supabase'
import { downloadBackup, restoreMenu } from '../lib/repository'
import { kitchenPeople, localized } from '../lib/domain'
import { Field, FormError, Modal } from './Shared'
export function Settings({
  data,
  userId,
  repository,
  onClose,
  onSaved,
  onSignOut,
  notify,
  demo,
}: {
  data: KitchenData
  userId: string
  repository: Repository
  onClose: () => void
  onSaved: () => Promise<void>
  onSignOut: () => void
  notify: (text: string) => void
  demo: boolean
}) {
  const { t, language } = useI18n(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [showLink, setShowLink] = useState(false)
  const me = data.members.find((m) => m.user_id === userId),
    chef = me?.role === 'chef',
    people = kitchenPeople(data),
    chefSessions = data.members.filter((m) => m.role === 'chef')
  async function run(action: () => Promise<void>, message?: string) {
    setBusy(true)
    setError('')
    try {
      await action()
      await onSaved()
      if (message) notify(message)
    } catch (e) {
      setError(t(errorKey(e)))
    } finally {
      setBusy(false)
    }
  }
  function profile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    void run(async () => {
      const name = String(form.get('display_name') || '').trim()
      if (!name) throw new Error('invalid_name')
      await repository.saveName(userId, name)
      if (chef)
        await repository.saveKitchen({
          ...data.kitchen,
          name: String(form.get('name') || '').trim(),
          announcement: String(form.get('announcement') || '').trim(),
        })
    }, t('saved'))
  }
  async function copy() {
    setShowLink(true)
    try {
      await navigator.clipboard.writeText(appUrl())
      notify(t('copied'))
    } catch {
      /* A visible selectable link is the fallback. */
    }
  }
  async function backup() {
    const value = await downloadBackup(repository)
    const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `snoicafe-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <Modal
      title={t('settings')}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <FormError message={error} />
      <form onSubmit={profile}>
        <Field
          label={t(chef ? 'chefName' : 'yourName')}
          hint={chef ? t('chefProfileHelp') : undefined}
        >
          <input name="display_name" maxLength={60} required defaultValue={me?.display_name} />
        </Field>
        {chef && (
          <>
            <Field label={t('kitchenName')}>
              <input name="name" maxLength={80} required defaultValue={data.kitchen.name} />
            </Field>
            <Field label={t('announcement')}>
              <textarea
                name="announcement"
                maxLength={500}
                rows={2}
                defaultValue={data.kitchen.announcement}
              />
            </Field>
          </>
        )}
        <button className="primary-button full" disabled={busy}>
          <Save size={17} />
          {busy ? t('saving') : t('save')}
        </button>
      </form>
      <section className="settings-section">
        <h3>
          <Users size={18} />
          {t('people')}
        </h3>
        <div className="members-list">
          {people.map((m) => (
            <div key={m.id}>
              <span className="member-avatar">{m.display_name.slice(0, 1)}</span>
              <span className="member-name">
                {m.display_name}
                <small>{t(m.role)}</small>
              </span>
              {chef && m.role === 'customer' && m.id !== userId && (
                <button
                  className="icon-button danger"
                  aria-label={`${t('endSession')} ${m.display_name}`}
                  disabled={busy}
                  onClick={() => {
                    if (confirm(t('endSessionConfirm')))
                      void run(() => repository.removeMember(m.id), t('removed'))
                  }}
                >
                  <UserMinus size={17} />
                </button>
              )}
            </div>
          ))}
        </div>
        {chef && (
          <details className="chef-sessions">
            <summary>{t('chefDevices', { n: chefSessions.length })}</summary>
            <p className="field-help">{t('chefDevicesHelp')}</p>
            <div className="members-list">
              {chefSessions.map((session) => (
                <div key={session.user_id}>
                  <span className="member-name">
                    {session.display_name}
                    <small>
                      {session.user_id === userId
                        ? t('thisDevice')
                        : t('chefDevice', { id: session.user_id.slice(0, 8) })}
                    </small>
                  </span>
                  {session.user_id !== userId && (
                    <button
                      className="icon-button danger"
                      aria-label={`${t('endSession')} ${session.display_name} ${session.user_id.slice(0, 8)}`}
                      disabled={busy}
                      onClick={() => {
                        if (confirm(t('endChefSessionConfirm')))
                          void run(() => repository.removeMember(session.user_id), t('removed'))
                      }}
                    >
                      <UserMinus size={17} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </section>
      {chef && (
        <>
          <section className="settings-section">
            <h3>
              <KeyRound size={18} />
              {t('access')}
            </h3>
            <button className="small-button" onClick={() => void copy()}>
              <Copy size={16} />
              {t('shareKitchen')}
            </button>
            {showLink && (
              <input
                className="share-link"
                value={appUrl()}
                aria-label={t('shareKitchen')}
                readOnly
                onFocus={(e) => e.target.select()}
              />
            )}
            <p className="field-help">{t('accessHelp')}</p>
            {demo && <p className="field-help">{t('previewAccess')}</p>}
            <form
              aria-label={t('access')}
              onSubmit={(e) => {
                e.preventDefault()
                if (busy || demo) return
                const formElement = e.currentTarget,
                  form = new FormData(formElement)
                const kitchenCode = String(form.get('kitchen_code') || ''),
                  password = String(form.get('chef_password') || '')
                if (!kitchenCode && !password) return
                if (!confirm(t('codeConfirm'))) return
                void run(async () => {
                  await repository.changeCodes(kitchenCode, password)
                  formElement.reset()
                }, t('saved'))
              }}
            >
              <Field label={t('newCode')} hint={t('codeHelp')}>
                <input
                  type="password"
                  name="kitchen_code"
                  disabled={busy || demo}
                  autoComplete="new-password"
                  placeholder={t('leaveBlank')}
                />
              </Field>
              <Field label={t('newChefPassword')} hint={t('passwordHelp')}>
                <input
                  type="password"
                  name="chef_password"
                  disabled={busy || demo}
                  autoComplete="new-password"
                  placeholder={t('leaveBlank')}
                />
              </Field>
              <button className="small-button" disabled={busy || demo}>
                {t('changeCodes')}
              </button>
            </form>
          </section>
          <section className="settings-section">
            <h3>
              <ArchiveRestore size={18} />
              {t('archived')}
            </h3>
            <p className="field-help">{t('archivedHint')}</p>
            {data.dishes
              .filter((d) => d.archived)
              .map((d) => (
                <div className="simple-row" key={d.id}>
                  <span>{localized(d, language)}</span>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => repository.saveDish({ ...d, archived: false, available: false }),
                        t('saved'),
                      )
                    }
                  >
                    {t('restore')}
                  </button>
                </div>
              ))}
            {!data.dishes.some((d) => d.archived) && (
              <p className="field-help">{t('noArchived')}</p>
            )}
          </section>
          <section className="settings-section">
            <h3>
              <Download size={18} />
              {t('backup')}
            </h3>
            <p className="field-help">{t('backupHelp')}</p>
            <button
              className="small-button"
              disabled={busy || demo}
              onClick={() => void run(backup)}
            >
              {busy ? t('exporting') : t('export')}
            </button>
            <h4>{t('restoreBackup')}</h4>
            <p className="field-help">{t('restoreHelp')}</p>
            <label className="file-button">
              {t('import')}
              <input
                type="file"
                accept="application/json,.json"
                disabled={busy || demo}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file)
                    void run(() => restoreMenu(repository, data.kitchen.id, file), t('imported'))
                  e.target.value = ''
                }}
              />
            </label>
          </section>
        </>
      )}
      {!demo && (
        <button className="danger-button full" type="button" onClick={onSignOut} disabled={busy}>
          <LogOut size={17} />
          {t('signOut')}
        </button>
      )}
    </Modal>
  )
}
