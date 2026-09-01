"""レポろく アプリアイコン生成スクリプト(これが唯一の正)。

アイコンを調整するときはこのファイルだけを編集する。
座標は Claude との検討チャットで固まった「マイクを構えるシマエナガちゃん」構図
(ペリウィンクルのグラデーション背景 / 正面向きの白いシマエナガ / スタンドマイク /
背景を横切る白いイコライザー / 右上の録音ドット)をそのまま数値化したもの。

    python3 gen_reporoku_assets.py            # プレビューを out/ に生成
    python3 gen_reporoku_assets.py --install  # app.json が参照する assets/ へ書き出し

Profit-Calculator-App-RN/app-rn/design/icons/gen_uritsumi_assets.py の構成
(単一ソース・プレビューと本番書き出しの分離・Android アダプティブアイコンの
セーフゾーン計算)を踏襲している。
"""
import argparse
import math
import os
from PIL import Image, ImageDraw, ImageFont

# ── キャンバス ────────────────────────────────────────
OUT = 1024
SS = 4                       # スーパーサンプリング倍率
CANVAS = OUT * SS
S = CANVAS / 100.0           # 100 基準座標 → ピクセル

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.abspath(os.path.join(HERE, '..', '..', 'assets'))
OUT_DIR = os.path.join(HERE, 'out')
STORE_DIR = os.path.join(HERE, 'store')

# ── 確定配色 ──────────────────────────────────────────
BG_TOP = '#7B85E0'           # ペリウィンクル(濃)
BG_BOTTOM = '#D6D9F7'        # ペリウィンクル(淡)
BODY = '#FFFFFF'
WING = '#D8D8DC'
ORANGE = '#FF9500'
EYE = '#1C1C1E'
CHEEK = '#FFD0D9'            # rgba(255,150,170,0.45) を白地に不透明合成した色
MIC = '#3A3A3C'
GRILLE = '#D8D8DC'
EQ_ALPHA = 153                # 白 60% 相当 (0-255)
REC = '#FF3B30'
REC_PILL = (0, 0, 0, 140)     # 黒 55% 相当
FONT_TEXT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'

# Android の adaptiveIcon.backgroundColor(フォールバック)。app.json と一致させる。
ANDROID_BG_COLOR = '#9AA0E8'

# 108dp 中 66dp の円 = 全マスクで確実に残る範囲。半径は canvas 比で 0.3056。
ADAPTIVE_SAFE_R = (66.0 / 108.0) / 2.0

# Play ストア掲載用アイコン。Google 側の規定(512x512, 1MB 以下, アルファ不可)。
STORE_ICON_SIZE = 512
STORE_ICON_MAX_BYTES = 1024 * 1024


# ── 座標変換 ──────────────────────────────────────────
# 全ての図形は 100 基準の (x, y) で書く。Scene が (offset, scale) を
# 適用してからスーパーサンプリング解像度のピクセルに変換する。
class Scene:
    def __init__(self, draw, ox=50.0, oy=50.0, scale=1.0):
        self.d = draw
        self.ox = ox
        self.oy = oy
        self.s = scale

    def xy(self, x, y):
        return (self.ox + (x - 50.0) * self.s, self.oy + (y - 50.0) * self.s)

    def pt(self, x, y):
        px, py = self.xy(x, y)
        return (px * S, py * S)

    def pts(self, *xys):
        return [self.pt(x, y) for x, y in xys]

    def length(self, v):
        return v * self.s * S

    def ellipse(self, cx, cy, rx, ry, fill):
        ox, oy = self.xy(cx, cy)
        self.d.ellipse([
            (ox - rx * self.s) * S, (oy - ry * self.s) * S,
            (ox + rx * self.s) * S, (oy + ry * self.s) * S,
        ], fill=fill)

    def rounded_rect(self, x, y, w, h, r, fill):
        ox, oy = self.xy(x, y)
        self.d.rounded_rectangle([
            ox * S, oy * S, (ox + w * self.s) * S, (oy + h * self.s) * S,
        ], radius=max(1.0, r * self.s * S), fill=fill)

    def polygon(self, pts, fill):
        self.d.polygon(self.pts(*pts), fill=fill)

    def line(self, pts, fill, w):
        self.d.line(self.pts(*pts), fill=fill, width=int(round(self.length(w))), joint='curve')
        for x, y in pts:
            self.ellipse(x, y, w / 2, w / 2, fill)

    def text(self, x, y, s, size, fill, font_path=FONT_TEXT):
        font = ImageFont.truetype(font_path, int(round(self.length(size))))
        px, py = self.pt(x, y)
        bbox = self.d.textbbox((0, 0), s, font=font)
        self.d.text((px - bbox[0], py - (bbox[1] + bbox[3]) / 2), s, font=font, fill=fill)

    def eye_closed(self, cx, cy, half_w, depth=3):
        # SVG の "M cx-w,cy Q cx,cy+depth cx+w,cy" と同じ 2 次ベジェ曲線。
        p0 = (cx - half_w, cy)
        c = (cx, cy + depth)
        p2 = (cx + half_w, cy)
        pts = []
        n = 16
        for i in range(n + 1):
            t = i / n
            mt = 1 - t
            x = mt * mt * p0[0] + 2 * mt * t * c[0] + t * t * p2[0]
            y = mt * mt * p0[1] + 2 * mt * t * c[1] + t * t * p2[1]
            pts.append((x, y))
        w = 1.5
        self.d.line(self.pts(*pts), fill=EYE, width=int(round(self.length(w))), joint='curve')
        self.ellipse(p0[0], p0[1], w / 2, w / 2, EYE)
        self.ellipse(p2[0], p2[1], w / 2, w / 2, EYE)


