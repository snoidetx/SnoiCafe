import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChefHat,
  Clock3,
  Heart,
  LockKeyhole,
  Megaphone,
  RotateCcw,
  Settings2,
  UtensilsCrossed,
  Users,
  X,
} from 'lucide-react'
import { I18nContext, errorKey, useI18n, type TranslationKey } from './i18n'
import type { Dish, KitchenData, Language, Repository, Status, Tab } from './types'
import { supabase } from './lib/supabase'
import { kitchenPeople, memberProfile } from './lib/domain'
import { Auth } from './components/Auth'
import { Menu } from './components/Menu'
import { Requests } from './components/Requests'
import { OrderDialog } from './components/OrderDialog'
import { DishEditor } from './components/DishEditor'
import { Categories } from './components/Categories'
import { Settings } from './components/Settings'
import { Busy, LanguageButton } from './components/Shared'

type Dialog =
  | { type: 'order'; dish: Dish | null }
  | { type: 'edit'; dish?: Dish }
  | { type: 'categories' }
  | { type: 'settings' }
  | null
export interface DemoControls {
  chefId: string
  customerId: string
  setUser: (id: string) => void
  reset: () => void
}
export function App({ repository, demo }: { repository?: Repository; demo?: DemoControls }) {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('snoicafe-language')
      if (saved === 'en' || saved === 'zh') return saved
      return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    } catch {
      return 'en'
    }
  })
  const setLanguage = useCallback((value: Language) => {
    setLanguageState(value)
    try {
      localStorage.setItem('snoicafe-language', value)
    } catch {
      /* Language still works without storage. */
    }
  }, [])
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [language])
  return (
    <I18nContext.Provider value={{ language, setLanguage }}>
      <KitchenApp repository={repository} demo={demo} />
    </I18nContext.Provider>
  )
}
function KitchenApp({ repository, demo }: { repository?: Repository; demo?: DemoControls }) {
  const { t, language, setLanguage: setDeviceLanguage } = useI18n(),
    [data, setData] = useState<KitchenData | null>(null),
    [userId, setUserId] = useState(demo?.chefId || '')
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [online, setOnline] = useState(navigator.onLine)
  const [tab, setTab] = useState<Tab>('menu'),
    [dialog, setDialog] = useState<Dialog>(null),
    [toast, setToast] = useState('')
  const [languageSaving, setLanguageSaving] = useState(false),
    [languageError, setLanguageError] = useState<TranslationKey | ''>('')
  const languageRef = useRef(language),
    languageSavingRef = useRef(false)
  languageRef.current = language
  const requestVersion = useRef(0),
    userRef = useRef(userId),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    if (!repository) {
      setLoading(false)
      return
    }
    try {
      let id = userRef.current
      if (!demo) {
        const session = await supabase!.auth.getSession()
        if (session.error) throw session.error
        id = session.data.session?.user.id || ''
      }
      const next = id ? await repository.load(id) : null
      if (version !== requestVersion.current) return
      const profile = next ? memberProfile(next, id) : undefined
      if (profile && !languageSavingRef.current) {
        // A first visit adopts the language chosen on the entry screen. Existing
        // preferences win, including when two devices join at the same time.
        const chosen =
          profile.preferred_language || (await repository.saveLanguage(languageRef.current, true))
        if (version !== requestVersion.current) return
        profile.preferred_language = chosen
        setDeviceLanguage(chosen)
      }
      userRef.current = id
      setUserId(id)
      setData(next?.members.some((m) => m.user_id === id) ? next : null)
      setError('')
      if (!next) setDialog(null)
    } catch (e) {
      if (version === requestVersion.current) setError(errorKey(e))
      throw e
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [repository, demo, setDeviceLanguage])
  useEffect(() => {
    const safeRefresh = () => {
      void refresh().catch(() => {})
    }
    safeRefresh()
    const unsubscribe = repository?.subscribe(safeRefresh)
    // Anonymous identities are invisible to the user. Access comes from verified kitchen membership.
    const auth =
      supabase && !demo
        ? supabase.auth.onAuthStateChange(() => {
            setTimeout(safeRefresh, 0)
          })
        : null
    const focus = () => {
      if (document.visibilityState === 'visible') safeRefresh()
    }
    const connected = () => {
        setOnline(true)
        safeRefresh()
      },
      disconnected = () => setOnline(false)
    document.addEventListener('visibilitychange', focus)
    window.addEventListener('online', connected)
    window.addEventListener('offline', disconnected)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) safeRefresh()
    }, 30000)
    return () => {
      ++requestVersion.current
      unsubscribe?.()
      auth?.data.subscription.unsubscribe()
      clearInterval(timer)
      clearTimeout(toastTimer.current)
      document.removeEventListener('visibilitychange', focus)
      window.removeEventListener('online', connected)
      window.removeEventListener('offline', disconnected)
    }
  }, [refresh, repository, demo])
  useEffect(() => {
    if (!data) setDialog(null)
  }, [data])
  function notify(message: string) {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3500)
  }
  async function saved() {
    await refresh()
    notify(t('saved'))
  }
  async function status(id: string, value: Status) {
    try {
      await repository!.status(id, value)
      await refresh()
      notify(t('updated'))
    } catch (e) {
      setError(errorKey(e))
      void refresh().catch(() => {})
    }
  }
  async function deleteRequest(id: string) {
    try {
      await repository!.deleteRequest(id)
      setData((current) =>
        current ? { ...current, requests: current.requests.filter((r) => r.id !== id) } : current,
      )
      await refresh()
      notify(t('requestDeleted'))
    } catch (e) {
      await refresh().catch(() => {})
      setError(errorKey(e))
    }
  }
  async function changeLanguage(value: Language) {
    if (!repository || !data || languageSavingRef.current) return
    const id = userRef.current
    const profileId = memberProfile(data, id)?.id
    if (!profileId) return
    languageSavingRef.current = true
    setLanguageSaving(true)
    setLanguageError('')
    ++requestVersion.current
    try {
      const chosen = await repository.saveLanguage(value)
      if (userRef.current !== id) return
      ++requestVersion.current
      setData((current) => {
        if (!current || memberProfile(current, id)?.id !== profileId) return current
        const update = (profile: NonNullable<KitchenData['chef_profiles']>[number]) =>
          profile.id === profileId ? { ...profile, preferred_language: chosen } : profile
        return {
          ...current,
          chef_profiles: current.chef_profiles?.map(update),
          customer_profiles: current.customer_profiles?.map(update),
        }
      })
      setDeviceLanguage(chosen)
    } catch (e) {
      setLanguageError(errorKey(e))
      setError(errorKey(e))
    } finally {
      languageSavingRef.current = false
      setLanguageSaving(false)
    }
  }
  async function signOut() {
    try {
      const result = await supabase!.auth.signOut({ scope: 'local' })
      if (result.error) throw result.error
      ++requestVersion.current
      setData(null)
      setDialog(null)
      setUserId('')
      userRef.current = ''
      setTab('menu')
    } catch (e) {
      setError(errorKey(e))
    }
  }
  function switchDemo(id: string) {
    setLanguageError('')
    demo!.setUser(id)
    userRef.current = id
    setUserId(id)
    setDialog(null)
    void refresh().catch(() => {})
  }
  const errorBanner = error ? (
    <div className="connection-banner" role="alert">
      <span>{t(error as Parameters<typeof t>[0])}</span>
      <button onClick={() => void refresh().catch(() => {})}>{t('retry')}</button>
    </div>
  ) : null
  if (loading)
    return (
      <div className="initial-loading">
        <ChefHat size={42} />
        <Busy />
      </div>
    )
  if (!data || !repository)
    return (
      <>
        {errorBanner}
        <Auth repository={repository} onRefresh={refresh} />
      </>
    )
  const me = data.members.find((m) => m.user_id === userId),
    chef = me?.role === 'chef',
    pending = data.requests.filter((r) => r.status === 'pending').length
  return (
    <I18nContext.Provider
      value={{
        language,
        setLanguage: (value) => void changeLanguage(value),
        languageSaving,
        languageError,
      }}
    >
      {demo && (
        <div className="demo-bar">
          <span>{t('demo')}</span>
          <div>
            <select
              aria-label={t('demoRole')}
              value={userId}
              onChange={(e) => switchDemo(e.target.value)}
            >
              <option value={demo.chefId}>{t('chef')}</option>
              <option value={demo.customerId}>{t('customer')}</option>
            </select>
            <button
              aria-label={t('resetDemo')}
              onClick={() => {
                if (confirm(t('resetConfirm'))) demo.reset()
              }}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      )}
      <div className="app-shell">
        <header className="kitchen-banner">
          <div className="banner-brand">
            <ChefHat size={19} />
            <span>SNOICAFE</span>
          </div>
          <div className="banner-actions">
            <LanguageButton />
            <button
              className="icon-button glass"
              aria-label={t('settings')}
              onClick={() => setDialog({ type: 'settings' })}
            >
              <Settings2 size={19} />
            </button>
          </div>
          <div className="banner-greeting">
            <span className="eyebrow">{t('subtitle')}</span>
            <p>{t('hello')}</p>
          </div>
        </header>
        <main className="kitchen-body">
          <section className="kitchen-intro">
            <div className="kitchen-heading">
              <div className="brand-avatar">
                <ChefHat size={32} />
                <span>♡</span>
              </div>
              <div className="kitchen-name">
                <h1>{data.kitchen.name}</h1>
                <p>
                  <Users size={13} />
                  {t('members', { n: kitchenPeople(data).length })}
                  <span className="dot">·</span>
                  {me?.display_name}{' '}
                  <span className="role-label">{t(chef ? 'chef' : 'customer')}</span>
                </p>
              </div>
              <span className="privacy-label" title={t('familyOnly')}>
                <LockKeyhole size={14} />
                <span>{t('familyOnly')}</span>
              </span>
            </div>
            <div className="announcement">
              <Megaphone size={15} />
              <p>{data.kitchen.announcement || t('noAnnouncement')}</p>
            </div>
          </section>
          {!online && (
            <div className="connection-banner" role="status">
              {t('offline')}
            </div>
          )}
          {errorBanner}
          {tab === 'menu' ? (
            <Menu
              data={data}
              repository={repository}
              chef={chef}
              disabled={!online}
              onOrder={(dish) => setDialog({ type: 'order', dish })}
              onEdit={(dish) => setDialog({ type: 'edit', dish })}
              onCategories={() => setDialog({ type: 'categories' })}
              onWish={() => setDialog({ type: 'order', dish: null })}
            />
          ) : (
            <Requests
              requests={data.requests}
              history={tab === 'history'}
              chef={chef}
              member={me}
              disabled={!online}
              onStatus={status}
              onDelete={deleteRequest}
              onBrowse={() => setTab('menu')}
            />
          )}
        </main>
        <nav className="bottom-nav" aria-label={t('kitchen')}>
          {(
            [
              { id: 'menu', icon: UtensilsCrossed },
              { id: 'wishlist', icon: Heart },
              { id: 'history', icon: Clock3 },
            ] as const
          ).map(({ id, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? 'selected' : ''}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => {
                setTab(id)
                window.scrollTo({ top: 0, behavior: 'instant' })
              }}
            >
              <span className="nav-icon">
                <Icon size={22} />
                {id === 'wishlist' && pending > 0 && (
                  <span className="nav-badge">{pending > 99 ? '99+' : pending}</span>
                )}
              </span>
              <span>{t(id)}</span>
            </button>
          ))}
        </nav>
      </div>
      {dialog?.type === 'order' && (
        <OrderDialog
          dish={dialog.dish}
          kitchenId={data.kitchen.id}
          repository={repository}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            await refresh()
            notify(t('added'))
          }}
        />
      )}
      {dialog?.type === 'edit' && chef && (
        <DishEditor
          dish={dialog.dish}
          data={data}
          repository={repository}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.type === 'categories' && chef && (
        <Categories
          categories={data.categories}
          kitchenId={data.kitchen.id}
          repository={repository}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.type === 'settings' && (
        <Settings
          data={data}
          userId={userId}
          repository={repository}
          demo={!!demo}
          onClose={() => setDialog(null)}
          onSaved={refresh}
          onSignOut={() => void signOut()}
          notify={notify}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          ✓ {toast}
          <button aria-label={t('close')} onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
    </I18nContext.Provider>
  )
}
