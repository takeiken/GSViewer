import torch
import math
import torch.nn.functional as F
from copy import deepcopy
import os
from itertools import product

from render import render_surface
from graphcut import tile_graph_cut
from config import *
from utils import *
from sam import generate_priority_map, compute_gaussian_uv

def sample_patches(splats_list, splat_range, p_width, p_num):

    margin = 0.02

    multi_patch_list = []   # [splats_num, p_num]
    patch_offset_list = []
    sx, sy = splat_range
    rand_x = torch.rand((p_num,)) * (sx - p_width - 2 * margin) + margin
    rand_y = torch.rand((p_num,)) * (sy - p_width - 2 * margin) + margin

    for splats in splats_list:
        p_list = []
        for i in range(p_num):
            means = splats['means']
            patch = torch.nonzero((means[:, 0] >= rand_x[i]) & (means[:, 0] < rand_x[i] + p_width) & (means[:, 1] > rand_y[i]) & (means[:, 1] <= rand_y[i] + p_width)).squeeze()
            p_list.append(patch)
        multi_patch_list.append(p_list)

    for i in range(p_num):
        offset = torch.tensor([rand_x[i], rand_y[i], 0.0])
        patch_offset_list.append(offset)

    return multi_patch_list, patch_offset_list

def sample_patches_to_image(src_image, splat_range, t_width, offset_list):
    if type(src_image) == torch.Tensor:
        img_t_width = int(t_width / splat_range[1] * src_image.shape[0])
        if img_t_width % 2 != 0:
            img_t_width -= 1
        
        image_list = []
        for offset in offset_list:
            img_offset = (src_image.shape[0] - int(offset[1] / splat_range[1] * src_image.shape[0]), int(offset[0] / splat_range[0] * src_image.shape[1]))
            img = src_image[img_offset[0]-img_t_width:img_offset[0], img_offset[1]:img_offset[1]+img_t_width]
            image_list.append(img)
        
        return image_list
    
    elif type(src_image) == dict:
        image_list = []
        for offset in offset_list:
            patch_dict = {}
            for key in src_image.keys():
                img_t_width = int(t_width / splat_range[1] * src_image[key].shape[0])
                if img_t_width % 2 != 0:
                    img_t_width -= 1
                img_offset = (src_image[key].shape[0] - int(offset[1] / splat_range[1] * src_image[key].shape[0]), int(offset[0] / splat_range[0] * src_image[key].shape[1]))
                img = src_image[key][img_offset[0]-img_t_width:img_offset[0], img_offset[1]:img_offset[1]+img_t_width]
                patch_dict[key] = img
            
            image_list.append(patch_dict)
        
        return image_list

    else:
        raise TypeError(src_image)

def combination_index_to_sets(idx, num_sets):
    """
    idx: 0..num_sets*(num_sets-1)/2 - 1
    Returns: (i,j) corresponding to the idx-th combination
    """
    acc = 0
    for i in range(num_sets):
        num_j = num_sets - i - 1
        if idx < acc + num_j:
            j = i + 1 + (idx - acc)
            return i, j
        acc += num_j
    raise ValueError("Index out of range")

def create_tile_definition(num_sets=2, num_colors_per_set=2):
    # Compute combinations
    set_combinations = [(i,j) for i in range(num_sets) for j in range(num_sets) if i != j and i < j]

    # Define edge color for each wang tile
    tile_def_list = []
    for comb_i in range(len(set_combinations)):
        we_colors = range(num_colors_per_set)
        ns_colors = range(num_colors_per_set)

        set_def_list = []
        for w_color, n_color, e_color, s_color in product(we_colors, ns_colors, we_colors, ns_colors):
            set_def_list.append((w_color, n_color, e_color, s_color))

        tile_def_list.append(set_def_list)

    print(tile_def_list)
    print(len(tile_def_list))
    return tile_def_list

