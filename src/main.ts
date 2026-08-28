const VALID_PATHS = new Set([
  "/",
  "/ar",
  "/admin",
  "/legacy-ar-preview",
  "/legacy-landing",
]);

// Route-based code splitting: the AR viewer pulls in MindAR + Three.js (large).
// Dynamic imports keep each route's payload separate so / stays light; heavy
// Three.js routes only load on /ar, /legacy-ar-preview, and /admin.
async function route(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  let path = window.location.pathname.replace(/\/$/, "") || "/";

  if (path === "/map-viewer") {
    window.history.replaceState({ wavemakers: { view: "ar" } }, "", "/ar");
    path = "/ar";
  }

  if (!VALID_PATHS.has(path)) {
    window.history.replaceState({ wavemakers: { view: "landing" } }, "", "/");
  }

  if (path === "/admin") {
    const { initAdminDashboard } = await import("./admin/dashboard");
    initAdminDashboard(app, {
      backdrop: "model3d",
    });
    return;
  }

  if (path === "/legacy-ar-preview") {
    const { clearAdminToken, fetchAdminMe, getAdminToken } = await import("./shared/api");
    const startPreview = async (): Promise<void> => {
      const { initArSimViewer } = await import("./ar/simViewer");
      initArSimViewer(app);
    };
    const enterPreview = async (): Promise<void> => {
      if (!getAdminToken()) {
        const { renderAdminLogin } = await import("./admin/login");
        renderAdminLogin(app, {
          title: "AR Preview",
          subtitle: "Sign in with your admin email and password to open the wall-map preview.",
          onSuccess: () => {
            void enterPreview();
          },
        });
        return;
      }
      try {
        const me = await fetchAdminMe();
        if (me.mustChangePassword) {
          const { renderAdminLogin } = await import("./admin/login");
          renderAdminLogin(app, {
            title: "AR Preview",
            subtitle: "Create a new password to continue.",
            mode: "change-password",
            email: me.email,
            onSuccess: () => {
              void enterPreview();
            },
          });
          return;
        }
        await startPreview();
      } catch {
        clearAdminToken();
        const { renderAdminLogin } = await import("./admin/login");
        renderAdminLogin(app, {
          title: "AR Preview",
          subtitle: "Sign in with your admin email and password to open the wall-map preview.",
          onSuccess: () => {
            void enterPreview();
          },
        });
      }
    };
    await enterPreview();
    return;
  }

  if (path === "/legacy-landing") {
    const { initLanding } = await import("./landing/landing");
    initLanding(app);
    return;
  }

  const { startAppShell } = await import("./appShell");
  await startAppShell(app);
}

void route();
