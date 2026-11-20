import { onAction, bindActions } from '../core/ui.js';
function apply(dark) {
  document.body.classList.toggle('dark-mode', dark);
  document.querySelectorAll('.theme-toggle i').forEach(i => { i.className = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon'; });
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f0c1d' : '#6d28d9');
}
export default {
  name: 'theme',
  init() {
    bindActions({ '.theme-toggle': 'toggle-theme' });
    apply(localStorage.getItem('kaza_theme') === 'dark');
    onAction('toggle-theme', () => {
      const dark = !document.body.classList.contains('dark-mode');
      localStorage.setItem('kaza_theme', dark ? 'dark' : 'light');
      apply(dark);
    });
  }
};
