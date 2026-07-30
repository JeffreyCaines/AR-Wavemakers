// Route-based code splitting: the AR viewer pulls in MindAR + Three.js (large),
// which the admin dashboard never needs. Dynamic imports keep each route's
// payload separate so /admin and / stay light; the heavy AR bundle only loads on /ar.
async function route(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  const path = window.location.pathname.replace(/\/$/, "") || "/";

  if (path === "/admin") {
    const { initAdminDashboard } = await import("./admin/dashboard");
    initAdminDashboard(app);
    return;
  }

  if (path === "/ar-preview") {
    const { initArSimViewer } = await import("./ar/simViewer");
    initArSimViewer(app);
    return;
  }

  if (path === "/ar") {
    const { initArViewer } = await import("./ar/viewer");
    initArViewer(app);
    return;
  }

  const { initLanding } = await import("./landing/landing");
  initLanding(app);
}

void route();
