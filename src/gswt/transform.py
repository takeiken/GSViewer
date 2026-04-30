import torch
import torch.nn.functional as F

import math
from typing import Tuple

def get_K(fov, img_hw: Tuple[int, int], mode='pinhole'):
    H, W = img_hw
    if mode == 'pinhole':
        focal_length = H / 2.0 / math.tan(fov / 2.0)
        K = torch.tensor(
            [
                [focal_length, 0.0, W / 2.0],
                [0.0, focal_length, H / 2.0],
                [0.0, 0.0, 1.0],
            ]
        )
    elif mode == 'ortho':
        focal_x, focal_y = fov
        K = torch.tensor(
            [
                [W / focal_x, 0.0, W / 2.0],
                [0.0, H / focal_y, H / 2.0],
                [0.0, 0.0, 1.0],
            ]
        )
    return K

def lookat(origin, target, up) -> torch.Tensor:

    origin = torch.tensor(origin, dtype=torch.float)
    target = torch.tensor(target, dtype=torch.float)
    up = torch.tensor(up, dtype=torch.float)
    
    dir = F.normalize(target - origin, dim=0)
    left = F.normalize(torch.cross(up, dir), dim=0)
    new_up = F.normalize(torch.cross(dir, left), dim=0)

    to_world = torch.eye(4)
    to_world[:3, 0] = -left
    to_world[:3, 1] = -new_up
    to_world[:3, 2] = dir
    to_world[:3, 3] = origin

    return to_world