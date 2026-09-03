/**
 * The climbs, transcribed from the Notion "Mountain Diaries / Climbs" database.
 *
 * IMPORTANT — what these coordinates are and are not.
 *
 * The diary entries link Strava activities but those are not machine-readable
 * from here, so each route below is an APPROXIMATE polyline built from a
 * handful of named waypoints (trailheads, huts, cols, summits), not a recorded
 * GPS track. Every waypoint is then snapped to the DEM by the seed script:
 * summits to the local maximum, huts and valley points to the nearest place
 * matching their published elevation. That makes the lines sit on real
 * terrain and reach the real summits, but the exact path between waypoints is
 * inferred.
 *
 * Tracks built this way are stored with `source: "drawn"` so they are never
 * mistaken for recorded data. Exporting the Strava GPX for any of these and
 * uploading it through /trips/new replaces the approximation with the real
 * thing.
 */

export type SnapMode = "max" | "min" | "near";

export interface Waypoint {
  name: string;
  lat: number;
  lon: number;
  /** Published elevation, metres. Used to verify or snap the coordinate. */
  ele?: number;
  /** How the seed script corrects this point against the DEM. */
  snap?: SnapMode;
  /** Search radius in degrees for snapping. */
  radius?: number;
  /** Cap on how far this point may move, metres. Defaults to 400. */
  maxMoveM?: number;
}

export interface ClimbSeed {
  peak: {
    slug: string;
    name: string;
    lat: number;
    lon: number;
    elevationM: number;
    prominenceM: number | null;
    countryCode: string;
    rangeName: string;
  };
  route: {
    slug: string;
    name: string;
    discipline: string;
    gradeSystem: string | null;
    grade: string | null;
    verticalM: number | null;
    aspectDeg: number | null;
    description: string;
  };
  trip: {
    title: string;
    startedAt: string;
    endedAt: string | null;
    outcome: "summit" | "highpoint" | "retreat" | "recon";
    notes: string;
    /** The Notion diary this was transcribed from. */
    sourceUrl: string;
  };
  waypoints: Waypoint[];
}

