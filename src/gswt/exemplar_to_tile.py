#!/usr/bin/env python3
"""
splat_tile_graphcut.py
======================
Generate a seamless square-tileable .splat/.ply from an irregular Gaussian
splat scene (.splat or .ply from 3DGS) using graph-cut seam optimisation.

Now with PCA auto-alignment: detects the flat face of the asset and rotates
it so the face (not the side) aligns with the tiling plane before tiling.

Dependencies:
    pip install numpy opencv-python PyMaxflow scipy

Usage:
    python splat_tile_graphcut.py -i scene.ply  -o tile.ply
    python splat_tile_graphcut.py -i scene.ply  -o tile.ply --plane xz
    python splat_tile_graphcut.py -i scene.ply  -o tile.ply --no-auto-align
"""

import numpy as np
import cv2
import argparse
import sys
from pathlib import Path
from scipy.spatial.transform import Rotation

try:
    import maxflow
except ImportError:
    sys.exit("Missing dependency: pip install PyMaxflow")


# ═══════════════════════════════════════════════════════════════════
#  .splat dtype (compact 32-byte format, used internally for raster)
# ═══════════════════════════════════════════════════════════════════

SPLAT_DTYPE = np.dtype([
    ("x",  np.float32), ("y",  np.float32), ("z",  np.float32),
    ("sx", np.float32), ("sy", np.float32), ("sz", np.float32),
    ("r",  np.uint8),   ("g",  np.uint8),
    ("b",  np.uint8),   ("a",  np.uint8),
    ("q0", np.uint8),   ("q1", np.uint8),
    ("q2", np.uint8),   ("q3", np.uint8),
])
assert SPLAT_DTYPE.itemsize == 32


# ═══════════════════════════════════════════════════════════════════
#  PCA alignment (ported from align_exemplar.py)
# ═══════════════════════════════════════════════════════════════════

# For each tiling plane, the perpendicular axis that the face normal
# should be aligned TO:
PLANE_PERP = {
    "xy": np.array([0.0, 0.0, 1.0]),   # tile in XY => face should point Z
    "xz": np.array([0.0, 1.0, 0.0]),   # tile in XZ => face should point Y
    "yz": np.array([1.0, 0.0, 0.0]),   # tile in YZ => face should point X
}


def fit_plane_normal(positions):
    """PCA on positions => surface normal (smallest-eigenvalue eigenvector)."""
    centroid = positions.mean(axis=0)
    centered = positions - centroid
    cov = centered.T @ centered / len(centered)
    eigvals, eigvecs = np.linalg.eigh(cov)
    # eigh returns ascending order; index 0 = smallest = normal direction
    normal = eigvecs[:, 0]
    return normal, centroid, eigvals


def rotation_between_normals(n_from, n_to):
    """Rotation that maps unit vector n_from => n_to."""
    n_from = n_from / np.linalg.norm(n_from)
    n_to   = n_to   / np.linalg.norm(n_to)
    dot = np.dot(n_from, n_to)

    if dot > 0.9999:
        return Rotation.identity()
    if dot < -0.9999:
        perp = np.array([1, 0, 0]) if abs(n_from[0]) < 0.9 else np.array([0, 1, 0])
        axis = np.cross(n_from, perp)
        axis /= np.linalg.norm(axis)
        return Rotation.from_rotvec(np.pi * axis)

    axis = np.cross(n_from, n_to)
    axis /= np.linalg.norm(axis)
    angle = np.arccos(np.clip(dot, -1, 1))
    return Rotation.from_rotvec(angle * axis)


def _decode_quat_splat(sp):
    """SPLAT uint8 q0..q3 (w,x,y,z) => float64 array (N,4) as (x,y,z,w) for scipy."""
    qw = (sp["q0"].astype(np.float64) - 128.0) / 128.0
    qx = (sp["q1"].astype(np.float64) - 128.0) / 128.0
    qy = (sp["q2"].astype(np.float64) - 128.0) / 128.0
    qz = (sp["q3"].astype(np.float64) - 128.0) / 128.0
    quats = np.column_stack([qx, qy, qz, qw])
    norms = np.linalg.norm(quats, axis=1, keepdims=True)
    quats /= np.maximum(norms, 1e-10)
    return quats


def _encode_quat_splat(quats_xyzw):
    """scipy (x,y,z,w) => SPLAT uint8 q0..q3 (w,x,y,z)."""
    w = quats_xyzw[:, 3]
    x = quats_xyzw[:, 0]
    y = quats_xyzw[:, 1]
    z = quats_xyzw[:, 2]
    q0 = np.clip(w * 128.0 + 128.0, 0, 255).astype(np.uint8)
    q1 = np.clip(x * 128.0 + 128.0, 0, 255).astype(np.uint8)
    q2 = np.clip(y * 128.0 + 128.0, 0, 255).astype(np.uint8)
    q3 = np.clip(z * 128.0 + 128.0, 0, 255).astype(np.uint8)
    return q0, q1, q2, q3


