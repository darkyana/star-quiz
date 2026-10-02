import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportOnboarding } from '../onboardingMetrics'
import { confirmFamilyStatus, deleteDeviceCredential, writeDeviceCredential } from '../../composables/useDeviceCredential'
import { fetchPairStatus, fetchSyncCapabilities } from '../api'

const credential = { device_id: 'device', secret: 'secret', role: 'parent' as const, name: 'private name' }
const transport = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
beforeEach(() => { localStorage.clear(); transport.mockClear(); vi.stubGlobal('fetch', transport) })
afterEach(() => vi.unstubAllGlobals())

describe('#310 anonymous reporter', () => {
  it('drops unknown legacy membership, counts pending as unjoined, and preserves confirmed joined offline', async () => {
    writeDeviceCredential(credential)
    reportOnboarding('guide_entry')
    expect(transport).not.toHaveBeenCalled()
    writeDeviceCredential(credential, 'pending')
    reportOnboarding('guide_entry')
    expect(JSON.parse(transport.mock.calls[0][1].body).family_status).toBe('unjoined')
    confirmFamilyStatus(credential, 'active')
    transport.mockRejectedValueOnce(new Error('offline'))
    reportOnboarding('quiz_start')
    await Promise.resolve()
    expect(JSON.parse(transport.mock.calls[1][1].body)).toEqual({ event: 'quiz_start', family_status: 'joined' })
    expect(transport).toHaveBeenCalledTimes(2) // no replay of the lost legacy event, no retry
    reportOnboarding('quiz_start')
    expect(JSON.parse(transport.mock.calls[2][1].body).family_status).toBe('joined')
  })
  it('credential replacement/deletion cannot inherit confirmation from an old in-flight response', () => {
    writeDeviceCredential(credential, 'active')
    const replacement = { ...credential, device_id: 'new', secret: 'new-secret' }
    writeDeviceCredential(replacement, 'pending')
    confirmFamilyStatus(credential, 'active')
    reportOnboarding('guide_entry')
    expect(JSON.parse(transport.mock.calls[0][1].body).family_status).toBe('unjoined')
    deleteDeviceCredential()
    confirmFamilyStatus(replacement, 'active')
    reportOnboarding('guide_entry')
    expect(JSON.parse(transport.mock.calls[1][1].body).family_status).toBe('unjoined')
  })
  it('successful existing APIs confirm legacy membership; ambiguous auth failures and pending polls do not erase joined', async () => {
    writeDeviceCredential(credential)
    transport.mockResolvedValueOnce(new Response('{"sync_protocol":6}', { status: 200 }))
    await fetchSyncCapabilities({ credential })
    transport.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await fetchSyncCapabilities({ credential })
    transport.mockResolvedValueOnce(new Response('{"status":"pending"}', { status: 200 }))
    await fetchPairStatus(credential)
    reportOnboarding('quiz_start')
    expect(JSON.parse(transport.mock.calls[3][1].body).family_status).toBe('joined')
  })
  it('throwing transport and local storage failure never escape to the user action', () => {
    transport.mockImplementationOnce(() => { throw new Error('offline') })
    expect(() => reportOnboarding('guide_entry')).not.toThrow()
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable') })
    expect(() => reportOnboarding('guide_entry')).not.toThrow()
    read.mockRestore()
  })
  it('sends only event and current unjoined classification, without identity, cookies or referrer', () => {
    reportOnboarding('guide_entry')
    expect(transport).toHaveBeenCalledOnce()
    const [url, options] = transport.mock.calls[0]
    expect(url).toBe('https://api.starquiz.link/api/metrics/onboarding')
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true })
    expect(options.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(options.body)).toEqual({ event: 'guide_entry', family_status: 'unjoined' })
  })
})
