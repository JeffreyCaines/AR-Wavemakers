import "../admin/styles.css";
import "./styles.css";
import techNlLogoUrl from "../images/TechNL-Logo_Black.webp";
import { submitStory } from "../shared/api";
import { sanitizeStorySubmissionInput } from "../shared/sanitizeStorySubmission";

function renderShareStoryTopBar(): string {
  return `
    <header class="share-story__top">
      <div class="share-story__brand logo_container">
        <a href="https://technl.ca/">
          <span class="logo_helper" aria-hidden="true"></span>
          <img src="${techNlLogoUrl}" alt="techNL" class="admin-header__logo">
        </a>
      </div>
      <a href="/" class="admin-link share-story__back">← Back to map</a>
    </header>
  `;
}
export function initShareStoryPage(root: HTMLElement): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#f3f6fb");

  root.innerHTML = `
    <div class="admin admin--share-story share-story">
      <div class="share-story__inner">
        ${renderShareStoryTopBar()}
        <section class="admin-panel share-story__panel">
          <header class="share-story__header">
            <h1>Share your impact story</h1>
            <p class="admin-muted">
              Tell us how your company is making a difference. Submissions are reviewed by our team
              before appearing on the AR world map.
            </p>
          </header>
          <form id="story-form" class="admin-form">
            <label>
              Story title
              <input name="title" required maxlength="120" placeholder="e.g. Ocean intelligence from St. John's" />
            </label>
            <label>
              Company name
              <input name="companyName" maxlength="120" placeholder="Your company" />
            </label>
            <label>
              Impact story
              <textarea name="body" rows="5.5" required maxlength="4000" placeholder="Describe the impact your company is having…"></textarea>
            </label>
            <label>
              Location
              <input name="address" required maxlength="200" placeholder="City, Province/State, Country" />
              <span class="admin-muted share-story__hint">We use this to place your story on the map after approval.</span>
            </label>
            <label>
              Contact email
              <input name="contactEmail" type="email" maxlength="200" placeholder="you@company.com" />
              <span class="admin-muted share-story__hint">Optional. Only used if we need to follow up about your submission.</span>
            </label>
            <label>
              Image URL
              <input name="imageUrl" type="url" maxlength="500" placeholder="https://…" />
              <span class="admin-muted share-story__hint">Optional. Link to a logo or photo.</span>
            </label>
            <label>
              Website URL
              <input name="linkUrl" type="url" maxlength="500" placeholder="https://…" />
            </label>
            <button type="submit" class="admin-btn--pill">Submit for review</button>
            <p id="story-error" class="admin-error" hidden></p>
          </form>
        </section>
      </div>
    </div>
  `;

  const form = root.querySelector("#story-form") as HTMLFormElement;
  const errorEl = root.querySelector("#story-error") as HTMLElement;
  const submitBtn = form.querySelector("button[type=submit]") as HTMLButtonElement;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;

    const fd = new FormData(form);
    const result = sanitizeStorySubmissionInput({
      title: fd.get("title"),
      companyName: fd.get("companyName"),
      body: fd.get("body"),
      address: fd.get("address"),
      contactEmail: fd.get("contactEmail"),
      imageUrl: fd.get("imageUrl"),
      linkUrl: fd.get("linkUrl"),
    });

    if (!result.ok) {
      errorEl.textContent = result.error;
      errorEl.hidden = false;
      submitBtn.disabled = false;
      return;
    }

    try {
      await submitStory(result.value);
      showSuccess(root);
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : "Submission failed. Please try again.";
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });
}

function showSuccess(root: HTMLElement): void {
  const inner = root.querySelector(".share-story__inner");
  if (!inner) return;

  inner.innerHTML = `
    ${renderShareStoryTopBar()}
    <section class="admin-panel share-story__panel">
      <h2>Thank you!</h2>
      <p class="admin-muted">
        Your story has been sent to our team for review. Once approved, it will be placed on the
        map for visitors to discover in AR.
      </p>
      <a href="/" class="admin-link">Return to the map</a>
    </section>
  `;
}

const app = document.getElementById("app");
if (app) initShareStoryPage(app);
