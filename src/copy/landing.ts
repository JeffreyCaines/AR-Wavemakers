import "./styles.css";
import techNlLogoUrl from "../images/techNL-logo.png";
import exitIconUrl from "../images/exitIcon.png";

export type CopyLandingOptions = {
  onLaunchMap?: () => void;
  onSelectOnSite?: () => void;
  onSelectAtHome?: () => void;
  onModeModalOpen?: () => void;
  skipDisclaimer?: boolean;
};

export type CopyLandingController = {
  openModeModal: (notifyHistory: boolean) => void;
  closeModeModal: () => void;
};

let disclaimerShown = false;

function isMobileUa(): boolean {
  const ua = navigator.userAgent;
  return (
    /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    /iPad|Tablet/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

async function ensureFormStyles(): Promise<void> {
  await import("./formStyles.css");
}

async function openStoryForm(root: HTMLElement, kind: "individual" | "organization"): Promise<void> {
  await ensureFormStyles();
  const { openGetNoticedForm } = await import("./getNoticedForm");
  openGetNoticedForm(root, kind);
}

function showDisclaimer(root: HTMLElement): void {
  if (disclaimerShown) return;
  disclaimerShown = true;

  const modal = document.createElement("div");
  modal.className = "copy-disclaimer";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "copy-disclaimer-title");
  modal.innerHTML = `
    <div class="copy-disclaimer__panel">
      <button type="button" class="copy-disclaimer__close" aria-label="Close">
        <img src="${exitIconUrl}" alt="" width="24" height="24" decoding="async" />
      </button>
      <div class="copy-disclaimer__content">
        <div class="copy-disclaimer__header" id="copy-disclaimer-title">Disclaimer</div>
        <p class="copy-disclaimer__text">
          This is not a production project.
          <br>Much of the UI is lifted from
          <a href="https://nlwavemakers.ca" target="_blank" rel="noopener noreferrer">nlwavemakers.ca</a>.
        </p>
      </div>
      <button type="button" class="copy-disclaimer__done" data-done>Got it</button>
    </div>
  `;

  const dismiss = (): void => modal.remove();
  modal.querySelector(".copy-disclaimer__close")?.addEventListener("click", dismiss);
  modal.querySelector("[data-done]")?.addEventListener("click", dismiss);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) dismiss();
  });

  root.appendChild(modal);
}

function showShareStoryChooser(root: HTMLElement): void {
  void (async () => {
    await ensureFormStyles();
    const modal = document.createElement("div");
    modal.className = "copy-modal copy-modal--share";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "copy-share-title");
    modal.innerHTML = `
      <div class="copy-modal__panel">
        <button type="button" class="copy-modal__close" aria-label="Close">
          <img src="${exitIconUrl}" alt="" width="24" height="24" decoding="async" />
        </button>
        <div class="copy-modal__content">
          <div class="copy-modal__header" id="copy-share-title">Join Newfoundland and Labrador’s (NL) Global Story</div>
          <div class="copy-modal__text">
            This experience is designed to highlight the global impact of the NL tech community’s  innovators, entrepreneurs, and organizations, who are driving global impact with cutting- edge solutions across industries and borders.
          </div>
          <div class="copy-modal__text">
            To add a pin to the map, submit either a personal profile or one for your organization. Share  your story to join the Wavemakers Experience.
          </div>
        </div>
        <div class="copy-modal__share-btns">
          <button type="button" class="copy-modal__share-btn" data-open="individual">INDIVIDUAL</button>
          <button type="button" class="copy-modal__share-btn" data-open="organization">ORGANIZATION</button>
        </div>
      </div>
    `;

    const dismiss = (): void => modal.remove();
    modal.querySelector(".copy-modal__close")?.addEventListener("click", dismiss);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) dismiss();
    });
    modal.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = btn.dataset.open;
        dismiss();
        if (kind === "individual" || kind === "organization") {
          void openStoryForm(root, kind);
        }
      });
    });

    root.appendChild(modal);
  })();
}

