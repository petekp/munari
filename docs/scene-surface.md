# HTML that belongs in a scene

```tsx
<SurfaceCanvas camera={{ position: [0, 0, 5] }}>
  <group position={[0, 0.5, 0]}>
    <SceneSurface size={[240, 80]}>
      <div style={{ width: 240, height: 80, background: 'white' }}>Scene label</div>
    </SceneSurface>
  </group>
</SurfaceCanvas>
```

Import `SceneSurface` from the package. `size` is the HTML's capture size in CSS
pixels. Its convenience mesh is one scene unit high and preserves that aspect
ratio; the surrounding group controls its position and scale. For custom materials,
geometry, or multiple parts, use `SceneSurface.Root`, `.HTML`, and `.Mesh`.
This form has no native page presentation to return to; supply an appropriate
fallback when the scene is essential to the experience.
