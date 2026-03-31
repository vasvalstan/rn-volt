import Mapbox from "@rnmapbox/maps";

const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (typeof token === "string" && token.length > 0) {
  Mapbox.setAccessToken(token);
}

const VOLT_DOODLE_STYLE_SPEC = {
  version: 8,
  name: "Volt Doodle",
  sources: {
    composite: {
      url: "mapbox://mapbox.mapbox-streets-v8",
      type: "vector",
    },
  },
  sprite: "mapbox://sprites/mapbox/light-v11",
  glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#FFEAF2" },
    },
    {
      id: "landuse",
      type: "fill",
      source: "composite",
      "source-layer": "landuse",
      paint: { "fill-color": "#FFEAF2", "fill-opacity": 1 },
    },
    {
      id: "park",
      type: "fill",
      source: "composite",
      "source-layer": "landuse",
      filter: ["==", "class", "park"],
      paint: { "fill-color": "rgba(0,229,160,0.35)", "fill-opacity": 1 },
    },
    {
      id: "grass",
      type: "fill",
      source: "composite",
      "source-layer": "landuse",
      filter: ["==", "class", "grass"],
      paint: { "fill-color": "rgba(0,229,160,0.25)", "fill-opacity": 1 },
    },
    {
      id: "water",
      type: "fill",
      source: "composite",
      "source-layer": "water",
      paint: { "fill-color": "rgba(14,165,233,0.25)" },
    },
    {
      id: "waterway",
      type: "line",
      source: "composite",
      "source-layer": "waterway",
      paint: {
        "line-color": "rgba(14,165,233,0.35)",
        "line-width": 2,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "building",
      type: "fill",
      source: "composite",
      "source-layer": "building",
      paint: {
        "fill-color": "rgba(255,45,120,0.08)",
        "fill-outline-color": "rgba(26,26,26,0.3)",
      },
    },
    // Road casings (thick black outlines)
    {
      id: "road-casing-motorway",
      type: "line",
      source: "composite",
      "source-layer": "road",
      filter: ["==", "class", "motorway"],
      paint: { "line-color": "#1A1A1A", "line-width": 14 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "road-casing-trunk",
      type: "line",
      source: "composite",
      "source-layer": "road",
      filter: ["==", "class", "trunk"],
      paint: { "line-color": "#1A1A1A", "line-width": 12 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "road-casing-primary",
      type: "line",
      source: "composite",
      "source-layer": "road",
      filter: ["==", "class", "primary"],
      paint: { "line-color": "#1A1A1A", "line-width": 10 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "road-casing-secondary",
      type: "line",
      source: "composite",
      "source-layer": "road",
      filter: ["==", "class", "secondary"],
      paint: { "line-color": "#1A1A1A", "line-width": 8 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "road-casing-tertiary",
      type: "line",
      source: "composite",
      "source-layer": "road",
      filter: ["==", "class", "tertiary"],
      paint: { "line-color": "#1A1A1A", "line-width": 6 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "road-casing-street",
      type: "line",
      source: "composite",
      "source-layer": "road",
      filter: ["==", "class", "street"],
      paint: { "line-color": "rgba(26,26,26,0.5)", "line-width": 4 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    // Road fills (cream/white interiors)
    {
      id: "road-fill-motorway",
      type: "line",
      source: "composite",
      "source-layer": "road",
      filter: ["==", "class", "motorway"],
      paint: { "line-color": "#FFFCEB", "line-width": 10 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "road-fill-trunk",
      type: "line",
      source: "composite",
      "source-layer": "road",
      filter: ["==", "class", "trunk"],
      paint: { "line-color": "#FFFCEB", "line-width": 8 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "road-fill-primary",
      type: "line",
      source: "composite",
      "source-layer": "road",
      filter: ["==", "class", "primary"],
      paint: { "line-color": "#F5F5F0", "line-width": 6 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "road-fill-secondary",
      type: "line",
      source: "composite",
      "source-layer": "road",
      filter: ["==", "class", "secondary"],
      paint: { "line-color": "#F5F5F0", "line-width": 5 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "road-fill-tertiary",
      type: "line",
      source: "composite",
      "source-layer": "road",
      filter: ["==", "class", "tertiary"],
      paint: { "line-color": "#FFFFFF", "line-width": 3.5 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "road-fill-street",
      type: "line",
      source: "composite",
      "source-layer": "road",
      filter: ["==", "class", "street"],
      paint: { "line-color": "#FFFFFF", "line-width": 2 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    // Road labels
    {
      id: "road-label",
      type: "symbol",
      source: "composite",
      "source-layer": "road",
      filter: ["has", "name"],
      layout: {
        "text-field": ["get", "name"],
        "text-size": 10,
        "symbol-placement": "line",
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
      },
      paint: {
        "text-color": "#1A1A1A",
        "text-halo-color": "#FFFCEB",
        "text-halo-width": 1.5,
      },
    },
    // Place labels
    {
      id: "place-label",
      type: "symbol",
      source: "composite",
      "source-layer": "place_label",
      layout: {
        "text-field": ["get", "name"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8, 12,
          14, 16,
        ],
        "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
        "text-max-width": 8,
      },
      paint: {
        "text-color": "#1A1A1A",
        "text-halo-color": "#FFEAF2",
        "text-halo-width": 2,
      },
    },
  ],
};

export const VOLT_DOODLE_STYLE_URL = `data:application/json,${encodeURIComponent(
  JSON.stringify(VOLT_DOODLE_STYLE_SPEC),
)}`;