def build_wang_tiles(splats_list, splat_range, t_width=1.0, num_sets=2, num_colors_per_set=2, num_center=1, num_center_choice=1, sam_info=None):

    tile_render_hw = (128, 128)
    assert(num_center <= num_center_choice)

    tile_def_list = create_tile_definition(num_sets, num_colors_per_set)
    num_comb = len(tile_def_list)
    num_tile = num_comb * num_colors_per_set ** 4

    # Get edge patch samples
    multi_edge_patch_list, edge_patch_offset_list = sample_patches(splats_list, splat_range, t_width, num_sets * num_colors_per_set)
    edge_patch_sam_info_list = sample_patches_to_image(sam_info, splat_range, t_width, edge_patch_offset_list)

    half_w = t_width / 2
    img_t_width = int(t_width / splat_range[1] * sam_info['color'].shape[0])
    if img_t_width % 2 != 0:
        img_t_width -= 1
    img_half_w = int(img_t_width / 2)
    sphere_r2 = torch.tensor([half_w * half_w * 2])
    multi_tile_list = []
    tile_offset_list = []
    edge_img_list = []
    edge_sam_info_list = []
    for comb_i, def_i in product(range(num_comb), range(num_colors_per_set ** 4)):
        tile_def = tile_def_list[comb_i][def_i] # W,N,E,S
        set_i, set_j = combination_index_to_sets(comb_i, num_sets)

        multi_sphere_tile = { 'tiles': [] }
        multi_tri_tile = { 'tiles': [] }
        tile_offset = {}
        edge_sam_info = {}
        for key in sam_info:
            edge_sam_info[key] = torch.zeros((img_t_width, img_t_width, sam_info[key].shape[2]))
        
        tile_key = ['west', 'north', 'east', 'south']
        
        for (spl_i, spl) in enumerate(splats_list):
        
            sphere_tile = {}
            tri_tile = {}
            for j in range(4):
                if j == 0 or j == 2 or rotate_tile:
                    edge_patch_index = tile_def[j] + num_colors_per_set * set_i
                else:
                    edge_patch_index = tile_def[j] + num_colors_per_set * set_j
                edge_patch = multi_edge_patch_list[spl_i][edge_patch_index]
                edge_patch_offset = edge_patch_offset_list[edge_patch_index]
                edge_patch_sam_info = edge_patch_sam_info_list[edge_patch_index]

                patch_means = spl['means'][edge_patch][:, 0:2]
                sphere_o = edge_patch_offset[0:2].clone()
                
                if j == 0:
                    # West
                    # Sphere patch
                    sphere_o[1] += half_w
                    sphere_patch_idx = torch.nonzero(
                        ((patch_means - sphere_o).square().sum(dim=1) <= sphere_r2) & 
                        (patch_means[:, 0] >= edge_patch_offset[0] + half_w)
                    ).squeeze(1)
                    # Triangle patch
                    triangle_patch_idx = torch.nonzero(
                        ((patch_means[:, 0] >= edge_patch_offset[0] + half_w) & (patch_means[:, 1] >= edge_patch_offset[1] + half_w) & (patch_means[:, 0] + patch_means[:, 1] <= edge_patch_offset[0] + edge_patch_offset[1] + 3 * half_w)) |
                        ((patch_means[:, 0] >= edge_patch_offset[0] + half_w) & (patch_means[:, 1] <  edge_patch_offset[1] + half_w) & (patch_means[:, 1] - patch_means[:, 0] >  edge_patch_offset[1] - edge_patch_offset[0] - half_w))
                    ).squeeze(1)
                    # Image patch
                    if spl_i == 0:
                        for key in sam_info:
                            img_patch_0 = edge_patch_sam_info[key][:img_half_w, img_half_w:] * torch.ones((img_half_w, img_half_w)).tril().unsqueeze(2)
                            img_patch_1 = edge_patch_sam_info[key][img_half_w:, img_half_w:] * torch.ones((img_half_w, img_half_w)).tril(-1).flip([0]).unsqueeze(2)
                            img_patch = torch.cat([img_patch_0, img_patch_1], 0)
                            edge_sam_info[key][:, :img_half_w] += img_patch
                elif j == 1:
                    # North
                    # Sphere patch
                    sphere_o[0] += half_w
                    sphere_o[1] += t_width
                    sphere_patch_idx = torch.nonzero(
                        ((patch_means - sphere_o).square().sum(dim=1) <= sphere_r2) & 
                        (patch_means[:, 1] <= edge_patch_offset[1] + half_w)
                    ).squeeze(1)
                    # Triangle patch
                    if not rotate_tile:
                        triangle_patch_idx = torch.nonzero(
                            ((patch_means[:, 1] <= edge_patch_offset[1] + half_w) & (patch_means[:, 0] <= edge_patch_offset[0] + half_w) & (patch_means[:, 0] + patch_means[:, 1] >  edge_patch_offset[0] + edge_patch_offset[1] + half_w)) |
                            ((patch_means[:, 1] <= edge_patch_offset[1] + half_w) & (patch_means[:, 0] >  edge_patch_offset[0] + half_w) & (patch_means[:, 1] - patch_means[:, 0] >= edge_patch_offset[1] - edge_patch_offset[0] - half_w))
                        ).squeeze(1)
                    else:
                        # East patch
                        triangle_patch_idx = torch.nonzero(
                            ((patch_means[:, 0] <  edge_patch_offset[0] + half_w) & (patch_means[:, 1] <= edge_patch_offset[1] + half_w) & (patch_means[:, 0] + patch_means[:, 1] >= edge_patch_offset[0] + edge_patch_offset[1] + half_w)) |
                            ((patch_means[:, 0] <  edge_patch_offset[0] + half_w) & (patch_means[:, 1] >  edge_patch_offset[1] + half_w) & (patch_means[:, 1] - patch_means[:, 0] <  edge_patch_offset[1] - edge_patch_offset[0] + half_w))
                        ).squeeze(1)
                    # Image patch
                    if spl_i == 0:
                        if not rotate_tile:
                            for key in sam_info:
                                img_patch_0 = edge_patch_sam_info[key][img_half_w:, :img_half_w] * torch.ones((img_half_w, img_half_w)).triu(1).unsqueeze(2)
                                img_patch_1 = edge_patch_sam_info[key][img_half_w:, img_half_w:] * torch.ones((img_half_w, img_half_w)).triu().flip([1]).unsqueeze(2)
                                img_patch = torch.cat([img_patch_0, img_patch_1], 1)
                                edge_sam_info[key][:img_half_w, :] += img_patch
                        else:
                            for key in sam_info:
                                img_patch_0 = edge_patch_sam_info[key][:img_half_w, :img_half_w] * torch.ones((img_half_w, img_half_w)).triu(1).flip([0]).unsqueeze(2)
                                img_patch_1 = edge_patch_sam_info[key][img_half_w:, :img_half_w] * torch.ones((img_half_w, img_half_w)).triu().unsqueeze(2)
                                img_patch = torch.cat([img_patch_0, img_patch_1], 0)
                                img_patch = torch.rot90(img_patch)
                                edge_sam_info[key][:img_half_w, :] += img_patch
                elif j == 2:
                    # East
                    # Sphere patch
                    sphere_o[0] += t_width
                    sphere_o[1] += half_w
                    sphere_patch_idx = torch.nonzero(
                        ((patch_means - sphere_o).square().sum(dim=1) <= sphere_r2) & 
                        (patch_means[:, 0] < edge_patch_offset[0] + half_w)
                    ).squeeze(1)
                    # Triangle patch
                    triangle_patch_idx = torch.nonzero(
                        ((patch_means[:, 0] <  edge_patch_offset[0] + half_w) & (patch_means[:, 1] <= edge_patch_offset[1] + half_w) & (patch_means[:, 0] + patch_means[:, 1] >= edge_patch_offset[0] + edge_patch_offset[1] + half_w)) |
                        ((patch_means[:, 0] <  edge_patch_offset[0] + half_w) & (patch_means[:, 1] >  edge_patch_offset[1] + half_w) & (patch_means[:, 1] - patch_means[:, 0] <  edge_patch_offset[1] - edge_patch_offset[0] + half_w))
                    ).squeeze(1)
                    # Image patch
                    if spl_i == 0:
                        for key in sam_info:
                            img_patch_0 = edge_patch_sam_info[key][:img_half_w, :img_half_w] * torch.ones((img_half_w, img_half_w)).triu(1).flip([0]).unsqueeze(2)
                            img_patch_1 = edge_patch_sam_info[key][img_half_w:, :img_half_w] * torch.ones((img_half_w, img_half_w)).triu().unsqueeze(2)
                            img_patch = torch.cat([img_patch_0, img_patch_1], 0)
                            edge_sam_info[key][:, img_half_w:] += img_patch
                elif j == 3:
                    # South
                    # Sphere patch
                    sphere_o[0] += half_w
                    sphere_patch_idx = torch.nonzero(
                        ((patch_means - sphere_o).square().sum(dim=1) <= sphere_r2) & 
                        (patch_means[:, 1] > edge_patch_offset[1] + half_w)
                    ).squeeze(1)
                    # Triangle patch
                    if not rotate_tile:
                        triangle_patch_idx = torch.nonzero(
                            ((patch_means[:, 1] >  edge_patch_offset[1] + half_w) & (patch_means[:, 0] >= edge_patch_offset[0] + half_w) & (patch_means[:, 0] + patch_means[:, 1] <  edge_patch_offset[0] + edge_patch_offset[1] + 3 * half_w)) |
                            ((patch_means[:, 1] >  edge_patch_offset[1] + half_w) & (patch_means[:, 0] <  edge_patch_offset[0] + half_w) & (patch_means[:, 1] - patch_means[:, 0] <= edge_patch_offset[1] - edge_patch_offset[0] + half_w))
                        ).squeeze(1)
                    else:
                        # West patch
                        triangle_patch_idx = torch.nonzero(
                            ((patch_means[:, 0] >= edge_patch_offset[0] + half_w) & (patch_means[:, 1] >= edge_patch_offset[1] + half_w) & (patch_means[:, 0] + patch_means[:, 1] <= edge_patch_offset[0] + edge_patch_offset[1] + 3 * half_w)) |
                            ((patch_means[:, 0] >= edge_patch_offset[0] + half_w) & (patch_means[:, 1] <  edge_patch_offset[1] + half_w) & (patch_means[:, 1] - patch_means[:, 0] >  edge_patch_offset[1] - edge_patch_offset[0] - half_w))
                        ).squeeze(1)
                    # Image patch
                    if spl_i == 0:
                        if not rotate_tile:
                            for key in sam_info:
                                img_patch_0 = edge_patch_sam_info[key][:img_half_w, :img_half_w] * torch.ones((img_half_w, img_half_w)).tril().flip([1]).unsqueeze(2)
                                img_patch_1 = edge_patch_sam_info[key][:img_half_w, img_half_w:] * torch.ones((img_half_w, img_half_w)).tril(-1).unsqueeze(2)
                                img_patch = torch.cat([img_patch_0, img_patch_1], 1)
                                edge_sam_info[key][img_half_w:, :] += img_patch
                        else:
                            for key in sam_info:
                                img_patch_0 = edge_patch_sam_info[key][:img_half_w, img_half_w:] * torch.ones((img_half_w, img_half_w)).tril().unsqueeze(2)
                                img_patch_1 = edge_patch_sam_info[key][img_half_w:, img_half_w:] * torch.ones((img_half_w, img_half_w)).tril(-1).flip([0]).unsqueeze(2)
                                img_patch = torch.cat([img_patch_0, img_patch_1], 0)
                                img_patch = torch.rot90(img_patch)
                                edge_sam_info[key][img_half_w:, :] += img_patch
                
                sphere_patch = edge_patch[sphere_patch_idx] # sphere patch is the indexes of gs in splats
                tri_patch = edge_patch[triangle_patch_idx]
                
                sphere_tile[tile_key[j]] = sphere_patch
                tri_tile[tile_key[j]] = tri_patch
                
                if spl_i == 0:
                    tile_offset[tile_key[j]] = edge_patch_offset
            
            multi_sphere_tile['tiles'].append(sphere_tile)
            multi_tri_tile['tiles'].append(tri_tile)
        
        tile_splats = place_tile(splats_list[0], multi_tri_tile['tiles'][0], tile_offset, (0.0, 0.0), t_width, mode='edge')
        tile_img = render_surface(tile_splats, (t_width, t_width), tile_render_hw, mode='ortho')
        
        # TODO: choose sphere/tri tile here
        # tile_list.append(sphere_tile)
        multi_tile_list.append(multi_tri_tile)
        tile_offset_list.append(tile_offset)
        edge_img_list.append(tile_img)
        edge_sam_info_list.append(edge_sam_info)

    multi_tile_list = multi_tile_list * num_center
    tile_offset_list = tile_offset_list * num_center

    # Add center patch
    all_multi_center_patch_list, all_center_patch_offset_list = sample_patches(splats_list, splat_range, t_width, num_tile * num_center_choice)
    all_center_patch_sam_info_list = sample_patches_to_image(sam_info, splat_range, t_width, all_center_patch_offset_list)
    for i in range(num_tile):
        print(f'Tile {i} / {num_tile}')
        multi_center_patch_list = []    # [num_splats, num_center_choice]
        for p_list in all_multi_center_patch_list:
            multi_center_patch_list.append(p_list[i * num_center_choice : (i + 1) * num_center_choice])
        center_patch_offset_list = all_center_patch_offset_list[i * num_center_choice : (i + 1) * num_center_choice]
        center_patch_sam_info_list = all_center_patch_sam_info_list[i * num_center_choice : (i + 1) * num_center_choice]
        tile = deepcopy(multi_tile_list[i])
        tile_offset = deepcopy(tile_offset_list[i])
        tile['edge_sam_info'] = edge_sam_info_list[i]

        """ Sphere center patch
        center_img_list = []
        sphere_center_patch_list = []
        for j in range(num_center_choice):
            center_patch = center_patch_list[j]
            center_patch_offset = center_patch_offset_list[j]

            patch_means = splats['means'][center_patch][:, 0:2]
            sphere_o_west = center_patch_offset[0:2].clone()
            sphere_o_west[0] -= half_w
            sphere_o_west[1] += half_w
            sphere_o_north = center_patch_offset[0:2].clone()
            sphere_o_north[0] += half_w
            sphere_o_north[1] += half_w + t_width
            sphere_o_east = center_patch_offset[0:2].clone()
            sphere_o_east[0] += half_w + t_width
            sphere_o_east[1] += half_w
            sphere_o_south = center_patch_offset[0:2].clone()
            sphere_o_south[0] += half_w
            sphere_o_south[1] -= half_w
            
            sphere_mask = (
                ((patch_means - sphere_o_west).square().sum(dim=1) > sphere_r2) &
                ((patch_means - sphere_o_north).square().sum(dim=1) > sphere_r2) &
                ((patch_means - sphere_o_east).square().sum(dim=1) > sphere_r2) &
                ((patch_means - sphere_o_south).square().sum(dim=1) > sphere_r2)
            )
            sphere_center_patch_idx = torch.nonzero(sphere_mask).squeeze()
            sphere_edge_patch_idx = torch.nonzero(~sphere_mask).squeeze()
            sphere_center_patch = center_patch[sphere_center_patch_idx]
            sphere_edge_patch = center_patch[sphere_edge_patch_idx]

            tile['center'] = sphere_edge_patch
            tile_offset['center'] = center_patch_offset
            
            sphere_edge_splats = place_tile(splats, tile, tile_offset, (0.0, 0.0), t_width, mode='center')
            sphere_edge_img = render_surface(sphere_edge_splats, (t_width, t_width), tile_render_hw, mode='ortho')
            center_img_list.append(sphere_edge_img)
            sphere_center_patch_list.append(sphere_center_patch)
        
        center_imgs = torch.stack(center_img_list)
        img_errors = (center_imgs - edge_img_list[i]).square().sum(dim=(1, 2, 3))
        min_index = img_errors.argmin()
        """

        # center_sam_color_imgs = torch.stack([ info['color'] for info in center_patch_sam_info_list ])
        # img_errors = (center_sam_color_imgs - edge_sam_info_list[i]['color']).square().sum(dim=(1, 2, 3))
        # min_index = img_errors.argmin()

        # tile['center'] = sphere_center_patch_list[min_index]

        center_maxflow_list = []
        for center_i in range(num_center_choice):
            for spl_i in range(len(splats_list)):
                tile['tiles'][spl_i]['center'] = multi_center_patch_list[spl_i][center_i]
            tile_offset['center'] = center_patch_offset_list[center_i]
            tile['center_sam_info'] = center_patch_sam_info_list[center_i]

            _, maxflow = tile_graph_cut(splats_list, tile, tile_offset, t_width, dry_run=True)
            center_maxflow_list.append((center_i, maxflow))

        center_maxflow_list.sort(key=lambda x: x[1])
        print(f'Center options:')
        print(center_maxflow_list)

        for center_idx in range(num_center):
            for spl_i in range(len(splats_list)):
                tile['tiles'][spl_i]['center'] = multi_center_patch_list[spl_i][center_idx]
            tile_offset['center'] = center_patch_offset_list[center_idx]
            tile['center_sam_info'] = center_patch_sam_info_list[center_idx]
            # multi_tile_list[i + center_idx * num_tile], _ = tile_graph_cut(splats_list, tile, tile_offset, t_width, tile_id=i)
            multi_tile_list[i + center_idx * num_tile], _ = tile_graph_cut(splats_list, tile, tile_offset, t_width)
            tile_offset_list[i + center_idx * num_tile] = deepcopy(tile_offset)
    
    # Generate priority map
    block_images = []
    for ci in range(num_center):
        # 4x4 grid for this block
        grid = [[None] * 4 for _ in range(4)]

        for i in range(num_tile):
            r, c = index_to_row_col(i)
            grid[r][c] = multi_tile_list[i + comb_i * ci * num_tile]['cut_index']

        # stitch rows horizontally
        rows = [torch.cat(grid[r], dim=1) for r in range(4)]
        block_img = torch.cat(rows, dim=0)  # 4H × 4W

        block_images.append(block_img)

    # stack blocks vertically
    combined = torch.cat(block_images, dim=0)
    priority_map = generate_priority_map(combined)

    return tile_def_list, multi_tile_list, tile_offset_list, priority_map

