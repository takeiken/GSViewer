import torch
import nerfview
from typing import Tuple
import math
import viser
import time

from gsplat.rendering import rasterization

class Viewer:
    def __init__(self, splats, device='cuda'):
        self.splats = splats
        self.device = device
    
    @torch.no_grad()
    def _viewer_render_fn(
        self, camera_state: nerfview.CameraState, img_wh: Tuple[int, int]
    ):
        """Callable function for the viewer."""
        W, H = img_wh
        c2w = camera_state.c2w
        K = camera_state.get_K(img_wh)
        c2w = torch.from_numpy(c2w).float().to(self.device)
        K = torch.from_numpy(K).float().to(self.device)
        
        sh_degree = int(math.sqrt(self.splats['colors'].shape[1]) - 1)
        
        render_colors, _, _ = rasterization(
            self.splats['means'],
            self.splats['quats'],
            self.splats['scales'],
            self.splats['opacities'],
            self.splats['colors'],
            torch.linalg.inv(c2w[None]),
            Ks=K[None],
            width=W,
            height=H,
            sh_degree=sh_degree,
        )  # [1, H, W, 3]
        return render_colors[0].cpu().numpy()

    def start_server(self):
        server = viser.ViserServer(port=8080, verbose=False)
        viewer = nerfview.Viewer(
            server=server,
            render_fn=self._viewer_render_fn,
            mode="rendering",
        )

        time.sleep(1000000)
