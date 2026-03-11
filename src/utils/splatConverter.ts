import * as spz from 'spz-js';

export function convertToSplat(result: any) {
  const numPoints = result.numPoints;
  const buffer = new ArrayBuffer(numPoints * 32);
  const f32 = new Float32Array(buffer);
  const u8 = new Uint8Array(buffer);
  
  const SH_C0 = 0.28209479177387814;
  
  for (let i = 0; i < numPoints; i++) {
    // Position
    f32[i * 8 + 0] = result.positions[i * 3 + 0];
    f32[i * 8 + 1] = result.positions[i * 3 + 1];
    f32[i * 8 + 2] = result.positions[i * 3 + 2];
    
    // Scale
    f32[i * 8 + 3] = Math.exp(result.scales[i * 3 + 0]);
    f32[i * 8 + 4] = Math.exp(result.scales[i * 3 + 1]);
    f32[i * 8 + 5] = Math.exp(result.scales[i * 3 + 2]);
    
    // Color (from SH0)
    let r = 0.5 + SH_C0 * result.colors[i * 3 + 0];
    let g = 0.5 + SH_C0 * result.colors[i * 3 + 1];
    let b = 0.5 + SH_C0 * result.colors[i * 3 + 2];
    
    u8[i * 32 + 24 + 0] = Math.max(0, Math.min(255, r * 255));
    u8[i * 32 + 24 + 1] = Math.max(0, Math.min(255, g * 255));
    u8[i * 32 + 24 + 2] = Math.max(0, Math.min(255, b * 255));
    
    // Alpha
    let a = 1 / (1 + Math.exp(-result.alphas[i]));
    u8[i * 32 + 24 + 3] = Math.max(0, Math.min(255, a * 255));
    
    // Rotation
    // spz-js rotations are x, y, z, w
    let rot_x = result.rotations[i * 4 + 0];
    let rot_y = result.rotations[i * 4 + 1];
    let rot_z = result.rotations[i * 4 + 2];
    let rot_w = result.rotations[i * 4 + 3];
    
    let len = Math.sqrt(rot_x*rot_x + rot_y*rot_y + rot_z*rot_z + rot_w*rot_w);
    rot_x /= len;
    rot_y /= len;
    rot_z /= len;
    rot_w /= len;
    
    u8[i * 32 + 28 + 0] = Math.max(0, Math.min(255, rot_w * 128 + 128));
    u8[i * 32 + 28 + 1] = Math.max(0, Math.min(255, rot_x * 128 + 128));
    u8[i * 32 + 28 + 2] = Math.max(0, Math.min(255, rot_y * 128 + 128));
    u8[i * 32 + 28 + 3] = Math.max(0, Math.min(255, rot_z * 128 + 128));
  }
  
  return buffer;
}
