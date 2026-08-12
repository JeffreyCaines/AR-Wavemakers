import type {
  IndividualStorySubmissionInput,
  InfoCard,
  OrganizationStorySubmissionInput,
  StorySubmission,
  StorySubmissionInput,
} from "./types";
import {
  sanitizeEmail,
  sanitizeHttpUrl,
  sanitizeMultilineText,
  sanitizePlainText,
  sanitizeStorySubmissionInput,
  type SanitizeStoryInputResult,
} from "./sanitizeStorySubmission";

const LIMITS = {
  name: 120,
  email: 200,
  location: 200,
  url: 500,
  shortAnswer: 250,
  longStory: 750,
  description: 250,
  member: 32,
  option: 120,
  maxMulti: 20,
  maxLocations: 20,
} as const;

function sanitizeStringList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = sanitizePlainText(item, maxLen);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function sanitizeUploadUrl(value: unknown): string | undefined {
  const raw = sanitizePlainText(value, LIMITS.url);
  if (!raw) return undefined;
  if (raw.startsWith("/api/uploads/")) {
    if (!/^\/api\/uploads\/[a-zA-Z0-9_-]+$/.test(raw)) return undefined;
    return raw;
  }
  return sanitizeHttpUrl(raw, LIMITS.url);
}

function buildIndividualBody(fields: {
  nlDescription?: string;
  whyDescription?: string;
  dreamJob?: string;
  story?: string;
}): string {
  const parts: string[] = [];
  if (fields.nlDescription) {
    parts.push(`What I love about NL:\n${fields.nlDescription}`);
  }
  if (fields.whyDescription) {
    parts.push(`Why I choose NL tech:\n${fields.whyDescription}`);
  }
  if (fields.dreamJob) {
    parts.push(`Tech-related dream job:\n${fields.dreamJob}`);
  }
  if (fields.story) {
    parts.push(`Success story:\n${fields.story}`);
  }
  return parts.join("\n\n") || "Individual Get Noticed submission.";
}

function buildOrganizationBody(fields: {
  mainDescription?: string;
  companyBio?: string;
  stakeholderDescription?: string;
  storyDescription?: string;
}): string {
  const parts: string[] = [];
  if (fields.mainDescription) parts.push(fields.mainDescription);
  if (fields.companyBio) parts.push(`Company bio:\n${fields.companyBio}`);
  if (fields.stakeholderDescription) {
    parts.push(`NL tech stakeholders outside the province:\n${fields.stakeholderDescription}`);
  }
  if (fields.storyDescription) {
    parts.push(`Success story:\n${fields.storyDescription}`);
  }
  return parts.join("\n\n") || "Organization Get Noticed submission.";
}

export { buildIndividualBody, buildOrganizationBody };

export function sanitizeIndividualSubmissionInput(input: unknown): SanitizeStoryInputResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid submission." };
  }
  const raw = input as Record<string, unknown>;

  const firstName = sanitizePlainText(raw.firstName, LIMITS.name);
  const lastName = sanitizePlainText(raw.lastName, LIMITS.name);
  const isTechNlMember = sanitizePlainText(raw.isTechNlMember, LIMITS.member);
  const pronouns = sanitizePlainText(raw.pronouns, LIMITS.name) || undefined;
  const profession = sanitizeStringList(raw.profession, LIMITS.maxMulti, LIMITS.option);
  const currLocation = sanitizePlainText(raw.currLocation, LIMITS.location);
  const origLocation = sanitizePlainText(raw.origLocation, LIMITS.location);
  const linkedin = sanitizeHttpUrl(raw.linkedin, LIMITS.url);
  const email = sanitizeEmail(raw.email);
  const nlDescription = sanitizeMultilineText(raw.nlDescription, LIMITS.shortAnswer) || undefined;
  const whyDescription = sanitizeMultilineText(raw.whyDescription, LIMITS.shortAnswer) || undefined;
  const dreamJob = sanitizeMultilineText(raw.dreamJob, LIMITS.shortAnswer) || undefined;
  const story = sanitizeMultilineText(raw.story, LIMITS.longStory) || undefined;
  const logoUrl = sanitizeUploadUrl(raw.logoUrl);
  const optInModeration = raw.optInModeration === true;
  const optInNewsletter = raw.optInNewsletter === true;

  if (!firstName) return { ok: false, error: "First name is required." };
  if (!lastName) return { ok: false, error: "Last name is required." };
  if (!isTechNlMember) return { ok: false, error: "techNL membership selection is required." };
  if (profession.length === 0) return { ok: false, error: "Profession / field of study is required." };
  if (!currLocation) return { ok: false, error: "Current location is required." };
  if (!origLocation) return { ok: false, error: "Hometown / birthplace is required." };
  if (!email) return { ok: false, error: "Enter a valid email address." };
  if (!logoUrl) return { ok: false, error: "A photo upload is required." };
  if (!optInModeration) return { ok: false, error: "Consent to share content is required." };

  const value: IndividualStorySubmissionInput = {
    submissionType: "individual",
    firstName,
    lastName,
    isTechNlMember,
    pronouns,
    profession,
    currLocation,
    origLocation,
    linkedin,
    email,
    nlDescription,
    whyDescription,
    dreamJob,
    story,
    optInModeration,
    optInNewsletter,
    logoUrl,
    title: `${firstName} ${lastName}`,
    companyName: "",
    body: buildIndividualBody({ nlDescription, whyDescription, dreamJob, story }),
    address: currLocation,
    contactEmail: email,
    imageUrl: logoUrl,
    linkUrl: linkedin,
  };

  return { ok: true, value };
}

