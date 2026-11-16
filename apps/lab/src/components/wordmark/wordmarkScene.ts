import {
  BufferGeometry,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { WORDMARK_GLYPHS } from "./wordmarkGlyphData";
import {
  dottedIParts,
  interpolateContours,
  meshFromRings,
  prepareContourMorph,
  type ContourMorph,
  type GlyphRing,
  type WordmarkGlyph,
} from "./wordmarkGeometry";
import {
  fixedLetterSlots,
  letterProgress,
  nextLetterClock,
  stepLetterSpring,
  type LetterClock,
  type LetterSpring,
  type WordmarkOptions,
} from "./wordmarkAnimation";
import {
  applyLetterFinish,
  initialLetterFinish,
  interpolateFinish,
  LETTER_COLORS,
  LETTER_FINISHES,
  type LetterFinish,
} from "./wordmarkMaterials";

interface Pose {
  x: number;
  y: number;
  tilt: number;
  scale: number;
}
interface Letter {
  index: number;
  character: string;
  choices: WordmarkGlyph[];
  target: WordmarkGlyph;
  rings: GlyphRing[];
  morph: ContourMorph;
  mesh: Mesh<BufferGeometry, MeshPhysicalMaterial>;
  clock: LetterClock;
  progress: number;
  fromFinish: LetterFinish;
  toFinish: LetterFinish;
  currentFinish: LetterFinish;
  slotX: number;
  pose: Record<keyof Pose, LetterSpring>;
  poseTarget: Pose;
  dodge: { x: LetterSpring; y: LetterSpring };
  floatPeriod: number;
  floatPhase: number;
}

export interface WordmarkScene {
  setOptions: (options: WordmarkOptions) => void;
  dispose: () => void;
}

const INITIAL_FONTS = [
  "Bodoni Moda",
  "Shrikhand",
  "Caveat",
  "Silkscreen",
  "Archivo",
  "Bodoni Moda",
];
const EM = 1.8;

function choose<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

function spring(x: number): LetterSpring {
  return { x, v: 0 };
}

function createEnvironment(renderer: WebGLRenderer) {
  const room = new RoomEnvironment();
  let generator: PMREMGenerator | undefined;
  try {
    generator = new PMREMGenerator(renderer);
    return generator.fromScene(room, 0.05);
  } finally {
    generator?.dispose();
    room.dispose();
  }
}

/** The host owns layout and navigation. The scene owns its canvas and GPU resources. */
export function mountWordmark(
  host: HTMLDivElement,
  initialOptions: WordmarkOptions,
  onReady: (ready: boolean) => void,
): WordmarkScene {
  let disposed = false;
  const cleanup: (() => void)[] = [];
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    for (const release of cleanup.reverse()) release();
  };
  try {
    let options = initialOptions;
    let seed = 641;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const randomPose = (): Pose => ({
      x: (random() * 2 - 1) * 0.08,
      y: (random() * 2 - 1) * 0.08,
      tilt: ((random() * 2 - 1) * Math.PI) / 18,
      scale: 1 + (random() * 2 - 1) * 0.12,
    });
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    cleanup.push(() => {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    });
    renderer.setPixelRatio(devicePixelRatio);
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.domElement.className = "munari-logo__canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(36, 1, 0.1, 100);
    const environment = createEnvironment(renderer);
    cleanup.push(() => environment.dispose());
    scene.environment = environment.texture;
    scene.add(new HemisphereLight("#ffffff", "#bec8c1", 0.45));
    const key = new DirectionalLight("#fff6e8", 2);
    key.position.set(-2.1, 2.9, 3.5);
    const fill = new DirectionalLight("#bfd4ff", 0.6);
    fill.position.set(4, 1, 2);
    scene.add(key, fill);

    const choices = [..."munari"].map((character) =>
      WORDMARK_GLYPHS.filter((glyph) => glyph.character === character),
    );
    const widths = choices.map(
      (glyphs) =>
        Math.max(...glyphs.map((glyph) => glyph.advance)) * 1.08 + 0.1,
    );
    const slots = fixedLetterSlots(widths);
    const wordWidth = widths.reduce((sum, width) => sum + width, 0);
    const letters: Letter[] = choices.map((glyphs, index) => {
      const source =
        glyphs.find((glyph) => glyph.font === INITIAL_FONTS[index]) ??
        glyphs[0];
      const target = choose(
        glyphs.filter((glyph) => glyph !== source),
        random,
      );
      const finish = initialLetterFinish(index);
      const material = new MeshPhysicalMaterial({
        ior: 1.45,
        iridescenceIOR: 1.3,
        iridescenceThicknessRange: [120, 280],
      });
      const mesh = new Mesh<BufferGeometry, MeshPhysicalMaterial>(
        new BufferGeometry(),
        material,
      );
      cleanup.push(() => {
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      mesh.name = source.character;
      scene.add(mesh);
      const pose = randomPose();
      const clock = nextLetterClock(
        0.2 + index * 0.19 + random() * 0.15,
        random,
        options,
      );
      return {
        index,
        character: source.character,
        choices: glyphs,
        target,
        rings: source.rings,
        morph: prepareContourMorph(
          source.rings,
          target.rings,
          source.character === "i",
        ),
        mesh,
        clock,
        progress: -1,
        fromFinish: finish,
        currentFinish: finish,
        toFinish: {
          ...choose(
            LETTER_FINISHES.filter((item) => item.name !== finish.name),
            random,
          ),
          color: choose(
            LETTER_COLORS.filter((color) => color !== finish.color),
            random,
          ),
        },
        slotX: slots[index],
        pose: {
          x: spring(pose.x),
          y: spring(pose.y),
          tilt: spring(pose.tilt),
          scale: spring(pose.scale),
        },
        poseTarget: pose,
        dodge: { x: spring(0), y: spring(0) },
        floatPeriod: 2.6 + random() * 2.4,
        floatPhase: random() * 2.6,
      };
    });

    function changeLetter(letter: Letter, elapsed: number) {
      const neighbors = [
        letters[letter.index - 1],
        letters[letter.index + 1],
      ].filter(Boolean);
      const target = choose(
        letter.choices.filter(
          (glyph) =>
            glyph.font !== letter.target.font &&
            !neighbors.some((other) => other.target.font === glyph.font),
        ),
        random,
      );
      const finish = choose(
        LETTER_FINISHES.filter(
          (item) =>
            item.name !== letter.currentFinish.name &&
            !neighbors.some((other) => other.toFinish.name === item.name),
        ),
        random,
      );
      const color = choose(
        LETTER_COLORS.filter(
          (color) =>
            color !== letter.currentFinish.color &&
            !neighbors.some((other) => other.toFinish.color === color),
        ),
        random,
      );
      try {
        const morph = prepareContourMorph(
          letter.rings,
          target.rings,
          letter.character === "i",
        );
        Object.assign(letter, {
          target,
          morph,
          fromFinish: letter.currentFinish,
          toFinish: { ...finish, color },
          clock: nextLetterClock(elapsed, random, options),
          poseTarget: randomPose(),
          progress: -1,
        });
      } catch {
        letter.clock.nextAt = elapsed + 0.4 + random();
      }
    }

    function drawLetter(letter: Letter, progress: number) {
      const finish = interpolateFinish(
        letter.fromFinish,
        letter.toFinish,
        progress,
      );
      const rings = interpolateContours(letter.morph, progress);
      if (letter.character === "i" && !dottedIParts(rings))
        throw new Error("The i needs its dot");
      const { geometry } = meshFromRings(rings, finish.depth, finish.bevel);
      const positions = geometry.getAttribute("position");
      const valid =
        positions.count > 0 && positions.array.every(Number.isFinite);
      if (!valid) {
        geometry.dispose();
        throw new Error("Invalid letter geometry");
      }
      letter.mesh.geometry.dispose();
      letter.mesh.geometry = geometry;
      applyLetterFinish(letter.mesh.material, finish);
      letter.currentFinish = finish;
      letter.rings = rings;
      letter.progress = progress;
    }

    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let hasSize = false,
      visible = true,
      contextLost = false,
      ready = false;
    let pending = 0,
      lastTime = 0,
      elapsed = 0,
      lastGeometryTime = -1;
    let pointer: { x: number; y: number } | null = null;
    const base = new Vector3(),
      center = new Vector3(),
      projected = new Vector3(),
      right = new Vector3(),
      up = new Vector3();

    function positionLetter(letter: Letter, dt: number) {
      const ambient = !reduced.matches;
      const { mesh, pose } = letter;
      for (const key of ["x", "y", "tilt", "scale"] as const)
        stepLetterSpring(pose[key], letter.poseTarget[key], ambient ? dt : 0);
      const float = ambient
        ? Math.cos(
            ((elapsed + letter.floatPhase) / letter.floatPeriod) * Math.PI * 2,
          ) *
          options.float *
          EM
        : 0;
      const depth = ambient
        ? Math.sin(elapsed * 1.1 + letter.index * 1.9) * options.depth * EM
        : 0;
      base.set(letter.slotX + pose.x.x * EM, pose.y.x * EM + float, depth);
      mesh.rotation.set(
        ambient ? Math.sin(elapsed * 0.8 + letter.index * 2.3) * 0.1 : 0,
        ambient ? Math.sin(elapsed * 0.6 + letter.index * 1.4) * 0.14 : 0,
        pose.tilt.x,
      );
      mesh.geometry.boundingBox?.getCenter(center);
      center.multiplyScalar(pose.scale.x).applyEuler(mesh.rotation).add(base);
      projected.copy(center).project(camera);
      const viewDepth = -center.applyMatrix4(camera.matrixWorldInverse).z;
      const pixelsPerUnit =
        host.clientHeight /
        (2 * Math.tan((camera.fov * Math.PI) / 360) * viewDepth);
      const fontPixels = EM * pixelsPerUnit;
      let targetX = 0,
        targetY = 0;
      if (pointer && ambient) {
        const dx = (projected.x * 0.5 + 0.5) * host.clientWidth - pointer.x;
        const dy = (-projected.y * 0.5 + 0.5) * host.clientHeight - pointer.y;
        const distance = Math.hypot(dx, dy),
          reach = fontPixels * 2.4;
        if (distance > 1 && distance < reach) {
          const force =
            (1 - distance / reach) ** 2 *
            Math.min(46, options.dodge * fontPixels);
          targetX = (dx / distance) * force;
          targetY = (dy / distance) * force;
        }
      }
      if (ambient) {
        stepLetterSpring(letter.dodge.x, targetX, dt);
        stepLetterSpring(letter.dodge.y, targetY, dt);
      } else {
        letter.dodge.x.x = 0;
        letter.dodge.x.v = 0;
        letter.dodge.y.x = 0;
        letter.dodge.y.v = 0;
      }
      mesh.position
        .copy(base)
        .addScaledVector(right, letter.dodge.x.x / pixelsPerUnit)
        .addScaledVector(up, -letter.dodge.y.x / pixelsPerUnit);
      mesh.rotation.x -= (letter.dodge.y.x / fontPixels) * 0.5;
      mesh.rotation.y += (letter.dodge.x.x / fontPixels) * 0.5;
      mesh.scale.setScalar(pose.scale.x);
    }

    function requestFrame() {
      if (
        !disposed &&
        !pending &&
        hasSize &&
        visible &&
        !document.hidden &&
        !contextLost
      )
        pending = requestAnimationFrame(frame);
    }

    function advanceLetter(letter: Letter, updateGeometry: boolean) {
      if (
        !reduced.matches &&
        letter.progress === 1 &&
        elapsed >= letter.clock.nextAt
      )
        changeLetter(letter, elapsed);
      const progress = reduced.matches
        ? Math.max(0, letter.progress)
        : letterProgress(letter.clock, elapsed);
      const needsGeometry =
        letter.progress < 0 ||
        (updateGeometry && Math.abs(progress - letter.progress) > 0.006) ||
        (progress === 1 && letter.progress !== 1);
      if (needsGeometry) {
        try {
          drawLetter(letter, progress);
        } catch {
          letter.clock = {
            start: elapsed - 1,
            duration: 1,
            nextAt: elapsed + 1 + random(),
          };
          letter.progress = 1;
        }
      }
    }

    function frame(now: number) {
      pending = 0;
      if (disposed || !hasSize || !visible || document.hidden || contextLost) {
        lastTime = 0;
        return;
      }
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.06) : 0;
      lastTime = now;
      if (!reduced.matches) elapsed += dt;
      const updateGeometry = elapsed - lastGeometryTime >= 1 / 45;
      for (const letter of letters) {
        advanceLetter(letter, updateGeometry);
        positionLetter(letter, dt);
      }
      if (updateGeometry) lastGeometryTime = elapsed;
      renderer.render(scene, camera);
      const allLettersDrawn = letters.every(letter => (letter.mesh.geometry.getAttribute('position')?.count ?? 0) > 0);
      if (!ready && allLettersDrawn) {
        ready = true;
        onReady(true);
      }
      if (!reduced.matches) requestFrame();
    }

    function resize() {
      const { width, height } = host.getBoundingClientRect();
      hasSize = width > 0 && height > 0;
      if (!hasSize) return;
      renderer.setPixelRatio(devicePixelRatio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const halfFov = Math.tan((camera.fov * Math.PI) / 360);
      const distance = Math.max(
        (wordWidth + 1.3) / (2 * halfFov * camera.aspect),
        2.8 / (2 * halfFov),
      );
      camera.position.set(0, distance * 0.1, distance);
      camera.lookAt(0, -0.1, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      requestFrame();
    }

    const clearPointer = () => {
      pointer = null;
      requestFrame();
    };
    const movePointer = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.buttons || reduced.matches) {
        clearPointer();
        return;
      }
      const rect = host.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      requestFrame();
    };
    const visibilityChanged = () => {
      lastTime = 0;
      clearPointer();
    };
    const contextFailed = () => {
      contextLost = true;
      ready = false;
      onReady(false);
    };
    const contextRestored = () => {
      contextLost = false;
      lastTime = 0;
      requestFrame();
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      visibilityChanged();
    });
    cleanup.push(() => {
      cancelAnimationFrame(pending);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      host.removeEventListener("pointermove", movePointer);
      host.removeEventListener("pointerleave", clearPointer);
      host.removeEventListener("pointerdown", clearPointer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", clearPointer);
      reduced.removeEventListener("change", visibilityChanged);
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        contextFailed,
      );
      renderer.domElement.removeEventListener(
        "webglcontextrestored",
        contextRestored,
      );
    });
    resizeObserver.observe(host);
    intersectionObserver.observe(host);
    host.addEventListener("pointermove", movePointer);
    host.addEventListener("pointerleave", clearPointer);
    host.addEventListener("pointerdown", clearPointer);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("resize", resize);
    window.addEventListener("blur", clearPointer);
    reduced.addEventListener("change", visibilityChanged);
    renderer.domElement.addEventListener("webglcontextlost", contextFailed);
    renderer.domElement.addEventListener(
      "webglcontextrestored",
      contextRestored,
    );
    resize();

    return {
      setOptions(next) {
        options = next;
        requestFrame();
      },
      dispose: destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
