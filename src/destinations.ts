/** `orbit` is the scene radius of the planet's (compressed) orbit. */
export const planets = [
  {
    id: "mercury",
    name: "Mercury",
    color: 0xa69789,
    orbit: 4.8,
    tilt: 0.01,
  },
  {
    id: "venus",
    name: "Venus",
    color: 0xe4bc83,
    orbit: 7.1,
    tilt: 3.09,
  },
  {
    id: "earth",
    name: "Earth",
    color: 0x638ee5,
    orbit: 9.7,
    tilt: 0.41,
  },
  {
    id: "mars",
    name: "Mars",
    color: 0xd47750,
    orbit: 12.9,
    tilt: 0.44,
  },
  {
    id: "jupiter",
    name: "Jupiter",
    color: 0xd5ad8f,
    orbit: 18.1,
    tilt: 0.05,
  },
  {
    id: "saturn",
    name: "Saturn",
    color: 0xddc69c,
    orbit: 23.1,
    tilt: 0.47,
  },
  {
    id: "uranus",
    name: "Uranus",
    color: 0x95d7da,
    orbit: 28.5,
    tilt: 1.71,
  },
  {
    id: "neptune",
    name: "Neptune",
    color: 0x6d95d1,
    orbit: 34.2,
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
