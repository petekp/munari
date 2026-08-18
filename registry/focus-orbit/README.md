# Focus orbit

Copy `FocusOrbitRig.tsx`, `cameraPose.ts`, and `arcLayout.ts` together.
They are the Workspace camera and layout policy: a cylindrical panel wall,
camera approach and home poses, reframe turns, and focus-navigation nudges.

The recipe consumes Munari's public focus API. It does not implement focus,
Surface behavior, or renderer handoff rules.
