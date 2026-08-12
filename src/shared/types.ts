import { getRipplesSimDurationMs, getRipplesOriginMapXY } from "./ripplesSim";

export type CardType = "individual" | "organization";

/** Absent or unknown cardType is treated as organization (legacy cards). */
export function resolveCardType(card: Pick<InfoCard, "cardType">): CardType {
  return card.cardType === "individual" ? "individual" : "organization";
}

export function filterCardsByType(cards: readonly InfoCard[], type: CardType): InfoCard[] {
  return cards.filter((card) => resolveCardType(card) === type);
}

export interface InfoCard {
  id: string;
  title: string;
  body: string;
  companyName?: string;
  address: string;
  lat: number;
  lng: number;
  /** Normalized horizontal position on the reference image, 0 (left) – 1 (right). */
  mapX: number;
  /** Normalized vertical position on the reference image, 0 (top) – 1 (bottom). */
  mapY: number;
  imageUrl?: string;
  linkUrl?: string;
  active: boolean;
  /** Absent on older stored cards; treat as organization. */
  cardType?: CardType;

  // Individual Get Noticed fields
  firstName?: string;
  lastName?: string;
  pronouns?: string;
  profession?: string[];
  currLocation?: string;
  origLocation?: string;
  linkedin?: string;
  email?: string;
  nlDescription?: string;
  whyDescription?: string;
  dreamJob?: string;
  story?: string;

  // Organization Get Noticed fields
  submitterName?: string;
  submitterEmail?: string;
  orgName?: string;
  industry?: string[];
  nlLocation?: string;
  locations?: string[];
  websiteUrl?: string;
  linkedinUrl?: string;
  orgContactEmail?: string;
  yearEstablished?: number;
  mainDescription?: string;
  companyBio?: string;
  mediaOneUrl?: string;
  mediaTwoUrl?: string;
  youtubeLink?: string;
  exportLocations?: string[];
  stakeholderDescription?: string;
  storyDescription?: string;

  // Shared Get Noticed fields
  isTechNlMember?: string;
  logoUrl?: string;
  optInModeration?: boolean;
  optInNewsletter?: boolean;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

export type SubmissionType = "legacy" | "individual" | "organization";

/** Shared display fields used by admin list/approve for every submission shape. */
export interface StorySubmissionCore {
  id: string;
  submittedAt: string;
  /** Absent on older stored rows; treat as legacy. */
  submissionType?: SubmissionType;
  title: string;
  companyName: string;
  body: string;
  address: string;
  contactEmail?: string;
  imageUrl?: string;
  linkUrl?: string;
}

export interface IndividualSubmissionFields {
  firstName: string;
  lastName: string;
  isTechNlMember: string;
  pronouns?: string;
  profession: string[];
  currLocation: string;
  origLocation: string;
  linkedin?: string;
  email: string;
  nlDescription?: string;
  whyDescription?: string;
  dreamJob?: string;
  story?: string;
  optInModeration: boolean;
  optInNewsletter: boolean;
  logoUrl: string;
}

export interface OrganizationSubmissionFields {
  submitterName: string;
  submitterEmail: string;
  orgName: string;
  isTechNlMember: string;
  industry: string[];
  nlLocation: string;
  locations: string[];
  websiteUrl: string;
  linkedinUrl?: string;
  orgContactEmail: string;
  yearEstablished?: number;
  mainDescription?: string;
  companyBio?: string;
  mediaOneUrl?: string;
  mediaTwoUrl?: string;
  youtubeLink?: string;
  exportLocations?: string[];
  stakeholderDescription?: string;
  storyDescription?: string;
  optInModeration: boolean;
  optInNewsletter: boolean;
  logoUrl: string;
}

export interface LegacyStorySubmission extends StorySubmissionCore {
  submissionType?: "legacy";
}

export interface IndividualStorySubmission extends StorySubmissionCore, IndividualSubmissionFields {
  submissionType: "individual";
}

export interface OrganizationStorySubmission extends StorySubmissionCore, OrganizationSubmissionFields {
  submissionType: "organization";
}

/** Public story submission awaiting admin review before map placement. */
export type StorySubmission =
  | LegacyStorySubmission
  | IndividualStorySubmission
  | OrganizationStorySubmission;

export type LegacyStorySubmissionInput = Omit<LegacyStorySubmission, "id" | "submittedAt"> & {
  submissionType?: "legacy";
};
export type IndividualStorySubmissionInput = Omit<IndividualStorySubmission, "id" | "submittedAt">;
export type OrganizationStorySubmissionInput = Omit<OrganizationStorySubmission, "id" | "submittedAt">;

export type StorySubmissionInput =
  | LegacyStorySubmissionInput
  | IndividualStorySubmissionInput
  | OrganizationStorySubmissionInput;

/**
 * A known place pinned at its true position on the (artistic) reference map.
 * Used to fit a projection from real lat/lng to normalized map coords, since a
 * stylized map does not match a textbook equirectangular world projection.
 */
export interface CalibrationPoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
  mapX: number;
  mapY: number;
}

