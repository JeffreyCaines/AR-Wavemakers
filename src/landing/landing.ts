import "./styles.css";

export function initLanding(root: HTMLElement): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#0a1628");

  root.innerHTML = `
    <div class="landing">
      <div class="landing__content">
        <p class="landing__brand">techNL Wavemakers</p>
        <h1 class="landing__title">NL World Map AR</h1>
        <p class="landing__prompt">How do you want to explore?</p>
        <div class="landing__actions">
          <a href="/ar" class="landing__btn landing__btn--primary">
            Phone with the real map
          </a>
          <a href="/ar-preview" class="landing__btn landing__btn--secondary">
            Browser simulator
          </a>
        </div>
      </div>
    </div>
  `;
}