EQ_BARS = [
    (4.8, 46, 14), (11.1, 42, 22), (17.4, 50, 10), (23.7, 38, 30), (30, 44, 18),
    (36.3, 35, 36), (42.6, 46, 14), (48.9, 33, 40), (55.2, 45, 16), (61.5, 36, 34),
    (67.8, 43, 20), (74.1, 39, 28), (80.4, 47, 12), (86.7, 41, 24), (93, 46, 14),
]


def draw_eq(sc, alpha_img_draw):
    """背景を横切る白いイコライザー。半透明なので専用レイヤーに描く。"""
    for x, y, h in EQ_BARS:
        sc.rounded_rect(x, y, 2.4, h, 1.2, (255, 255, 255, EQ_ALPHA))


def draw_illustration(sc, d):
    # 体
    sc.ellipse(50, 54, 29, 31, BODY)
    # 羽(ハの字、体に少し食い込む)
    _rotated_ellipse(sc, 72, 68, 6, 10, 25, WING)
    _rotated_ellipse(sc, 28, 68, 6, 10, -25, WING)
    # 足
    sc.line([(45, 84), (45, 89)], ORANGE, 2)
    sc.line([(43, 90), (45, 89), (47, 90)], ORANGE, 2)
    sc.line([(55, 84), (55, 89)], ORANGE, 2)
    sc.line([(53, 90), (55, 89), (57, 90)], ORANGE, 2)
    # 目(閉じたまぶた)
    sc.eye_closed(42, 45, 3)
    sc.eye_closed(58, 45, 3)
    # くちばし
    sc.polygon([(47, 52), (53, 52), (50, 58)], ORANGE)
    # ほっぺ
    sc.ellipse(36, 54, 3.5, 3.5, CHEEK)
    sc.ellipse(64, 54, 3.5, 3.5, CHEEK)
    # マイク(スタンド型、胸の前)
    sc.rounded_rect(39.5, 50, 21, 30, 10.5, MIC)
    sc.line([(43, 58), (57, 58)], GRILLE, 2)
    sc.line([(43, 65), (57, 65)], GRILLE, 2)
    sc.line([(43, 72), (57, 72)], GRILLE, 2)
    sc.line([(50, 80), (50, 94)], MIC, 5.4)
    sc.rounded_rect(35, 95, 30, 4.5, 2.25, MIC)


def _rotated_ellipse(sc, cx, cy, rx, ry, angle_deg, fill):
    ang = math.radians(angle_deg)
    n = 48
    raw = []
    for i in range(n):
        t = 2 * math.pi * i / n
        ex, ey = rx * math.cos(t), ry * math.sin(t)
        rxp = ex * math.cos(ang) - ey * math.sin(ang)
        ryp = ex * math.sin(ang) + ey * math.cos(ang)
        raw.append((cx + rxp, cy + ryp))
    sc.d.polygon(sc.pts(*raw), fill=fill)


def compute_illust_bbox():
    """イラスト(鳥+マイク)を scale=1 で描いて実際の alpha 外接矩形を測る。
    手で見積もった bbox だとズレて安全マージンを無駄に取ってしまうため、
    Android アダプティブアイコンの適合率は毎回これで実測する。"""
    img = new_canvas()
    d = ImageDraw.Draw(img, 'RGBA')
    sc = Scene(d, ox=50, oy=50, scale=1.0)
    draw_illustration(sc, d)
    box = img.getbbox()
    if box is None:
        raise SystemExit('イラストが空です')
    x0, y0, x1, y1 = box
    return (x0 / S, y0 / S, x1 / S, y1 / S)


def fit_scale_and_offset(bbox, safe_r_frac):
    """bbox の対角線が安全円に完全に収まるスケール。真円ランチャーでも絶対に欠けない。"""
    x0, y0, x1, y1 = bbox
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    half_w, half_h = (x1 - x0) / 2, (y1 - y0) / 2
    half_diag = math.hypot(half_w, half_h)
    safe_r = safe_r_frac * 100.0
    scale = safe_r / half_diag
    return scale, cx, cy


def diagonal_gradient(size, c0, c1):
    """(0,0)→(1,1) の対角線グラデーションを、2x2 画像の拡大縮小で近似する。"""
    def mix(a, b, t):
        return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

    mid = mix(c0, c1, 0.5)
    base = Image.new('RGB', (2, 2))
    base.putpixel((0, 0), c0)
    base.putpixel((1, 0), mid)
    base.putpixel((0, 1), mid)
    base.putpixel((1, 1), c1)
    return base.resize((size, size), Image.BICUBIC)


