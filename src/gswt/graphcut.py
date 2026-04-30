from pathlib import Path
from copy import deepcopy
from typing import Dict, List, Optional, Tuple, Union

import torchvision.transforms as transforms
from PIL import Image
import maxflow
import torch
import numpy as np
import cv2

from config import *
from render import render_surface, render_orbit
from utils import *

def construct_graph(
    tile_render_hw,
    graph_cut_mode,
    edge_patch_img: torch.Tensor,
    edge_patch_sam_info,
    center_patch_img: torch.Tensor,
    center_patch_sam_info,
    source_mask,
    sink_mask,
):
    graph = maxflow.GraphFloat()
    node_ids = graph.add_grid_nodes(tile_render_hw)

    A = edge_patch_img
    A_grad = torch.gradient(A)
    A_us = torch.cat((A[1:, :], A[:1, :]), dim=0) # up shift
    A_grad_us = torch.cat((A_grad[0][1:, :], A_grad[0][:1, :]), dim=0)
    A_ls = torch.cat((A[:, 1:], A[:, :1]), dim=1) # left shift
    A_grad_ls = torch.cat((A_grad[1][:, 1:], A_grad[1][:, :1]), dim=1)

    A_sam = edge_patch_sam_info['color']
    A_sam_grad = torch.gradient(A_sam)
    A_sam_us = torch.cat((A_sam[1:, :], A_sam[:1, :]), dim=0)
    A_sam_grad_us = torch.cat((A_sam_grad[0][1:, :], A_sam_grad[0][:1, :]), dim=0)
    A_sam_ls = torch.cat((A_sam[:, 1:], A_sam[:, :1]), dim=1)
    A_sam_grad_ls = torch.cat((A_sam_grad[1][:, 1:], A_sam_grad[1][:, :1]), dim=1)

    B = center_patch_img
    B_grad = torch.gradient(B)
    B_us = torch.cat((B[1:, :], B[:1, :]), dim=0)
    B_grad_us = torch.cat((B_grad[0][1:, :], B_grad[0][:1, :]), dim=0)
    B_ls = torch.cat((B[:, 1:], B[:, :1]), dim=1)
    B_grad_ls = torch.cat((B_grad[1][:, 1:], B_grad[1][:, :1]), dim=1)

    B_sam = center_patch_sam_info['color']
    B_sam_grad = torch.gradient(B_sam)
    B_sam_us = torch.cat((B_sam[1:, :], B_sam[:1, :]), dim=0)
    B_sam_grad_us = torch.cat((B_sam_grad[0][1:, :], B_sam_grad[0][:1, :]), dim=0)
    B_sam_ls = torch.cat((B_sam[:, 1:], B_sam[:, :1]), dim=1)
    B_sam_grad_ls = torch.cat((B_sam_grad[1][:, 1:], B_sam_grad[1][:, :1]), dim=1)

    match graph_cut_mode:
        case "color":
            w = ((A - B).norm(dim=-1) + (A_us - B_us).norm(dim=-1)) / (A_grad[0].norm(dim=-1) + A_grad_us.norm(dim=-1) + B_grad[0].norm(dim=-1) + B_grad_us.norm(dim=-1))
        case "sam":
            w = ((A_sam - B_sam).norm(dim=-1) + (A_sam_us - B_sam_us).norm(dim=-1)) / (A_sam_grad[0].norm(dim=-1) + A_sam_grad_us.norm(dim=-1) + B_sam_grad[0].norm(dim=-1) + B_sam_grad_us.norm(dim=-1))
        case "combined":
            w_alpha = 0.6
            w_d = w_alpha * ((A - B).norm(dim=-1) + (A_us - B_us).norm(dim=-1)) \
                + (1 - w_alpha) * ((A_sam - B_sam).norm(dim=-1) + (A_sam_us - B_sam_us).norm(dim=-1))
            w_g = w_alpha * (A_grad[0].norm(dim=-1) + A_grad_us.norm(dim=-1) + B_grad[0].norm(dim=-1) + B_grad_us.norm(dim=-1)) \
                + (1 - w_alpha) * (A_sam_grad[0].norm(dim=-1) + A_sam_grad_us.norm(dim=-1) + B_sam_grad[0].norm(dim=-1) + B_sam_grad_us.norm(dim=-1))
            w = w_d / w_g
    w = w.nan_to_num()
    structure = np.array([[0, 0, 0], [0, 0, 0], [0, 1, 0]])
    graph.add_grid_edges(node_ids, weights=w.cpu().numpy(), structure=structure, symmetric=True)

    match graph_cut_mode:
        case "color":
            w = ((A - B).norm(dim=-1) + (A_ls - B_ls).norm(dim=-1)) / (A_grad[1].norm(dim=-1) + A_grad_ls.norm(dim=-1) + B_grad[1].norm(dim=-1) + B_grad_ls.norm(dim=-1))
        case "sam":
            w = ((A_sam - B_sam).norm(dim=-1) + (A_sam_ls - B_sam_ls).norm(dim=-1)) / (A_sam_grad[1].norm(dim=-1) + A_sam_grad_ls.norm(dim=-1) + B_sam_grad[1].norm(dim=-1) + B_sam_grad_ls.norm(dim=-1))
        case "combined":
            w_d = w_alpha * ((A - B).norm(dim=-1) + (A_ls - B_ls).norm(dim=-1)) \
                + (1 - w_alpha) * ((A_sam - B_sam).norm(dim=-1) + (A_sam_ls - B_sam_ls).norm(dim=-1))
            w_g = w_alpha * (A_grad[1].norm(dim=-1) + A_grad_ls.norm(dim=-1) + B_grad[1].norm(dim=-1) + B_grad_ls.norm(dim=-1)) \
                + (1 - w_alpha) * (A_sam_grad[1].norm(dim=-1) + A_sam_grad_ls.norm(dim=-1) + B_sam_grad[1].norm(dim=-1) + B_sam_grad_ls.norm(dim=-1))
            w = w_d / w_g
    w = w.nan_to_num()
    structure = np.array([[0, 0, 0], [0, 0, 1], [0, 0, 0]])
    graph.add_grid_edges(node_ids, weights=w.cpu().numpy(), structure=structure, symmetric=True)

    source_cap = source_mask * 1e16
    source_cap = source_cap.cpu().numpy()    
    sink_cap = sink_mask * 1e16
    sink_cap = sink_cap.cpu().numpy()

    graph.add_grid_tedges(node_ids, source_cap, sink_cap)

    return graph, node_ids

