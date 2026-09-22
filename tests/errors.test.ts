import { describe, expect, it } from 'vitest'
import { AuthApiError } from '@supabase/supabase-js'
import { errorKey, errorReference, translate } from '../src/i18n'

describe('sign-in error reporting', () => {
  it('explains disabled anonymous sign-in without calling it a password error', () => {
    const error = new AuthApiError(
      'Anonymous sign-ins are disabled',
      422,
      'anonymous_provider_disabled',
    )
    expect(errorKey(error)).toBe('anonymousSignInsDisabled')
    for (const language of ['en', 'zh'] as const) {
      expect(translate(language, errorKey(error))).toContain('Anonymous Sign-Ins')
      expect(translate(language, errorKey(error))).not.toBe(translate(language, 'error'))
    }
    expect(errorKey(new Error('Anonymous sign-ins are disabled'))).toBe('anonymousSignInsDisabled')
  })

  it.each([
    ['signup_disabled', 'signupsDisabled'],
    ['over_request_rate_limit', 'signInRateLimited'],
    ['captcha_failed', 'signInCaptchaFailed'],
    ['PGRST202', 'databaseSetupIncomplete'],
    ['PGRST205', 'databaseSetupIncomplete'],
  ])('uses the structured %s error code', (code, key) => {
    expect(errorKey({ code, message: 'Upstream message may change' })).toBe(key)
  })

  it('distinguishes bad API configuration, rejected kitchen credentials, and network failures', () => {
    expect(errorKey({ message: 'Invalid API key' })).toBe('backendKeyInvalid')
    expect(errorKey({ message: 'Signups not allowed for this instance' })).toBe('signupsDisabled')
    expect(errorKey(new Error('invalid_code'))).toBe('invalid_code')
    expect(errorKey(new Error('rate_limited'))).toBe('rate_limited')
    expect(errorKey(new TypeError('Failed to fetch'))).toBe('networkError')
    expect(errorKey(null)).toBe('error')
    expect(errorKey(new Error('constructor'))).toBe('error')
  })

  it('exposes only safe references for unexpected errors', () => {
    const error = {
      code: '42501',
      message: 'sensitive SQL',
      details: 'submitted secret',
      hint: 'private context',
    }
    const message = translate('en', 'signInFailedAt', {
      stage: translate('en', 'signInMenuStage'),
      code: errorReference(error)!,
    })
    expect(message).toContain('loading your menu')
    expect(message).toContain('42501')
    expect(message).not.toContain(error.message)
    expect(message).not.toContain(error.details)
    expect(errorReference({ code: 'PGRST999' })).toBe('PGRST999')
    expect(errorReference({ code: 'sb_publishable_privatevalue', status: 401 })).toBe('HTTP 401')
    expect(errorReference({ code: 'secret-value' })).toBeUndefined()
    expect(errorReference(null)).toBeUndefined()
  })
})