async function renderDesktopLanding(
  root: HTMLElement,
  options: CopyLandingOptions
): Promise<void> {
  const [{ default: waveAnimDesktopUrl }, { default: pathIconUrl }] = await Promise.all([
    import("../images/WaveAnimation_Desktop1080p.gif"),
    import("../images/pathIcon.png"),
  ]);

  root.innerHTML = `
    <div class="copy-landing">
      <div class="copy-landing__anim" aria-hidden="true">
        <img src="${waveAnimDesktopUrl}" alt="" decoding="async" />
      </div>
      <div class="copy-landing__container">
        <img class="copy-landing__logo" src="${techNlLogoUrl}" alt="techNL" width="4320" height="1696" decoding="async" data-technl />
        <h1 class="copy-landing__title">Join Newfoundland and Labrador’s Tech Wavemakers Experience.</h1>
        <p class="copy-landing__copy">
          techNL invites you to help showcase the global impact of Newfoundland and Labrador’s tech community through an exciting, augmented reality map experience. Add a pin to represent yourself or your organization and submit your profile information to join the story.
        </p>
        <button type="button" class="copy-landing__btn" data-open="individual">Individual</button>
        <button type="button" class="copy-landing__btn" data-open="organization">Organization</button>
        <div class="copy-landing__links">
          <button type="button" class="copy-landing__launch" data-launch>
            Launch Map in Your Browser
            <img src="${pathIconUrl}" alt="" width="27" height="48" decoding="async" />
          </button>
          <p class="copy-landing__question">
            Have question? Contact us at <a href="mailto:info@technl.ca">info@technl.ca</a>
          </p>
        </div>
      </div>
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.open;
      if (kind === "individual" || kind === "organization") {
        void openStoryForm(root, kind);
      }
    });
  });
  root.querySelector("[data-launch]")?.addEventListener("click", () => {
    options.onLaunchMap?.();
  });
}

async function renderMobileLanding(root: HTMLElement): Promise<void> {
  const [{ default: waveAnimMobileUrl }, { default: eighthWallLogoUrl }] = await Promise.all([
    import("../images/WaveAnimation.gif"),
    import("../images/8thWall-Logo.png"),
  ]);

  root.innerHTML = `
    <div class="copy-landing copy-landing--mobile">
      <img class="copy-landing__bg" src="${waveAnimMobileUrl}" alt="" decoding="async" aria-hidden="true" />
      <div class="copy-landing__top">
        <img class="copy-landing__logo" src="${techNlLogoUrl}" alt="techNL" width="4320" height="1696" decoding="async" data-technl />
        <div>
          <p class="copy-landing__title">Welcome to Wavemakers.</p>
          <p class="copy-landing__copy">
            techNL’s Wavemakers Experience uses computer vision and machine learning to bring Newfoundland and Labrador’s tech ecosystem to life. Press START to explore the map or SHARE YOUR STORY to submit a profile. We'll notify you when your profile is approved and appears on the map.
          </p>
        </div>
        <button type="button" class="copy-landing__btn" data-start>START</button>
        <button type="button" class="copy-landing__btn" data-share>SHARE YOUR STORY</button>
        <div class="copy-landing__perms">
          <p>Please <span class="copy-landing__medium">allow Wavemakers to use the<br> camera</span> to load the experience.</p>
        </div>
      </div>
      <div class="copy-landing__bottom">
        <p class="copy-landing__question">
          Have question?<br>Contact us at
          <a href="mailto:info@technl.ca" target="_blank" rel="noopener noreferrer">info@technl.ca</a>
        </p>
        <img class="copy-landing__8thwall" src="${eighthWallLogoUrl}" alt="8th Wall" decoding="async" />
      </div>
    </div>
  `;

  root.querySelector("[data-share]")?.addEventListener("click", () => {
    showShareStoryChooser(root);
  });
}

export async function initCopyLanding(
  root: HTMLElement,
  options: CopyLandingOptions = {}
): Promise<CopyLandingController> {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#1c294b");
  document.title = "Wavemakers";

  let modeModal: HTMLElement | null = null;

  const closeModeModal = (): void => {
    modeModal?.remove();
    modeModal = null;
  };

  const showModeSelect = (notifyHistory: boolean): void => {
    if (modeModal) return;
    const modal = document.createElement("div");
    modal.className = "copy-modal copy-modal--mode";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "copy-mode-title");
    modal.innerHTML = `
        <div class="copy-modal__panel">
          <div class="copy-modal__content">
            <div class="copy-modal__header" id="copy-mode-title">Select a Mode</div>
            <div class="copy-modal__text">
              To launch the experience, choose your mode based on your location: select "On Site" if you're in the Co. Innovation Centre, or "At Home" if you are in another location.
            </div>
          </div>
          <div class="copy-modal__share-btns">
            <button type="button" class="copy-modal__share-btn" data-mode="on-site">ON SITE</button>
            <button type="button" class="copy-modal__share-btn" data-mode="at-home">AT HOME</button>
          </div>
        </div>
      `;

    modal.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode;
        closeModeModal();
        if (mode === "on-site") {
          options.onSelectOnSite?.();
          return;
        }
        if (mode === "at-home") {
          options.onSelectAtHome?.();
        }
      });
    });

    modeModal = modal;
    root.appendChild(modal);
    if (notifyHistory) {
      options.onModeModalOpen?.();
    }
  };

  if (isMobileUa()) {
    await renderMobileLanding(root);
    root.querySelector("[data-start]")?.addEventListener("click", () => {
      showModeSelect(true);
    });
  } else {
    await renderDesktopLanding(root, options);
  }

  root.querySelectorAll<HTMLElement>("[data-technl]").forEach((logo) => {
    logo.addEventListener("click", () => {
      window.open("https://technl.ca/", "_blank", "noopener,noreferrer");
    });
  });

  if (!options.skipDisclaimer) {
    showDisclaimer(root);
  }

  return {
    openModeModal: (notifyHistory) => showModeSelect(notifyHistory),
    closeModeModal,
  };
}