export function sanitizeOrganizationSubmissionInput(input: unknown): SanitizeStoryInputResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid submission." };
  }
  const raw = input as Record<string, unknown>;

  const submitterName = sanitizePlainText(raw.submitterName, LIMITS.name);
  const submitterEmail = sanitizeEmail(raw.submitterEmail);
  const orgName = sanitizePlainText(raw.orgName, LIMITS.name);
  const isTechNlMember = sanitizePlainText(raw.isTechNlMember, LIMITS.member);
  const industry = sanitizeStringList(raw.industry, LIMITS.maxMulti, LIMITS.option);
  const nlLocation = sanitizePlainText(raw.nlLocation, LIMITS.location);
  const locations = sanitizeStringList(raw.locations, LIMITS.maxLocations, LIMITS.location);
  const websiteUrl = sanitizeHttpUrl(raw.websiteUrl, LIMITS.url);
  const linkedinUrl = sanitizeHttpUrl(raw.linkedinUrl, LIMITS.url);
  const orgContactEmail = sanitizeEmail(raw.orgContactEmail);
  const yearRaw = raw.yearEstablished;
  let yearEstablished: number | undefined;
  if (yearRaw !== undefined && yearRaw !== null && yearRaw !== "") {
    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < 1800 || year > new Date().getFullYear()) {
      return { ok: false, error: "Year established must be a valid year." };
    }
    yearEstablished = year;
  }
  const mainDescription = sanitizeMultilineText(raw.mainDescription, LIMITS.description) || undefined;
  const companyBio = sanitizeMultilineText(raw.companyBio, LIMITS.description) || undefined;
  const mediaOneUrl = sanitizeUploadUrl(raw.mediaOneUrl);
  const mediaTwoUrl = sanitizeUploadUrl(raw.mediaTwoUrl);
  const youtubeLink = sanitizeHttpUrl(raw.youtubeLink, LIMITS.url);
  const exportLocations = sanitizeStringList(raw.exportLocations, LIMITS.maxLocations, LIMITS.location);
  const stakeholderDescription =
    sanitizeMultilineText(raw.stakeholderDescription, LIMITS.shortAnswer) || undefined;
  const storyDescription = sanitizeMultilineText(raw.storyDescription, LIMITS.shortAnswer) || undefined;
  const logoUrl = sanitizeUploadUrl(raw.logoUrl);
  const optInModeration = raw.optInModeration === true;
  const optInNewsletter = raw.optInNewsletter === true;

  if (!submitterName) return { ok: false, error: "Submitter name is required." };
  if (!submitterEmail) return { ok: false, error: "Enter a valid submitter email." };
  if (!orgName) return { ok: false, error: "Organization name is required." };
  if (!isTechNlMember) return { ok: false, error: "techNL membership selection is required." };
  if (industry.length === 0) return { ok: false, error: "Industry is required." };
  if (!nlLocation) return { ok: false, error: "Head office location is required." };
  if (locations.length === 0) return { ok: false, error: "At least one business location is required." };
  if (!websiteUrl) return { ok: false, error: "Website URL is required." };
  if (!orgContactEmail) return { ok: false, error: "Enter a valid organization contact email." };
  if (!logoUrl) return { ok: false, error: "A logo upload is required." };
  if (!optInModeration) return { ok: false, error: "Consent to share content is required." };

  const value: OrganizationStorySubmissionInput = {
    submissionType: "organization",
    submitterName,
    submitterEmail,
    orgName,
    isTechNlMember,
    industry,
    nlLocation,
    locations,
    websiteUrl,
    linkedinUrl,
    orgContactEmail,
    yearEstablished,
    mainDescription,
    companyBio,
    mediaOneUrl,
    mediaTwoUrl,
    youtubeLink,
    exportLocations: exportLocations.length ? exportLocations : undefined,
    stakeholderDescription,
    storyDescription,
    optInModeration,
    optInNewsletter,
    logoUrl,
    title: orgName,
    companyName: orgName,
    body: buildOrganizationBody({
      mainDescription,
      companyBio,
      stakeholderDescription,
      storyDescription,
    }),
    address: nlLocation,
    contactEmail: submitterEmail,
    imageUrl: logoUrl,
    linkUrl: websiteUrl,
  };

  return { ok: true, value };
}

