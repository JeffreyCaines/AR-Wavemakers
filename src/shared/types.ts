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
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

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
export const MAP_TARGET_PATH = "/map-target.mind";
export const DEFAULT_MAP_ASPECT_RATIO = 1.5;

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
  },
];