def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def new_canvas():
    return Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))


def downsample(img):
    return img.resize((OUT, OUT), Image.LANCZOS)


def gradient_with_eq():
    """グラデーション + 白いイコライザーを合成した、CANVAS 解像度の RGBA。"""
    bg = diagonal_gradient(CANVAS, hex_to_rgb(BG_TOP), hex_to_rgb(BG_BOTTOM)).convert('RGBA')
    eq_layer = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    eq_draw = ImageDraw.Draw(eq_layer)
    sc_eq = Scene(eq_draw, ox=50, oy=50, scale=1.0)
    draw_eq(sc_eq, eq_draw)
    return Image.alpha_composite(bg, eq_layer)


def render_full_icon():
    """iOS / expo 汎用アイコン。背景を全面焼き込んだ 1 枚(OS が角丸マスクをかける)。"""
    composed = gradient_with_eq()
    d = ImageDraw.Draw(composed, 'RGBA')
    sc = Scene(d, ox=50, oy=50, scale=1.0)
    draw_illustration(sc, d)
    return downsample(composed).convert('RGB')


def render_adaptive_foreground():
    """Android アダプティブアイコンの前景。透過 PNG。66/108 のセーフサークルに収める。"""
    img = new_canvas()
    d = ImageDraw.Draw(img, 'RGBA')
    scale, cx, cy = fit_scale_and_offset(compute_illust_bbox(), ADAPTIVE_SAFE_R)
    sc = Scene(d, ox=50, oy=50, scale=scale)
    orig_xy = sc.xy

    def shifted_xy(x, y, _orig=orig_xy, _cx=cx, _cy=cy):
        return _orig(x - (_cx - 50.0), y - (_cy - 50.0))

    sc.xy = shifted_xy
    draw_illustration(sc, d)
    return downsample(img)


def render_adaptive_background():
    """アダプティブアイコンの背景レイヤー。
    イコライザーは前景(セーフゾーンに収める鳥+マイク)に含めると外接矩形が
    横に広がって鳥が小さくなってしまうため、常に全面表示される背景側に焼き込む。"""
    return downsample(gradient_with_eq()).convert('RGB')


def render_monochrome(fg_rgba_1024):
    """前景の不透明部分を単色白にした Android 13+ テーマアイコン用レイヤー。"""
    r, g, b, a = fg_rgba_1024.split()
    white = Image.new('RGBA', fg_rgba_1024.size, '#FFFFFF')
    white.putalpha(a)
    return white


def render_store_icon():
    """Play ストア掲載用。512x512, アルファなし, 1MB 以下。"""
    full = render_full_icon()
    icon = full.resize((STORE_ICON_SIZE, STORE_ICON_SIZE), Image.LANCZOS).convert('RGB')
    return icon


def render_favicon():
    full = render_full_icon()
    return full.resize((196, 196), Image.LANCZOS)


def save_checked(img, path, max_bytes=None):
    img.save(path, optimize=True)
    if max_bytes is not None:
        size = os.path.getsize(path)
        if size > max_bytes:
            raise SystemExit(f'{path} が {size} バイトで上限 {max_bytes} を超えている')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true', help='assets/ へ本番書き出し')
    args = parser.parse_args()

    full = render_full_icon()
    fg = render_adaptive_foreground()
    bg = render_adaptive_background()
    mono = render_monochrome(fg)
    store = render_store_icon()
    favicon = render_favicon()

    if args.install:
        os.makedirs(ASSETS, exist_ok=True)
        save_checked(full, os.path.join(ASSETS, 'icon.png'))
        save_checked(fg, os.path.join(ASSETS, 'android-icon-foreground.png'))
        save_checked(bg, os.path.join(ASSETS, 'android-icon-background.png'))
        save_checked(mono, os.path.join(ASSETS, 'android-icon-monochrome.png'))
        save_checked(favicon, os.path.join(ASSETS, 'favicon.png'))
        os.makedirs(STORE_DIR, exist_ok=True)
        save_checked(store, os.path.join(STORE_DIR, 'play_store_icon_512.png'), STORE_ICON_MAX_BYTES)
        print('assets/ と design/icons/store/ に書き出しました')
    else:
        os.makedirs(OUT_DIR, exist_ok=True)
        save_checked(full, os.path.join(OUT_DIR, 'preview_icon_1024.png'))
        save_checked(fg, os.path.join(OUT_DIR, 'preview_adaptive_fg.png'))
        save_checked(bg, os.path.join(OUT_DIR, 'preview_adaptive_bg.png'))
        save_checked(mono, os.path.join(OUT_DIR, 'preview_monochrome.png'))
        os.makedirs(STORE_DIR, exist_ok=True)
        save_checked(store, os.path.join(STORE_DIR, 'play_store_icon_512.png'), STORE_ICON_MAX_BYTES)
        print('out/ にプレビューを生成しました(--install で assets/ へ書き出し)')


if __name__ == '__main__':
    main()
