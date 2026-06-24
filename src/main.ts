// Route-based code splitting: the AR viewer pulls in MindAR + Three.js (large),
// which the admin dashboard never needs. Dynamic imports keep each route's
// payload separate so /admin loads light and the heavy AR bundle only loads on /.
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

  const { initArViewer } = await import("./ar/viewer");
  initArViewer(app);
}

void route();
