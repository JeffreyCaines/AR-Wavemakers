// Route-based code splitting: the AR viewer pulls in MindAR + Three.js (large),
// which the admin dashboard never needs. Dynamic imports keep each route's
// payload separate so /admin and / stay light; heavy Three.js routes only load
// on /ar, /ar-preview, /8th-ar, /map-viewer, and /3d-admin.
async function route(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  const path = window.location.pathname.replace(/\/$/, "") || "/";

  if (path === "/admin") {
    const { initAdminDashboard } = await import("./admin/dashboard");
    initAdminDashboard(app);
    return;
  }

  if (path === "/3d-admin") {
    const { initAdminDashboard } = await import("./admin/dashboard");
    initAdminDashboard(app, {
      backdrop: "model3d",
      title: "3D Admin Dashboard",
      subtitle: "Enter the admin password to manage cards on the 3D map.",
    });
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

  if (path === "/8th-ar") {
    const { initEighthWallArViewer } = await import("./ar/eighthWallViewer");
    initEighthWallArViewer(app);
    return;
  }

  if (path === "/copy") {
    window.location.replace("/");
    return;
  }

  if (path === "/map-viewer") {
    const { initMapViewer } = await import("./map-viewer/viewer");
    initMapViewer(app);
    return;
  }

  if (path === "/legacy-landing") {
    const { initLanding } = await import("./landing/landing");
    initLanding(app);
    return;
  }

  const { initCopyLanding } = await import("./copy/landing");
  initCopyLanding(app);
}

void route();