def _decode_quat_raw(raw, prop_names):
    """PLY raw rot_0..rot_3 (w,x,y,z) float => (N,4) as (x,y,z,w) for scipy."""
    if "rot_0" not in prop_names:
        return None
    qw = raw["rot_0"].astype(np.float64)
    qx = raw["rot_1"].astype(np.float64)
    qy = raw["rot_2"].astype(np.float64)
    qz = raw["rot_3"].astype(np.float64)
    quats = np.column_stack([qx, qy, qz, qw])
    norms = np.linalg.norm(quats, axis=1, keepdims=True)
    quats /= np.maximum(norms, 1e-10)
    return quats


def _encode_quat_raw(raw, quats_xyzw):
    """scipy (x,y,z,w) => PLY raw rot_0..rot_3 (w,x,y,z) float32."""
    norms = np.linalg.norm(quats_xyzw, axis=1, keepdims=True)
    quats_xyzw = quats_xyzw / np.maximum(norms, 1e-10)
    raw["rot_0"] = quats_xyzw[:, 3].astype(np.float32)
    raw["rot_1"] = quats_xyzw[:, 0].astype(np.float32)
    raw["rot_2"] = quats_xyzw[:, 1].astype(np.float32)
    raw["rot_3"] = quats_xyzw[:, 2].astype(np.float32)


def align_to_tiling_plane(sp, raw, plane, flip_normal=False):
    """
    Detect the flat face of the splat cloud via PCA, then rotate the
    entire cloud so the face normal aligns with the tiling plane's
    perpendicular axis.

    Rotates: positions, Gaussian quaternions.

    Returns (sp, raw) — both rotated in-place copies.
    """
    pos = np.column_stack([
        sp["x"].astype(np.float64),
        sp["y"].astype(np.float64),
        sp["z"].astype(np.float64),
    ])

    surface_normal, centroid, eigvals = fit_plane_normal(pos)
    target_normal = PLANE_PERP[plane]

    # Ensure surface normal points towards positive side of target axis
    if np.dot(surface_normal, target_normal) < 0:
        surface_normal = -surface_normal

    if flip_normal:
        surface_normal = -surface_normal

    angle_deg = np.degrees(np.arccos(
        np.clip(np.dot(surface_normal, target_normal), -1, 1)))

    # Flatness ratio: smallest eigenvalue should be much smaller than others
    flatness = eigvals[0] / (eigvals[1] + 1e-20)

    print(f"\n== PCA auto-alignment ==")
    print(f"  centroid       : ({centroid[0]:.3f}, {centroid[1]:.3f}, {centroid[2]:.3f})")
    print(f"  eigenvalues    : {eigvals[0]:.6f}, {eigvals[1]:.6f}, {eigvals[2]:.6f}")
    print(f"  flatness ratio : {flatness:.4f}  (< 0.1 = clearly flat)")
    print(f"  surface normal : ({surface_normal[0]:.4f}, {surface_normal[1]:.4f}, {surface_normal[2]:.4f})")
    print(f"  target normal  : ({target_normal[0]:.4f}, {target_normal[1]:.4f}, {target_normal[2]:.4f})")
    print(f"  misalignment   : {angle_deg:.1f}°")

    if angle_deg < 2.0:
        print(f"  => already well-aligned, skipping rotation")
        return sp, raw

    R = rotation_between_normals(surface_normal, target_normal)
    rot_deg = np.degrees(R.magnitude())
    rot_axis = R.as_rotvec() / (R.magnitude() + 1e-10)
    print(f"  rotation angle : {rot_deg:.1f}°")
    print(f"  rotation axis  : ({rot_axis[0]:.4f}, {rot_axis[1]:.4f}, {rot_axis[2]:.4f})")

    sp = sp.copy()

    # ── rotate positions (around centroid) ──
    centered = pos - centroid
    rotated = R.apply(centered)
    final = rotated + centroid

    sp["x"] = final[:, 0].astype(np.float32)
    sp["y"] = final[:, 1].astype(np.float32)
    sp["z"] = final[:, 2].astype(np.float32)

    # ── rotate SPLAT quaternions ──
    quats_xyzw = _decode_quat_splat(sp)
    splat_rots = Rotation.from_quat(quats_xyzw)
    rotated_rots = R * splat_rots
    out_xyzw = rotated_rots.as_quat()
    sp["q0"], sp["q1"], sp["q2"], sp["q3"] = _encode_quat_splat(out_xyzw)

    # ── rotate raw PLY data (if present) ──
    if raw is not None:
        raw = raw.copy()
        raw_names = list(raw.dtype.names) if raw.dtype.names else []

        # positions
        raw["x"] = final[:, 0].astype(np.float32)
        raw["y"] = final[:, 1].astype(np.float32)
        raw["z"] = final[:, 2].astype(np.float32)

        # quaternions
        if "rot_0" in raw_names:
            rq = _decode_quat_raw(raw, raw_names)
            if rq is not None:
                raw_splat_rots = Rotation.from_quat(rq)
                raw_rotated = R * raw_splat_rots
                _encode_quat_raw(raw, raw_rotated.as_quat())

    print(f"  => rotated {len(sp):,} Gaussians DONE\n")
    return sp, raw


