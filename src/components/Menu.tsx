import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Coins, Pencil, Plus, Search, Settings2, Sparkles, X } from 'lucide-react'
import type { Category, Dish, KitchenData, Repository } from '../types'
import { useI18n } from '../i18n'
import { description, filterDishes, localized, orderedCategories } from '../lib/domain'
import { DishPhoto, Empty } from './Shared'

interface Props {
  data: KitchenData
  repository: Repository
  chef: boolean
  onOrder: (dish: Dish) => void
  onEdit: (dish?: Dish) => void
  onCategories: () => void
  onWish: () => void
  disabled: boolean
}
export function Menu({
  data,
  repository,
  chef,
  onOrder,
  onEdit,
  onCategories,
  onWish,
  disabled,
}: Props) {
  const { t, language } = useI18n(),
    [active, setActive] = useState('all'),
    [search, setSearch] = useState(''),
    [editing, setEditing] = useState(false)
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (searching) searchRef.current?.focus()
  }, [searching])
  useEffect(() => {
    if (!chef) setEditing(false)
  }, [chef])
  useEffect(() => {
    if (active !== 'all' && active !== 'other' && !data.categories.some((c) => c.id === active))
      setActive('all')
  }, [data.categories, active])
  const dishes = useMemo(
    () => filterDishes(data.dishes, search, language),
    [data.dishes, search, language],
  )
  const categories: Category[] = [
    ...orderedCategories(data.categories),
    {
      id: 'other',
      kitchen_id: data.kitchen.id,
      name: t('uncategorized'),
      name_zh: t('uncategorized'),
      emoji: '🍽️',
      position: 999,
    },
  ]
  const groups = categories
    .map((category) => ({
      category,
      dishes: dishes.filter(
        (d) => d.category_id === (category.id === 'other' ? null : category.id),
      ),
    }))
    .filter((g) => (active === 'all' ? g.dishes.length > 0 : active === g.category.id))
  return (
    <>
      <section className="menu-tools" aria-label={t('menu')}>
        <div className="menu-mode">
          <h2>{t('menu')}</h2>
          {chef && (
            <button
              className={editing ? 'text-button active' : 'text-button'}
              onClick={() => setEditing(!editing)}
            >
              {editing ? t('done') : t('manage')}
            </button>
          )}
        </div>
        <div className="tool-actions">
          {chef && (
            <button className="small-button" onClick={() => onEdit()} disabled={disabled}>
              <Plus size={15} />
              <span>{t('addDish')}</span>
            </button>
          )}
          <button
            className={searching ? 'icon-button active' : 'icon-button subtle'}
            aria-label={t('search')}
            onClick={() => {
              setSearching(!searching)
              setSearch('')
            }}
          >
            {searching ? <X size={18} /> : <Search size={18} />}
          </button>
        </div>
      </section>
      {searching && (
        <div className="search-bar">
          <Search size={18} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
          />
        </div>
      )}
      <div className="menu-layout">
        <aside className="category-rail" aria-label={t('categories')}>
          <button
            className={`category-item ${active === 'all' ? 'selected' : ''}`}
            aria-pressed={active === 'all'}
            onClick={() => setActive('all')}
          >
            <span className="category-emoji">🍽️</span>
            <span>{t('all')}</span>
          </button>
          {categories
            .filter(
              (c) => c.id !== 'other' || data.dishes.some((d) => !d.archived && !d.category_id),
            )
            .map((c) => (
              <button
                key={c.id}
                className={`category-item ${active === c.id ? 'selected' : ''}`}
                aria-pressed={active === c.id}
                onClick={() => setActive(c.id)}
              >
                <span className="category-emoji" aria-hidden="true">
                  {c.emoji}
                </span>
                <span>{localized(c, language)}</span>
              </button>
            ))}
          {chef && (
            <button className="category-manage" onClick={onCategories}>
              <Settings2 size={16} />
              <span>{t('categories')}</span>
            </button>
          )}
        </aside>
        <div className="dish-list">
          {groups.length === 0 ? (
            <Empty
              title={search ? t('noResults') : t('noDishes')}
              body={search ? t('trySearch') : t('noDishesBody')}
              action={
                chef && !search ? (
                  <button className="primary-button" onClick={() => onEdit()}>
                    <Plus size={16} />
                    {t('addDish')}
                  </button>
                ) : undefined
              }
            />
          ) : (
            groups.map(({ category, dishes: groupDishes }) => (
              <section
                className="dish-section"
                key={category.id}
                aria-labelledby={`category-${category.id}`}
              >
                <h3 id={`category-${category.id}`}>
                  <span>{category.emoji}</span> {localized(category, language)}{' '}
                  <small>{groupDishes.length}</small>
                </h3>
                {groupDishes.length === 0 ? (
                  <p className="category-empty">{t('emptyCategory')}</p>
                ) : (
                  groupDishes.map((dish) => {
                    const name = localized(dish, language),
                      count = data.requests
                        .filter((r) => r.dish_id === dish.id && r.status === 'pending')
                        .reduce((sum, r) => sum + r.quantity, 0)
                    return (
                      <article
                        className={`dish-row ${!dish.available ? 'unavailable' : ''}`}
                        key={dish.id}
                      >
                        <DishPhoto path={dish.photo_path} name={name} repository={repository} />
                        <div className="dish-info">
                          <h4>{name}</h4>
                          <p className="dish-description">{description(dish, language)}</p>
                          <div className="dish-labels">
                            {!dish.available ? (
                              <span className="soft-label">{t('soldOut')}</span>
                            ) : dish.options.length > 0 ? (
                              <span className="soft-label">
                                {t('options')}
                                <ChevronDown size={11} />
                              </span>
                            ) : null}
                            {count > 0 && (
                              <span className="request-label">
                                {count} {t('pending')}
                              </span>
                            )}
                          </div>
                          <div className="dish-bottom">
                            <span className="dish-price" title={t('funPrice')}>
                              <Coins size={16} />
                              {Number(dish.price).toFixed(2)}
                            </span>
                            <button
                              className="add-button"
                              aria-label={`${editing ? t('edit') : t('order')} ${name}`}
                              disabled={disabled || (!editing && !dish.available)}
                              onClick={() => (editing ? onEdit(dish) : onOrder(dish))}
                            >
                              {editing ? <Pencil size={17} /> : <Plus size={20} />}
                            </button>
                          </div>
                        </div>
                      </article>
                    )
                  })
                )}
              </section>
            ))
          )}
          <button className="wish-callout" onClick={onWish} disabled={disabled}>
            <span className="wish-star">
              <Sparkles size={21} />
            </span>
            <span>
              <strong>{t('wishPrompt')}</strong>
              <small>{t('requestDish')}</small>
            </span>
            <Plus size={18} />
          </button>
          <p className="coins-note">
            <Coins size={12} />
            {t('funPrice')}
          </p>
        </div>
      </div>
    </>
  )
}
