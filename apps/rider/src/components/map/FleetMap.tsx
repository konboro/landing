// FleetMap — the map abstraction. Renders the native Mapbox map when a token is
// present AND the native module loads; otherwise falls back to a fully
// interactive styled placeholder so the app never crashes in Expo Go.
import React from 'react';
import { FallbackMap } from './FallbackMap';
import { hasMapboxToken, type FleetMapProps } from './types';

let MapboxImpl: React.ComponentType<FleetMapProps> | null | undefined;

function loadMapbox(): React.ComponentType<FleetMapProps> | null {
  if (MapboxImpl !== undefined) return MapboxImpl;
  try {
    // Only require when a token exists — keeps native code out of Expo Go.
    const mod = require('./MapboxFleetMap') as typeof import('./MapboxFleetMap');
    MapboxImpl = mod.MapboxFleetMap;
  } catch {
    MapboxImpl = null;
  }
  return MapboxImpl;
}

export function FleetMap(props: FleetMapProps) {
  if (hasMapboxToken()) {
    const Impl = loadMapbox();
    if (Impl) return <Impl {...props} />;
  }
  return <FallbackMap {...props} />;
}

export type { FleetMapProps };
