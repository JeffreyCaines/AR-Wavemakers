import "./appShell.css";
import type { CopyLandingController } from "./copy/landing";
import type { ExperienceViewOptions } from "./shared/experienceView";

type RouteView = "landing" | "ar";
type ShellView = RouteView | "8th-ar" | "map-viewer";
type ArMode = "on-site" | "at-home" | "map";

type WavemakersHistoryState = {
  wavemakers?: {
    view: RouteView;
    modal?: "mode";
    arMode?: ArMode;
  };
  arSheet?: boolean;
};

const LOADER_HTML = `
  <div class="copy-loading" role="progressbar" aria-busy="true" aria-label="loading">
    <div class="copy-loading__spinner">
      <svg width="100" height="100" viewBox="-21 -21 44 44" xmlns="http://www.w3.org/2000/svg" stroke="#9b2272" aria-hidden="true">
        <g fill="none" fill-rule="evenodd">
          <g transform="translate(1 1)" stroke-width="4">
            <circle stroke-opacity=".5" cx="0" cy="0" r="20" stroke="#FFFFFF" stroke-width="4"></circle>
            <path d="M20 0c0-9.94-8.06-20-20-20">
              <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="1s" repeatCount="indefinite"></animateTransform>
            </path>
          </g>
        </g>
      </svg>
    </div>
  </div>
`;

function currentPath(): string {
  return window.location.pathname.replace(/\/$/, "") || "/";
}