/** Route POST body to the correct sanitizer based on submissionType. */
export function sanitizeAnyStorySubmissionInput(input: unknown): SanitizeStoryInputResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid submission." };
  }
  const type = (input as Record<string, unknown>).submissionType;
  if (type === "individual") return sanitizeIndividualSubmissionInput(input);
  if (type === "organization") return sanitizeOrganizationSubmissionInput(input);

  const legacy = sanitizeStorySubmissionInput(input);
  if (!legacy.ok) return legacy;
  return {
    ok: true,
    value: { ...legacy.value, submissionType: "legacy" },
  };
}

export function submissionTypeLabel(submission: StorySubmission): string {
  if (submission.submissionType === "individual") return "Individual";
  if (submission.submissionType === "organization") return "Organization";
  return "Story";
}

export function isIndividualSubmission(
  submission: StorySubmission
): submission is Extract<StorySubmission, { submissionType: "individual" }> {
  return submission.submissionType === "individual";
}

export function isOrganizationSubmission(
  submission: StorySubmission
): submission is Extract<StorySubmission, { submissionType: "organization" }> {
  return submission.submissionType === "organization";
}

/** Map an approved submission onto InfoCard fields (coords/active set by caller). */
export function infoCardPayloadFromSubmission(
  submission: StorySubmission
): Omit<InfoCard, "id" | "lat" | "lng" | "mapX" | "mapY" | "active"> {
  const cardType = submission.submissionType === "individual" ? "individual" : "organization";
  const base: Omit<InfoCard, "id" | "lat" | "lng" | "mapX" | "mapY" | "active"> = {
    title: submission.title,
    body: submission.body,
    companyName: submission.companyName || undefined,
    address: submission.address,
    imageUrl: submission.imageUrl || undefined,
    linkUrl: submission.linkUrl || undefined,
    cardType,
  };

  if (isIndividualSubmission(submission)) {
    return {
      ...base,
      firstName: submission.firstName,
      lastName: submission.lastName,
      isTechNlMember: submission.isTechNlMember,
      pronouns: submission.pronouns,
      profession: submission.profession,
      currLocation: submission.currLocation,
      origLocation: submission.origLocation,
      linkedin: submission.linkedin,
      email: submission.email,
      nlDescription: submission.nlDescription,
      whyDescription: submission.whyDescription,
      dreamJob: submission.dreamJob,
      story: submission.story,
      optInModeration: submission.optInModeration,
      optInNewsletter: submission.optInNewsletter,
      logoUrl: submission.logoUrl,
    };
  }

  if (isOrganizationSubmission(submission)) {
    return {
      ...base,
      submitterName: submission.submitterName,
      submitterEmail: submission.submitterEmail,
      orgName: submission.orgName,
      isTechNlMember: submission.isTechNlMember,
      industry: submission.industry,
      nlLocation: submission.nlLocation,
      locations: submission.locations,
      websiteUrl: submission.websiteUrl,
      linkedinUrl: submission.linkedinUrl,
      orgContactEmail: submission.orgContactEmail,
      yearEstablished: submission.yearEstablished,
      mainDescription: submission.mainDescription,
      companyBio: submission.companyBio,
      mediaOneUrl: submission.mediaOneUrl,
      mediaTwoUrl: submission.mediaTwoUrl,
      youtubeLink: submission.youtubeLink,
      exportLocations: submission.exportLocations,
      stakeholderDescription: submission.stakeholderDescription,
      storyDescription: submission.storyDescription,
      optInModeration: submission.optInModeration,
      optInNewsletter: submission.optInNewsletter,
      logoUrl: submission.logoUrl,
    };
  }

  return base;
}

export type { StorySubmissionInput };