def index_to_row_col(idx: int):
    """
    ['0000', '0010', '1010', '1000']
    ['0001', '0011', '1011', '1001']
    ['0101', '0111', '1111', '1101']
    ['0100', '0110', '1110', '1100']
    """
    b0 = (idx >> 0) & 1
    b1 = (idx >> 1) & 1
    b2 = (idx >> 2) & 1
    b3 = (idx >> 3) & 1

    row = (b2 << 1) | (b0 ^ b2)
    col = (b3 << 1) | (b1 ^ b3)
    return row, col

def generate_all_tiles(splats, tile_def_list, tile_list, tile_offset_list, t_width, comb_idx):
    num_vert = num_hori = 4
    new_splat_range = (t_width * num_hori, t_width * num_vert)
    
    new_splats = { k: [] for k in splats }
    
    for i in range(num_vert):
        for j in range(num_hori):
            
            tw = int(j / 2)
            tn = int(i / 2)
            te = 1 if (j == 1) or (j == 2) else 0
            ts = 1 if (i == 1) or (i == 2) else 0
            
            tile_id = -1
            for t_id in range(len(tile_def_list[comb_idx])):
                tile_def = tile_def_list[comb_idx][t_id]
                if (tile_def[0] == tw) and (tile_def[1] == tn) and (tile_def[2] == te) and (tile_def[3] == ts):
                    tile_id = t_id
                    break
            assert(tile_id >= 0)
            tile_id += comb_idx * 16  

            pos_x = j * t_width
            pos_y = new_splat_range[1] - (i + 1) * t_width
            placed_splats = place_tile(splats, tile_list[tile_id], tile_offset_list[tile_id], (pos_x, pos_y), t_width)

            for key in splats:
                new_splats[key].append(placed_splats[key])
    
    for key in new_splats:
        new_splats[key] = torch.cat(new_splats[key], dim=0)
    
    return new_splats, new_splat_range

