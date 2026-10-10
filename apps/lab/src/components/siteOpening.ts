// Site opening — one reveal after Home has drawn its composition.
// The native cover precedes the app bundle and stays outside the captured
// content. Inline Home calls revealSite; framed or bare Home has no cover
// and only marks itself ready.

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
}
