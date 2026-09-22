import { useState, type FormEvent } from 'react'
import { ArrowRight, ChefHat, KeyRound, LockKeyhole, UtensilsCrossed } from 'lucide-react'
import type { Repository } from '../types'
import { supabase } from '../lib/supabase'
import { useI18n, errorKey, errorReference, type TranslationKey } from '../i18n'
import { Field, FormError, LanguageButton } from './Shared'
export function Auth({
  repository,
  onRefresh,
}: {
  repository?: Repository
  onRefresh: () => Promise<void>
}) {
  const { t } = useI18n(),
    [busy, setBusy] = useState(false),
    [chef, setChef] = useState(false),
    [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !supabase || !repository) return
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    let stage: TranslationKey = 'signInSessionStage'
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!data.session) {
        const { error } = await supabase.auth.signInAnonymously()
        if (error) throw error
      }
      stage = 'signInCodeStage'
      await repository.unlock(
        String(form.get('code') || ''),
        String(form.get('name') || '').trim(),
        chef,
      )
      stage = 'signInMenuStage'
      await onRefresh()
    } catch (e) {
      const key = errorKey(e)
      setError(
        key === 'error'
          ? t('signInFailedAt', {
              stage: t(stage),
              code: errorReference(e) || t('unknownErrorCode'),
            })
          : t(chef && key === 'invalid_code' ? 'invalidChefPassword' : key),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-language">
        <LanguageButton />
      </div>
      <div className="auth-banner" />
      <section className="auth-card">
        <div className="brand-avatar">
          <ChefHat size={34} />
        </div>
        <span className="eyebrow">SNOICAFE</span>
        <h1>{!supabase ? t('notConfigured') : t('signIn')}</h1>
        <p>{!supabase ? t('notConfiguredBody') : chef ? t('chefUnlockBody') : t('unlockBody')}</p>
        {!supabase ? (
          <a
            className="primary-button"
            href="https://github.com/snoidetx/SnoiCafe#setup"
            target="_blank"
            rel="noreferrer"
          >
            {t('setupGuide')}
            <ArrowRight size={17} />
          </a>
        ) : (
          <>
            <div className="entry-modes">
              <button
                type="button"
                aria-pressed={!chef}
                className={!chef ? 'selected' : ''}
                onClick={() => {
                  setChef(false)
                  setError('')
                }}
              >
                <UtensilsCrossed size={17} />
                {t('customerEntry')}
              </button>
              <button
                type="button"
                aria-pressed={chef}
                className={chef ? 'selected' : ''}
                onClick={() => {
                  setChef(true)
                  setError('')
                }}
              >
                <ChefHat size={17} />
                {t('chefEntry')}
              </button>
            </div>
            <form onSubmit={submit}>
              <Field
                label={t(chef ? 'chefName' : 'yourName')}
                hint={chef ? t('chefNameHelp') : undefined}
              >
                <input name="name" required maxLength={60} autoComplete="nickname" />
              </Field>
              <Field label={t(chef ? 'chefPassword' : 'kitchenCode')}>
                <input
                  name="code"
                  type="password"
                  required
                  autoComplete={chef ? 'current-password' : 'off'}
                />
              </Field>
              <FormError message={error} />
              <button className="primary-button full" disabled={busy}>
                <KeyRound size={18} />
                {busy ? t('loading') : t('unlock')}
              </button>
            </form>
            <p className="device-note">{t('sameDevice')}</p>
          </>
        )}
        <p className="auth-private">
          <LockKeyhole size={13} />
          {t('familyOnly')}
        </p>
      </section>
    </main>
  )
}