def generate_all_tiles_split(splats, tile_def_list, tile_list, tile_offset_list, t_width, comb_idx):
    margin = 0.5 * t_width

    num_vert = num_hori = 4
    new_splat_range = (t_width * num_hori + margin * (num_hori - 1), t_width * num_vert + margin * (num_vert - 1))
    
    new_splats = { k: [] for k in splats }
    
    for i in range(num_vert):
        for j in range(num_hori):
            
            tw = int(j / 2)
            tn = int(i / 2)
            te = 1 if (j == 1) or (j == 2) else 0
            ts = 1 if (i == 1) or (i == 2) else 0
            
            tile_id = -1
            for t_id in range(len(tile_def_list[comb_idx])):
                tile_def = tile_def_list[comb_idx][t_id]
                if (tile_def[0] == tw) and (tile_def[1] == tn) and (tile_def[2] == te) and (tile_def[3] == ts):
                    tile_id = t_id
                    break
            assert(tile_id >= 0)    
            tile_id += comb_idx * 16

            pos_x = j * (t_width + margin)
            pos_y = new_splat_range[1] - (i + 1) * t_width - i * margin
            placed_splats = place_tile(splats, tile_list[tile_id], tile_offset_list[tile_id], (pos_x, pos_y), t_width)

            for key in splats:
                new_splats[key].append(placed_splats[key])
    
    for key in new_splats:
        new_splats[key] = torch.cat(new_splats[key], dim=0)
    
    return new_splats, new_splat_range

