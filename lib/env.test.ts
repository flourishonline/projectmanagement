import { describe, expect, it } from 'vitest'
import { isAllowedEmail } from './env'

describe('email domain restriction', () => {
  it('admits addresses on the domain', () => {
    expect(isAllowedEmail('ellissa@flourishonline.com.au')).toBe(true)
    expect(isAllowedEmail('  Ellissa@FlourishOnline.com.au  ')).toBe(true)
  })

  it('turns away everything else', () => {
    expect(isAllowedEmail('someone@gmail.com')).toBe(false)
    expect(isAllowedEmail('someone@flourishonline.com')).toBe(false)
    expect(isAllowedEmail(null)).toBe(false)
    expect(isAllowedEmail('')).toBe(false)
  })

  it('is not fooled by a domain that merely ends with ours', () => {
    // The check anchors on the "@", so a look-alike domain cannot slip past.
    expect(isAllowedEmail('someone@notflourishonline.com.au')).toBe(false)
    expect(isAllowedEmail('flourishonline.com.au@evil.com')).toBe(false)
  })
})
