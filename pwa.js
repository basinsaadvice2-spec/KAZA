const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

async function startPwa() {
    const installButton = document.getElementById('pwa-install-button');
    const updateButton = document.getElementById('pwa-update-button');
    const helpModal = document.getElementById('pwa-install-help');
    const networkStatus = document.getElementById('network-status');
    let installPrompt = null;
    let registration = null;
    let reloadForUpdate = false;

    const setNetworkStatus = () => {
      const offline = !navigator.onLine;
      networkStatus.hidden = !offline;
      networkStatus.textContent = offline
        ? 'Connexion Internet indisponible. Les recherches, messages et publications nécessitent une connexion.'
        : '';
    };
    setNetworkStatus();
    window.addEventListener('online', setNetworkStatus);
    window.addEventListener('offline', setNetworkStatus);

    const setInstallVisibility = () => { installButton.hidden = standalone(); };
    setInstallVisibility();
    window.matchMedia('(display-mode: standalone)').addEventListener?.('change', setInstallVisibility);
    window.addEventListener('appinstalled', () => { installPrompt = null; setInstallVisibility(); });
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      installPrompt = event;
      installButton.hidden = standalone();
    });

    installButton.addEventListener('click', async () => {
      if (!installPrompt) {
        helpModal.hidden = false;
        return;
      }
      const prompt = installPrompt;
      installPrompt = null;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') installButton.hidden = true;
    });
    document.getElementById('pwa-help-close').addEventListener('click', () => { helpModal.hidden = true; });
    helpModal.addEventListener('click', (event) => { if (event.target === helpModal) helpModal.hidden = true; });

    if (!('serviceWorker' in navigator)) return;
    try {
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      const showUpdate = () => { updateButton.hidden = !(registration?.waiting && navigator.serviceWorker.controller); };
      showUpdate();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', showUpdate);
      });
      updateButton.addEventListener('click', () => {
        if (!registration?.waiting) return;
        reloadForUpdate = true;
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadForUpdate) window.location.reload();
      });
      window.addEventListener('online', () => registration?.update().catch(() => {}));
      await registration.update().catch(() => {});
      showUpdate();
    } catch (error) {
      console.error('[KAZA] Enregistrement PWA impossible', error);
    }
}

startPwa();