def generate_texture(splats, tile_def_list, tile_hash, tile_list, tile_offset_list, t_width, new_splat_range):
    
    num_hori = int(new_splat_range[0] / t_width)
    num_vert = int(new_splat_range[1] / t_width)
    num_color = tile_hash.shape[:2]
    num_p = tile_hash.shape[2]
    
    new_splats = { k: [] for k in splats }
    tile_splats_def = torch.zeros((num_vert, num_hori), dtype=torch.int)
    for i in range(num_vert):
        for j in range(num_hori):
            if i == 0:
                color_N = torch.randint(0, num_color[1], (1,))
            else:
                color_N = tile_def_list[tile_splats_def[i - 1, j]][3]
            if j == 0:
                color_W = torch.randint(0, num_color[0], (1,))
            else:
                color_W = tile_def_list[tile_splats_def[i, j - 1]][2]
            
            p = torch.randint(0, num_p, (1,))
            tile_id = tile_hash[color_W, color_N, p]
            tile_splats_def[i, j] = tile_id
            
            pos_x = j * t_width
            pos_y = new_splat_range[1] - (i + 1) * t_width
            placed_splats = place_tile(splats, tile_list[tile_id], tile_offset_list[tile_id], (pos_x, pos_y), t_width)

            for key in new_splats:
                new_splats[key].append(placed_splats[key])
    
    for key in new_splats:
        new_splats[key] = torch.cat(new_splats[key], dim=0)
    
    return new_splats