export const CLIMBS: ClimbSeed[] = [
  // -------------------------------------------------------------------------
  {
    peak: {
      slug: "gran-paradiso",
      name: "Gran Paradiso",
      lat: 45.5163,
      lon: 7.2686,
      elevationM: 4061,
      prominenceM: 1891,
      countryCode: "IT",
      rangeName: "Graian Alps",
    },
    route: {
      slug: "chabod",
      name: "Via Chabod Hut",
      discipline: "alpine",
      gradeSystem: "french",
      grade: "F+",
      verticalM: 2100,
      aspectDeg: 315,
      description:
        "From Pont in Valsavarenche to the Chabod hut, then the Laveciau glacier " +
        "to the summit ridge, finishing over the ladders and chains of the rocky " +
        "summit block to the Madonna.",
    },
    trip: {
      title: "Gran Paradiso — Via Chabod Hut",
      startedAt: "2025-06-22",
      endedAt: "2025-06-24",
      outcome: "summit",
      notes:
        "First glacier. Breakfast at 4am, away by 4:30 in the dark, deliberately " +
        "last out of the hut so we could follow another team. Roped up at the " +
        "glacier and climbed fast to counterbalance inexperience. Queued an hour " +
        "on the single-track summit ridge, getting cold with my thick gloves " +
        "stuck in my bag. Summit around 7:30am, about three hours of climbing. " +
        "The rocky summit traverse was far more technical than any of us " +
        "expected — crampons on granite, memorial plaques, genuine fear. Hit by " +
        "a short blizzard on the descent, then slush on the glacier by midday. " +
        "Back at Chabod 12:30pm.",
      sourceUrl: "https://app.notion.com/2127ec4ed7988072af71d74a8dce3082",
    },
    waypoints: [
      { name: "Pont, Valsavarenche", lat: 45.5344, lon: 7.2094, ele: 1960, snap: "near", radius: 0.012 },
      { name: "Chabod Hut", lat: 45.5314, lon: 7.2372, ele: 2750, snap: "near", radius: 0.008 },
      { name: "Laveciau glacier snout", lat: 45.5253, lon: 7.2494, ele: 3150, snap: "near", radius: 0.008 },
      { name: "Upper Laveciau glacier", lat: 45.5203, lon: 7.2601, ele: 3750, snap: "near", radius: 0.008 },
      { name: "Summit ridge", lat: 45.5174, lon: 7.2660, ele: 3980, snap: "near", radius: 0.004 },
      { name: "Summit", lat: 45.5163, lon: 7.2686, ele: 4061, snap: "max", radius: 0.004 },
    ],
  },

  // -------------------------------------------------------------------------
  {
    peak: {
      slug: "mont-blanc",
      name: "Mont Blanc",
      lat: 45.8326,
      lon: 6.8652,
      elevationM: 4808,
      prominenceM: 4696,
      countryCode: "IT",
      rangeName: "Graian Alps",
    },
    route: {
      slug: "italian-pope",
      name: "Italian Route (Via del Papa) via Gonella",
      discipline: "alpine",
      gradeSystem: "french",
      grade: "PD+",
      verticalM: 3150,
      aspectDeg: 225,
      description:
        "The Italian normal route from Val Veny: up the Miage glacier, a via " +
        "ferrata of ladders and cables to the Gonella hut, then the Dôme glacier " +
        "and the ridges over Piton des Italiens and Col Major to the summit.",
    },
    trip: {
      title: "Mont Blanc — Italian Route via Gonella",
      startedAt: "2025-06-26",
      endedAt: "2025-06-27",
      outcome: "summit",
      notes:
        "The easier glacier-edge approach was wrecked by landslides, so we went " +
        "up the spine of the dead glacier — like walking the backbone of a " +
        "dinosaur, and a blunt lesson in how far the ice has receded. Four hours " +
        "in, we hit the via ferrata to the Gonella and hauled 12kg packs up " +
        "ladders in mountain boots. Hut at 2pm, bed at 7pm, away at midnight. " +
        "Ascending on the glacier at night was mystical — a line of head torches " +
        "snaking up. Our guide was 64 and one of the fittest people I have met; " +
        "his lesson was the power of slowness. Rested at the bivouac before the " +
        "final 400m. The descent was the hard part: daylight revealed what the " +
        "dark had hidden, the snow softened, and every step felt treacherous. " +
        "'Stride with confidence.' Back at the hut 7:40am.",
      sourceUrl: "https://app.notion.com/2127ec4ed7988045a7d7f7e877a1ede4",
    },
    waypoints: [
      { name: "Val Veny (La Visaille)", lat: 45.7844, lon: 6.8447, ele: 1660, snap: "near", radius: 0.012 },
      { name: "Miage glacier", lat: 45.8014, lon: 6.8319, ele: 2100, snap: "near", radius: 0.010 },
      { name: "Foot of the via ferrata", lat: 45.8175, lon: 6.8206, ele: 2750, snap: "near", radius: 0.008 },
      { name: "Gonella Hut", lat: 45.8231, lon: 6.8175, ele: 3071, snap: "near", radius: 0.006 },
      { name: "Dôme glacier", lat: 45.8297, lon: 6.8339, ele: 3900, snap: "near", radius: 0.008 },
      { name: "Piton des Italiens", lat: 45.8345, lon: 6.8489, ele: 4250, snap: "near", radius: 0.006 },
      { name: "Col Major", lat: 45.8336, lon: 6.8608, ele: 4650, snap: "near", radius: 0.004 },
      { name: "Summit", lat: 45.8326, lon: 6.8652, ele: 4808, snap: "max", radius: 0.003 },
    ],
  },

  // -------------------------------------------------------------------------
  {
    peak: {
      slug: "single-cone",
      name: "Single Cone",
      lat: -45.0719,
      lon: 168.8081,
      elevationM: 2319,
      prominenceM: 1084,
      countryCode: "NZ",
      rangeName: "The Remarkables",
    },
    route: {
      slug: "ski-field-ridge",
      name: "Ski Field Ridge",
      discipline: "scramble",
      gradeSystem: null,
      grade: null,
      verticalM: 700,
      aspectDeg: 45,
      description:
        "From the Remarkables ski area base up the side of the piste to the " +
        "backcountry exit, then along the ridge through deep snow to the foot of " +
        "the final rocky summit block — which needs rope work to finish.",
    },
    trip: {
      title: "Single Cone — Snowcraft #1",
      startedAt: "2025-08-02",
      endedAt: null,
      outcome: "highpoint",
      notes:
        "Doing a Snowcraft #1 course with Vy. The plan was never the tippy top — " +
        "the summit block needs rope skills our group didn't have — but to test " +
        "everything we'd learnt over two days. Up the side of the piste to the " +
        "backcountry exit, transceiver checks, then the ridge in deep snow to " +
        "just below the final rocky outpost. Clambered carefully (hopefully not " +
        "over a cornice) to see the valley from the other side: the lake weaving " +
        "between snow-ridged mountains, one of the most incredible views I've " +
        "seen. A taste of mountain life I couldn't get out of my mouth. " +
        "(Shot the whole day on a camera with no film in it.)",
      sourceUrl: "https://app.notion.com/2447ec4ed79880d887bdedee354694b1",
    },
    waypoints: [
      { name: "Remarkables base", lat: -45.0503, lon: 168.8114, ele: 1610, snap: "near", radius: 0.010 },
      { name: "Backcountry exit", lat: -45.0578, lon: 168.8106, ele: 1900, snap: "near", radius: 0.008 },
      { name: "Ridge", lat: -45.0653, lon: 168.8094, ele: 2150, snap: "near", radius: 0.006 },
      { name: "Below the summit block", lat: -45.0705, lon: 168.8084, ele: 2270, snap: "near", radius: 0.004 },
    ],
  },

  // -------------------------------------------------------------------------
  {
    peak: {
      slug: "mount-bogong",
      name: "Mount Bogong",
      lat: -36.7374,
      lon: 147.2903,
      elevationM: 1986,
      prominenceM: 1600,
      countryCode: "AU",
      rangeName: "Victorian Alps",
    },
    route: {
      slug: "eskdale-spur",
      name: "Eskdale Spur",
      discipline: "hike",
      gradeSystem: null,
      grade: null,
      verticalM: 1350,
      aspectDeg: 340,
      description:
        "From the Mountain Creek valley up Eskdale Spur to Michell Hut, then " +
        "through the snow gums onto the open ridge and over the false top to the " +
        "rocky summit cairn on Victoria's highest mountain.",
    },
    trip: {
      title: "Mount Bogong — Eskdale Spur",
      startedAt: "2025-09-13",
      endedAt: null,
      outcome: "summit",
      notes:
        "Victoria's largest mountain — only 1,986m, but tall enough for snow, " +
        "and I do love a little bit of snow. Camped at Mountain Creek, slept in " +
        "the car, woke a little too late, so we skipped the valley walk and " +
        "started from the Eskdale Spur trailhead. Steep climb to Michell Hut " +
        "where the snow started. Crampons on past the hut — a first for Eddie — " +
        "then up through the trees onto the ridge, skiers occasionally flying " +
        "past and the drop on one side steeper than my ice axe made me " +
        "comfortable with. False top first, as always, then the main summit: a " +
        "bulbous rocky pile. Clouds came in and took the view, but not the " +
        "delight. Best part was the descent — we found our feet weren't the only " +
        "way down, and made the skiers jealous. River dunk and ramen after.",
      sourceUrl: "https://app.notion.com/2a37ec4ed79880c2b09af56de894f6d3",
    },
    waypoints: [
      { name: "Eskdale Spur trailhead", lat: -36.7742, lon: 147.3067, ele: 700, snap: "near", radius: 0.020 },
      { name: "Lower spur", lat: -36.7681, lon: 147.3105, ele: 1100, snap: "near", radius: 0.010 },
      { name: "Michell Hut", lat: -36.7614, lon: 147.3119, ele: 1551, snap: "near", radius: 0.008 },
      { name: "Onto the ridge", lat: -36.7528, lon: 147.3039, ele: 1800, snap: "near", radius: 0.008 },
      { name: "False top", lat: -36.7444, lon: 147.2961, ele: 1930, snap: "near", radius: 0.006 },
      { name: "Summit cairn", lat: -36.7374, lon: 147.2903, ele: 1986, snap: "max", radius: 0.006 },
    ],
  },

  // -------------------------------------------------------------------------
  {
    peak: {
      slug: "french-ridge",
      name: "French Ridge",
      lat: -44.4699,
      lon: 168.7599,
      elevationM: 1480,
      prominenceM: null,
      countryCode: "NZ",
      rangeName: "Mount Aspiring National Park",
    },
    route: {
      slug: "west-matukituki",
      name: "West Matukituki & French Ridge",
      discipline: "hike",
      gradeSystem: null,
      grade: null,
      verticalM: 1100,
      aspectDeg: 270,
      description:
        "From Raspberry Flat up the West Matukituki valley past Aspiring Hut, " +
        "then the notorious French Ridge climb — roughly 1,000m over 3km on a " +
        "staircase of tree roots and rock — to French Ridge Hut at 1,480m.",
    },
    trip: {
      title: "French Ridge Hut — Mount Aspiring",
      startedAt: "2026-08-09",
      endedAt: "2026-08-11",
      outcome: "highpoint",
      notes:
        "Fresh off Snowcraft #2 at the Remarkables Ice Festival and keen to test " +
        "the new gear. Day 1: Raspberry Flat up the valley under Rob Roy Peak, " +
        "with a detour to the Rob Roy Glacier lookout — view half-blocked by " +
        "overgrowth and avalanche risk stopping us going higher. Aspiring Hut " +
        "was a 20-person 'absolute chalet' and completely empty, faintly haunted, " +
        "with a possum scare. Day 2: the ridge is about 1,000m over 3km — for " +
        "every 3 metres forward you gain 1 up. Four hours: two grinding through " +
        "forest where ancient roots form a staircase you grip and climb, one " +
        "scrambling rock, and a last hour plodding snow. First time Vy and I had " +
        "felt truly alone on snow on a ridgeline — honestly a bit scary. Day 3: " +
        "broke the descent into four phases — the Snow, the Roots, the hike to " +
        "the hut, the walk out. Vy's knees went, so I took their pack for the " +
        "last kilometres. A milestone in my recovery journey.",
      sourceUrl: "https://app.notion.com/3b17ec4ed79880fb86d2f2d8f5aaf9c5",
    },
    waypoints: [
      { name: "Raspberry Flat car park", lat: -44.5306, lon: 168.7239, ele: 460, snap: "near", radius: 0.020 },
      { name: "Matukituki bridge", lat: -44.5203, lon: 168.7186, ele: 450, snap: "near", radius: 0.010 },
      { name: "Aspiring Hut", lat: -44.5081, lon: 168.7109, ele: 470, snap: "near", radius: 0.010 },
      { name: "Base of French Ridge", lat: -44.4842, lon: 168.7381, ele: 520, snap: "near", radius: 0.012 },
      { name: "Forest / root staircase", lat: -44.4778, lon: 168.7481, ele: 950, snap: "near", radius: 0.008 },
      { name: "Rock scramble", lat: -44.4731, lon: 168.7551, ele: 1250, snap: "near", radius: 0.006 },
      { name: "French Ridge Hut", lat: -44.4699, lon: 168.7599, ele: 1480, snap: "near", radius: 0.005 },
    ],
  },
];