def tile_graph_cut(
    splats_list: List,
    multi_tile: Dict,
    tile_offset: Dict,
    t_width: float,
    tile_id: int = None,
    dry_run: bool = False,
) -> Tuple[Dict, float]:
    tile_render_hw = (256, 256)
    graph_cut_mode = "combined" # [color, sam, combined]
    if tile_id != None:
        id_string = f"tile{tile_id}_"
    else:
        id_string = ""

    # Graph cut in 2D
    # render_surface(splats, (t_width, t_width), tile_render_hw, splat_offset=tile_offset['west'], splat_index=tile['west'], image_file='west_patch.png', mode='ortho')
    tile_splats = place_tile(splats_list[0], multi_tile['tiles'][0], tile_offset, (0.0, 0.0), t_width, mode='edge')
    edge_patch_img = render_surface(tile_splats, (t_width, t_width), tile_render_hw, image_file=image_dir / f'{id_string}graphcut_edge.png', mode='ortho')
    center_patch_img = render_surface(splats_list[0], (t_width, t_width), tile_render_hw, splat_offset=tile_offset['center'], splat_index=multi_tile['tiles'][0]['center'], image_file=image_dir / f'{id_string}graphcut_center.png', mode='ortho')

    # Resize sam_info images to graph cut reso
    edge_patch_sam_info = {}
    center_patch_sam_info = {}
    for key in ['color', 'index']:

        sam_info = multi_tile['edge_sam_info'][key]
        sam_info = transforms.Resize(tile_render_hw, transforms.InterpolationMode.NEAREST, antialias=False)(sam_info.permute((2, 0, 1))).permute((1, 2, 0))
        edge_patch_sam_info[key] = sam_info
        # img = Image.fromarray(img.detach().cpu().numpy())
        # img = img.resize((tile_render_hw[1], tile_render_hw[0]), Image.Resampling.NEAREST)

        img = sam_info * 255
        img = Image.fromarray(img.detach().cpu().numpy().astype(np.uint8))
        img.save(image_dir / f'graphcut_edge_sam_{key}.png')

        sam_info = multi_tile['center_sam_info'][key]
        sam_info = transforms.Resize(tile_render_hw, transforms.InterpolationMode.NEAREST, antialias=False)(sam_info.permute((2, 0, 1))).permute((1, 2, 0))
        center_patch_sam_info[key] = sam_info
        # img = Image.fromarray(img.detach().cpu().numpy())
        # img = img.resize((tile_render_hw[1], tile_render_hw[0]), Image.Resampling.NEAREST)

        img = sam_info * 255
        img = Image.fromarray(img.detach().cpu().numpy().astype(np.uint8))
        img.save(image_dir / f'graphcut_center_sam_{key}.png')

    # Source
    source_mask = torch.zeros(tile_render_hw, dtype=torch.bool)
    source_mask[:, 0] = 1
    source_mask[:, -1] = 1
    source_mask[0, :] = 1
    source_mask[-1, :] = 1

    # Min margin
    # min_margin = int(tile_render_hw[0] / 32)
    # source_mask[:, 0:min_margin] = 1
    # source_mask[:, -min_margin:-1] = 1
    # source_mask[0:min_margin, :] = 1
    # source_mask[-min_margin:-1, :] = 1

    # Sink
    # Full X
    sink_mask = torch.eye(tile_render_hw[0], dtype=torch.bool)
    sink_mask[0, 0] = 0
    sink_mask[-1, -1] = 0
    sink_mask = sink_mask | sink_mask.flip(0)

    # Half X
    # sink_mask = torch.zeros(tile_render_hw, dtype=torch.bool)
    # r_4 = int(tile_render_hw[0] / 4)
    # half_x = torch.eye(2 * r_4)
    # half_x = half_x + half_x.flip(0)
    # sink_mask[r_4 : 3 * r_4, r_4 : 3 * r_4] = half_x

    # Half square
    # sink_mask = torch.zeros(tile_render_hw, dtype=torch.bool)
    # r_4 = int(tile_render_hw[0] / 4)
    # sink_mask[r_4 : 3 * r_4, r_4 : 3 * r_4] = torch.ones((2 * r_4, 2 * r_4))

    sink_mask = sink_mask & ~source_mask

    graph, node_ids = construct_graph(
        tile_render_hw,
        graph_cut_mode,
        edge_patch_img,
        edge_patch_sam_info,
        center_patch_img,
        center_patch_sam_info,
        source_mask,
        sink_mask,
    )

    # Run maxflow
    max_flow = graph.maxflow()
    if dry_run:
        return None, max_flow

    center_patch_mask = torch.from_numpy(graph.get_grid_segments(node_ids)).to(device).to(torch.bool)
    edge_patch_mask = ~center_patch_mask

    center_patch_vis = center_patch_img * center_patch_mask.unsqueeze(2)
    center_patch_vis = (center_patch_vis.clamp(0.0, 1.0) * 255).cpu().numpy().astype(np.uint8)
    center_patch_vis_img = Image.fromarray(center_patch_vis)
    # center_patch_vis_img.save(image_dir / f'graphcut_center_mask.png')
    center_patch_vis_img.save(image_dir / f'{id_string}graphcut_center_mask.png')
    edge_patch_vis = edge_patch_img * edge_patch_mask.unsqueeze(2)
    edge_patch_vis = (edge_patch_vis.clamp(0.0, 1.0) * 255).cpu().numpy().astype(np.uint8)
    edge_patch_vis_img = Image.fromarray(edge_patch_vis)
    # edge_patch_vis_img.save(image_dir / f'graphcut_edge_mask.png')
    edge_patch_vis_img.save(image_dir / f'{id_string}graphcut_edge_mask.png')
    tile_vis = center_patch_vis + edge_patch_vis
    tile_vis_img = Image.fromarray(tile_vis)
    # tile_vis_img.save(image_dir / f'graphcut_result_img.png')
    tile_vis_img.save(image_dir / f'{id_string}graphcut_result_img.png')
    contours, _ = cv2.findContours(center_patch_mask.cpu().numpy().astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE) 
    # Try to smooth contours
    contours = [cv2.approxPolyDP(contour, epsilon=0.01, closed=True) for contour in contours]
    cv2.drawContours(tile_vis, contours, -1, (255, 255, 255), thickness=2) 
    tile_vis_img = Image.fromarray(tile_vis)
    # tile_vis_img.save(image_dir / f'graphcut_result_img_mask.png')
    tile_vis_img.save(image_dir / f'{id_string}graphcut_result_img_mask.png')

    # Store priority map
    center_index = center_patch_sam_info['index'] * center_patch_mask.unsqueeze(2)
    edge_index = edge_patch_sam_info['index'] * edge_patch_mask.unsqueeze(2)
    multi_tile['cut_index'] = center_index + edge_index

    # Extend graph cut area
    for index in range(center_patch_sam_info['index'].max().int()):
        index_mask = (center_patch_sam_info['index'][:, :, 0] == index)
        if (index_mask & center_patch_mask).sum() > index_mask.sum() / 2:
            center_patch_mask = index_mask | center_patch_mask

    ones_mask = torch.ones(tile_render_hw, dtype=torch.bool)
    margin = 2 # account for error when resizing
    west_mask = ones_mask.tril(-margin) & ones_mask.tril(-1-margin).flip([0])
    north_mask = ones_mask.triu(1+margin) & ones_mask.triu(margin).flip([1])
    east_mask = ones_mask.triu(margin) & ones_mask.triu(1+margin).flip([0])
    south_mask = ones_mask.tril(-1-margin) & ones_mask.tril(-margin).flip([1])
    edge_masks = [west_mask, north_mask, east_mask, south_mask]
    for index in range(edge_patch_sam_info['index'].max().int()):
        index_mask = (edge_patch_sam_info['index'][:, :, 0] == index)
        if index_mask.sum() == 0:
            continue
        for edge_mask in edge_masks:
            index_edge_mask = index_mask & edge_mask
            if (index_edge_mask & edge_patch_mask).sum() > index_edge_mask.sum() / 2:
                edge_patch_mask = index_edge_mask | edge_patch_mask

    # edge_patch_mask = diagonal_band_mask(tile_render_hw[0], tile_render_hw[1], 20)
    # edge_patch_mask = ones_mask

    tile_vis = center_patch_img * center_patch_mask.unsqueeze(2)
    tile_vis_img = tile_vis.clamp(0.0, 1.0) * 255
    tile_vis_img = Image.fromarray(tile_vis_img.cpu().numpy().astype(np.uint8))
    tile_vis_img.save(image_dir / f'{id_string}graphcut_center_mask_extended.png')

    tile_vis = edge_patch_img * edge_patch_mask.unsqueeze(2)
    tile_vis_img = tile_vis.clamp(0.0, 1.0) * 255
    tile_vis_img = Image.fromarray(tile_vis_img.cpu().numpy().astype(np.uint8))
    tile_vis_img.save(image_dir / f'{id_string}graphcut_edge_mask_extended.png')

    # Cut in 3D
    tile_key = ['west', 'north', 'east', 'south', 'center']
    ones_mask = torch.ones(tile_render_hw, dtype=torch.bool)
    pixel_mask = {
        'west': ones_mask.tril() & ones_mask.tril(-1).flip([0]) & edge_patch_mask,
        'north': ones_mask.triu(1) & ones_mask.triu().flip([1]) & edge_patch_mask,
        'east': ones_mask.triu() & ones_mask.triu(1).flip([0]) & edge_patch_mask,
        'south': ones_mask.tril(-1) & ones_mask.tril().flip([1]) & edge_patch_mask,
        'center': center_patch_mask,
    }
    range_offset = {
        'west':     torch.tensor([t_width / 2, 0.0]),
        'north':    torch.tensor([0.0, -t_width / 2]),
        'east':     torch.tensor([-t_width / 2, 0.0]),
        'south':    torch.tensor([0.0, t_width / 2]),
        'center':   torch.tensor([0.0, 0.0]),
    }
    if rotate_tile:
        range_offset['north'] = range_offset['east']
        range_offset['south'] = range_offset['west']

    new_multi_tile = deepcopy(multi_tile)
    for (spl_i, spl) in enumerate(splats_list):
        for key in tile_key:
            patch_means = spl['means'][new_multi_tile['tiles'][spl_i][key]]
            if patch_means.nelement() == 0:
                print("Warning: empty patch")
                continue
            patch_means = patch_means[:, 0:2]

            p_mask = pixel_mask[key]
            if rotate_tile and (key == 'north' or key == 'south'):
                p_mask = p_mask.rot90(k=-1)
            splat_range = torch.nonzero(p_mask).to(torch.float)
            splat_range *= t_width / tile_render_hw[0]
            splat_range[:, 0] = t_width - t_width / tile_render_hw[0] - splat_range[:, 0]
            splat_range = splat_range[:, [1, 0]]
            splat_range += tile_offset[key][0:2] + range_offset[key]
            splat_range = splat_range.unsqueeze(0)

            # Batched process to avoid out of memory
            # splat_mask = ((patch_means.unsqueeze(1) >= splat_range).all(dim=2) & (patch_means.unsqueeze(1) <= splat_range + t_width / tile_render_hw[0]).all(dim=2)).any(dim=1)
            batch_size = 1024
            splat_mask = []
            for batch_i in range(0, patch_means.shape[0], batch_size):
                batch_means = patch_means[batch_i : batch_i + batch_size]
                batch_mask = ((batch_means.unsqueeze(1) >= splat_range).all(dim=2) & (batch_means.unsqueeze(1) <= splat_range + t_width / tile_render_hw[0]).all(dim=2)).any(dim=1)
                splat_mask.append(batch_mask)
            splat_mask = torch.cat(splat_mask)

            # splat_idx = torch.nonzero(splat_mask).squeeze()   # Cause error when empty
            new_multi_tile['tiles'][spl_i][key] = new_multi_tile['tiles'][spl_i][key][splat_mask]
            # render_surface(splats, (t_width, t_width), tile_render_hw, splat_offset=tile_offset[key], splat_index=splat_patch, image_file=f'cut_tile_{key}.png', mode='ortho')

            torch.cuda.empty_cache()

    new_tile_splats = place_tile(splats_list[0], new_multi_tile['tiles'][0], tile_offset, (0.0, 0.0), t_width)
    new_tile_img = render_surface(new_tile_splats, (t_width, t_width), tile_render_hw, image_file=image_dir / f'{id_string}graphcut_result_gs.png', mode='ortho')
    
    # import os
    # os.makedirs(image_dir / f'{id_string}_edge', exist_ok=True)
    # new_tile_splats = place_tile(splats_list[0], new_multi_tile['tiles'][0], tile_offset, (0.0, 0.0), t_width, mode='edge')
    
    # torch.save(new_tile_splats, output_dir / f'tile_{id_string}.pt')
    # new_tile_img = render_orbit(new_tile_splats, (t_width, t_width), tile_render_hw, image_file=image_dir / f'{id_string}_edge')

    return new_multi_tile, max_flow

    """ Unfinished old 3D cut
    # Split center patch to 4 edge patches
    half_w = t_width / 2
    center_patch = tile['center']
    center_patch_offset = tile_offset['center']
    patch_means = splats['means'][center_patch][:, 0:2]
    west_center_patch_idx = torch.nonzero(
        ((patch_means[:, 0] <  center_patch_offset[0] + half_w) & (patch_means[:, 1] >= center_patch_offset[1] + half_w) & (patch_means[:, 0] + patch_means[:, 1] <= center_patch_offset[0] + center_patch_offset[1] + 2 * half_w)) |
        ((patch_means[:, 0] <  center_patch_offset[0] + half_w) & (patch_means[:, 1] <  center_patch_offset[1] + half_w) & (patch_means[:, 1] - patch_means[:, 0] >  center_patch_offset[1] - center_patch_offset[0]))
    ).squeeze()
    north_center_patch_idx = torch.nonzero(
        ((patch_means[:, 1] >  center_patch_offset[1] + half_w) & (patch_means[:, 0] <= center_patch_offset[0] + half_w) & (patch_means[:, 0] + patch_means[:, 1] >  center_patch_offset[0] + center_patch_offset[1] + 2 * half_w)) |
        ((patch_means[:, 1] >  center_patch_offset[1] + half_w) & (patch_means[:, 0] >  center_patch_offset[0] + half_w) & (patch_means[:, 1] - patch_means[:, 0] >= center_patch_offset[1] - center_patch_offset[0]))
    ).squeeze()
    east_center_patch_idx = torch.nonzero(
        ((patch_means[:, 0] >= center_patch_offset[0] + half_w) & (patch_means[:, 1] <= center_patch_offset[1] + half_w) & (patch_means[:, 0] + patch_means[:, 1] >= center_patch_offset[0] + center_patch_offset[1] + 2 * half_w)) |
        ((patch_means[:, 0] >= center_patch_offset[0] + half_w) & (patch_means[:, 1] >  center_patch_offset[1] + half_w) & (patch_means[:, 1] - patch_means[:, 0] <  center_patch_offset[1] - center_patch_offset[0]))
    ).squeeze()
    south_center_patch_idx = torch.nonzero(
        ((patch_means[:, 1] <= center_patch_offset[1] + half_w) & (patch_means[:, 0] >= center_patch_offset[0] + half_w) & (patch_means[:, 0] + patch_means[:, 1] <  center_patch_offset[0] + center_patch_offset[1] + 2 * half_w)) |
        ((patch_means[:, 1] <= center_patch_offset[1] + half_w) & (patch_means[:, 0] <  center_patch_offset[0] + half_w) & (patch_means[:, 1] - patch_means[:, 0] <= center_patch_offset[1] - center_patch_offset[0]))
    ).squeeze()
    west_center_patch = center_patch[west_center_patch_idx]
    north_center_patch = center_patch[north_center_patch_idx]
    east_center_patch = center_patch[east_center_patch_idx]
    south_center_patch = center_patch[south_center_patch_idx]

    # West
    west_center_img = render_surface(splats, (t_width, t_width), tile_render_hw, splat_offset=center_patch_offset, splat_index=west_center_patch, image_file='west_center_patch.png', mode='ortho')
    west_edge_img = render_surface(splats, (t_width, t_width), tile_render_hw, splat_offset=(tile_offset['west'][0]+half_w, tile_offset['west'][1]), splat_index=tile['west'], image_file='west_edge_patch.png', mode='ortho')
    """
