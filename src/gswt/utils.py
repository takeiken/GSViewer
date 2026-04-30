from io import BytesIO
from typing import Optional

import torch
import matplotlib.cm as cm
import matplotlib.pyplot as plt
from PIL import Image
import numpy as np
import OpenEXR
import Imath

from rotation_conversions import matrix_to_quaternion, quaternion_to_matrix
from config import *

def place_tile(splats, tile, tile_offset, pos, t_width, mode='all'):

    placed_splats = {}

    half_w = t_width / 2
    tile_key = ['west', 'north', 'east', 'south', 'center']
    if mode in tile_key:
        tile_key = [mode]
    elif mode == 'all':
        tile_key = ['west', 'north', 'east', 'south', 'center']
    elif mode == 'edge':
        tile_key = ['west', 'north', 'east', 'south']
    elif mode == 'center':
        tile_key = ['center']
    else:
        assert(False)

    # Copy splats parameters to the new splats
    full_tile_patch = []
    for i in range(len(tile_key)):
        full_tile_patch.append(tile[tile_key[i]])
    full_tile_patch = torch.cat(full_tile_patch, dim=0)
    
    for key in splats:
        placed_splats[key] = splats[key][full_tile_patch]


    # Change means
    place_offset = {
        'west':     torch.tensor([pos[0] - half_w, pos[1], 0.0]),
        'north':    torch.tensor([pos[0], pos[1] + half_w, 0.0]),
        'east':     torch.tensor([pos[0] + half_w, pos[1], 0.0]),
        'south':    torch.tensor([pos[0], pos[1] - half_w, 0.0]),
        'center':   torch.tensor([pos[0], pos[1], 0.0]),
    }

    placed_means_list = []
    rotated_quats_list = []
    for i in range(len(tile_key)):
        key = tile_key[i]
        patch = tile[key]
        means = splats['means'][patch]
        # print(i, (means - tile_offset[tile_key[i]]).max(dim=0)[0], (means - tile_offset[tile_key[i]]).min(dim=0)[0])
        placed_means = means - tile_offset[key] + place_offset[key]
        # print(placed_means.max(dim=0)[0])
        rotated_quats = splats['quats'][patch].clone()

        if rotate_tile and (key == 'north' or key == 'south'):
            rot_m = torch.tensor([
                [0.0, -1.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0],
            ])
            rot_center = place_offset[key] + torch.tensor([half_w, half_w, 0.0])
            placed_means = torch.matmul(rot_m, (placed_means - rot_center).T).T + rot_center

            rotated_quats = quaternion_to_matrix(rotated_quats)
            rotated_quats = rot_m @ rotated_quats
            rotated_quats = matrix_to_quaternion(rotated_quats)

        placed_means_list.append(placed_means)
        rotated_quats_list.append(rotated_quats)

    placed_splats['means'] = torch.cat(placed_means_list, dim=0)
    placed_splats['quats'] = torch.cat(rotated_quats_list, dim=0)

    return placed_splats

def save_image(filename, tensor: torch.Tensor):
    img = tensor.clamp(0.0, 1.0) * 255
    img = img.detach().cpu().numpy().astype(np.uint8)
    img = Image.fromarray(img)
    img.save(filename)

def save_image_value(filename, tensor: torch.Tensor, colormap=False):
    if colormap:
        img = tensor.detach().cpu().numpy()
        img = apply_colormap(img) * 255
    else:
        img = (tensor.clamp(0.0, 1.0) * 255).repeat((1, 1, 3))
        img = img.detach().cpu().numpy()
    img = img.astype(np.uint8)
    img = Image.fromarray(img)
    img.save(filename)

def save_exr_r32f(filename, image: torch.Tensor):
    """
    image: torch.Tensor [H, W, 3], float32
    """
    filename = str(filename)

    img = image.detach().cpu().numpy().astype(np.float32)
    H, W, _ = img.shape

    header = OpenEXR.Header(W, H)

    # Define RGB float channels
    header['channels'] = {
        'R': Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)),
    }

    exr = OpenEXR.OutputFile(filename, header)

    exr.writePixels({
        'R': img.tobytes(),
    })

    exr.close()