function isMobileUa(): boolean {
  const ua = navigator.userAgent;
  return (
    /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    /iPad|Tablet/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function viewFromPath(path: string): RouteView | null {
  if (path === "/") return "landing";
  if (path === "/ar") return "ar";
  return null;
}

function historyState(): WavemakersHistoryState | null {
  return window.history.state as WavemakersHistoryState | null;
}

export async function startAppShell(app: HTMLElement): Promise<void> {
  let activeView: ShellView | null = null;
  let landing: CopyLandingController | null = null;
  let disposeViewer: (() => void) | null = null;
  let loadGen = 0;
  let launchedFromLanding = false;
  let loaderEl: HTMLElement | null = null;
  let hostEl: HTMLElement | null = null;

  const commitArMode = (arMode: ArMode): void => {
    launchedFromLanding = true;
    const next = { wavemakers: { view: "ar" as const, arMode } };
    if (currentPath() === "/ar") {
      history.pushState(next, "", "/ar");
      return;
    }
    history.replaceState(next, "", "/ar");
  };

  const landingOptions = {
    onLaunchMap: () => {
      launchedFromLanding = true;
      history.pushState({ wavemakers: { view: "ar", arMode: "map" } }, "", "/ar");
      void showMapViewer();
    },
    onSelectOnSite: () => {
      commitArMode("on-site");
      void showAr();
    },
    onSelectAtHome: () => {
      commitArMode("at-home");
      void showEighthWall();
    },
    onModeModalOpen: () => {
      const state = historyState();
      if (state?.wavemakers?.modal === "mode") return;
      const onAr = currentPath() === "/ar";
      history.pushState(
        { wavemakers: { view: onAr ? "ar" : "landing", modal: "mode" } },
        "",
        onAr ? "/ar" : "/"
      );
    },
  };

  function hideLoader(): void {
    loaderEl?.remove();
    loaderEl = null;
  }

  function showLoader(): void {
    hideLoader();
    const wrap = document.createElement("div");
    wrap.innerHTML = LOADER_HTML.trim();
    loaderEl = wrap.firstElementChild as HTMLElement;
    document.body.appendChild(loaderEl);
  }

  function clearHost(): void {
    disposeViewer?.();
    disposeViewer = null;
    hostEl?.remove();
    hostEl = null;
  }

  function createHost(): HTMLElement {
    clearHost();
    const host = document.createElement("div");
    host.className = "experience-host";
    host.setAttribute("aria-hidden", "true");
    document.body.appendChild(host);
    hostEl = host;
    return host;
  }

  function revealHost(host: HTMLElement): void {
    app.innerHTML = "";
    landing = null;
    host.classList.add("is-live");
    host.removeAttribute("aria-hidden");
    if (host.parentElement !== app) {
      app.appendChild(host);
    }
    hideLoader();
  }

  function abortLoad(): void {
    hideLoader();
    clearHost();
  }

  function handleExit(historySteps = 1): void {
    if (!launchedFromLanding) {
      window.location.assign("/");
      return;
    }
    const steps = Math.max(1, historySteps);
    history.go(-steps);
  }

  const viewOptions = (gen: number): ExperienceViewOptions => ({
    onReady: () => {
      if (gen !== loadGen) return;
      if (!hostEl) {
        hideLoader();
        return;
      }
      revealHost(hostEl);
    },
    onFailed: () => {
      if (gen !== loadGen) return;
      hideLoader();
      if (launchedFromLanding) {
        abortLoad();
        if (currentPath() === "/ar") {
          if (isMobileUa()) {
            history.replaceState({ wavemakers: { view: "ar", modal: "mode" } }, "", "/ar");
            activeView = null;
            void showLanding({ modeSelect: true });
            return;
          }
          history.replaceState({ wavemakers: { view: "landing" } }, "", "/");
          activeView = "landing";
          void showLanding();
          return;
        }
        history.replaceState({ wavemakers: { view: "landing" } }, "", "/");
        activeView = "landing";
        return;
      }
      if (hostEl) {
        revealHost(hostEl);
      }
    },
    onExit: handleExit,
  });

  async function showLanding(opts?: { modeSelect?: boolean }): Promise<void> {
    const gen = ++loadGen;
    hideLoader();
    clearHost();
    launchedFromLanding = false;
    activeView = "landing";
    const { initCopyLanding } = await import("./copy/landing");
    if (gen !== loadGen) return;
    landing = await initCopyLanding(app, {
      ...landingOptions,
      skipDisclaimer: Boolean(opts?.modeSelect),
    });
    if (gen !== loadGen) return;
    if (opts?.modeSelect || historyState()?.wavemakers?.modal === "mode") {
      landing.openModeModal(false);
    }
  }

  async function showAr(): Promise<void> {
    const gen = ++loadGen;
    activeView = "ar";
    landing?.closeModeModal();
    showLoader();
    const host = createHost();
    try {
      const { initArViewer } = await import("./ar/viewer");
      if (gen !== loadGen) return;
      disposeViewer = initArViewer(host, viewOptions(gen));
    } catch {
      if (gen !== loadGen) return;
      viewOptions(gen).onFailed?.();
    }
  }

  async function showEighthWall(): Promise<void> {
    const gen = ++loadGen;
    activeView = "8th-ar";
    landing?.closeModeModal();
    showLoader();
    const host = createHost();
    try {
      const { initEighthWallArViewer } = await import("./ar/eighthWallViewer");
      if (gen !== loadGen) return;
      disposeViewer = initEighthWallArViewer(host, viewOptions(gen));
    } catch {
      if (gen !== loadGen) return;
      viewOptions(gen).onFailed?.();
    }
  }

  async function showMapViewer(): Promise<void> {
    const gen = ++loadGen;
    activeView = "map-viewer";
    landing?.closeModeModal();
    showLoader();
    const host = createHost();
    try {
      const { initMapViewer } = await import("./map-viewer/viewer");
      if (gen !== loadGen) return;
      disposeViewer = initMapViewer(host, viewOptions(gen));
    } catch {
      if (gen !== loadGen) return;
      viewOptions(gen).onFailed?.();
    }
  }

  async function syncToLocation(): Promise<void> {
    const path = currentPath();
    const view = viewFromPath(path);
    const state = historyState();

    if (view === null) {
      history.replaceState({ wavemakers: { view: "landing" } }, "", "/");
      if (activeView !== "landing") {
        await showLanding();
      }
      return;
    }

    if (view === "landing") {
      if (activeView !== "landing") {
        await showLanding();
      } else if (state?.wavemakers?.modal === "mode") {
        landing?.openModeModal(false);
      } else {
        landing?.closeModeModal();
      }
      return;
    }

    if (view === "ar") {
      const arMode = state?.wavemakers?.arMode;
      if (arMode === "on-site") {
        if (activeView !== "ar") await showAr();
        return;
      }
      if (arMode === "at-home") {
        if (activeView !== "8th-ar") await showEighthWall();
        return;
      }
      if (arMode === "map") {
        if (activeView !== "map-viewer") await showMapViewer();
        return;
      }
      if (!isMobileUa()) {
        if (activeView !== "map-viewer") await showMapViewer();
        return;
      }
      if (activeView === "landing" && landing) {
        landing.openModeModal(false);
        return;
      }
      await showLanding({ modeSelect: true });
      return;
    }
  }

  window.addEventListener("popstate", () => {
    const state = historyState();
    if (state?.arSheet) return;
    void syncToLocation();
  });

  const path = currentPath();
  const view = viewFromPath(path);
  const existing = historyState()?.wavemakers;
  if (view === "ar" && !existing?.arMode) {
    if (isMobileUa()) {
      history.replaceState({ wavemakers: { view: "ar", modal: "mode" } }, "", "/ar");
    } else {
      history.replaceState({ wavemakers: { view: "ar", arMode: "map" } }, "", "/ar");
    }
  }

  await syncToLocation();
}
