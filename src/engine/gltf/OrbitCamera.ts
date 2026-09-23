import { mat4 } from '../math/mat4';
import { vec3, type Vec3 } from '../math/vec3';

export function rotateAround(vector: Vec3, axis: Vec3, radians: number): Vec3 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const cross = vec3.cross(axis, vector);
  const dot = vec3.dot(axis, vector) * (1 - c);
  return [
    vector[0] * c + cross[0] * s + axis[0] * dot,
    vector[1] * c + cross[1] * s + axis[1] * dot,
    vector[2] * c + cross[2] * s + axis[2] * dot,
  ];
}

export class OrbitCamera {
  position: Vec3 = [0, 0, 35];
  target: Vec3 = [0, 0, 0];
  up: Vec3 = [0, 1, 0];
  fov = (36 * Math.PI) / 180;
  near = 0.1;
  far = 200;
  minDistance = 0.2;
  maxDistance = 200;
  projectionOffsetY = 0;
  readonly view = mat4.create();
  readonly projection = mat4.create();
  readonly viewProjection = mat4.create();
  private readonly events = new AbortController();
  private readonly pointers = new Map<
    number,
    { x: number; y: number; pan: boolean }
  >();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onChange: () => void,
  ) {
    const options = { signal: this.events.signal };
    canvas.addEventListener(
      'contextmenu',
      (event) => event.preventDefault(),
      options,
    );
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button > 2) return;
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
          pan: event.button !== 0 || event.shiftKey,
        });
      },
      options,
    );
    canvas.addEventListener(
      'pointermove',
      (event) => {
        const current = this.pointers.get(event.pointerId);
        if (!current) return;
        const previous = { ...current };
        const other = [...this.pointers.entries()].find(
          ([id]) => id !== event.pointerId,
        )?.[1];
        current.x = event.clientX;
        current.y = event.clientY;
        if (other) {
          const oldDistance = Math.hypot(
            previous.x - other.x,
            previous.y - other.y,
          );
          const newDistance = Math.hypot(
            current.x - other.x,
            current.y - other.y,
          );
          if (oldDistance > 1 && newDistance > 1)
            this.zoom(oldDistance / newDistance, false);
          this.pan(
            (current.x - previous.x) * 0.5,
            (current.y - previous.y) * 0.5,
          );
        } else if (current.pan) {
          this.pan(current.x - previous.x, current.y - previous.y);
        } else {
          const height = Math.max(1, canvas.clientHeight);
          this.orbit(
            (-(current.x - previous.x) * Math.PI * 2) / height,
            (-(current.y - previous.y) * Math.PI) / height,
          );
        }
      },
      options,
    );
    const release = (event: PointerEvent) =>
      this.pointers.delete(event.pointerId);
    canvas.addEventListener('pointerup', release, options);
    canvas.addEventListener('pointercancel', release, options);
    canvas.addEventListener('lostpointercapture', release, options);
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const pixels =
          event.deltaY *
          (event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? canvas.clientHeight
              : 1);
        this.zoom(Math.exp(Math.max(-1, Math.min(1, pixels * 0.001))));
      },
      { ...options, passive: false },
    );
  }

  orbit(yaw: number, pitch = 0): void {
    let offset = rotateAround(
      vec3.sub(this.position, this.target),
      this.up,
      yaw,
    );
    const right = vec3.normalize(vec3.cross(this.up, offset));
    const candidate = rotateAround(offset, right, pitch);
    if (Math.abs(vec3.dot(vec3.normalize(candidate), this.up)) < 0.995)
      offset = candidate;
    this.position = vec3.add(this.target, offset);
    this.onChange();
  }

  zoom(scale: number, notify = true): void {
    const offset = vec3.sub(this.position, this.target);
    const distance = vec3.length(offset);
    const next = Math.min(
      this.maxDistance,
      Math.max(this.minDistance, distance * scale),
    );
    this.position = vec3.add(
      this.target,
      vec3.scale(offset, next / Math.max(distance, 1e-8)),
    );
    if (notify) this.onChange();
  }

  pan(dx: number, dy: number): void {
    const forward = vec3.normalize(vec3.sub(this.target, this.position));
    const right = vec3.normalize(vec3.cross(forward, this.up));
    const vertical = vec3.cross(right, forward);
    const scale =
      (2 *
        vec3.length(vec3.sub(this.position, this.target)) *
        Math.tan(this.fov / 2)) /
      Math.max(1, this.canvas.clientHeight);
    const translation = vec3.add(
      vec3.scale(right, -dx * scale),
      vec3.scale(vertical, dy * scale),
    );
    this.position = vec3.add(this.position, translation);
    this.target = vec3.add(this.target, translation);
    this.onChange();
  }

  update(aspect: number): void {
    mat4.lookAt(this.view, this.position, this.target, this.up);
    mat4.perspective(this.projection, this.fov, aspect, this.near, this.far);
    this.projection[9] = -this.projectionOffsetY;
    mat4.multiply(this.viewProjection, this.projection, this.view);
  }

  dispose(): void {
    this.events.abort();
    this.pointers.clear();
  }
}
