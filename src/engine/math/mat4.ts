import type { Vec3 } from './vec3';

// Column-major 4x4 matrices stored as Float32Array(16), WebGPU/WGSL convention.
export type Mat4 = Float32Array;

export const mat4 = {
  create(): Mat4 {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },

  identity(out: Mat4): Mat4 {
    out.fill(0);
    out[0] = out[5] = out[10] = out[15] = 1;
    return out;
  },

  multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
    const r = out === a || out === b ? new Float32Array(16) : out;
    for (let c = 0; c < 4; c++) {
      const bc = c * 4;
      const b0 = b[bc]!;
      const b1 = b[bc + 1]!;
      const b2 = b[bc + 2]!;
      const b3 = b[bc + 3]!;
      r[bc] = a[0]! * b0 + a[4]! * b1 + a[8]! * b2 + a[12]! * b3;
      r[bc + 1] = a[1]! * b0 + a[5]! * b1 + a[9]! * b2 + a[13]! * b3;
      r[bc + 2] = a[2]! * b0 + a[6]! * b1 + a[10]! * b2 + a[14]! * b3;
      r[bc + 3] = a[3]! * b0 + a[7]! * b1 + a[11]! * b2 + a[15]! * b3;
    }
    if (r !== out) out.set(r);
    return out;
  },

  // WebGPU clip space: z in [0, 1].
  perspective(
    out: Mat4,
    fovYRad: number,
    aspect: number,
    near: number,
    far: number,
  ): Mat4 {
    const f = 1 / Math.tan(fovYRad / 2);
    const nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = far * nf;
    out[11] = -1;
    out[14] = far * near * nf;
    return out;
  },

  lookAt(out: Mat4, eye: Vec3, center: Vec3, up: Vec3): Mat4 {
    let zx = eye[0] - center[0];
    let zy = eye[1] - center[1];
    let zz = eye[2] - center[2];
    const zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl;
    zy /= zl;
    zz /= zl;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    const xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl;
    xy /= xl;
    xz /= xl;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    out[0] = xx;
    out[1] = yx;
    out[2] = zx;
    out[3] = 0;
    out[4] = xy;
    out[5] = yy;
    out[6] = zy;
    out[7] = 0;
    out[8] = xz;
    out[9] = yz;
    out[10] = zz;
    out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  },

  fromRotationTranslationScale(
    out: Mat4,
    q: [number, number, number, number],
    t: Vec3,
    s: number,
  ): Mat4 {
    const [x, y, z, w] = q;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    out[0] = (1 - (yy + zz)) * s;
    out[1] = (xy + wz) * s;
    out[2] = (xz - wy) * s;
    out[3] = 0;
    out[4] = (xy - wz) * s;
    out[5] = (1 - (xx + zz)) * s;
    out[6] = (yz + wx) * s;
    out[7] = 0;
    out[8] = (xz + wy) * s;
    out[9] = (yz - wx) * s;
    out[10] = (1 - (xx + yy)) * s;
    out[11] = 0;
    out[12] = t[0];
    out[13] = t[1];
    out[14] = t[2];
    out[15] = 1;
    return out;
  },

  invert(out: Mat4, a: Mat4): Mat4 | null {
    const a00 = a[0]!, a01 = a[1]!, a02 = a[2]!, a03 = a[3]!;
    const a10 = a[4]!, a11 = a[5]!, a12 = a[6]!, a13 = a[7]!;
    const a20 = a[8]!, a21 = a[9]!, a22 = a[10]!, a23 = a[11]!;
    const a30 = a[12]!, a31 = a[13]!, a32 = a[14]!, a33 = a[15]!;
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    let det =
      b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  },
};