# ═══════════════════════════════════════════════════════════════════
#  PLY helpers
# ═══════════════════════════════════════════════════════════════════

_NP_TYPE_MAP = {
    "float": np.float32, "float32": np.float32,
    "double": np.float64, "float64": np.float64,
    "uchar": np.uint8, "uint8": np.uint8,
    "char": np.int8, "int8": np.int8,
    "ushort": np.uint16, "uint16": np.uint16,
    "short": np.int16, "int16": np.int16,
    "uint": np.uint32, "uint32": np.uint32,
    "int": np.int32, "int32": np.int32,
}

_PLY_TYPE_MAP = {
    ("f", 4): "float",  ("f", 8): "double",
    ("u", 1): "uchar",  ("i", 1): "char",
    ("u", 2): "ushort", ("i", 2): "short",
    ("u", 4): "uint",   ("i", 4): "int",
}


# ═══════════════════════════════════════════════════════════════════
#  PLY loader => (splat_arr, raw_arr)
# ═══════════════════════════════════════════════════════════════════

def load_ply_gaussian(path: str):
    """
    Load a 3DGS .ply file.
    Returns
    -------
    splat_arr : ndarray[SPLAT_DTYPE]  — compact view for rasterisation
    raw_arr   : ndarray               — original PLY data (all properties)
    """
    with open(path, "rb") as f:
        # ── parse ASCII header ──
        header_lines = []
        while True:
            line = f.readline()
            if not line:
                sys.exit("Error: premature end of PLY header")
            line_s = line.decode("ascii", errors="replace").strip()
            header_lines.append(line_s)
            if line_s == "end_header":
                break

        is_binary_le = False
        is_binary_be = False
        is_ascii = False
        n_vertices = 0
        properties = []  # [(name, ply_type_str), ...]
        in_vertex = False

        for hl in header_lines:
            parts = hl.split()
            if not parts:
                continue
            if parts[0] == "format":
                if "binary_little_endian" in hl:
                    is_binary_le = True
                elif "binary_big_endian" in hl:
                    is_binary_be = True
                else:
                    is_ascii = True
            elif parts[0] == "element":
                in_vertex = (parts[1] == "vertex")
                if in_vertex:
                    n_vertices = int(parts[2])
            elif parts[0] == "property" and in_vertex:
                if parts[1] == "list":
                    sys.exit("Error: list properties in vertex element not supported")
                properties.append((parts[2], parts[1]))  # (name, ply_type)

        if n_vertices == 0:
            sys.exit("Error: no vertices found in PLY")

        prop_names = [p[0] for p in properties]
        print(f"PLY: {n_vertices:,} vertices, {len(properties)} properties")
        short = prop_names[:15]
        print(f"  properties: {', '.join(short)}{'…' if len(prop_names) > 15 else ''}")

        endian = "<" if is_binary_le else (">" if is_binary_be else "=")

        if is_ascii:
            rows = []
            for _ in range(n_vertices):
                line = f.readline().decode("ascii").strip()
                rows.append(line.split())
            dt_fields = []
            for name, ptype in properties:
                npt = _NP_TYPE_MAP.get(ptype, np.float32)
                dt_fields.append((name, npt))
            dt = np.dtype(dt_fields)
            raw = np.empty(n_vertices, dtype=dt)
            for i, row in enumerate(rows):
                for j, (name, ptype) in enumerate(properties):
                    npt = _NP_TYPE_MAP.get(ptype, np.float32)
                    raw[name][i] = npt(row[j])
        else:
            dt_fields = []
            for name, ptype in properties:
                npt = _NP_TYPE_MAP.get(ptype)
                if npt is None:
                    sys.exit(f"Error: unsupported PLY type '{ptype}'")
                dt_fields.append((name, endian + np.dtype(npt).str[1:]))
            dt = np.dtype(dt_fields)
            data = f.read(n_vertices * dt.itemsize)
            raw = np.frombuffer(data, dtype=dt).copy()
            if len(raw) != n_vertices:
                print(f"  Warning: expected {n_vertices} vertices, got {len(raw)}")

    # ═══ build SPLAT_DTYPE view for the rasteriser ═══
    def get(name, alts=None, default=None):
        for n in [name] + (alts or []):
            if n in prop_names:
                return raw[n].astype(np.float64)
        if default is not None:
            return np.full(len(raw), default, dtype=np.float64)
        sys.exit(f"Error: property '{name}' not found. Available: {prop_names}")

    n = len(raw)
    sp = np.zeros(n, dtype=SPLAT_DTYPE)

    # position
    sp["x"] = raw["x"].astype(np.float32)
    sp["y"] = raw["y"].astype(np.float32)
    sp["z"] = raw["z"].astype(np.float32)

    # scale (3DGS stores log-scale)
    if any(p in prop_names for p in ("scale_0", "log_scale_0")):
        s0 = np.clip(get("scale_0", ["log_scale_0"]), -20, 10)
        s1 = np.clip(get("scale_1", ["log_scale_1"]), -20, 10)
        s2 = np.clip(get("scale_2", ["log_scale_2"]), -20, 10)
        sp["sx"] = np.exp(s0).astype(np.float32)
        sp["sy"] = np.exp(s1).astype(np.float32)
        sp["sz"] = np.exp(s2).astype(np.float32)
    else:
        sp["sx"] = get("sx", default=0.01).astype(np.float32)
        sp["sy"] = get("sy", default=0.01).astype(np.float32)
        sp["sz"] = get("sz", default=0.01).astype(np.float32)

    # colour (SH DC => linear RGB)
    C0 = 0.28209479177387814
    if "f_dc_0" in prop_names:
        r = np.clip(0.5 + C0 * get("f_dc_0"), 0, 1)
        g = np.clip(0.5 + C0 * get("f_dc_1"), 0, 1)
        b = np.clip(0.5 + C0 * get("f_dc_2"), 0, 1)
    elif "red" in prop_names:
        rv, gv, bv = get("red"), get("green"), get("blue")
        mx = max(rv.max(), gv.max(), bv.max(), 1)
        scale = 1.0 if mx <= 1.0 else 1.0 / 255.0
        r = np.clip(rv * scale, 0, 1)
        g = np.clip(gv * scale, 0, 1)
        b = np.clip(bv * scale, 0, 1)
    else:
        r = g = b = np.full(n, 0.5)
        print("  Warning: no colour properties found — using grey")
    sp["r"] = (r * 255).astype(np.uint8)
    sp["g"] = (g * 255).astype(np.uint8)
    sp["b"] = (b * 255).astype(np.uint8)

    # opacity (3DGS stores logit)
    if "opacity" in prop_names:
        op = np.clip(get("opacity"), -20, 20)
        opacity = 1.0 / (1.0 + np.exp(-op))
    else:
        opacity = np.ones(n)
        print("  Warning: no opacity property — using 1.0")
    sp["a"] = (np.clip(opacity, 0, 1) * 255).astype(np.uint8)

    # rotation quaternion
    if "rot_0" in prop_names:
        q = np.column_stack([get("rot_0"), get("rot_1"),
                             get("rot_2"), get("rot_3")])
        qn = np.linalg.norm(q, axis=1, keepdims=True)
        q = q / np.maximum(qn, 1e-10)
        q_u8 = np.clip(q * 128.0 + 128.0, 0, 255).astype(np.uint8)
    else:
        q_u8 = np.tile(np.array([255, 128, 128, 128], np.uint8), (n, 1))
        print("  Warning: no rotation properties — using identity")
    sp["q0"] = q_u8[:, 0]
    sp["q1"] = q_u8[:, 1]
    sp["q2"] = q_u8[:, 2]
    sp["q3"] = q_u8[:, 3]

    # filter NaN / Inf
    pos = np.column_stack([sp["x"].astype(np.float64),
                           sp["y"].astype(np.float64),
                           sp["z"].astype(np.float64)])
    valid = np.all(np.isfinite(pos), axis=1)
    n_bad = int(np.sum(~valid))
    if n_bad:
        print(f"  Warning: removed {n_bad:,} Gaussians with NaN/Inf positions")
        sp = sp[valid]
        raw = raw[valid]

    print(f"  -> {len(sp):,} valid Gaussians")
    return sp, raw