export const MAP_REFERENCE_PATH = "/map-reference.jpg";
/** Admin pin editor uses the tighter crop of the wall photo (not the AR tracking image). */
export const MAP_ADMIN_REFERENCE_PATH = "/map-reference%20-%20cropped.jpg";
export const MAP_TARGET_PATH = "/map-target.mind";
export const RIPPLES_GIF_PATH = "/assets/ripples.gif";
export const RIPPLES_FADE_GIF_PATH = "/assets/ripples-fade.gif";
/** @deprecated Prefer getRipplesSimDurationMs from ripplesSim — kept for admin GIF preview. */
export const RIPPLES_LOOP_DURATION_MS = 11030;
export const RIPPLES_FADE_DURATION_MS = 11130;
export const DEFAULT_MAP_ASPECT_RATIO = 1.5;

export type RipplesVariant = "loop" | "fade";

/** Placement of one ripples shader variant on the AR reference map. */
export interface RipplesAnchorPlacement {
  mapX: number;
  mapY: number;
  originX: number;
  originY: number;
  widthRatio: number;
}

/** Saved ripples configuration for the AR viewer and admin editor. */
export interface RipplesAnchor {
  activeVariant: RipplesVariant;
  loop: RipplesAnchorPlacement;
  fade: RipplesAnchorPlacement;
}

export const DEFAULT_RIPPLES_PLACEMENT: RipplesAnchorPlacement = {
  ...getRipplesOriginMapXY(),
  originX: 0.33,
  originY: 0.67,
  widthRatio: 1,
};

export const DEFAULT_RIPPLES_ANCHOR: RipplesAnchor = {
  activeVariant: "loop",
  loop: { ...DEFAULT_RIPPLES_PLACEMENT },
  fade: { ...DEFAULT_RIPPLES_PLACEMENT },
};

export function getRipplesGifPath(variant: RipplesVariant): string {
  return variant === "fade" ? RIPPLES_FADE_GIF_PATH : RIPPLES_GIF_PATH;
}

/** Procedural ripples duration (matches ripples.py total_duration). */
export function getRipplesPlayDurationMs(_variant?: RipplesVariant): number {
  return getRipplesSimDurationMs();
}

export function getRipplesPlacement(config: RipplesAnchor, variant: RipplesVariant): RipplesAnchorPlacement {
  return config[variant];
}

export function getActiveRipplesPlacement(config: RipplesAnchor): RipplesAnchorPlacement {
  return getRipplesPlacement(config, config.activeVariant);
}

/** Pixel crop of `map-reference - cropped.jpg` within `map-reference.jpg`. */
export const MAP_ADMIN_CROP = {
  originalWidth: 4032,
  originalHeight: 3024,
  x: 313,
  y: 830,
  width: 3345,
  height: 1696,
} as const;

export const SEED_CARDS: InfoCard[] = [
  {
    id: "seed-st-johns",
    title: "St. John's, NL",
    body: "A Newfoundland & Labrador tech company is building ocean intelligence platforms from St. John's, helping coastal communities monitor marine conditions in real time.",
    companyName: "NL Ocean Tech",
    address: "St. John's, NL, Canada",
    lat: 47.5615,
    lng: -52.7126,
    mapX: 0.28,
    mapY: 0.38,
    active: true,
    cardType: "organization",
  },
  {
    id: "seed-london",
    title: "London, UK",
    body: "The same NL team partners with European ports to deploy predictive logistics software, reducing shipping delays across the Atlantic corridor.",
    companyName: "NL Ocean Tech",
    address: "London, United Kingdom",
    lat: 51.5074,
    lng: -0.1278,
    mapX: 0.52,
    mapY: 0.35,
    active: true,
    cardType: "organization",
  },
];
