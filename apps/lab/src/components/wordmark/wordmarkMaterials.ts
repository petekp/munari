import { Color, MathUtils, MeshPhysicalMaterial } from "three";

const FINISH_DEFAULTS = {
  roughness: 0.3,
  metalness: 0,
  transmission: 0.001,
  iridescence: 0.001,
  sheen: 0.001,
  clearcoat: 0.001,
  specularIntensity: 1,
  emissiveIntensity: 0,
  envMapIntensity: 0.85,
  sheenRoughness: 0.65,
  clearcoatRoughness: 0.12,
  depth: 0.25,
  bevel: 0.025,
};
export type LetterFinish = typeof FINISH_DEFAULTS & {
  name: string;
  color: string;
};

export const LETTER_FINISHES = [
  {
    name: "Ink",
    roughness: 1,
    specularIntensity: 0.03,
    emissiveIntensity: 0.1,
    envMapIntensity: 0.35,
  },
  {
    name: "Balloon",
    roughness: 0.34,
    specularIntensity: 0.45,
    sheen: 0.15,
    clearcoat: 0.12,
    depth: 0.32,
    bevel: 0.05,
  },
  {
    name: "Foil",
    roughness: 0.16,
    metalness: 1,
    envMapIntensity: 1.2,
    bevel: 0.022,
  },
  {
    name: "Gummy",
    roughness: 0.14,
    transmission: 0.55,
    clearcoat: 0.8,
    depth: 0.34,
    bevel: 0.045,
  },
  {
    name: "Neon",
    roughness: 0.4,
    emissiveIntensity: 0.75,
    clearcoat: 0.2,
    envMapIntensity: 0.3,
    depth: 0.18,
    bevel: 0.02,
  },
  {
    name: "Chrome",
    roughness: 0.05,
    metalness: 1,
    envMapIntensity: 1.3,
    bevel: 0.016,
  },
  {
    name: "Pearl",
    roughness: 0.28,
    metalness: 0.2,
    iridescence: 0.6,
    sheen: 0.35,
    clearcoat: 0.55,
  },
  {
    name: "Velvet",
    roughness: 0.85,
    sheen: 1,
    specularIntensity: 0.15,
    envMapIntensity: 0.5,
    depth: 0.3,
    bevel: 0.035,
  },
  {
    name: "Holo",
    roughness: 0.12,
    metalness: 1,
    iridescence: 1,
    envMapIntensity: 1.1,
  },
  {
    name: "Plasma",
    roughness: 0.5,
    emissiveIntensity: 0.42,
    transmission: 0.2,
    iridescence: 0.3,
    depth: 0.3,
    bevel: 0.04,
  },
  {
    name: "Enamel",
    roughness: 0.07,
    clearcoat: 1,
    envMapIntensity: 0.8,
    bevel: 0.028,
  },
].map((finish) => ({ ...FINISH_DEFAULTS, ...finish }));

export const LETTER_COLORS = [
  "#f2695c",
  "#f07ff0",
  "#52c7f2",
  "#b47deb",
  "#66c94e",
  "#f5a53f",
  "#f76fa2",
];
const INITIAL_FINISHES = [6, 3, 7, 5, 2, 10];
const INITIAL_COLORS = [
  "#66cda8",
  "#f5a53f",
  "#b47deb",
  "#52c7f2",
  "#66c94e",
  "#f2695c",
];
const FINISH_KEYS = [
  "roughness",
  "metalness",
  "transmission",
  "iridescence",
  "sheen",
  "clearcoat",
  "specularIntensity",
  "emissiveIntensity",
  "envMapIntensity",
  "sheenRoughness",
  "clearcoatRoughness",
  "depth",
  "bevel",
] as const;
const color = new Color(),
  targetColor = new Color(),
  white = new Color("#ffffff");

export function initialLetterFinish(index: number): LetterFinish {
  return {
    ...LETTER_FINISHES[INITIAL_FINISHES[index]],
    color: INITIAL_COLORS[index],
  };
}

export function interpolateFinish(
  from: LetterFinish,
  to: LetterFinish,
  progress: number,
): LetterFinish {
  const finish = { ...from, name: progress < 0.5 ? from.name : to.name };
  for (const key of FINISH_KEYS)
    finish[key] = MathUtils.lerp(from[key], to[key], progress);
  finish.color =
    "#" +
    color
      .set(from.color)
      .lerp(targetColor.set(to.color), progress)
      .getHexString();
  return finish;
}

export function applyLetterFinish(
  material: MeshPhysicalMaterial,
  finish: LetterFinish,
): void {
  material.color.set(finish.color);
  material.attenuationColor.copy(material.color);
  material.attenuationDistance = 0.3;
  material.thickness = finish.depth * 1.8;
  material.emissive.copy(material.color);
  material.sheenColor.copy(material.color).lerp(white, 0.25);
  for (const key of FINISH_KEYS) {
    if (key !== "depth" && key !== "bevel") material[key] = finish[key];
  }
}
