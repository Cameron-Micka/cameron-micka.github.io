import { mat4, type Mat4 } from './math/mat4';
import type { Vec3 } from './math/vec3';
import { Frustum } from './math/frustum';
import { PLANET_SPACING } from './Scene';

const FOV = (50 * Math.PI) / 180;
const NEAR = 0.1;
const FAR = 200;

// Default ("dolly") camera pose. Position is measured as an offset from the
// focused planet's center (z = scrub * PLANET_SPACING) and the look angle is
// baked in from world-space yaw/pitch so framing stays consistent across
// every focused planet rather than swinging through a fixed look-at point.
// Two poses are dialed in live from free-cam — a 3/4 off-axis framing for
// landscape (wide) viewports, and a higher / more downward-tilted framing for
// portrait (tall) viewports where the bottom UI ribbon takes a bigger bite out
// of the viewport.
interface Pose {
  viewDistance: number;
  eyeHeight: number;
  eyeSideOffset: number;
  yaw: number;
  pitch: number;
}

const POSE_LANDSCAPE: Pose = {
  viewDistance: 8.94,
  eyeHeight: 2.17,
  eyeSideOffset: 5.71,
  yaw: (-23.9 * Math.PI) / 180,
  pitch: (-8.7 * Math.PI) / 180,
};

const POSE_PORTRAIT: Pose = {
  viewDistance: 9.63,
  eyeHeight: 6.30,
  eyeSideOffset: -0.38,
  yaw: (2.3 * Math.PI) / 180,
  pitch: (-27.1 * Math.PI) / 180,
};

function selectPose(aspect: number): Pose {
  return aspect >= 1 ? POSE_LANDSCAPE : POSE_PORTRAIT;
}

export class Camera {
  view: Mat4 = mat4.create();
  proj: Mat4 = mat4.create();
  viewProj: Mat4 = mat4.create();
  invViewProj: Mat4 = mat4.create();
  // Six-plane frustum derived from viewProj each update, for sphere culling.
  frustum = new Frustum();
  position: Vec3;

  private aspect = 1;
  private zoom = 1;
  private extra = 0; // extra pull-back distance, used by the fly-in cinematic

  private portrait: boolean;
  private viewDistance!: number;
  private eyeHeight!: number;
  private eyeSideOffset!: number;
  private forwardX!: number;
  private forwardY!: number;
  private forwardZ!: number;

  constructor() {
    // Seed from the current viewport orientation so the initial framing is
    // correct before the first resize() fires.
    this.aspect =
      typeof window !== 'undefined' && window.innerHeight > 0
        ? window.innerWidth / window.innerHeight
        : 1;
    this.portrait = this.aspect < 1;
    this.applyPose(selectPose(this.aspect));
    this.position = [this.eyeSideOffset, this.eyeHeight, this.viewDistance];
  }

  private applyPose(pose: Pose): void {
    this.viewDistance = pose.viewDistance;
    this.eyeHeight = pose.eyeHeight;
    this.eyeSideOffset = pose.eyeSideOffset;
    const cy = Math.cos(pose.pitch);
    this.forwardX = Math.sin(pose.yaw) * cy;
    this.forwardY = Math.sin(pose.pitch);
    this.forwardZ = -Math.cos(pose.yaw) * cy;
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    const portrait = aspect < 1;
    // Re-dial the framing only when the orientation flips between
    // landscape and portrait, not on every minor resize.
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.applyPose(selectPose(aspect));
    }
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
  // Zoom and the cinematic `extra` pull-back both dolly the camera toward (or
  // away from) the focused planet's center along the eye→planet vector rather
  // than the camera's forward look vector. Because the framing is an off-axis
  // 3/4 view, the planet does not sit on the forward axis; dollying along
  // forward would slide the planet across the screen as you zoom. Moving along
  // the eye→planet line instead keeps the planet on the same view ray, so it
  // stays at a constant screen position while zooming. Look direction is
  // unchanged by dolly.
  update(scrub: number): void {
    const focusZ = scrub * PLANET_SPACING;
    const dolly = (1 - this.zoom) * this.viewDistance - this.extra;
    // Vector from the un-dollied eye to the focused planet center. The eye sits
    // at (eyeSideOffset, eyeHeight, focusZ + viewDistance) and the planet at
    // (0, 0, focusZ), so the focusZ terms cancel in z and the delta is constant
    // across planets.
    let toFocusX = -this.eyeSideOffset;
    let toFocusY = -this.eyeHeight;
    let toFocusZ = -this.viewDistance;
    const len = Math.hypot(toFocusX, toFocusY, toFocusZ) || 1;
    toFocusX /= len;
    toFocusY /= len;
    toFocusZ /= len;
    this.position = [
      this.eyeSideOffset + toFocusX * dolly,
      this.eyeHeight + toFocusY * dolly,
      focusZ + this.viewDistance + toFocusZ * dolly,
    ];
    const center: Vec3 = [
      this.position[0] + this.forwardX,
      this.position[1] + this.forwardY,
      this.position[2] + this.forwardZ,
    ];

    mat4.lookAt(this.view, this.position, center, [0, 1, 0]);
    mat4.perspective(this.proj, FOV, this.aspect, NEAR, FAR);
    mat4.multiply(this.viewProj, this.proj, this.view);
    mat4.invert(this.invViewProj, this.viewProj);
    this.frustum.setFromViewProj(this.viewProj);
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
    this.frustum.setFromViewProj(this.viewProj);
  }
}
