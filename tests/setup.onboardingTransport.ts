// Suite-wide safety: even legacy Home/Result tests must never send real analytics.
// Per-test fetch doubles can still inspect payloads; unstubbing restores this barrier.
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (new URL(url, 'http://localhost').pathname === '/api/metrics/onboarding') {
    return Promise.resolve(new Response(null, { status: 204 }))
  }
  return realFetch(input, init)
}
