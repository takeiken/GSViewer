import time
from pathlib import Path
import torch
import numpy as np
from PIL import Image

from config import *
from gswt import *
from viewer import Viewer
from sam import sam, generate_priority_map, assign_gaussian_uv, generate_center_offset_map

if __name__ == "__main__":

    start_time = time.time()
    os.makedirs(image_dir, exist_ok=True)

    if torch.cuda.is_available():
        torch.set_default_device('cuda')

    source_splat_range = torch.tensor([
        [-10.0, -10.0, -10.0],
        [10.0, 10.0, 10.0],
    ])
    target_splat_range = (10.0, 10.0)
    t_width = 4.0
    image_shape = (2048, 2048)
    torch.manual_seed(0)
    num_center = 1
    do_preprocess_height = False
    black_bkgd = False
    bkgd_height = 0.0
    tile_vis = False

    # Synthetic
    source_splat_range = torch.tensor([
        [0.0, 0.0, 0.32],
        [1.0, 1.0, 0.7],
    ])

    # exp_name = 'desert_sparse'
    # torch.manual_seed(2)

    # exp_name = 'grass_sparse'

    # exp_name = 'grass_field'

    # exp_name = 'mars'
    # num_center = 2

    # exp_name = 'meadow'
    # torch.manual_seed(6)

    # Real-world
    source_splat_range = torch.tensor([
        [-2.0, -2.0, -0.4],
        [2.0, 2.0, 0.4],
    ])
    do_preprocess_height = True
    # black_bkgd = True
    # bkgd_height = -0.5

    # exp_name = 'rubble_drone'
    # bkgd_height = 0.7

    # exp_name = 'forest_drone'

    exp_name = 'plants_drone'
    # bkgd_height = 0.6

    # exp_name = 'grass_drone'

    # exp_name = 'water_rocks_drone'
    # torch.manual_seed(1)

    # exp_name = 'rocks_drone'
    # torch.manual_seed(1)

    # exp_name = 'bricks_drone'

    # exp_name = 'road_drone'
    # source_splat_range = torch.tensor([
    #     [-1.0, -1.0, -1.0],
    #     [1.0, 1.0, 1.0],
    # ])

    # source_splat_range = torch.tensor([
    #     [-1.0, -1.0, -0.4],
    #     [1.0, 1.0, 0.4],
    # ])
    # exp_name = 'fur'

    splat_name = [
        'splats_0.pt',
        'splats_1.pt',
        'splats_2.pt',
        'splats_3.pt',
        'splats_4.pt',
        'splats_5.pt',
    ]   # process according to splats[0]
    splat_name = [ exemplar_dir / exp_name / filename for filename in splat_name ]

    ori_splats_list = load_exemplar_list(
        splat_name,
        source_splat_range,
        target_splat_range,
        do_preprocess_height,
    )
    clean_exemplar_list(ori_splats_list, t_width)
    splats_list = preprocess_splats_list(ori_splats_list)

    # from clustering import dchdp, label_random_color

    # splats = splats_list[2]
    # cluster_id, _ = dchdp(splats, 0.08, 0.5, 300.0)
    # splats['colors'] = label_random_color(cluster_id).unsqueeze(1)
    # # labels = gs_cluster(splats)
    # # splats['colors'] = label_random_color(labels).unsqueeze(1)
    # print(f"Time: {time.time() - start_time}")
    # viewer = Viewer(splats_list[0])
    # viewer.start_server()
    # exit()

    for (i, splats) in enumerate(splats_list):
        render_surface(splats, target_splat_range, image_shape, image_file=image_dir / f'exemplar_lod_{i}.png')
        render_surface(splats, target_splat_range, image_shape, image_file=image_dir / f'exemplar_tilt_lod_{i}.png', tilt=True, mode='pinhole')

    exemplar_img = render_surface(splats_list[0], target_splat_range, image_shape, image_file=image_dir / f'exemplar.png')

    # SAM segmentation
    print("Running SAM...")
    sam_result, masks = sam(image_dir / 'exemplar.png')
    img = sam_result['contour'] * 200
    img = Image.fromarray(img.detach().cpu().numpy().astype(np.uint8))
    img.save(image_dir / 'exemplar_sam_contour.png')
    img = sam_result['color'] * 255
    img = Image.fromarray(img.detach().cpu().numpy().astype(np.uint8))
    img.save(image_dir / 'exemplar_sam_color.png')
    img = 255 - sam_result['index']
    img = Image.fromarray(img.detach().cpu().numpy().astype(np.uint8))
    img.save(image_dir / 'exemplar_sam_index.png')
    if sam_result['index'].max() > 255:
        print(f"WARNING: Too many SAM segment areas: {sam_result['index'].max()}")

    assign_gaussian_uv(ori_splats_list, target_splat_range)
    # priority_map = generate_priority_map(sam_result['index'])
    offset_map = generate_center_offset_map(sam_result, masks, target_splat_range)
    # exemplar_maps = torch.cat([priority_map, offset_map], dim=-1)
    # save_exr_rg32f(image_dir / 'offset_map.exr', offset_map)

    # save_image(image_dir / 'exemplar_0.2.png', (priority_map > 0.8) * exemplar_img)
    # save_image(image_dir / 'exemplar_0.4.png', (priority_map > 0.6) * exemplar_img)
    # save_image(image_dir / 'exemplar_0.6.png', (priority_map > 0.4) * exemplar_img)
    # save_image(image_dir / 'exemplar_0.8.png', (priority_map > 0.2) * exemplar_img)
    # exit()
    # viewer = Viewer(splats)
    # viewer.start_server()

    # Build Wang tiles
    print("Building Wang tiles...")
    # tile_def_list, tile_hash, tile_list, tile_offset_list = build_wang_tiles(splats, target_splat_range, t_width, num_color=(3, 3), num_p=9)
    tile_def_list, multi_tile_list, tile_offset_list, priority_map = build_wang_tiles(splats_list, target_splat_range, t_width, num_sets=2, num_colors_per_set=2, num_center=num_center, num_center_choice=8, sam_info=sam_result)

    save_tiles(ori_splats_list, multi_tile_list, tile_offset_list, t_width, black_bkgd, bkgd_height, tile_vis)
    save_exr_r32f(splats_dir / 'priority_map.exr', priority_map)
    save_exr_rg32f(splats_dir / 'offset_map.exr', offset_map)
    zip_tiles()

    # Visualize
    avg_scale = []
    avg_splat_count = []
    for i in range(len(splat_name)):
        splats = splats_list[i]
        tile_list = [m_tile['tiles'][i] for m_tile in multi_tile_list]

        for comb_i in range(len(tile_def_list)):
            all_tiles_comb_splats, new_splat_range = generate_all_tiles(splats, tile_def_list, tile_list, tile_offset_list, t_width, comb_i)
            render_surface(all_tiles_comb_splats, new_splat_range, image_shape, image_file=image_dir / f'lod_{i}_comb_{comb_i}_all_tiles_comb.png')
            render_surface(all_tiles_comb_splats, new_splat_range, image_shape, image_file=image_dir / f'lod_{i}_comb_{comb_i}_all_tiles_comb_tilt.png', tilt=True, mode='pinhole')

            all_tiles_split_splats, new_splat_range = generate_all_tiles_split(splats, tile_def_list, tile_list, tile_offset_list, t_width, comb_i)
            render_surface(all_tiles_split_splats, new_splat_range, (1840, 1840), image_file=image_dir / f'lod_{i}_comb_{comb_i}_all_tiles_split.png', margin=0.05, background=[1, 1, 1], save_alpha=True)
            render_surface(all_tiles_split_splats, new_splat_range, image_shape, image_file=image_dir / f'lod_{i}_comb_{comb_i}_all_tiles_split_tilt.png', tilt=True, mode='pinhole')

        avg_scale.append(all_tiles_comb_splats['scales'].mean())
        if black_bkgd:
            avg_splat_count.append(all_tiles_comb_splats['means'].shape[0] / (16 * num_center) + (8 - i) ** 2)
        else:
            avg_splat_count.append(all_tiles_comb_splats['means'].shape[0] / (16 * num_center))
        # print(f"Lod {i} avg scale: {all_tiles_comb_splats['scales'].mean()}")
        # print(f"Lod {i} avg splat count: {all_tiles_comb_splats['means'].shape[0] / 16}")

        # if i == 0:
        #     new_splat_range = (40, 40)
        #     # new_display_shape = (display_shape[0] * 2, display_shape[1] * 2)
        #     gen_splats = generate_texture(splats, tile_def_list, tile_hash, tile_list, tile_offset_list, t_width, new_splat_range)
        #     render_surface(gen_splats, new_splat_range, display_shape, image_file='gen_top.png', margin=0.03, background=[1, 1, 1])
        #     render_surface(gen_splats, new_splat_range, display_shape, image_file='gen_top_tilt.png', tilt=True, mode='pinhole')

    splats = splats_list[0]
    tile_list = [m_tile['tiles'][0] for m_tile in multi_tile_list]
    all_tiles_comb_splats, new_splat_range = generate_all_tiles(splats, tile_def_list, tile_list, tile_offset_list, t_width, 0)
    tile_img = render_surface(all_tiles_comb_splats, new_splat_range, (1024, 1024))
    save_image(image_dir / 'exemplar_0.2.png', (priority_map > 0.8) * tile_img)
    save_image(image_dir / 'exemplar_0.4.png', (priority_map > 0.6) * tile_img)
    save_image(image_dir / 'exemplar_0.6.png', (priority_map > 0.4) * tile_img)
    save_image(image_dir / 'exemplar_0.8.png', (priority_map > 0.2) * tile_img)

    print("Avg scale and splat count:")
    for s in avg_scale:
        print(f"{s:.3g} & ", end="")    
    print("")
    for s in avg_splat_count:
        print(f"{s} & ", end="")
    print("")
    for s in avg_splat_count:
        print(f"{(s / 1000.0):.3g}K & ", end="")
    print("")

    # tile_splats = vis_tiles(splats, splat_range, tile_list, tile_offset_list, t_width)
    # gen_splats['means'][:, 0] += tile_splats['means'][:, 0].max() + 0.5 * splat_range[0]
    # for key in tile_splats:
    #     tile_splats[key] = torch.cat([tile_splats[key], gen_splats[key]], dim=0)

    # viewer = Viewer(tile_splats)
    # viewer.start_server()

    # img = Image.open(image_dir / "lod_0_all_tiles_comb.png")
    # resized = img.resize((64, 64), resample=Image.BILINEAR)
    # resized.save(image_dir / "proxy.png")

    end_time = time.time()
    print(f"Elapsed time: {end_time - start_time}s.")