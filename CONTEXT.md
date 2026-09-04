# Munari

Munari keeps live DOM content available as physical matter in a Three scene.
This glossary names the content, its renderer holds, and the evidence for a
handoff.

## Language

### Content and ownership

**Retained content**:
The live content, state, and interaction that remain meaningful while its
pixels change renderer. A captured image is one rendering of that content.
_Avoid_: Rebuilt renderer UI.

**Surface**:
One logical piece of retained content, with a stable identity and optional
presentations. A Surface can contain named parts.
_Avoid_: Mesh, texture, canvas when referring to the whole Surface.

**Part**:
One named source and its presenters within a Surface. The Surface's exclusive
handoff includes its complete declared part set.

**Source**:
The content that supplies pixels to a Surface. A source can serve another
material without having its own visible presentation.

**Presentation**:
A renderer's representation of the content. Its existence does not establish
that the user can see it.

**Presenter**:
A participant that draws a Surface's content and supplies draw evidence.

**Page presentation**:
The native DOM representation of retained content. It owns layout,
accessibility, focus, and the browser's ordinary input path.

**Scene presentation**:
A scene representation of retained content. It owns scene geometry, material,
placement, and its draw evidence; it does not own the source.

**Scene boundary**:
The lifecycle boundary for one Surface's custom scene contribution. It keeps
that contribution alive through preparation, reversal, return, and cleanup.
The boundary cannot retain the caller-owned scene host.

**Scene host**:
The shared renderer boundary used by Surface presentations. Its lifetime is
independent of any one Surface or scene contribution, and its owner keeps it
alive while those resources need it.

**Renderer hold**:
The authority to show and receive input for an exclusive Surface at a given
point in its handoff.
_Avoid_: Request, progress, or readiness as substitutes for the hold.

**Destination**:
The renderer endpoint the application requests. It can differ from the
current hold while the handoff waits for evidence or motion.

**Handoff**:
The guarded transfer of a renderer hold. The outgoing renderer retains its
duty until the incoming path meets the transfer contract.

**Release**:
The end of a presenter's duty to show or receive input for content. Resource
removal and the final clearing draw can finish after that boundary.

### Presentation modes

**Exclusive Surface**:
A Surface whose page and scene presentations exchange one renderer hold.

**Twin Surface**:
A Surface with concurrent page and scene presentations, without an exclusive
handoff between them. The page remains primary for keyboard and accessibility.

**Resident Surface**:
A Surface with a scene presentation and no page presentation. It starts at the
scene endpoint without a page handoff delay or protocol frame loop, while
readiness and presentation evidence remain separate.

**Source-only Surface**:
A Surface that supplies a capture without registering its own presenter.
The absence of presenter readiness is valid in this mode.

### Evidence and motion

**Progress**:
The amount of a Surface's motion between its page and scene destinations.
Progress describes motion, not proof of a renderer hold.

**Paint generation**:
One successful captured version of a source. A generation has meaning with
its source identity and lifetime, not as a number shared across sources.

**Paint-matched anchor**:
A named content region measured with the successful paint that supplies its
pixels. A current layout box beside an older raster is not paint-matched.

**Readiness**:
Evidence that the declared parts have presenters and their first eligible
draws. Readiness alone does not establish screen presentation.

**Presentation receipt**:
Evidence that a draw met a particular presentation requirement. It does not
prove the visual quality of arbitrary material, occlusion, or scene policy.

**Perceptual floor**:
A measured minimum below which a correct mechanism cannot be seen or felt
under the stated viewing and gesture conditions.

**Browser gate**:
A runnable check of a named browser behavior with an explicit failure limit.
A capability skip is an untested path, not a passing behavior check.
