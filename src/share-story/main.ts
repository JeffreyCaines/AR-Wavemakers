import "./styles.css";
import { submitStory } from "../shared/api";
import { sanitizeStorySubmissionInput } from "../shared/sanitizeStorySubmission";

export function initShareStoryPage(root: HTMLElement): void {
  root.innerHTML = `
    <div class="share-story">
      <div class="share-story__inner">
        <a href="/" class="share-story__back">&larr; Back to map</a>
        <header class="share-story__header">
          <h1>Share your impact story</h1>
          <p>
            Tell us how your company is making a difference. Submissions are reviewed by our team
            before appearing on the AR world map.
          </p>
        </header>
        <form id="story-form" class="share-story__form">
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
            <textarea name="body" rows="6" required maxlength="4000" placeholder="Describe the impact your company is having…"></textarea>
          </label>
          <label>
            Location
            <input name="address" required maxlength="200" placeholder="City, Province/State, Country" />
            <span class="share-story__hint">We use this to place your story on the map after approval.</span>
          </label>
          <label>
            Contact email
            <input name="contactEmail" type="email" maxlength="200" placeholder="you@company.com" />
            <span class="share-story__hint">Optional. Only used if we need to follow up about your submission.</span>
          </label>
          <label>
            Image URL
            <input name="imageUrl" type="url" maxlength="500" placeholder="https://…" />
            <span class="share-story__hint">Optional. Link to a logo or photo.</span>
          </label>
          <label>
            Website URL
            <input name="linkUrl" type="url" maxlength="500" placeholder="https://…" />
          </label>
          <button type="submit" class="share-story__submit">Submit for review</button>
          <p id="story-error" class="share-story__error" hidden></p>
        </form>
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
    <a href="/" class="share-story__back">&larr; Back to map</a>
    <div class="share-story__success">
      <h2>Thank you!</h2>
      <p>
        Your story has been sent to our team for review. Once approved, it will be placed on the
        map for visitors to discover in AR.
      </p>
      <a href="/">Return to the map</a>
    </div>
  `;
}

const app = document.getElementById("app");
if (app) initShareStoryPage(app);