def save_exr_rg32f(filename, image: torch.Tensor):
    """
    image: torch.Tensor [H, W, 3], float32
    """
    filename = str(filename)

    img = image.detach().cpu().numpy().astype(np.float32)
    H, W, _ = img.shape

    header = OpenEXR.Header(W, H)

    # Define RGB float channels
    header['channels'] = {
        'R': Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)),
        'G': Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)),
        # 'B': Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)),
    }

    exr = OpenEXR.OutputFile(filename, header)

    exr.writePixels({
        'R': img[..., 0].tobytes(),
        'G': img[..., 1].tobytes(),
        # 'B': img[..., 2].tobytes(),
    })

    exr.close()

def apply_colormap(x: np.ndarray, cmap='viridis') -> np.ndarray:
    cmap_fn = cm.get_cmap(cmap)
    rgb = cmap_fn(x.squeeze())[..., :3]  # drop alpha
    return rgb

# gsplat
def save_ply(splats: torch.nn.ParameterDict, dir: str):
    """Export a Gaussian Splats model to bytes."""
    means = splats['means']
    scales = splats['scales']
    quats = splats['quats']
    opacities = splats['opacities']
    sh0 = splats['sh0']
    shN = splats['shN']
    # Custom property
    if 'uvs' in splats:
        uvs = splats['uvs']
    else:
        uvs = None
    total_splats = means.shape[0]
    assert means.shape == (total_splats, 3), "Means must be of shape (N, 3)"
    assert scales.shape == (total_splats, 3), "Scales must be of shape (N, 3)"
    assert quats.shape == (total_splats, 4), "Quaternions must be of shape (N, 4)"
    assert opacities.shape == (total_splats,), "Opacities must be of shape (N,)"
    assert sh0.shape == (total_splats, 1, 3), "sh0 must be of shape (N, 1, 3)"
    assert (
        shN.ndim == 3 and shN.shape[0] == total_splats and shN.shape[2] == 3
    ), f"shN must be of shape (N, K, 3), got {shN.shape}"

    # Reshape spherical harmonics
    sh0 = sh0.squeeze(1)  # Shape (N, 3)
    shN = shN.permute(0, 2, 1).reshape(means.shape[0], -1)  # Shape (N, K * 3)

    # Check for NaN or Inf values
    invalid_mask = (
        torch.isnan(means).any(dim=1)
        | torch.isinf(means).any(dim=1)
        | torch.isnan(scales).any(dim=1)
        | torch.isinf(scales).any(dim=1)
        | torch.isnan(quats).any(dim=1)
        | torch.isinf(quats).any(dim=1)
        | torch.isnan(opacities)
        | torch.isinf(opacities)
        | torch.isnan(sh0).any(dim=1)
        | torch.isinf(sh0).any(dim=1)
        | torch.isnan(shN).any(dim=1)
        | torch.isinf(shN).any(dim=1)
    )

    # Filter out invalid entries
    valid_mask = ~invalid_mask
    means = means[valid_mask]
    scales = scales[valid_mask]
    quats = quats[valid_mask]
    opacities = opacities[valid_mask]
    sh0 = sh0[valid_mask]
    shN = shN[valid_mask]
    if uvs != None:
        uvs = uvs[valid_mask]

    data = splat2ply_bytes(means, scales, quats, opacities, sh0, shN, uvs)

    with open(dir, "wb") as binary_file:
        binary_file.write(data)

    return data