# ═══════════════════════════════════════════════════════════════════
#  PLY writer
# ═══════════════════════════════════════════════════════════════════

def save_ply_gaussian(path: str, raw_arr: np.ndarray):
    """Write a structured numpy array as binary_little_endian PLY."""
    n = len(raw_arr)
    dt = raw_arr.dtype

    lines = ["ply", "format binary_little_endian 1.0", f"element vertex {n}"]

    le_fields = []
    for name in dt.names:
        fd = dt.fields[name][0]
        ply_t = _PLY_TYPE_MAP.get((fd.kind, fd.itemsize), "float")
        lines.append(f"property {ply_t} {name}")
        le_fd = fd.newbyteorder("<") if fd.itemsize > 1 else fd
        le_fields.append((name, le_fd))
    lines.append("end_header")

    le_dt = np.dtype(le_fields)
    le_arr = np.empty(n, dtype=le_dt)
    for name in dt.names:
        le_arr[name] = raw_arr[name]

    with open(path, "wb") as f:
        f.write(("\n".join(lines) + "\n").encode("ascii"))
        f.write(le_arr.tobytes())

    print(f"saved  {n:,} Gaussians => {path}")


def splat_to_ply_raw(splat_arr: np.ndarray) -> np.ndarray:
    """Convert SPLAT_DTYPE => PLY structured array (SH degree 0, no rest)."""
    n = len(splat_arr)
    C0 = 0.28209479177387814

    fields = [
        ("x", np.float32), ("y", np.float32), ("z", np.float32),
        ("nx", np.float32), ("ny", np.float32), ("nz", np.float32),
        ("f_dc_0", np.float32), ("f_dc_1", np.float32), ("f_dc_2", np.float32),
        ("opacity", np.float32),
        ("scale_0", np.float32), ("scale_1", np.float32), ("scale_2", np.float32),
        ("rot_0", np.float32), ("rot_1", np.float32),
        ("rot_2", np.float32), ("rot_3", np.float32),
    ]
    out = np.zeros(n, dtype=np.dtype(fields))

    out["x"] = splat_arr["x"]
    out["y"] = splat_arr["y"]
    out["z"] = splat_arr["z"]

    r = splat_arr["r"].astype(np.float64) / 255.0
    g = splat_arr["g"].astype(np.float64) / 255.0
    b = splat_arr["b"].astype(np.float64) / 255.0
    out["f_dc_0"] = ((r - 0.5) / C0).astype(np.float32)
    out["f_dc_1"] = ((g - 0.5) / C0).astype(np.float32)
    out["f_dc_2"] = ((b - 0.5) / C0).astype(np.float32)

    a = np.clip(splat_arr["a"].astype(np.float64) / 255.0, 1e-6, 1.0 - 1e-6)
    out["opacity"] = np.log(a / (1.0 - a)).astype(np.float32)

    out["scale_0"] = np.log(np.maximum(splat_arr["sx"].astype(np.float64), 1e-20)).astype(np.float32)
    out["scale_1"] = np.log(np.maximum(splat_arr["sy"].astype(np.float64), 1e-20)).astype(np.float32)
    out["scale_2"] = np.log(np.maximum(splat_arr["sz"].astype(np.float64), 1e-20)).astype(np.float32)

    q0 = (splat_arr["q0"].astype(np.float64) - 128.0) / 128.0
    q1 = (splat_arr["q1"].astype(np.float64) - 128.0) / 128.0
    q2 = (splat_arr["q2"].astype(np.float64) - 128.0) / 128.0
    q3 = (splat_arr["q3"].astype(np.float64) - 128.0) / 128.0
    qn = np.maximum(np.sqrt(q0**2 + q1**2 + q2**2 + q3**2), 1e-10)
    out["rot_0"] = (q0 / qn).astype(np.float32)
    out["rot_1"] = (q1 / qn).astype(np.float32)
    out["rot_2"] = (q2 / qn).astype(np.float32)
    out["rot_3"] = (q3 / qn).astype(np.float32)

    return out


