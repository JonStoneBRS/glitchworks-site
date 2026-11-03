"""Render CodeWalker .ydr.xml models with bpy in a dark, neon-lit studio.

Usage (python, not blender): python3 render.py <spec.json>
spec: {"out": "file.png", "w":1600, "h":900, "samples":96,
       "items":[{"xml": "path.ydr.xml", "loc":[x,y,z], "rot":[rx,ry,rz] (deg), "scale":1}],
       "cam": {"dir":[x,y,z], "fov":35, "pad":1.15}, "floor": true}
"""
import bpy, sys, json, math, os, re
import xml.etree.ElementTree as ET
from mathutils import Vector, Euler
from PIL import Image

WIDTH = {"Position": 3, "Normal": 3, "Colour0": 4, "Colour1": 4, "Tangent": 4,
         "BlendWeights": 4, "BlendIndices": 4}
for i in range(8):
    WIDTH[f"TexCoord{i}"] = 2

TEXCACHE = "/tmp/texcache"
os.makedirs(TEXCACHE, exist_ok=True)


def dds_to_png(path):
    out = os.path.join(TEXCACHE, re.sub(r"[^A-Za-z0-9_.-]", "_", path) + ".png")
    if not os.path.exists(out):
        try:
            Image.open(path).convert("RGBA").save(out)
        except Exception as e:
            print("tex fail", path, e)
            return None
    return out