# gsplat
def splat2ply_bytes(
    means: torch.Tensor,
    scales: torch.Tensor,
    quats: torch.Tensor,
    opacities: torch.Tensor,
    sh0: torch.Tensor,
    shN: torch.Tensor,
    uvs: Optional[torch.Tensor],
) -> bytes:
    """Return the binary Ply file. Supported by almost all viewers.

    Args:
        means (torch.Tensor): Splat means. Shape (N, 3)
        scales (torch.Tensor): Splat scales. Shape (N, 3)
        quats (torch.Tensor): Splat quaternions. Shape (N, 4)
        opacities (torch.Tensor): Splat opacities. Shape (N,)
        sh0 (torch.Tensor): Spherical harmonics. Shape (N, 3)
        shN (torch.Tensor): Spherical harmonics. Shape (N, K*3)

    Returns:
        bytes: Binary Ply file representing the model.
    """

    num_splats = means.shape[0]
    buffer = BytesIO()

    # Write PLY header
    buffer.write(b"ply\n")
    buffer.write(b"format binary_little_endian 1.0\n")
    buffer.write(f"element vertex {num_splats}\n".encode())
    buffer.write(b"property float x\n")
    buffer.write(b"property float y\n")
    buffer.write(b"property float z\n")
    for i, data in enumerate([sh0, shN]):
        prefix = "f_dc" if i == 0 else "f_rest"
        for j in range(data.shape[1]):
            buffer.write(f"property float {prefix}_{j}\n".encode())
    buffer.write(b"property float opacity\n")
    for i in range(scales.shape[1]):
        buffer.write(f"property float scale_{i}\n".encode())
    for i in range(quats.shape[1]):
        buffer.write(f"property float rot_{i}\n".encode())
    # Custom property
    buffer.write(b"property float uv_0\n")
    buffer.write(b"property float uv_1\n")
    buffer.write(b"end_header\n")

    # Concatenate all tensors in the correct order
    if uvs != None:
        splat_data = torch.cat(
            [means, sh0, shN, opacities.unsqueeze(1), scales, quats, uvs], dim=1
        )
    else:
        splat_data = torch.cat(
            [means, sh0, shN, opacities.unsqueeze(1), scales, quats], dim=1
        )
    # Ensure correct dtype
    splat_data = splat_data.to(torch.float32)

    # Write binary data
    float_dtype = np.dtype(np.float32).newbyteorder("<")
    buffer.write(splat_data.detach().cpu().numpy().astype(float_dtype).tobytes())

    return buffer.getvalue()

def diagonal_band_mask(H, W, width, device="cuda"):
    y, x = torch.meshgrid(
        torch.arange(H, device=device),
        torch.arange(W, device=device),
        indexing="ij"
    )

    # mask is True where pixels are kept
    mask = (torch.abs(y - x) > width) & (torch.abs(x + y - H) > width)
    return mask

def exr_rgb_to_png_normalized(exr_path, png_path, percentile_clip=None):
    exr = OpenEXR.InputFile(str(exr_path))
    header = exr.header()

    dw = header['dataWindow']
    W = dw.max.x - dw.min.x + 1
    H = dw.max.y - dw.min.y + 1

    pt = Imath.PixelType(Imath.PixelType.FLOAT)

    r = np.frombuffer(exr.channel('R', pt), dtype=np.float32)
    g = np.frombuffer(exr.channel('G', pt), dtype=np.float32)
    b = np.frombuffer(exr.channel('B', pt), dtype=np.float32)

    rgb = np.stack([r, g, b], axis=-1).reshape(H, W, 3)

    # Optional percentile clipping (robust visualization)
    if percentile_clip is not None:
        lo, hi = np.percentile(rgb, percentile_clip)
        rgb = np.clip(rgb, lo, hi)

    # Normalize to [0,1]
    minv, maxv = rgb.min(), rgb.max()
    if maxv > minv:
        rgb = (rgb - minv) / (maxv - minv)
    else:
        rgb = np.zeros_like(rgb)

    plt.imsave(png_path, rgb)
    print(f"Saved PNG: {png_path}")

# exr_rgb_to_png_normalized("D:/zengyunfan/HKUST/research/video_loop/tmp/position_map (1).exr", "D:/zengyunfan/HKUST/research/video_loop/tmp/position_map_1.png")