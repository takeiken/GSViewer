import * as THREE from 'three';

/**
 * Exports gaussian splat data to a PLY format blob.
 * This is a minimal implementation targeting the structure expected by many splat scripts.
 */
export async function exportToPly(
  centerData: Float32Array,
  colorData: any,
  selectedIndices?: Set<number>,
  erasedIndices?: Map<number, number>
): Promise<Blob> {
  const numSplats = centerData.length / 4;
  
  // Ensure we have a Uint32Array view of the color data
  // We use the byteOffset and byteLength to handle cases where the buffer is shared
  const colorDataUint32 = colorData instanceof Uint32Array 
    ? colorData 
    : new Uint32Array(colorData.buffer, colorData.byteOffset, colorData.byteLength / 4);

  // Identify valid splats (not erased)
  const validIndices: number[] = [];
  for (let i = 0; i < numSplats; i++) {
    const isErased = erasedIndices && (erasedIndices.get(i) || 0) > 0;
    
    // Some splats might have zero alpha but still be valid points in the scene
    // We'll skip the zero-alpha filter to be safe
    if (!isErased) {
        validIndices.push(i);
    }
  }

  const count = validIndices.length;
  console.log(`Exporting ${count} splats to PLY (out of ${numSplats} total)...`);

  const header = `ply
format binary_little_endian 1.0
element vertex ${count}
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

  const headerUint8 = new TextEncoder().encode(header);
  
  // Each splat has 17 float32 fields: 
  // x,y,z (3), nx,ny,nz (3), f_dc_0,1,2 (3), opacity (1), scale_0,1,2 (3), rot_0,1,2,3 (4)
  // Total: 17 * 4 = 68 bytes.
  const splatSize = 68;
  const dataSize = count * splatSize;
  const buffer = new ArrayBuffer(headerUint8.byteLength + dataSize);
  const view = new DataView(buffer);

  // Copy header
  const uint8Buffer = new Uint8Array(buffer);
  uint8Buffer.set(headerUint8);

  let offset = headerUint8.byteLength;

  for (let idx = 0; idx < validIndices.length; idx++) {
    const splatIdx = validIndices[idx];
    
    // Position
    view.setFloat32(offset, centerData[splatIdx * 4 + 0], true);
    view.setFloat32(offset + 4, centerData[splatIdx * 4 + 1], true);
    view.setFloat32(offset + 8, centerData[splatIdx * 4 + 2], true);
    
    // Normals (Placeholder 0s)
    view.setFloat32(offset + 12, 0, true);
    view.setFloat32(offset + 16, 0, true);
    view.setFloat32(offset + 20, 0, true);

    // Color (f_dc)
    const colorUint = colorDataUint32[splatIdx * 4 + 3];
    const r = colorUint & 0xFF;
    const g = (colorUint >>> 8) & 0xFF;
    const b = (colorUint >>> 16) & 0xFF;
    const a = (colorUint >>> 24) & 0xFF;
    
    // Convert 0-255 to SH f_dc
    view.setFloat32(offset + 24, (r / 255 - 0.5) / 0.28209, true);
    view.setFloat32(offset + 28, (g / 255 - 0.5) / 0.28209, true);
    view.setFloat32(offset + 32, (b / 255 - 0.5) / 0.28209, true);

    // Opacity - In standard 3DGS PLY, opacity is stored as its logit.
    // logit(x) = log(x / (1 - x))
    const alphaVal = Math.max(0.001, Math.min(0.999, a / 255));
    const logitOpacity = Math.log(alphaVal / (1 - alphaVal));
    view.setFloat32(offset + 36, logitOpacity, true);

    // Scale - In 3DGS PLY it's often the log of the scale
    const scaleVal = centerData[splatIdx * 4 + 3] || 1.0;
    // If scaleVal is already very small or negative, it might be a log/logit from the internal state.
    // Otherwise we take the log.
    const finalLogScale = scaleVal < -10 ? scaleVal : Math.log(Math.max(1e-10, scaleVal));
    
    view.setFloat32(offset + 40, finalLogScale, true);
    view.setFloat32(offset + 44, finalLogScale, true);
    view.setFloat32(offset + 48, finalLogScale, true);

    // Rotation
    view.setFloat32(offset + 52, 1, true); // rot_0 (w)
    view.setFloat32(offset + 56, 0, true); // rot_1 (x)
    view.setFloat32(offset + 60, 0, true); // rot_2 (y)
    view.setFloat32(offset + 64, 0, true); // rot_3 (z)

    if (idx === 0) {
      console.log('Sample Splat Data:', {
        pos: [centerData[splatIdx * 4 + 0], centerData[splatIdx * 4 + 1], centerData[splatIdx * 4 + 2]],
        color: [r, g, b, a],
        scale: finalLogScale,
        opacity: alphaVal
      });
    }

    offset += splatSize;
  }

  return new Blob([buffer], { type: 'application/octet-stream' });
}