def make_material(name, tex_path, spec_hint):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    low = name.lower()
    rough = 0.45
    metal = 0.0
    if any(k in low for k in ("steel", "chrome", "alu", "metal", "silver")):
        rough, metal = 0.28, 0.9
    if any(k in low for k in ("rubber", "tyre", "fabric", "vinyl", "foam", "black_plastic")):
        rough = 0.7
    if "paint" in low:
        rough = 0.35
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if tex_path:
        img = bpy.data.images.load(tex_path)
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = img
        nt.links.new(tn.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def import_ydr(xml_path):
    root = ET.parse(xml_path).getroot()
    texdir = xml_path[: -len(".ydr.xml")]
    shaders = []
    for sh in root.findall("./ShaderGroup/Shaders/Item"):
        diff = None
        for p in sh.findall("./Parameters/Item"):
            if p.get("name") == "DiffuseSampler":
                n = p.findtext("Name")
                diff = n.strip() if n else None
        tex = None
        if diff:
            cand = os.path.join(texdir, diff + ".dds")
            if os.path.exists(cand):
                tex = dds_to_png(cand)
        shaders.append(make_material(f"{os.path.basename(texdir)}_{diff}_{len(shaders)}", tex, None))
    objs = []
    models = root.find("DrawableModelsHigh")
    if models is None:
        return objs
    for model in models.findall("Item"):
        for g in model.findall("./Geometries/Item"):
            si = int(g.find("ShaderIndex").get("value"))
            lay = [c.tag for c in g.find("./VertexBuffer/Layout")]
            data = g.findtext("./VertexBuffer/Data") or ""
            verts, uvs = [], []
            for line in data.strip().split("\n"):
                parts = [p for p in line.strip().split("   ") if p.strip()]
                comp = dict(zip(lay, parts))
                x, y, z = map(float, comp["Position"].split())
                verts.append((x, y, z))
                if "TexCoord0" in comp:
                    u, v = map(float, comp["TexCoord0"].split())
                    uvs.append((u, 1.0 - v))
            idx = list(map(int, (g.findtext("./IndexBuffer/Data") or "").split()))
            faces = [tuple(idx[i:i + 3]) for i in range(0, len(idx) - 2, 3)]
            me = bpy.data.meshes.new("g")
            me.from_pydata(verts, [], faces)
            if uvs:
                uvl = me.uv_layers.new()
                for poly in me.polygons:
                    for li in poly.loop_indices:
                        uvl.data[li].uv = uvs[me.loops[li].vertex_index]
            me.materials.append(shaders[si] if si < len(shaders) else None)
            for p in me.polygons:
                p.use_smooth = True
            me.update()
            ob = bpy.data.objects.new(os.path.basename(xml_path), me)
            bpy.context.scene.collection.objects.link(ob)
            objs.append(ob)
    return objs


def neon_area(name, loc, color, power, size, target):
    l = bpy.data.lights.new(name, "AREA")
    l.color = color
    l.energy = power
    l.size = size
    o = bpy.data.objects.new(name, l)
    o.location = loc
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(o)
    return o


def main(spec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    allobjs = []
    for it in spec["items"]:
        objs = import_ydr(it["xml"])
        for o in objs:
            o.scale = (it.get("scale", 1),) * 3
            o.rotation_euler = Euler([math.radians(a) for a in it.get("rot", [0, 0, 0])])
            o.location = it.get("loc", [0, 0, 0])
        allobjs += objs
    bpy.context.view_layer.update()
    if spec.get("row"):
        x = 0.0
        gap = spec.get("gap", 0.04)
        groups = {}
        for o in allobjs:
            groups.setdefault(o.name.split(".")[0], []).append(o)
        for name, objs in groups.items():
            bpy.context.view_layer.update()
            ps = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
            mnx = min(p.x for p in ps); mxx = max(p.x for p in ps)
            mny = min(p.y for p in ps); mxy = max(p.y for p in ps)
            mnz = min(p.z for p in ps)
            for o in objs:
                o.location.x += x - mnx
                o.location.y -= (mny + mxy) / 2
                o.location.z -= mnz
            x += (mxx - mnx) + gap
        bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in allobjs for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    # sit on floor at z=0
    for o in allobjs:
        o.location.z -= mn.z
    mx.z -= mn.z
    mn.z = 0
    centre = (mn + mx) / 2
    size = (mx - mn).length

    if spec.get("floor", True):
        bpy.ops.mesh.primitive_plane_add(size=size * 30, location=(centre.x, centre.y, 0))
        fl = bpy.context.active_object
        fm = bpy.data.materials.new("floor")
        fm.use_nodes = True
        b = fm.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (0.012, 0.013, 0.02, 1)
        b.inputs["Roughness"].default_value = 0.32
        b.inputs["Specular IOR Level"].default_value = 0.6
        fl.data.materials.append(fm)

    world = bpy.data.worlds.new("w")
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.005, 0.01, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0

    s = size
    c = centre
    k = spec.get("light", 1.0)
    neon_area("cyan", (c.x - s * 1.1, c.y + s * 1.1, c.z + s * 0.9), (0.18, 0.9, 1.0), 110 * s * s * k, s * 0.35, c)
    neon_area("magenta", (c.x + s * 1.1, c.y + s * 1.1, c.z + s * 0.9), (1.0, 0.25, 0.94), 110 * s * s * k, s * 0.35, c)
    neon_area("key", (c.x + s * 0.3, c.y - s * 1.0, c.z + s * 2.2), (1.0, 0.94, 0.88), 60 * s * s * k, s * 0.8, c)
    neon_area("top", (c.x, c.y, c.z + s * 2.0), (0.7, 0.75, 1.0), 12 * s * s * k, s * 2, c)

    # glowing neon bars in the background
    if spec.get("bars", True):
        for i, (col, off) in enumerate((((0.1, 0.85, 1.0), -1), ((1.0, 0.2, 0.92), 1))):
            bpy.ops.mesh.primitive_cube_add(size=1, location=(c.x + off * s * 0.9, c.y + s * 2.6, s * 0.9))
            bar = bpy.context.active_object
            bar.scale = (s * 0.02, s * 0.02, s * 1.8)
            em = bpy.data.materials.new(f"bar{i}")
            em.use_nodes = True
            nb = em.node_tree.nodes["Principled BSDF"]
            nb.inputs["Emission Color"].default_value = (*col, 1)
            nb.inputs["Emission Strength"].default_value = 18
            nb.inputs["Base Color"].default_value = (0, 0, 0, 1)
            bar.data.materials.append(em)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(c.x, c.y + s * 2.6, s * 0.06))
        bar = bpy.context.active_object
        bar.scale = (s * 2.4, s * 0.02, s * 0.015)
        em = bpy.data.materials.new("barh")
        em.use_nodes = True
        nb = em.node_tree.nodes["Principled BSDF"]
        nb.inputs["Emission Color"].default_value = (0.55, 0.4, 1.0, 1)
        nb.inputs["Emission Strength"].default_value = 12
        bar.data.materials.append(em)

    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens_unit = "FOV"
    cam_d.sensor_fit = "VERTICAL"
    cam_d.angle = math.radians(spec.get("cam", {}).get("fov", 30))
    cam = bpy.data.objects.new("cam", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    d = Vector(spec.get("cam", {}).get("dir", [0.9, -1.4, 0.7])).normalized()
    dist = (s / 2) / math.tan(cam_d.angle / 2) * spec.get("cam", {}).get("pad", 1.1)
    aim = c + Vector(spec.get("cam", {}).get("aim", [0, 0, 0])) * s
    cam.location = aim + d * dist
    cam.rotation_euler = (aim - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_d.clip_start = s * 0.01
    cam_d.clip_end = s * 100

    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = spec.get("samples", 96)
    sc.cycles.use_denoising = True
    sc.render.resolution_x = spec.get("w", 1600)
    sc.render.resolution_y = spec.get("h", 900)
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Punchy"
    sc.view_settings.exposure = spec.get("exposure", -0.3)
    sc.render.film_transparent = False
    sc.render.filepath = spec["out"]
    bpy.ops.render.render(write_still=True)
    print("wrote", spec["out"])


if __name__ == "__main__":
    main(json.load(open(sys.argv[1])))
