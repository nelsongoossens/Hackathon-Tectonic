import sys
import numpy as np

W, H, FPS, DUR = 1080, 1350, 30, 5.0
N = int(FPS * DUR)

def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)

BG = hexc("#CFC4C2")
TEAL = hexc("#1F4E5F")
AQUA = hexc("#A9D8DA")
CORAL = hexc("#FF4B2B")
EMBER = hexc("#FF8A3D")
MIST = hexc("#E7F2F1")
GREY = hexc("#9A918F")

# keyframes: t, scale, heat (teal->coral), sat (grey->colour)
KEYS = [
    (0.0, 0.30, 0.0, 1.0),
    (1.2, 0.31, 0.0, 1.0),
    (2.0, 0.47, 1.0, 1.0),
    (2.9, 0.45, 1.0, 1.0),
    (3.6, 0.19, 0.15, 0.0),
    (4.2, 0.19, 0.15, 0.0),
    (5.0, 0.30, 0.0, 1.0),
]

def smooth(x):
    return x * x * (3 - 2 * x)

def state(t):
    for a, b in zip(KEYS, KEYS[1:]):
        if a[0] <= t <= b[0]:
            u = smooth((t - a[0]) / (b[0] - a[0]))
            return [a[i] + (b[i] - a[i]) * u for i in (1, 2, 3)]
    return list(KEYS[-1][1:])

ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
X = (xs - W * 0.5) / W
Y = (ys - H * 0.46) / W
# soft vignette so the frame reads as a poster
VIG = 1 - 0.10 * np.clip((X ** 2 + (Y * 0.8) ** 2) / 0.45, 0, 1)[..., None]
rng = np.random.default_rng(7)

def field(t, cx, cy, radius, phase):
    dx, dy = X - cx, Y - cy
    r = np.sqrt(dx * dx + dy * dy)
    th = np.arctan2(dy, dx)
    w = 2 * np.pi * t / DUR  # integer harmonics keep the loop seamless
    r = r * (1 + 0.07 * np.sin(3 * th + w + phase) + 0.04 * np.sin(5 * th - 2 * w + phase))
    return np.exp(-(r / radius) ** 2)[..., None]

def lerp(a, b, u):
    return a + (b - a) * u

out = sys.stdout.buffer
for i in range(N):
    t = i / FPS
    scale, heat, sat = state(t)
    scale *= 1 + 0.035 * np.sin(2 * np.pi * t / 2.5)
    w = 2 * np.pi * t / DUR
    ox, oy = 0.03 * np.cos(w), 0.025 * np.sin(2 * w)

    outer = field(t, 0, 0, scale * 1.05, 0.0)
    mid = field(t, ox, oy, scale * 0.68, 1.3)
    core = field(t, ox * 1.6, oy * 1.6 - 0.02, scale * 0.32, 2.1)

    img = np.broadcast_to(BG, (H, W, 3)).copy()
    img = lerp(img, TEAL, outer * 0.85)
    img = lerp(img, lerp(AQUA, CORAL, heat), mid * 0.9)
    img = lerp(img, lerp(MIST, EMBER, heat), core * (0.55 + 0.35 * heat))

    # silenced: drain colour and let the aura sink into the background
    lum = (img @ np.array([0.299, 0.587, 0.114], dtype=np.float32))[..., None]
    grey = lerp(BG, GREY, np.clip((BG.mean() - lum) * 2.2 + 0.4, 0, 1))
    img = lerp(grey, img, sat)

    img *= VIG
    img += rng.normal(0, 0.05, (H, W, 1)).astype(np.float32)
    img += rng.normal(0, 0.015, (H, W, 3)).astype(np.float32)
    out.write((np.clip(img, 0, 1) * 255).astype(np.uint8).tobytes())
