"""レポろく アプリアイコン生成スクリプト(これが唯一の正)。

アイコンを調整するときはこのファイルだけを編集する。
座標は Claude との検討チャットで固まった「波形入りクリップボードを見るシマエナガちゃん」
構図(ペリウィンクルのグラデーション背景 / 画面左のシマエナガ / 右の波形入り
クリップボード)をそのまま数値化したもの。スタンプ抜き(正面)・うりつみ(右で左向き)
とキャラの向き・位置が被らないよう、左に立って右のクリップボードを見る構図にしている。

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
TAIL = '#3A3A3C'             # スタンプ抜き・うりつみと同じ尾の色
GRILLE = '#D8D8DC'
BAND_ALPHA = 40              # 背景を横切る白い帯の不透明度(うりつみと同じ)
WOOD = '#B98452'             # クリップボード背面の木の板
WOOD_DARK = '#9C6C3F'        # 木の板の縁(立体感)
PAPER = '#F7F5EF'            # クリップボードの用紙
CLIP = '#9498A6'             # クリップボードの金具

# クリップボードを斜めに持っている角度と、回転の軸(鳥の羽が触れているあたり)。
CLIP_TILT_DEG = -28
CLIP_PIVOT = (58, 79)
# クリップボード自体の大きさ(鳥に対する相対サイズ)。CLIP_PIVOT を中心に縮小する。
CLIP_SCALE = 0.75
# クリップボード全体を(dx, dy)だけずらす。羽(手)の位置に持っていくために使う。
CLIP_POS = (38, -45)
# クリップボードを左右反転させるか。
CLIP_FLIP = True

# シマエナガちゃんを時計回りに傾ける角度と、回転の軸(足元)。
# 主役の傾きはクリップボード側。鳥は直立に近い、控えめな傾きにとどめる。
BIRD_TILT_DEG = -10
BIRD_PIVOT = (29, 82)

# 本番アイコンに焼き込む「寄り」(検討時に気に入られた zoom_final.png のクロップを
# ox/oy/scale に変換したもの。1024px 中 (150,20)-(990,730) のクロップに相当)。
FULL_ZOOM_CROP = (220, 0, 970, 750)  # 750x750 の正方形。もっと寄った見た目
REC = '#FF3B30'
REC_PILL = (0, 0, 0, 140)     # 黒 55% 相当
FONT_TEXT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'

# Android の adaptiveIcon.backgroundColor(フォールバック)。app.json と一致させる。
ANDROID_BG_COLOR = '#9AA0E8'

# Play ストア掲載用アイコン。Google 側の規定(512x512, 1MB 以下, アルファ不可)。
STORE_ICON_SIZE = 512
STORE_ICON_MAX_BYTES = 1024 * 1024


# ── 座標変換 ──────────────────────────────────────────
# 全ての図形は 100 基準の (x, y) で書く。Scene が (offset, scale) を
# 適用してからスーパーサンプリング解像度のピクセルに変換する。
class Scene:
    def __init__(self, draw, ox=50.0, oy=50.0, scale=1.0, flip=False):
        self.d = draw
        self.ox = ox
        self.oy = oy
        self.s = scale
        self.flip = flip  # True なら x を 100-x に鏡映してから配置する

    def xy(self, x, y):
        xx = (100.0 - x) if self.flip else x
        return (self.ox + (xx - 50.0) * self.s, self.oy + (y - 50.0) * self.s)

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
        # 両端を個別に xy() へ通してから min/max で正規化する。
        # こうしておくと flip=True で x が鏡映されても矩形が壊れない。
        x0, y0 = self.xy(x, y)
        x1, y1 = self.xy(x + w, y + h)
        self.d.rounded_rectangle([
            min(x0, x1) * S, min(y0, y1) * S, max(x0, x1) * S, max(y0, y1) * S,
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

    def eye_v(self, cx, cy, s, mirror=False):
        # うりつみと同じ「>」「<」形の、くしゃっと閉じた目。内側に尖った折れ線。
        m = -1 if mirror else 1
        pts = [(cx - m * s, cy - s * 0.75), (cx + m * s * 0.55, cy), (cx - m * s, cy + s * 0.75)]
        self.line(pts, EYE, 1.6)

    def foot(self, hip, tip, w=2.0):
        """脚1本。うりつみと同じく、指は脚の向きを基準に開くので、
        傾けて持ち上げても足首の角度が揃う。"""
        hx, hy = hip
        tx, ty = tip
        self.line([(hx, hy), (tx, ty)], ORANGE, w)
        ux, uy = tx - hx, ty - hy
        n = math.hypot(ux, uy) or 1.0
        ux, uy = ux / n, uy / n
        px, py = -uy, ux
        r = 1.6
        self.line([
            (tx - px * r + ux * 0.6, ty - py * r + uy * 0.6),
            (tx, ty),
            (tx + px * r + ux * 0.6, ty + py * r + uy * 0.6),
        ], ORANGE, w)



def draw_clipboard(sc):
    """右側の小道具:木の板を背面に持つ、波形入りクリップボード。
    録音がノートになることを示す。斜めに持っている見た目にするため、
    このレイヤーは呼び出し側で回転してから合成する。"""
    # 背面の木の板(紙より一回り大きく、縁を少し暗くして立体感を出す)
    sc.rounded_rect(51, 21, 41, 65, 5, WOOD_DARK)
    sc.rounded_rect(52, 21.6, 39, 63, 4.6, WOOD)
    # 用紙
    sc.rounded_rect(57, 29, 30, 53, 3, PAPER)
    # クリップの金具(板の上端を挟む)
    sc.rounded_rect(65.5, 15, 13, 13, 3, CLIP)
    sc.rounded_rect(68.5, 18.8, 7, 4, 1.5, PAPER)
    # 波形(録音の記録であることを示す。用紙の中身だけ左右反転)
    for x, h in [
        (62, 16), (65.5, 10), (69, 18), (72.5, 12), (76, 22),
        (79.5, 14), (83, 8),
    ]:
        sc.rounded_rect(x, 45 - h / 2, 2.2, h, 1.1, ORANGE)
    # 書き起こしたメモの行(右寄せに反転)
    sc.rounded_rect(61, 61, 21, 3, 1.5, GRILLE)
    sc.rounded_rect(67, 67, 15, 3, 1.5, GRILLE)
    sc.rounded_rect(64, 73, 18, 3, 1.5, GRILLE)


def render_clipboard_layer(ox, oy, scale):
    """クリップボード一式を CLIP_PIVOT を中心に CLIP_SCALE 倍したうえで、
    同じ点を軸に斜めへ回転させたレイヤーを返す。"""
    layer = new_canvas()
    d = ImageDraw.Draw(layer, 'RGBA')
    inner_scale = scale * CLIP_SCALE
    ax, ay = CLIP_PIVOT
    dx, dy = CLIP_POS
    # flip 時は xy() が x を (100-x) に鏡映するため、CLIP_PIVOT が動かないよう
    # 「実際に使われる x」(eff_ax) で打ち消し量を計算し直す。
    eff_ax = (100.0 - ax) if CLIP_FLIP else ax
    inner_ox = ox + (ax - 50.0) * scale - (eff_ax - 50.0) * inner_scale + dx * inner_scale
    inner_oy = oy + (ay - 50.0) * scale * (1 - CLIP_SCALE) + dy * inner_scale
    sc = Scene(d, ox=inner_ox, oy=inner_oy, scale=inner_scale, flip=CLIP_FLIP)
    draw_clipboard(sc)
    pivot_px = sc.pt(*CLIP_PIVOT)
    # 反射(flip)のあとに回転すると、回転の向きが打ち消し合う形になるため、
    # flip 時は角度の符号を反転させて本当の鏡映結果にする。
    tilt = -CLIP_TILT_DEG if CLIP_FLIP else CLIP_TILT_DEG
    return layer.rotate(tilt, resample=Image.BICUBIC, center=pivot_px)


def draw_bird(sc):
    # 尾(スタンプ抜き・うりつみと同じ形を左側へ反転。見切れず、かつ短すぎない長さに)
    sc.polygon([(25, 71), (9, 79), (10, 84), (27, 78)], TAIL)
    # 体(画面左側)
    sc.ellipse(29, 57, 22, 24, BODY)
    # 羽(奥の羽 + クリップボードを持つ羽)
    _rotated_ellipse(sc, 11, 67, 5, 8, 40, WING)
    _rotated_ellipse(sc, 53, 43, 5, 9, 55, WING)
    # 足(左は持ち上げ、右は垂直な軸足)
    sc.foot((23, 78), (16, 83))  # 左足
    sc.foot((35, 78), (36.5, 86.5))  # 右足(左足と同じ長さに揃える)
    # 目(うりつみと同じ、くしゃっとした「>」「<」。顔のパーツは右へ寄せる)
    sc.eye_v(28, 48, 3.0, mirror=False)
    sc.eye_v(38, 48, 3.0, mirror=True)
    # ほっぺ
    sc.ellipse(22, 57, 3, 3, CHEEK)
    sc.ellipse(44, 57, 3, 3, CHEEK)
    # くちばし
    sc.polygon([(30.5, 55), (35.5, 55), (33, 60)], ORANGE)


def render_bird_layer(ox, oy, scale):
    """鳥一式を描いてから BIRD_PIVOT を軸に時計回りへ少し回転させたレイヤーを返す。"""
    layer = new_canvas()
    d = ImageDraw.Draw(layer, 'RGBA')
    sc = Scene(d, ox=ox, oy=oy, scale=scale)
    draw_bird(sc)
    pivot_px = sc.pt(*BIRD_PIVOT)
    return layer.rotate(BIRD_TILT_DEG, resample=Image.BICUBIC, center=pivot_px)


def draw_illustration(base_rgba, ox=50, oy=50, scale=1.0):
    """base_rgba(CANVAS 解像度の RGBA)に鳥(斜め)とクリップボード(斜め・前面)を描き込んで返す。"""
    composed = Image.alpha_composite(base_rgba, render_bird_layer(ox, oy, scale))
    composed = Image.alpha_composite(composed, render_clipboard_layer(ox, oy, scale))
    return composed


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


def render_gradient():
    """ペリウィンクルの対角線グラデーション + うりつみと同じ斜めの白い帯。CANVAS 解像度の RGBA。"""
    bg = diagonal_gradient(CANVAS, hex_to_rgb(BG_TOP), hex_to_rgb(BG_BOTTOM)).convert('RGBA')
    band = new_canvas()
    band_draw = ImageDraw.Draw(band, 'RGBA')
    sc = Scene(band_draw, ox=50, oy=50, scale=1.0)
    # 左端(0)ほど帯を少しだけ細く、右端(100)は元の太さのまま(うりつみに近い控えめな先細り)
    sc.polygon([(0, 30), (100, -10), (100, 34), (0, 61)], (255, 255, 255, BAND_ALPHA))
    return Image.alpha_composite(bg, band)


def render_full_icon():
    """iOS / expo 汎用アイコン。背景を全面焼き込んだ 1 枚(OS が角丸マスクをかける)。
    Scene のズーム(scale>1)はキャンバスの外側に描く余白が無く縁が切れてしまうため、
    等倍で描いた画像を実際にクロップ&リサイズしてズームする。"""
    composed = draw_illustration(render_gradient())
    full = downsample(composed).convert('RGB')
    x0, y0, x1, y1 = FULL_ZOOM_CROP
    return full.crop((x0, y0, x1, y1)).resize((OUT, OUT), Image.LANCZOS)


def render_adaptive_foreground():
    """Android アダプティブアイコンの前景。透過 PNG。
    iOS の本番アイコン(render_full_icon)と同じ FULL_ZOOM_CROP で切り出し、
    見た目のズーム感を両OSで揃える。"""
    img = draw_illustration(new_canvas())
    full = downsample(img)
    x0, y0, x1, y1 = FULL_ZOOM_CROP
    return full.crop((x0, y0, x1, y1)).resize((OUT, OUT), Image.LANCZOS)


def render_adaptive_background():
    """アダプティブアイコンの背景レイヤー(グラデーションのみ)。前景と同じクロップを適用し、
    帯の位置が前景とズレないようにする。"""
    full = downsample(render_gradient()).convert('RGB')
    x0, y0, x1, y1 = FULL_ZOOM_CROP
    return full.crop((x0, y0, x1, y1)).resize((OUT, OUT), Image.LANCZOS)


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
