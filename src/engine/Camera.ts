import { mat4, type Mat4 } from './math/mat4';
import type { Vec3 } from './math/vec3';
import { PLANET_SPACING } from './Scene';

const FOV = (50 * Math.PI) / 180;
const NEAR = 0.1;
const FAR = 200;
// Default ("dolly") camera pose. Position is measured as an offset from the
// focused planet's center (z = scrub * PLANET_SPACING) and the look angle is
// baked in from world-space yaw/pitch so framing stays consistent across
// every focused planet rather than swinging through a fixed look-at point.
// Captured live from free-cam to dial in a flattering off-axis 3/4 view.
const VIEW_DISTANCE = 8.68;
const EYE_HEIGHT = 2.26;
const EYE_SIDE_OFFSET = 10.28;
const YAW = (-36.8 * Math.PI) / 180;
const PITCH = (-8.6 * Math.PI) / 180;
const FORWARD_X = Math.sin(YAW) * Math.cos(PITCH);
const FORWARD_Y = Math.sin(PITCH);
const FORWARD_Z = -Math.cos(YAW) * Math.cos(PITCH);

export class Camera {
  view: Mat4 = mat4.create();
  proj: Mat4 = mat4.create();
  viewProj: Mat4 = mat4.create();
  invViewProj: Mat4 = mat4.create();
  position: Vec3 = [EYE_SIDE_OFFSET, EYE_HEIGHT, VIEW_DISTANCE];

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
  //
  // Zoom and the cinematic `extra` pull-back both dolly the camera along its
  // own forward vector (rather than just sliding eyeZ) so ctrl+wheel pulls
  // straight in toward whatever the camera is looking at, regardless of the
  // off-axis 3/4 view angle. Look direction is unchanged by dolly.
  update(scrub: number): void {
    const focusZ = scrub * PLANET_SPACING;
    const dolly = (1 - this.zoom) * VIEW_DISTANCE - this.extra;
    this.position = [
      EYE_SIDE_OFFSET + FORWARD_X * dolly,
      EYE_HEIGHT + FORWARD_Y * dolly,
      focusZ + VIEW_DISTANCE + FORWARD_Z * dolly,
    ];
    const center: Vec3 = [
      this.position[0] + FORWARD_X,
      this.position[1] + FORWARD_Y,
      this.position[2] + FORWARD_Z,
    ];

    mat4.lookAt(this.view, this.position, center, [0, 1, 0]);
    mat4.perspective(this.proj, FOV, this.aspect, NEAR, FAR);
    mat4.multiply(this.viewProj, this.proj, this.view);
    mat4.invert(this.invViewProj, this.viewProj);
  }

  // Update from an arbitrary eye + Euler yaw/pitch (no roll). Used by the
  // free-fly camera; bypasses the scrub/zoom/extra plumbing.
  // Convention: yaw=0 looks down -Z; positive yaw turns right.
  updateFree(eye: Vec3, yaw: number, pitch: number): void {
    const cy = Math.cos(pitch);
    const sy = Math.sin(pitch);
    const cyaw = Math.cos(yaw);
    const syaw = Math.sin(yaw);
    const fx = syaw * cy;
    const fy = sy;
    const fz = -cyaw * cy;
    this.position = [eye[0], eye[1], eye[2]];
    const center: Vec3 = [eye[0] + fx, eye[1] + fy, eye[2] + fz];
    mat4.lookAt(this.view, this.position, center, [0, 1, 0]);
    mat4.perspective(this.proj, FOV, this.aspect, NEAR, FAR);
    mat4.multiply(this.viewProj, this.proj, this.view);
    mat4.invert(this.invViewProj, this.viewProj);
  }
}
