export const planets = [
  {
    id: "mercury",
    name: "Mercury",
    color: 0xa69789,
    orbit: 4.8,
    size: 0.42,
    phase: 2.57,
    tilt: 0.01,
  },
  {
    id: "venus",
    name: "Venus",
    color: 0xe4bc83,
    orbit: 7.1,
    size: 0.62,
    phase: 0.14,
    tilt: 3.09,
  },
  {
    id: "earth",
    name: "Earth",
    color: 0x638ee5,
    orbit: 9.7,
    size: 0.69,
    phase: 0.56,
    tilt: 0.41,
  },
  {
    id: "mars",
    name: "Mars",
    color: 0xd47750,
    orbit: 12.9,
    size: 0.5,
    phase: 1.48,
    tilt: 0.44,
  },
  {
    id: "jupiter",
    name: "Jupiter",
    color: 0xd5ad8f,
    orbit: 18.1,
    size: 1.62,
    phase: 5.83,
    tilt: 0.05,
  },
  {
    id: "saturn",
    name: "Saturn",
    color: 0xddc69c,
    orbit: 23.1,
    size: 1.28,
    phase: 0.88,
    tilt: 0.47,
  },
  {
    id: "uranus",
    name: "Uranus",
    color: 0x95d7da,
    orbit: 28.5,
    size: 0.91,
    phase: 4.18,
    tilt: 1.71,
  },
  {
    id: "neptune",
    name: "Neptune",
    color: 0x6d95d1,
    orbit: 34.2,
    size: 0.87,
    phase: 5.02,
    tilt: 0.49,
  },
] as const;

export type PlanetId = (typeof planets)[number]["id"];

export const solarRoute = [
  "system",
  "sun",
  ...planets.map((planet) => planet.id),
] as const;
export type SolarDestination = (typeof solarRoute)[number];

export const destinationGroups = [
  {
    label: "Solar System",
    ids: solarRoute,
  },
  { label: "Deep Space", ids: ["galaxy", "blackhole"] },
  { label: "Habitat", ids: ["station"] },
] as const;

export type Destination = (typeof destinationGroups)[number]["ids"][number];

const stationViews = ["orbital", "cutaway", "habitat", "ground"] as const;
export type View = (typeof stationViews)[number];

export function locationFromHash(hash: string) {
  const [id, mode] = hash.slice(1).split("/");
  for (const { ids } of destinationGroups) {
    const destination = ids.find((stop) => stop === id);
    if (!destination) continue;
    const view =
      destination === "station"
        ? stationViews.find((view) => view === mode) ?? "orbital"
        : "orbital";
    return { destination, view };
  }
}

export function isSolarDestination(id: Destination): id is SolarDestination {
  return solarRoute.some((stop) => stop === id);
}

export type DestinationInfo = {
  name: string;
  color: number;
};

const specialDestinations = {
  system: {
    name: "Solar System",
    color: 0xc5d9fb,
  },
  sun: {
    name: "Sun",
    color: 0xffbc77,
  },
  galaxy: {
    name: "Milky Way",
    color: 0xc7b9e6,
  },
  blackhole: {
    name: "Gargantua",
    color: 0xffb681,
  },
  station: {
    name: "Cooper Station",
    color: 0xaac8ef,
  },
} satisfies Partial<Record<Destination, DestinationInfo>>;

export function destinationInfo(id: Destination): DestinationInfo {
  const planet = planets.find((body) => body.id === id);
  if (planet) return planet;
  switch (id) {
    case "system":
    case "sun":
    case "galaxy":
    case "blackhole":
    case "station":
      return specialDestinations[id];
    default:
      throw new Error("Unknown planet");
  }
}
