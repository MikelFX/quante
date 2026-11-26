/* Plnolet widget: opens the age verification window over the shop's checkout.
 *
 *   <script src="https://quantecode.com/plnolet/widget.js" defer></script>
 *   // 1. your server: POST /api/plnolet/v1/sessions → { id, url }
 *   // 2. in the browser:
 *   const r = await Plnolet.verify(url)          // { session, status: 'verified' | 'failed' | 'expired' | 'closed' }
 *   // 3. your server: GET /api/plnolet/v1/sessions/{id} — only `verified: true` from the API counts.
 *
 * If the browser blocks the popup, the page goes to the verification window instead and comes back
 * to your return_url with ?plnolet_session=…&plnolet_status=…
 * No cookies, no tracking, no dependencies.
 */
(function () {
  'use strict'
  if (window.Plnolet) return

  function verify(url) {
    return new Promise(function (resolve, reject) {
      var target
      try {
        target = new URL(url)
      } catch {
        reject(new Error('Plnolet: invalid session url'))
        return
      }
      var session = (target.pathname.match(/\/plnolet\/v\/(ses_[A-Za-z0-9]{24})$/) || [])[1]
      if (!session || target.protocol !== 'https:' && target.hostname !== 'localhost') {
        reject(new Error('Plnolet: not a verification url'))
        return
      }
      var w = 480, h = 680
      var left = Math.max(0, (window.screenX || 0) + ((window.outerWidth || w) - w) / 2)
      var top = Math.max(0, (window.screenY || 0) + ((window.outerHeight || h) - h) / 2)
      var popup = window.open(target.href, 'plnolet_' + session, 'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top)
      if (!popup) {
        window.location.assign(target.href)
        return
      }
      var done = false
      function finish(result) {
        if (done) return
        done = true
        window.removeEventListener('message', onMessage)
        clearInterval(timer)
        resolve(result)
      }
      function onMessage(ev) {
        if (ev.origin !== target.origin || !ev.data || ev.data.type !== 'plnolet:done' || ev.data.session !== session) return
        finish({ session: session, status: String(ev.data.status) })
      }
      window.addEventListener('message', onMessage)
      var timer = setInterval(function () {
        if (popup.closed) finish({ session: session, status: 'closed' })
      }, 500)
    })
  }

  window.Plnolet = { verify: verify, version: '0.1' }
})()