def vis_tiles(splats, splat_range, tile_list, tile_offset_list, t_width):
    tile_splats = {
        'means': [],
        'scales': [],
        'quats': [],
        'opacities': [],
        'colors': [],
    }
    
    # Examplar
    for key in tile_splats:
        tile_splats[key].append(splats[key])
    
    # Tiles
    num_tiles = len(tile_list)
    num_x = math.ceil(math.sqrt(num_tiles))
    
    for i in range(num_tiles):
        pos_x = 2 * t_width * (i % num_x) + 1.5 * splat_range[0]
        pos_y = 2 * t_width * int(i / num_x)
        placed_splats = place_tile(splats, tile_list[i], tile_offset_list[i], (pos_x, pos_y), t_width)
        
        for key in tile_splats:
            tile_splats[key].append(placed_splats[key])
    
    for key in tile_splats:
        tile_splats[key] = torch.cat(tile_splats[key], dim=0)
    
    return tile_splats

def find_bleeding_gaussians(
    splats,
    t_width,
    k: float = 3.0,
    margin: float = 0.3,       # safe margin (tile units)
    min_scale: float = 0.1,    # ignore small Gaussians
):
    """
    Identify Gaussians whose support crosses the tile boundary.

    means:  [N, D]
    scales: [N, D] or [N]
    tile_min, tile_max: scalars or tensors of shape [D]
    k: Gaussian support multiplier (2–3 typical)

    Returns:
        bleeding_mask: [N] bool
    """

    means = splats['means']
    scales = torch.exp(splats['scales'])

    D = means.shape[1]

    tile_min = torch.as_tensor(0.0, device=means.device)
    tile_max = torch.as_tensor(t_width, device=means.device)

    if tile_min.ndim == 0:
        tile_min = tile_min.expand(D)
    if tile_max.ndim == 0:
        tile_max = tile_max.expand(D)

    # effective sigma per Gaussian
    if scales.ndim == 1:
        sigma = scales.unsqueeze(1).expand(-1, D)
        sigma_max = scales
    else:
        sigma = scales
        sigma_max = scales.max(dim=1).values

    large_enough = sigma_max >= min_scale

    support = k * sigma

    # distance to lower and upper boundaries
    dist_min = means - tile_min
    dist_max = tile_max - means

    bleed_min = dist_min < (support - margin)
    bleed_max = dist_max < (support - margin)

    # bleeding if support exceeds boundary distance in any dimension
    bleeding = (bleed_min.any(dim=1) | bleed_max.any(dim=1)) & large_enough

    return bleeding

