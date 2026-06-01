import { mat4, type Mat4 } from './math/mat4';
import type { Vec3 } from './math/vec3';
import { PLANET_SPACING } from './Scene';

const FOV = (50 * Math.PI) / 180;
const NEAR = 0.1;
const FAR = 200;
const VIEW_DISTANCE = 8.5;
const EYE_HEIGHT = 1.8;

export class Camera {
  view: Mat4 = mat4.create();
  proj: Mat4 = mat4.create();
  viewProj: Mat4 = mat4.create();
  invViewProj: Mat4 = mat4.create();
  position: Vec3 = [0, EYE_HEIGHT, VIEW_DISTANCE];

  private aspect = 1;
  private zoom = 1;
  private extra = 0; // extra pull-back distance, used by the fly-in cinematic

  setAspect(aspect: number): void {
    this.aspect = aspect;
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(0.6, Math.min(1.6, zoom));
  }

  setExtraDistance(extra: number): void {
    this.extra = Math.max(0, extra);
  }

  // scrub: continuous index in [0, planetCount-1]; camera frames that planet.
  // The timeline is reversed (higher index = more recent), so the camera sits on
  // the +z side and looks toward -z, leaving older planets receding ahead.
  update(scrub: number): void {
    const focusZ = scrub * PLANET_SPACING;
    const dist = VIEW_DISTANCE * this.zoom + this.extra;
    const eyeZ = focusZ + dist;
    this.position = [0, EYE_HEIGHT, eyeZ];
    const center: Vec3 = [0, 0, focusZ - 1.5];

    mat4.lookAt(this.view, this.position, center, [0, 1, 0]);
    mat4.perspective(this.proj, FOV, this.aspect, NEAR, FAR);
    mat4.multiply(this.viewProj, this.proj, this.view);
    mat4.invert(this.invViewProj, this.viewProj);
  }
}
