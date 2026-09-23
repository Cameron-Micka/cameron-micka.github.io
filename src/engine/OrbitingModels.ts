import type { GltfAsset, GltfDraw, GltfFrame } from './gltf/types';
import { mat4 } from './math/mat4';
import { quat } from './math/quat';
import { mulberry32 } from './math/rng';
import { vec3 } from './math/vec3';
import type {
  FrameState,
  PlanetInstance,
  OrbitingModelInstance,
} from './types';

export const ORBITING_MODELS = {
  ringWorld: {
    feature: 'ringWorld',
    instances: 'ringWorlds',
    path: 'models/broken-ring.glb',
    label: 'ring world',
  },
  spaceStation: {
    feature: 'spaceStation',
    instances: 'spaceStations',
    path: 'models/death-star-ii.glb',
    label: 'space station',
  },
} as const;

type OrbitingModelDefinition =
  (typeof ORBITING_MODELS)[keyof typeof ORBITING_MODELS];

function companionOrbitRadius(planet: PlanetInstance, radius: number): number {
  let orbitRadius = planet.radius * 2.4;
  for (const moon of planet.moons) {
    orbitRadius = Math.max(
      orbitRadius,
      moon.orbitRadius + moon.size + radius + planet.radius * 0.1,
    );
  }
  return orbitRadius;
}

export function buildRingWorlds(
  planets: readonly PlanetInstance[],
  moonTime: number,
): OrbitingModelInstance[] {
  const instances: OrbitingModelInstance[] = [];
  for (const planet of planets) {
    if (!planet.ringWorld || planet.visibility <= 0.02) continue;
    const radius = planet.radius * 0.5;
    const orbitRadius = companionOrbitRadius(planet, radius);
    const phase = mulberry32(planet.seed ^ 0x72696e67)() * Math.PI * 2 - 0.35;
    const angle = phase - moonTime * 0.12;
    const orbit = orbitRadius * planet.visibility;
    const offset = quat.rotateVec3(planet.orientation, [
      Math.cos(angle) * orbit,
      Math.sin(angle) * Math.sin(0.75) * orbit,
      Math.sin(angle) * Math.cos(0.75) * orbit,
    ]);
    const tilt = quat.multiply(
      quat.fromAxisAngle([0, 1, 0], 0.7),
      quat.fromAxisAngle([0, 0, 1], 0.65 + moonTime * 0.045),
    );
    instances.push({
      planet: planet.slug,
      center: vec3.add(planet.center, offset),
      radius: radius * planet.visibility,
      orientation: quat.multiply(planet.orientation, tilt),
    });
  }
  return instances;
}

export function buildSpaceStations(
  planets: readonly PlanetInstance[],
  moonTime: number,
): OrbitingModelInstance[] {
  const instances: OrbitingModelInstance[] = [];
  for (const planet of planets) {
    if (!planet.spaceStation || planet.visibility <= 0.02) continue;
    const radius = planet.radius * 0.55;
    let orbitRadius = companionOrbitRadius(planet, radius);
    if (planet.ringWorld) {
      const ringRadius = planet.radius * 0.5;
      orbitRadius = Math.max(
        orbitRadius,
        companionOrbitRadius(planet, ringRadius) +
          ringRadius +
          radius +
          planet.radius * 0.1,
      );
    }
    const phase = mulberry32(planet.seed ^ 0x73746174)() * Math.PI * 2;
    const angle = phase - moonTime * 0.18;
    const orbit = orbitRadius * planet.visibility;
    const offset = quat.rotateVec3(planet.orientation, [
      Math.cos(angle) * orbit,
      Math.sin(angle) * Math.sin(0.35) * orbit,
      Math.sin(angle) * Math.cos(0.35) * orbit,
    ]);
    const spin = quat.multiply(
      quat.fromAxisAngle([1, 0, 0], 0.18),
      quat.fromAxisAngle([0, 1, 0], 0.4 + moonTime * 0.08),
    );
    instances.push({
      planet: planet.slug,
      center: vec3.add(planet.center, offset),
      radius: radius * planet.visibility,
      orientation: quat.multiply(planet.orientation, spin),
    });
  }
  return instances;
}