# ═══════════════════════════════════════════════════════════════════
#  .splat I/O
# ═══════════════════════════════════════════════════════════════════

def load_splat_binary(path: str):
    """Returns (splat_arr, None) — no raw PLY data."""
    raw_bytes = Path(path).read_bytes()
    n = len(raw_bytes) // 32
    if n == 0:
        sys.exit(f"Error: '{path}' has no valid Gaussians")
    if len(raw_bytes) % 32:
        print(f"  Warning: trailing {len(raw_bytes) % 32} bytes ignored")
    arr = np.frombuffer(raw_bytes[: n * 32], dtype=SPLAT_DTYPE).copy()

    pos = np.column_stack([arr["x"].astype(np.float64),
                           arr["y"].astype(np.float64),
                           arr["z"].astype(np.float64)])
    valid = np.all(np.isfinite(pos), axis=1)
    n_bad = int(np.sum(~valid))
    if n_bad:
        print(f"  Warning: removed {n_bad:,} Gaussians with NaN/Inf")
        arr = arr[valid]

    print(f"loaded {len(arr):,} Gaussians from {path}")
    return arr, None


def save_splat_binary(path: str, arr: np.ndarray):
    arr.tofile(path)
    print(f"saved  {len(arr):,} Gaussians => {path}")


# ═══════════════════════════════════════════════════════════════════
#  Auto-detect I/O
# ═══════════════════════════════════════════════════════════════════

