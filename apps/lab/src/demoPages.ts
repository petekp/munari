import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { DemoId } from './components/sceneCatalog'

// Each advertised demo's page, keyed by its catalog id. The `satisfies`
// makes a catalog entry without a page a type error.
export const DEMO_PAGES = {
  genie: lazy(() => import('./scenes/genie/Genie').then(m => ({ default: m.GenieApp }))),
  flight: lazy(() => import('./scenes/flight/Flight').then(m => ({ default: m.FlightApp }))),
  light: lazy(() => import('./scenes/light/Light').then(m => ({ default: m.LightApp }))),
  plume: lazy(() => import('./scenes/plume/Plume').then(m => ({ default: m.PlumeApp }))),
  selection: lazy(() => import('./scenes/selection/Selection').then(m => ({ default: m.SelectionApp }))),
  'marble-hand': lazy(() => import('./scenes/marble-hand/MarbleHand').then(m => ({ default: m.MarbleHandApp }))),
  knobs: lazy(() => import('./scenes/knobs/Knobs').then(m => ({ default: m.KnobsApp }))),
  postcard: lazy(() => import('./scenes/postcard/Postcard').then(m => ({ default: m.PostcardApp }))),
  logo: lazy(() => import('./scenes/logo/Logo').then(m => ({ default: m.LogoApp }))),
  'review-notes': lazy(() => import('./scenes/review-notes/ReviewNotes').then(m => ({ default: m.ReviewNotesApp }))),
  'tear-planner': lazy(() => import('./scenes/tear-planner/TearPlanner').then(m => ({ default: m.TearPlannerApp }))),
  'cutaway-prototype': lazy(() => import('./scenes/cutaway-prototype/CutawayPrototype').then(m => ({ default: m.CutawayPrototypeApp }))),
} satisfies Record<DemoId, LazyExoticComponent<ComponentType>>
