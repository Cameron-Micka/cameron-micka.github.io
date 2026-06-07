import type { Mat4 } from './mat4';
import type { Vec3 } from './vec3';

// View frustum represented as its six bounding planes, extracted from a
// column-major view-projection matrix via the Gribb–Hartmann method. Each plane
// is stored as [A, B, C, D] (normalized so |(A, B, C)| = 1); the signed distance
// of a point (x, y, z) from the plane is A*x + B*y + C*z + D, positive on the
// inside of the frustum.
//
// Assumes a [0, 1] clip-space depth range (the WebGPU / WGSL convention produced
// by mat4.perspective in this engine), which only affects how the near plane is
// derived. Used for coarse sphere-vs-frustum culling so off-screen bodies (whole
// planets with their moons/satellites, individual moons, and the sun) are
// skipped before they ever reach a draw call.
export class Frustum {
  // 6 planes × 4 components (A, B, C, D), packed contiguously.
  private readonly planes = new Float32Array(24);

  // Recompute the six planes from a column-major view-projection matrix. Element
  // (row, col) lives at m[col * 4 + row], so the matrix rows used below are:
  //   rowX = (m0, m4, m8,  m12)
  //   rowY = (m1, m5, m9,  m13)
  //   rowZ = (m2, m6, m10, m14)
  //   rowW = (m3, m7, m11, m15)
  setFromViewProj(m: Mat4): void {
    const m0 = m[0]!;
    const m1 = m[1]!;
    const m2 = m[2]!;
    const m3 = m[3]!;
    const m4 = m[4]!;
    const m5 = m[5]!;
    const m6 = m[6]!;
    const m7 = m[7]!;
    const m8 = m[8]!;
    const m9 = m[9]!;
    const m10 = m[10]!;
    const m11 = m[11]!;
    const m12 = m[12]!;
    const m13 = m[13]!;
    const m14 = m[14]!;
    const m15 = m[15]!;

    // Left = rowW + rowX, Right = rowW − rowX
    this.setPlane(0, m3 + m0, m7 + m4, m11 + m8, m15 + m12);
    this.setPlane(1, m3 - m0, m7 - m4, m11 - m8, m15 - m12);
    // Bottom = rowW + rowY, Top = rowW − rowY
    this.setPlane(2, m3 + m1, m7 + m5, m11 + m9, m15 + m13);
    this.setPlane(3, m3 - m1, m7 - m5, m11 - m9, m15 - m13);
    // Near = rowZ (z ∈ [0, 1]), Far = rowW − rowZ
    this.setPlane(4, m2, m6, m10, m14);
    this.setPlane(5, m3 - m2, m7 - m6, m11 - m10, m15 - m14);
  }

  private setPlane(i: number, a: number, b: number, c: number, d: number): void {
    const inv = 1 / (Math.hypot(a, b, c) || 1);
    const o = i * 4;
    this.planes[o] = a * inv;
    this.planes[o + 1] = b * inv;
    this.planes[o + 2] = c * inv;
    this.planes[o + 3] = d * inv;
  }

  // True if the sphere is at least partially inside the frustum. A sphere is
  // outside only when it lies fully behind any single plane (signed distance
  // < −radius), so a body straddling an edge is conservatively kept.
  intersectsSphere(center: Vec3, radius: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 6; i++) {
      const o = i * 4;
      const dist =
        p[o]! * center[0] + p[o + 1]! * center[1] + p[o + 2]! * center[2] + p[o + 3]!;
      if (dist < -radius) return false;
    }
    return true;
  }
}