def load_input(path: str):
    ext = Path(path).suffix.lower()
    if ext == ".ply":
        return load_ply_gaussian(path)
    elif ext == ".splat":
        return load_splat_binary(path)
    else:
        print(f"  Warning: unknown extension '{ext}', trying .splat binary")
        return load_splat_binary(path)


def save_output(path: str, sp: np.ndarray, raw):
    ext = Path(path).suffix.lower()
    if ext == ".ply":
        if raw is not None:
            save_ply_gaussian(path, raw)
        else:
            print("  converting .splat => PLY (SH degree 0, no higher-order SH)")
            save_ply_gaussian(path, splat_to_ply_raw(sp))
    else:
        save_splat_binary(path, sp)


# ═══════════════════════════════════════════════════════════════════
#  Plane helpers
# ═══════════════════════════════════════════════════════════════════

PLANES = {
    "xy": ("x", "y", "z"),
    "xz": ("x", "z", "y"),
    "yz": ("y", "z", "x"),
}


def get_uv(sp, plane):
    a, b, _ = PLANES[plane]
    return sp[a].astype(np.float64).copy(), sp[b].astype(np.float64).copy()


# ═══════════════════════════════════════════════════════════════════
#  Rasteriser
# ═══════════════════════════════════════════════════════════════════

def rasterize(u, v, rgba, res, T):
    img = np.zeros((res, res, 4), np.float32)
    wgt = np.zeros((res, res), np.float32)

    c = rgba.astype(np.float32) / 255.0
    uw = u % T
    vw = v % T
    pu = np.clip((uw / T * res).astype(np.int32), 0, res - 1)
    pv = np.clip((vw / T * res).astype(np.int32), 0, res - 1)

    al = c[:, 3]
    for ch in range(3):
        np.add.at(img[:, :, ch], (pv, pu), c[:, ch] * al)
    np.add.at(wgt, (pv, pu), al)

    m = wgt > 0
    for ch in range(3):
        img[:, :, ch][m] /= wgt[m]
    img[:, :, 3] = np.clip(wgt, 0, 1)

    return cv2.GaussianBlur(img, (5, 5), 1.5)


# ═══════════════════════════════════════════════════════════════════
#  Graph-cut (toroidal)
# ═══════════════════════════════════════════════════════════════════

def graphcut(c_img, c_msk, p_img, p_msk):
    h, w = c_msk.shape
    has_c = c_msk > 0.05
    has_p = p_msk > 0.05

    if not np.any(has_c & has_p):
        return has_p

    d = np.sum((c_img[:, :, :3] - p_img[:, :, :3]) ** 2, axis=2)
    d *= 1.0 + 6.0 * np.minimum(c_msk, p_msk)

    g = maxflow.Graph[float]()
    nid = g.add_grid_nodes((h, w))

    hw = np.zeros((h, w), np.float64)
    hw[:, :-1] = d[:, :-1] + d[:, 1:] + 1e-8
    g.add_grid_edges(nid, weights=hw,
        structure=np.array([[0, 0, 0], [0, 0, 1], [0, 0, 0]]),
        symmetric=True)

    vw = np.zeros((h, w), np.float64)
    vw[:-1, :] = d[:-1, :] + d[1:, :] + 1e-8
    g.add_grid_edges(nid, weights=vw,
        structure=np.array([[0, 0, 0], [0, 0, 0], [0, 1, 0]]),
        symmetric=True)

    for y in range(h):
        cap = float(d[y, -1] + d[y, 0] + 1e-8)
        g.add_edge(int(nid[y, -1]), int(nid[y, 0]), cap, cap)
    for x in range(w):
        cap = float(d[-1, x] + d[0, x] + 1e-8)
        g.add_edge(int(nid[-1, x]), int(nid[0, x]), cap, cap)

    INF = 1e9
    src = np.zeros((h, w), np.float64)
    snk = np.zeros((h, w), np.float64)
    src[has_c & ~has_p] = INF
    snk[has_p & ~has_c] = INF
    g.add_grid_tedges(nid, src, snk)

    g.maxflow()
    return g.get_grid_segments(nid)


