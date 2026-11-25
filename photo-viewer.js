import { onAction } from './ui.js';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

export default {
  name: 'photo-viewer',
  init() {
    const dialog = document.createElement('dialog');
    dialog.id = 'photo-viewer-dialog';
    dialog.className = 'photo-viewer-dialog';
    dialog.setAttribute('aria-label', 'Agrandissement de la photo du logement');
    dialog.innerHTML = `
      <div class="photo-viewer-shell">
        <div class="photo-viewer-toolbar" role="toolbar" aria-label="Commandes de la photo">
          <button type="button" data-viewer-control="zoom-out" aria-label="Dézoomer" title="Dézoomer">−</button>
          <span class="photo-viewer-zoom-level" aria-live="polite">100%</span>
          <button type="button" data-viewer-control="zoom-in" aria-label="Zoomer" title="Zoomer">+</button>
          <button type="button" data-viewer-control="reset" aria-label="Ajuster la photo à l’écran" title="Ajuster à l’écran">⤢</button>
          <button type="button" data-viewer-control="close" aria-label="Fermer la photo" title="Fermer">×</button>
        </div>
        <div class="photo-viewer-stage">
          <img alt="" draggable="false">
        </div>
        <p class="photo-viewer-caption"></p>
      </div>`;
    document.body.append(dialog);

    const stage = dialog.querySelector('.photo-viewer-stage');
    const image = stage.querySelector('img');
    const caption = dialog.querySelector('.photo-viewer-caption');
    const zoomLevel = dialog.querySelector('.photo-viewer-zoom-level');
    const zoomOut = dialog.querySelector('[data-viewer-control="zoom-out"]');
    const zoomIn = dialog.querySelector('[data-viewer-control="zoom-in"]');
    let zoom = MIN_ZOOM;

    function layoutImage(center = false) {
      if (!image.naturalWidth || !image.naturalHeight) return;
      const width = Math.max(1, stage.clientWidth - 32);
      const height = Math.max(1, stage.clientHeight - 32);
      const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const fittedWidth = image.naturalWidth * fit;
      const fittedHeight = image.naturalHeight * fit;
      image.style.width = `${fittedWidth * zoom}px`;
      image.style.height = `${fittedHeight * zoom}px`;
      stage.classList.toggle('is-zoomed', zoom > MIN_ZOOM);
      zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
      zoomOut.disabled = zoom <= MIN_ZOOM;
      zoomIn.disabled = zoom >= MAX_ZOOM;

      if (zoom <= MIN_ZOOM) {
        stage.scrollTo(0, 0);
      } else if (center) {
        requestAnimationFrame(() => {
          stage.scrollTo({
            left: Math.max(0, (image.clientWidth - stage.clientWidth) / 2),
            top: Math.max(0, (image.clientHeight - stage.clientHeight) / 2)
          });
        });
      }
    }

    function setZoom(nextZoom) {
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
      layoutImage(true);
    }

    image.addEventListener('load', () => layoutImage());
    window.addEventListener('resize', () => {
      if (dialog.open) layoutImage();
    });
    zoomOut.addEventListener('click', () => setZoom(zoom - ZOOM_STEP));
    zoomIn.addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
    dialog.querySelector('[data-viewer-control="reset"]').addEventListener('click', () => setZoom(MIN_ZOOM));
    dialog.querySelector('[data-viewer-control="close"]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      image.removeAttribute('src');
      image.style.width = '';
      image.style.height = '';
      caption.textContent = '';
      zoom = MIN_ZOOM;
    });

    onAction('view-photo', (button) => {
      const sourceImage = button.querySelector('.main-photo');
      const source = sourceImage?.currentSrc || sourceImage?.src;
      if (!source) return;
      zoom = MIN_ZOOM;
      zoomLevel.textContent = '100%';
      zoomOut.disabled = true;
      zoomIn.disabled = false;
      caption.textContent = sourceImage.alt || 'Photo du logement';
      image.alt = caption.textContent;
      image.src = source;
      dialog.showModal();
      dialog.querySelector('[data-viewer-control="close"]').focus();
    });
  }
};