// Geometry/textures are shared; only draw transforms are duplicated per planet.
// One native render call also keeps WebGPU uniforms distinct until submission.
export class OrbitingModelScene {
  readonly asset: GltfAsset;
  private readonly draws = new Map<string, GltfDraw[]>();
  private readonly baseTransforms: Float32Array<ArrayBuffer>[];
  private readonly model = mat4.create();
  private readonly assetRadius: number;
  private readonly frame: GltfFrame = {
    viewProjection: mat4.create(),
    view: mat4.create(),
    cameraPosition: [0, 0, 0],
    keyLight: { direction: [0, 1, 0], color: [3.2, 3.05, 2.85] },
    fillLight: { direction: [0, -1, 0], color: [0.01, 0.015, 0.025] },
    ambientSky: [0.012, 0.018, 0.035],
    ambientGround: [0.006, 0.008, 0.018],
    fog: { color: [0.04, 0.06, 0.14], density: 0.018 },
    output: 'linear',
  };

  constructor(
    readonly definition: OrbitingModelDefinition,
    asset: GltfAsset,
    planets: readonly string[],
  ) {
    if (!planets.length || new Set(planets).size !== planets.length) {
      throw new Error(
        `Parent planets for ${definition.label} must be nonempty and unique.`,
      );
    }
    this.assetRadius = Math.hypot(
      Math.max(Math.abs(asset.bounds.min[0]), Math.abs(asset.bounds.max[0])),
      Math.max(Math.abs(asset.bounds.min[1]), Math.abs(asset.bounds.max[1])),
      Math.max(Math.abs(asset.bounds.min[2]), Math.abs(asset.bounds.max[2])),
    );
    if (
      !Number.isFinite(this.assetRadius) ||
      this.assetRadius <= 0 ||
      !asset.draws.length
    ) {
      throw new Error(
        `The ${definition.label} asset must have finite, nonzero bounds and drawable geometry.`,
      );
    }
    this.baseTransforms = asset.draws.map(
      (draw) => new Float32Array(draw.transform),
    );
    for (const planet of planets) {
      this.draws.set(
        planet,
        asset.draws.map((draw) => ({
          ...draw,
          name: `${planet} / ${draw.name}`,
          transform: new Float32Array(draw.transform),
          visible: false,
        })),
      );
    }
    this.asset = {
      ...asset,
      draws: [...this.draws.values()].flat(),
      stats: {
        ...asset.stats,
        drawCalls: asset.stats.drawCalls * planets.length,
        triangles: asset.stats.triangles * planets.length,
      },
    };
  }

  update(frame: FrameState, hdr = true): GltfFrame | null {
    for (const draws of this.draws.values()) {
      for (const draw of draws) draw.visible = false;
    }
    let visible = false;
    for (const instance of frame[this.definition.instances]) {
      const draws = this.draws.get(instance.planet);
      if (!draws)
        throw new Error(
          `No ${this.definition.label} asset was initialized for ${instance.planet}.`,
        );
      if (!Number.isFinite(instance.radius) || instance.radius <= 0) {
        throw new Error(
          `The ${this.definition.label} radius must be finite and positive.`,
        );
      }
      if (!frame.frustum.intersectsSphere(instance.center, instance.radius))
        continue;
      visible = true;
      mat4.fromRotationTranslationScale(
        this.model,
        instance.orientation,
        instance.center,
        instance.radius / this.assetRadius,
      );
      for (const [index, draw] of draws.entries()) {
        mat4.multiply(draw.transform, this.model, this.baseTransforms[index]!);
        draw.visible = true;
      }
    }
    if (!visible) return null;
    this.frame.viewProjection = frame.viewProj;
    this.frame.view = frame.view;
    this.frame.cameraPosition = frame.cameraPos;
    this.frame.keyLight.direction = frame.keyLightDir;
    this.frame.fillLight.direction = vec3.scale(frame.keyLightDir, -1);
    this.frame.wireframe = frame.wireframe;
    this.frame.output = hdr ? 'linear' : 'tonemapped';
    return this.frame;
  }
}