# ═══════════════════════════════════════════════════════════════════
#  Tile builder
# ═══════════════════════════════════════════════════════════════════

def build_tile(sp, raw, tile_size, plane, overlap, rres, jitter, seed):
    rng = np.random.RandomState(seed)

    u0, v0 = get_uv(sp, plane)

    # filter non-finite UV
    fin = np.isfinite(u0) & np.isfinite(v0)
    if not np.all(fin):
        nbad = int(np.sum(~fin))
        print(f"  Warning: {nbad} non-finite UV coords — filtering")
        sp = sp[fin]
        if raw is not None:
            raw = raw[fin]
        u0 = u0[fin]
        v0 = v0[fin]
        if len(sp) == 0:
            sys.exit("Error: no valid Gaussians after filtering")

    su = float(u0.max() - u0.min())
    sv = float(v0.max() - v0.min())
    ucen = float((u0.min() + u0.max()) / 2.0)
    vcen = float((v0.min() + v0.max()) / 2.0)

    uc = u0 - ucen
    vc = v0 - vcen

    T = tile_size if tile_size else max(su, sv) * 2.5
    print(f"splat extent : {su:.4f} × {sv:.4f}")
    print(f"tile size    : {T:.4f}")

    step_u = max(su * (1.0 - overlap), 1e-9)
    step_v = max(sv * (1.0 - overlap), 1e-9)
    margin = max(su, sv)

    places = []
    gv = -margin
    while gv < T + margin:
        gu = -margin
        while gu < T + margin:
            places.append((gu, gv))
            gu += step_u
        gv += step_v
    rng.shuffle(places)

    copy_off = [
        (ou + rng.uniform(-su * jitter, su * jitter),
         ov + rng.uniform(-sv * jitter, sv * jitter))
        for ou, ov in places
    ]
    N = len(copy_off)
    print(f"copies       : {N}")

    rgba = np.column_stack([sp["r"], sp["g"], sp["b"], sp["a"]])

    c_img = np.zeros((rres, rres, 4), np.float32)
    c_msk = np.zeros((rres, rres), np.float32)
    lmap = -np.ones((rres, rres), np.int32)

    for ci in range(N):
        ou, ov = copy_off[ci]
        cu = uc + ou
        cv = vc + ov

        p_img = rasterize(cu, cv, rgba, rres, T)
        p_msk = p_img[:, :, 3]

        use_p = graphcut(c_img, c_msk, p_img, p_msk)

        c_img[use_p] = p_img[use_p]
        c_msk[use_p] = p_msk[use_p]
        lmap[use_p] = ci

        if (ci + 1) % max(1, N // 8) == 0 or ci == N - 1:
            cov = 100.0 * np.mean(c_msk > 0.05)
            print(f"  [{ci + 1:4d}/{N}]  coverage {cov:.1f}%")

    cov_final = 100.0 * np.mean(c_msk > 0.05)
    if cov_final < 95:
        print(f"  Warning: coverage only {cov_final:.1f}% — try --overlap 0.5 or smaller --tile-size")

    # ── assemble output ──
    print("assembling output Gaussians …")
    a0, a1, _ = PLANES[plane]
    parts_sp = []
    parts_raw = []

    for ci in range(N):
        ou, ov = copy_off[ci]
        cu_w = (uc + ou) % T
        cv_w = (vc + ov) % T

        pu = np.clip((cu_w / T * rres).astype(np.int32), 0, rres - 1)
        pv = np.clip((cv_w / T * rres).astype(np.int32), 0, rres - 1)

        owned = lmap[pv, pu] == ci
        if not np.any(owned):
            continue

        ns = sp[owned].copy()
        ns[a0] = cu_w[owned].astype(np.float32)
        ns[a1] = cv_w[owned].astype(np.float32)
        parts_sp.append(ns)

        if raw is not None:
            nr = raw[owned].copy()
            nr[a0] = cu_w[owned].astype(np.float32)
            nr[a1] = cv_w[owned].astype(np.float32)
            parts_raw.append(nr)

    if not parts_sp:
        sys.exit("Error: no Gaussians assigned to any copy. "
                 "Try increasing --overlap or reducing --tile-size.")

    out_sp = np.concatenate(parts_sp)
    out_raw = np.concatenate(parts_raw) if parts_raw else None

    ratio = len(out_sp) / len(sp)
    print(f"  {len(out_sp):,} Gaussians ({ratio:.1f}× input)")
    return out_sp, out_raw, T, c_img


# ═══════════════════════════════════════════════════════════════════
#  Boundary duplication
# ═══════════════════════════════════════════════════════════════════

def add_boundary_dupes(sp, raw, T, plane, sigma_mult=3.0):
    a0, a1, _ = PLANES[plane]
    u = sp[a0].astype(np.float64)
    v = sp[a1].astype(np.float64)

    sc = np.column_stack([sp["sx"], sp["sy"], sp["sz"]])
    margin = sigma_mult * float(np.mean(np.max(np.abs(sc), axis=1)))
    if margin < 1e-6:
        margin = T * 0.02
    print(f"  boundary margin: {margin:.4f}")

    offsets = [(-T, 0), (T, 0), (0, -T), (0, T),
               (-T, -T), (-T, T), (T, -T), (T, T)]
    dupes_sp = []
    dupes_raw = []

    for du, dv in offsets:
        su = u + du
        sv = v + dv
        inside = ((su > -margin) & (su < T + margin) &
                  (sv > -margin) & (sv < T + margin))
        orig = ((u >= 0) & (u < T) & (v >= 0) & (v < T))
        pick = inside & orig
        if np.any(pick):
            d = sp[pick].copy()
            d[a0] = su[pick].astype(np.float32)
            d[a1] = sv[pick].astype(np.float32)
            dupes_sp.append(d)

            if raw is not None:
                dr = raw[pick].copy()
                dr[a0] = su[pick].astype(np.float32)
                dr[a1] = sv[pick].astype(np.float32)
                dupes_raw.append(dr)

    if dupes_sp:
        extra_sp = np.concatenate(dupes_sp)
        print(f"  +{len(extra_sp):,} boundary duplicates")
        sp_out = np.concatenate([sp, extra_sp])
        if dupes_raw:
            raw_out = np.concatenate([raw, np.concatenate(dupes_raw)])
        else:
            raw_out = raw
        return sp_out, raw_out

    return sp, raw


# ═══════════════════════════════════════════════════════════════════
#  CLI
# ═══════════════════════════════════════════════════════════════════

def main():
    ap = argparse.ArgumentParser(
        description="Seamless square tile from irregular .splat/.ply (graph-cut)")
    ap.add_argument("-i", "--input", required=True,
                    help="input .splat or .ply file (3DGS format)")
    ap.add_argument("-o", "--output", default="tile.ply",
                    help="output file (.ply or .splat, default: tile.ply)")
    ap.add_argument("--tile-size", type=float, default=None,
                    help="tile extent in world units (default: auto = 2.5× scene size)")
    ap.add_argument("--plane", default="xz", choices=["xy", "xz", "yz"],
                    help="2-D tiling plane (default: xz = ground)")
    ap.add_argument("--overlap", type=float, default=0.4,
                    help="copy overlap fraction 0–1 (default: 0.4)")
    ap.add_argument("--raster", type=int, default=256,
                    help="raster resolution for graph-cut (default: 256)")
    ap.add_argument("--jitter", type=float, default=0.08,
                    help="positional jitter fraction (default: 0.08)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--no-boundary-dupes", action="store_true",
                    help="skip boundary Gaussian duplication")
    ap.add_argument("--no-auto-align", action="store_true",
                    help="skip PCA auto-alignment (use raw orientations)")
    ap.add_argument("--flip-normal", action="store_true",
                    help="flip the PCA-detected face normal (if face is upside-down)")
    ap.add_argument("--debug-png", default=None,
                    help="save rasterised seam map as PNG for inspection")
    a = ap.parse_args()

    sp, raw = load_input(a.input)

    # ── auto-align face to tiling plane ──
    if not a.no_auto_align:
        sp, raw = align_to_tiling_plane(sp, raw, a.plane, flip_normal=a.flip_normal)
    else:
        print("\n── auto-alignment skipped (--no-auto-align) ──\n")

    result_sp, result_raw, T, canvas = build_tile(
        sp, raw, a.tile_size, a.plane, a.overlap, a.raster, a.jitter, a.seed
    )

    if not a.no_boundary_dupes:
        print("adding boundary duplicates …")
        result_sp, result_raw = add_boundary_dupes(
            result_sp, result_raw, T, a.plane
        )

    save_output(a.output, result_sp, result_raw)

    if a.debug_png:
        dbg = (np.clip(canvas[:, :, :3], 0, 1) * 255).astype(np.uint8)
        cv2.imwrite(a.debug_png, dbg)
        print(f"debug image => {a.debug_png}")

    print(f"\ntile world size: {T:.4f}")
    print(f"to tile in a viewer, repeat offset by {T:.4f} "
          f"in {a.plane[0].upper()} and {a.plane[1].upper()}")
    print("done DONE")


if __name__ == "__main__":
    main()