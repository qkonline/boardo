// Keeps bottom sheets above the on-screen keyboard. iOS doesn't shrink the page when the
// keyboard opens, so anything fixed to the bottom of the screen ends up behind it. The visual
// viewport says how much of the screen is still visible; expose that to CSS as
//   --kb   how far the keyboard reaches up from the bottom of the page (0 when closed)
//   --vvh  the height of what's still visible
// Android Chrome resizes the page itself (see interactive-widget in index.html), so --kb stays 0.

export function trackKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const touch = window.matchMedia('(pointer: coarse)');
  const update = () => {
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--kb', `${Math.round(covered)}px`);
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    // Android resizes the page instead, so on touch screens also treat a big drop in visible
    // height as the keyboard.
    const shrunk = touch.matches && vv.height < window.screen.height * 0.6;
    root.classList.toggle('keyboard-open', covered > 80 || shrunk);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
