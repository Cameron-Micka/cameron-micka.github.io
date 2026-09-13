export const ATMOSPHERE_SHELL_SCALE = 1.02;
export const ATMOSPHERE_LUT_WIDTH = 128;
export const ATMOSPHERE_LUT_HEIGHT = 64;

export function createAtmosphereOpticalDepthLut(): Float32Array<ArrayBuffer> {
  const data = new Float32Array(ATMOSPHERE_LUT_WIDTH * ATMOSPHERE_LUT_HEIGHT * 2);
  const innerRadius = 1 / (ATMOSPHERE_SHELL_SCALE - 1);
  const outerRadius = innerRadius + 1;
  const rayleighTop = Math.exp(-6);
  const mieTop = Math.exp(-18);
  const samples = 64;

  for (let row = 0; row < ATMOSPHERE_LUT_HEIGHT; row++) {
    const heightCoord = row / (ATMOSPHERE_LUT_HEIGHT - 1);
    const radius = innerRadius + heightCoord * heightCoord;
    const horizonCosine = -Math.sqrt(Math.max(1 - (innerRadius / radius) ** 2, 0));
    for (let column = 0; column < ATMOSPHERE_LUT_WIDTH; column++) {
      const angleCoord = column / (ATMOSPHERE_LUT_WIDTH - 1);
      const cosine = horizonCosine + (1 - horizonCosine) * angleCoord * angleCoord;
      const projectedRadius = radius * cosine;
      const distance = Math.max(0, Math.sqrt(
        projectedRadius ** 2 + (outerRadius - radius) * (outerRadius + radius),
      ) - projectedRadius);
      let rayleighDepth = 0;
      let mieDepth = 0;
      for (let sample = 0; sample < samples; sample++) {
        const start = (sample / samples) ** 2 * distance;
        const end = ((sample + 1) / samples) ** 2 * distance;
        const midpoint = (start + end) * 0.5;
        const altitude = Math.max(0, Math.min(1,
          Math.sqrt(radius ** 2 + midpoint * (midpoint + 2 * projectedRadius)) - innerRadius,
        ));
        rayleighDepth += (Math.exp(-6 * altitude) - rayleighTop) / (1 - rayleighTop) * (end - start);
        mieDepth += (Math.exp(-18 * altitude) - mieTop) / (1 - mieTop) * (end - start);
      }
      const offset = (row * ATMOSPHERE_LUT_WIDTH + column) * 2;
      data[offset] = rayleighDepth;
      data[offset + 1] = mieDepth;
    }
  }
  return data;
}