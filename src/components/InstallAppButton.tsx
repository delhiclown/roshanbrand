import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const IOS_INSTALL_DISMISSED_KEY = 'roshanbrand_ios_install_dismissed';

function isIosSafari(): boolean {
  const userAgent = window.navigator.userAgent;
  const isAppleMobile = /iPad|iPhone|iPod/.test(userAgent) ||
    (userAgent.includes('Macintosh') && window.navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
  return isAppleMobile && isSafari;
}

function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in window.navigator && Boolean(window.navigator.standalone));
}

export function InstallAppButton() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIosInstall, setShowIosInstall] = useState(false);
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const updateInstalled = () => setInstalled(isInstalled());
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setShowIosInstall(false);
    };

    updateInstalled();
    setShowIosInstall(
      isIosSafari() && window.localStorage.getItem(IOS_INSTALL_DISMISSED_KEY) !== '1'
    );
    standaloneQuery.addEventListener('change', updateInstalled);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      standaloneQuery.removeEventListener('change', updateInstalled);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const dismissIosInstructions = () => {
    setShowIosInstructions(false);
    setShowIosInstall(false);
    window.localStorage.setItem(IOS_INSTALL_DISMISSED_KEY, '1');
  };

  if (installed || (!installPrompt && !showIosInstall)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (installPrompt) {
            void installApp().catch((error: unknown) => {
              console.error('Failed to show the app install prompt:', error);
            });
          }
          else setShowIosInstructions(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-slate-900/90 px-2.5 py-1.5 text-xs font-bold text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_#040714] transition-colors hover:border-cyan-300 hover:text-white sm:px-3"
        aria-label="Install Roshanbrand app"
      >
        <Download className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">{showIosInstall ? 'Install' : 'Install App'}</span>
        <span className="sm:hidden">Install</span>
      </button>

      {showIosInstructions && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/80 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismissIosInstructions();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            className="w-full max-w-sm rounded-2xl border border-cyan-400/30 bg-[#0b112c] p-5 text-slate-100 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="ios-install-title" className="text-lg font-extrabold text-cyan-200">
                Install Roshanbrand
              </h2>
              <button
                type="button"
                onClick={dismissIosInstructions}
                className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"
                aria-label="Close install instructions"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              In Safari, tap <strong className="text-white">Share &gt; Add to Home Screen</strong>
              {' '}to install the app.
            </p>
            <button
              type="button"
              onClick={dismissIosInstructions}
              className="mt-5 w-full rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-400"
            >
              Got it
            </button>
          </section>
        </div>
      )}
    </>
  );
}
