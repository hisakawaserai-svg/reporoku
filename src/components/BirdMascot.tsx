/**
 * シマエナガのマスコット。図形のみで描くため theme 非依存・色はハードコード。
 *
 * 元は別アプリの Skia 実装。本プロジェクトは react-native-svg を使う。
 * 空状態は variant='sleep'、録音待機は variant='calling'(同じ羽＋音符)。
 */
import { Circle, Ellipse, G, Path, Svg } from "react-native-svg";

const NOTE = "#E8B07A";
/** 翼の回転軸(肩の位置)。100×100 基準。 */
const WING_ORIGIN = { x: 64, y: 46 };

interface Props {
  variant?: "day" | "night" | "sleep" | "calling";
  /** 描画ボックスの一辺(px)。内部は 100×100 基準を size に拡縮 */
  size?: number;
  /**
   * 背景の丸・太陽・月・星を描くか。既定 true。
   * false にするとキャラ単体。sleep は薄い Z、calling は音符を残す。
   */
  showScene?: boolean;
  /**
   * 目を閉じるか。既定は variant==='sleep' のとき閉じる。
   */
  eyesClosed?: boolean;
}

function EighthNote({ x, y, scale, rotate }: { x: number; y: number; scale: number; rotate: number }) {
  return (
    <G transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
      <Ellipse cx={0} cy={0} rx={3.4} ry={2.5} fill={NOTE} />
      <Path d="M3 0 L3 -13" stroke={NOTE} strokeWidth={1.5} strokeLinecap="round" fill="none" />
      <Path d="M3 -13 Q12 -10 10 -3 Q6 -7 3 -8 Z" fill={NOTE} />
    </G>
  );
}

export default function BirdMascot({
  variant = "sleep",
  size = 120,
  showScene = true,
  eyesClosed,
}: Props) {
  const isDay = variant === "day";
  const isNight = variant === "night";
  const isSleep = variant === "sleep";
  const isCalling = variant === "calling";
  const closed = eyesClosed ?? isSleep;
  const bodyStroke = showScene ? "none" : "#E5E5EA";
  const wingAngle = isCalling ? -40 : 0;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {showScene ? (
        <Circle
          cx={50}
          cy={50}
          r={48}
          fill={isDay ? "#BFE6FF" : isNight ? "#1E2A55" : "#B8B5E8"}
        />
      ) : null}

      {showScene && isDay ? <Circle cx={78} cy={24} r={11} fill="#FFD23F" /> : null}
      {showScene && isNight ? (
        <>
          <Circle cx={76} cy={24} r={11} fill="#F3ECC4" />
          <Circle cx={71} cy={21} r={10} fill="#1E2A55" />
          <Circle cx={26} cy={22} r={2} fill="#FFFFFF" />
          <Circle cx={40} cy={14} r={1.5} fill="#FFFFFF" />
          <Circle cx={22} cy={40} r={1.5} fill="#FFFFFF" />
        </>
      ) : null}
      {showScene && isSleep ? <Circle cx={75} cy={25} r={13} fill="#FFF1A8" /> : null}

      {isSleep ? (
        <Path
          d={showScene ? "M25 25 L33 25 L25 35 L33 35" : "M68 14 L80 14 L68 28 L80 28"}
          stroke={showScene ? "#FFFFFF" : "#C7C7CC"}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : null}

      {isCalling ? (
        <>
          <EighthNote x={24} y={22} scale={1} rotate={-18} />
          <EighthNote x={40} y={12} scale={0.78} rotate={8} />
        </>
      ) : null}

      {/* 尾: 体の右下から斜め後方へ長く伸びる */}
      <Path d="M55 72 L84 86 L82 93 L52 81 Z" fill="#3A3A3C" />
      {/* 足: 体の下にちょこんと2本 */}
      <Path
        d="M45 82 L45 90 M42 91 L45 90 L48 91"
        stroke="#FF9500"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M55 82 L55 90 M52 91 L55 90 L58 91"
        stroke="#FF9500"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* ふわふわの白い体(＝頭一体型の丸) */}
      <Ellipse
        cx={50}
        cy={54}
        rx={29}
        ry={31}
        fill="#FFFFFF"
        stroke={bodyStroke}
        strokeWidth={showScene ? 0 : 1}
      />
      {/* 翼: 体の右側にうっすら黒。呼びかけは肩を軸に同じ羽を上げる */}
      <G transform={`rotate(${wingAngle} ${WING_ORIGIN.x} ${WING_ORIGIN.y})`}>
        <Ellipse cx={70} cy={60} rx={9} ry={16} fill="#D8D8DC" />
      </G>
      {closed ? (
        <>
          <Path
            d="M39 48 Q42 51 45 48"
            stroke="#1C1C1E"
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
          />
          <Path
            d="M55 48 Q58 51 61 48"
            stroke="#1C1C1E"
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
          />
        </>
      ) : (
        <>
          <Circle cx={42} cy={48} r={3} fill="#1C1C1E" />
          <Circle cx={58} cy={48} r={3} fill="#1C1C1E" />
        </>
      )}
      {/* 三角くちばし(オレンジ)。呼びかけも下向き三角1つ */}
      <Path
        d={closed ? "M47 55 L53 55 L50 58 Z" : "M47 54 L53 54 L50 60 Z"}
        fill="#FF9500"
      />
      <Circle cx={36} cy={56} r={3.5} fill="rgba(255,150,170,0.45)" />
      <Circle cx={64} cy={56} r={3.5} fill="rgba(255,150,170,0.45)" />
    </Svg>
  );
}
