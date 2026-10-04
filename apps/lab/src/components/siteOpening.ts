// Site opening — one reveal after the first page has drawn its composition.
// The native cover precedes the app bundle and stays outside the captured
// content. A page in the top window reveals the site itself; a framed demo
// only marks its document ready, and the shell reveals on the frame's load.

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

export function announcePageReady() {
  document.documentElement.dataset.pageReady = 'true'
  if (window.parent === window) revealSite()
}