def save_tiles(ori_splats_list, multi_tile_list, tile_offset_list, t_width, black_bkgd, bkgd_height, tile_vis):
    os.makedirs(splats_dir, exist_ok=True)

    if tile_vis:
        torch.save(ori_splats_list[0], splats_dir / f'exemplar.pt')

    for i in range(len(multi_tile_list)):
        for (spl_i, spl) in enumerate(ori_splats_list):
            placed_splats = place_tile(spl, multi_tile_list[i]['tiles'][spl_i], tile_offset_list[i], (0, 0), t_width)

            # bleeding = find_bleeding_gaussians(placed_splats, t_width)
            # print(f'tile{i}_lod{spl_i} bleeding: {bleeding.sum()}')
            # for key in placed_splats.keys():
            #     placed_splats[key] = placed_splats[key][~bleeding]

            # Black background
            if black_bkgd:
                black_count = 8 - spl_i
                means = []
                for pi in range(black_count):
                    for pj in range(black_count):
                        means.append([
                            (pi + 0.5) / black_count * t_width,
                            (pj + 0.5) / black_count * t_width,
                            bkgd_height,
                        ])
                black_means = torch.tensor(means)
                black_quats = torch.tensor([0.0, 0.0, 0.0, 1.0]).repeat(black_count ** 2, 1)
                black_scales = torch.log(torch.tensor([0.5 / black_count * t_width, 0.5 / black_count * t_width, 0.01])).repeat(black_count ** 2, 1)
                black_opacities = torch.ones((black_count ** 2)) * (-spl_i/4)
                # black_opacities = torch.ones((black_count ** 2))
                black_sh0 = -torch.ones((black_count ** 2, 1, 3)) * 10
                black_uvs = torch.zeros((black_count ** 2, 2)) * 10

                placed_splats['means'] = torch.cat([placed_splats['means'], black_means], dim=0)
                placed_splats['quats'] = torch.cat([placed_splats['quats'], black_quats], dim=0)
                placed_splats['scales'] = torch.cat([placed_splats['scales'], black_scales], dim=0)
                placed_splats['opacities'] = torch.cat([placed_splats['opacities'], black_opacities], dim=0)
                placed_splats['sh0'] = torch.cat([placed_splats['sh0'], black_sh0], dim=0)
                placed_splats['uvs'] = torch.cat([placed_splats['uvs'], black_uvs], dim=0)

            placed_splats['shN'] = torch.zeros((placed_splats['means'].shape[0], 15, 3))

            if tile_vis:
                torch.save(placed_splats, splats_dir / f'tile{i}_lod{spl_i}.pt')
            else:
                save_ply(placed_splats, splats_dir / f'tile{i}_lod{spl_i}.ply')
            # if spl_i == 0:
            #     ply_name = f'lod1_tile_{i}_1.5x.ply'
            # elif spl_i == 1:
            #     ply_name = f'lod1_tile_{i}_1.0x.ply'
            # else:
            #     ply_name = f'lod1_tile_{i}_0.5x.ply'
            # save_ply(placed_splats, splats_dir / ply_name)
            # save_splats(placed_splats, f'lod1_tile_{i}.ply')

