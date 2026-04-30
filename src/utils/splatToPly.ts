export function splatToPly(
  buffer: ArrayBuffer,
  erasedIndices: Map<number, number> | Set<number>
): Blob {
  const isErased = (i: number) => {
    if (erasedIndices instanceof Set) {
      return erasedIndices.has(i);
    }
    return (erasedIndices.get(i) || 0) > 0;
  };

  const splatSize = 32;
  const numSplats = Math.floor(buffer.byteLength / splatSize);

  let keptCount = 0;
  for (let i = 0; i < numSplats; i++) {
    if (!isErased(i)) {
      keptCount++;
    }
  }

  const header = `ply
format binary_little_endian 1.0
element vertex ${keptCount}
property float x
property float y
property float z
property float nx
property float ny
property float nz
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
`;
  const headerBytes = new TextEncoder().encode(header);
  
  // 68 bytes per splat in PLY
  const plySplatSize = 68;
  const outBuffer = new ArrayBuffer(headerBytes.length + keptCount * plySplatSize);
  const outView = new DataView(outBuffer);
  new Uint8Array(outBuffer).set(headerBytes);
  
  const inView = new DataView(buffer);
  
  let offset = headerBytes.length;
  for (let i = 0; i < numSplats; i++) {
    if (!isErased(i)) {
      const inOffset = i * splatSize;
      
      // x, y, z (Float32)
      outView.setFloat32(offset + 0, inView.getFloat32(inOffset + 0, true), true);
      outView.setFloat32(offset + 4, inView.getFloat32(inOffset + 4, true), true);
      outView.setFloat32(offset + 8, inView.getFloat32(inOffset + 8, true), true);
      
      // nx, ny, nz
      outView.setFloat32(offset + 12, 0, true);
      outView.setFloat32(offset + 16, 0, true);
      outView.setFloat32(offset + 20, 0, true);
      
      // Color
      const r = inView.getUint8(inOffset + 24);
      const g = inView.getUint8(inOffset + 25);
      const b = inView.getUint8(inOffset + 26);
      const a = inView.getUint8(inOffset + 27);
      
      const SH_C0 = 0.28209479177387814;
      outView.setFloat32(offset + 24, (r / 255.0 - 0.5) / SH_C0, true);
      outView.setFloat32(offset + 28, (g / 255.0 - 0.5) / SH_C0, true);
      outView.setFloat32(offset + 32, (b / 255.0 - 0.5) / SH_C0, true);
      
      // opacity (logit)
      const alphaVal = Math.max(0.001, Math.min(0.999, a / 255.0));
      const logitOpacity = Math.log(alphaVal / (1 - alphaVal));
      outView.setFloat32(offset + 36, logitOpacity, true);
      
      // scale_0, scale_1, scale_2
      const scaleX = Math.log(Math.max(1e-10, inView.getFloat32(inOffset + 12, true)));
      const scaleY = Math.log(Math.max(1e-10, inView.getFloat32(inOffset + 16, true)));
      const scaleZ = Math.log(Math.max(1e-10, inView.getFloat32(inOffset + 20, true)));
      
      outView.setFloat32(offset + 40, scaleX, true);
      outView.setFloat32(offset + 44, scaleY, true);
      outView.setFloat32(offset + 48, scaleZ, true);
      
      // rotation: w, x, y, z (Uint8) mapped from (val - 128) / 128
      const rotW_u8 = inView.getUint8(inOffset + 28);
      const rotX_u8 = inView.getUint8(inOffset + 29);
      const rotY_u8 = inView.getUint8(inOffset + 30);
      const rotZ_u8 = inView.getUint8(inOffset + 31);
      
      // normalize
      let qw = (rotW_u8 - 128) / 128.0;
      let qx = (rotX_u8 - 128) / 128.0;
      let qy = (rotY_u8 - 128) / 128.0;
      let qz = (rotZ_u8 - 128) / 128.0;
      
      const len = Math.sqrt(qx*qx + qy*qy + qz*qz + qw*qw);
      if (len > 0.0001) {
        qw /= len;
        qx /= len;
        qy /= len;
        qz /= len;
      }
      
      // PLY order: rot_0=w, rot_1=x, rot_2=y, rot_3=z
      outView.setFloat32(offset + 52, qw, true);
      outView.setFloat32(offset + 56, qx, true);
      outView.setFloat32(offset + 60, qy, true);
      outView.setFloat32(offset + 64, qz, true);
      
      offset += plySplatSize;
    }
  }
  
  return new Blob([outBuffer], { type: 'application/octet-stream' });
}
