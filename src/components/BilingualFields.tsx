import { Fragment } from 'react'
import { useI18n } from '../i18n'
import { Field } from './Shared'

export function BilingualFields({
  value,
  kind,
}: {
  value?: { name: string; name_zh: string; description?: string; description_zh?: string }
  kind: 'dish' | 'category'
}) {
  const { language, t } = useI18n()
  const languages = [language, language === 'zh' ? 'en' : 'zh'] as const
  return languages.map((fieldLanguage, index) => {
    const name = fieldLanguage === 'zh' ? 'name_zh' : 'name'
    const description = fieldLanguage === 'zh' ? 'description_zh' : 'description'
    const primary = index === 0
    return (
      <Fragment key={fieldLanguage}>
        <Field
          label={t(
            primary
              ? kind === 'dish'
                ? 'dishName'
                : 'categoryName'
              : fieldLanguage === 'zh'
                ? 'chineseName'
                : 'englishName',
          )}
        >
          <input
            name={name}
            required={primary}
            maxLength={kind === 'dish' ? 100 : 60}
            defaultValue={value?.[name]}
            lang={fieldLanguage === 'zh' ? 'zh-CN' : 'en'}
          />
        </Field>
        {kind === 'dish' && (
          <Field
            label={t(
              primary
                ? 'description'
                : fieldLanguage === 'zh'
                  ? 'chineseDescription'
                  : 'englishDescription',
            )}
          >
            <textarea
              name={description}
              rows={2}
              maxLength={1000}
              defaultValue={value?.[description]}
              lang={fieldLanguage === 'zh' ? 'zh-CN' : 'en'}
            />
          </Field>
        )}
      </Fragment>
    )
  })
}