def zip_tiles():
    import zipfile
    import shutil

    zip_name = output_dir / 'gswt.zip'
    if os.path.exists(zip_name):
        os.remove(zip_name)

    with zipfile.ZipFile(zip_name, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(splats_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, splats_dir)
                z.write(full_path, rel_path)

    shutil.rmtree(splats_dir)

def preprocess_splats(ori_splats):
    splats = {}
    
    for key in ori_splats:
        splats[key] = ori_splats[key].clone()

    splats['quats'] = F.normalize(splats["quats"], p=2, dim=-1)
    splats['scales'] = torch.exp(splats["scales"])
    splats['opacities'] = torch.sigmoid(splats["opacities"])
    splats['colors'] = torch.cat([splats["sh0"], splats["shN"]], 1)
    splats.pop('sh0')
    splats.pop('shN')

    return splats

def preprocess_splats_list(ori_splats):
    return [preprocess_splats(ori) for ori in ori_splats]

def preprocess_height(splats_list, splat_range):
    heightmap_res = (10, 10) # (W, H)

    heightmap = torch.zeros(heightmap_res)
    ref_splats = splats_list[0]
    grid_w = (splat_range[1, 0] - splat_range[0, 0]) / heightmap_res[0]
    grid_h = (splat_range[1, 1] - splat_range[0, 1]) / heightmap_res[1]

    for i in range(heightmap_res[0]):
        for j in range(heightmap_res[1]):
            bbox = ((i * grid_w + splat_range[0, 0], j * grid_h + splat_range[0, 1]), ((i + 1) * grid_w + splat_range[0, 0], (j + 1) * grid_h + splat_range[0, 1]))
            splats_mask = (ref_splats['means'][:, 0] >= bbox[0][0]) & (ref_splats['means'][:, 0] < bbox[1][0]) & (ref_splats['means'][:, 1] >= bbox[0][1]) & (ref_splats['means'][:, 1] < bbox[1][1])
            mean_height = ref_splats['means'][splats_mask][:, 2].mean()
            heightmap[i, j] = mean_height

    # print(heightmap)
    heightmap = heightmap.transpose(0, 1).unsqueeze(0).unsqueeze(0) # [1, 1, H, W]

    for i in range(len(splats_list)):
        means = splats_list[i]['means']
        N = means.shape[0]
        u = (means[:, 0] - splat_range[0, 0]) / (splat_range[1, 0] - splat_range[0, 0]) * 2 - 1
        v = (means[:, 1] - splat_range[0, 1]) / (splat_range[1, 1] - splat_range[0, 1]) * 2 - 1

        grid = torch.stack([u, v], dim=1).view(N, 1, 1, 2)
        height = F.grid_sample(
            heightmap.broadcast_to((N, 1, heightmap_res[0], heightmap_res[1])),
            grid,
            mode='bilinear',
            align_corners=False,
            padding_mode='border'
        )

        splats_list[i]['means'][:, 2] -= height.view(-1)

def clean_exemplar_list(splats_list, t_width):
    for ori_s in splats_list:
        s_mask = ((ori_s['scales'] < math.log(t_width)) & (ori_s['scales'] != -torch.inf)).all(-1)
        for key in ori_s:
            ori_s[key] = ori_s[key][s_mask]

def load_exemplar_list(
    splat_name,
    source_splat_range,
    target_splat_range,
    do_preprocess_height,
):
    splats_list = []
    for filename in splat_name:
        ori_s = torch.load(filename, map_location=device)['splats']

        # Clean xy
        s_mask = (ori_s['means'][:, :2] >= source_splat_range[0][:2]).all(-1) & (ori_s['means'][:, :2] <= source_splat_range[1][:2]).all(-1)
        for key in ori_s:
            ori_s[key] = ori_s[key][s_mask]

        splats_list.append(ori_s)

    if do_preprocess_height:
        preprocess_height(splats_list, source_splat_range)

    for ori_s in splats_list:
        # Clean height
        s_mask = (ori_s['means'][:, 2] >= source_splat_range[0][2]) & (ori_s['means'][:, 2] <= source_splat_range[1][2])
        for key in ori_s:
            ori_s[key] = ori_s[key][s_mask]

        scale_factor = target_splat_range[0] / (source_splat_range[1, 0] - source_splat_range[0, 0])
        ori_s['scales'] += math.log(scale_factor)
        ori_s['means'] -= source_splat_range[0]
        ori_s['means'] *= scale_factor

    return splats_list