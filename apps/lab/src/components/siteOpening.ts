// Site opening — one reveal after the framed page has drawn its composition.
// The native cover lives in index.html so it precedes the app bundle. It stays
// separate from captured content: hiding the iframe can suppress its paint.

export const HOME_READY = 'munari:home-ready'

export function revealSite() {
  const root = document.documentElement
  const cover = document.getElementById('site-opening')
  if (!cover || !root.hasAttribute('data-opening') || root.dataset.opening === 'revealing') return
  const finish = () => { cover.remove(); delete root.dataset.opening }
  document.getElementById('root')?.removeAttribute('inert')
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return }
  cover.addEventListener('transitionend', finish, {once: true})
  cover.addEventListener('transitioncancel', finish, {once: true})
  root.dataset.opening = 'revealing'
}

export function announceHomeReady() {
  document.documentElement.dataset.homeReady = 'true'
  if (window.parent === window) revealSite()
  else window.parent.postMessage(HOME_READY, window.location.origin)
}
