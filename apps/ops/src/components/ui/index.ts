// Barrel for the ops design system. `primitives.tsx` used to live one level
// up as `components/ui.tsx`, where it shadowed this folder — every import of
// '../components/ui' resolved to the file, not the barrel. Moving it in here
// keeps all 17 existing import sites working while exposing the new
// components through the same specifier.
export * from './primitives';
// Shared ops UI foundation. Import from here, not from the individual files:
//
//   import { Icon, BottomSheet, SegmentedControl } from '../components/ui';
//
// The older primitives (Screen, Card, Button, Field, …) still live in
// `components/ui.tsx` — this folder is the layer above them: gestures, overlays
// and the controls that recur across the map, task and damage screens.
//
// HEADS UP: `components/ui.tsx` shadows this directory. Both Metro and tsc
// resolve a sibling `.tsx` file before a folder's `index.ts`, so
// `from '../components/ui'` still lands on the old primitives file and this
// barrel must be imported as `'../components/ui/index'` until the two are
// merged (move ui.tsx's exports in here and re-export them below).
export { Icon, type IconName } from './Icon';
export { BottomSheet, SheetHeader, type BottomSheetProps } from './BottomSheet';
export { PhotoViewer, PhotoStrip, type PhotoViewerProps } from './PhotoViewer';
export { SegmentedControl, type SegmentOption } from './SegmentedControl';
export { Chip, ChipGroup, type ChipOption, type ChipTone, type ChipGroupProps } from './Chip';
export { SearchBar } from './SearchBar';
