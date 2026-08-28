/**
 * ツールバー用のアイコン。大半はPhosphor Icons（Bold weight、MITライセンス、
 * https://phosphoricons.com）の塗りつぶし形状をそのまま採用している——
 * 以前は自前の線画（fill:none+stroke）で統一していたが、「タッチペンっぽく
 * 見える」等の見た目の物足りなさが重なったため、既製の充実したアイコンセットに
 * 揃えることにした（ユーザー指示）。fill="#000000"だった元のSVGはfill=currentColor
 * に差し替えてあり、実際の色はCSS側（ボタンのink色）に委ねる。
 *
 * 一部は挙動が絡む・既製アイコンに相当するものが無いため、引き続き自前で
 * 描いている: marker（選択中の色が先端に反映されるチゼルチップ）、
 * eraserSizeSmall/Medium/Large（実際の大きさの違いをそのまま見せる市松模様）、
 * pattern*（柄・質感そのもののプレビュー）。これらは今までどおりfill:none+
 * strokeの線画（common）や個別の塗りで描く。
 */

const common = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS: Record<
  | "pen"
  | "marker"
  | "eraser"
  | "eraserSizeSmall"
  | "eraserSizeMedium"
  | "eraserSizeLarge"
  | "text"
  | "move"
  | "trace"
  | "checklist"
  | "shapeRound"
  | "shapeOval"
  | "shapeSquare"
  | "sharedRooms"
  | "menu"
  | "patternMatte"
  | "patternTortoiseshell"
  | "patternClear"
  | "patternWood"
  | "trash"
  | "timer"
  | "room"
  | "undo"
  | "plus"
  | "link",
  string
> = {
  // Phosphorのpen-bold。元は1つの<path>に4つのサブパス（本体の輪郭／
  // シャフトの陰影線／ペン先金具の陰影線／ペン先のインクだまり）がZ区切りで
  // 入っているのを4つの<path>に分けている。本体の輪郭・ペン先のインク
  // だまりはcurrentColor（黒）に固定し、シャフト・ペン先金具の陰影線
  // （元のPhosphorアイコンで面取りを表していた細い2本の線）だけをCSS変数
  // --pen-tip-colorにして選択中のペン色を反映している（ユーザー指示：
  // 「黒と選択色の部分を逆にして」——当初は輪郭・ペン先側を選択色、
  // 陰影線側を黒にしていた）。toolbar.tsがdrawColorが変わるたびに
  // --pen-tip-colorを更新する。
  pen: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <path fill="currentColor" d="M227.32,73.37,182.63,28.69a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31l83.67-83.66,3.48,13.9-36.8,36.79a8,8,0,0,0,11.31,11.32l40-40a8,8,0,0,0,2.11-7.6l-6.9-27.61L227.32,96A16,16,0,0,0,227.32,73.37Z"/>
      <path fill="currentColor" d="M48,179.31,76.69,208H48Z"/>
      <path fill="var(--pen-tip-color, currentColor)" d="M96,204.69,51.31,160,136,75.31,180.69,120Z"/>
      <path fill="var(--pen-tip-color, currentColor)" d="M192,108.69,147.32,64,171.32,40,216,84.69Z"/>
    </svg>`,
  // Phosphorのhighlighter-bold（斜めに構えたハイライター）をそのまま採用。
  // 元は1つの<path>に3つのサブパス（本体の輪郭／斜めの陰影線／ペン先の
  // インクだまり）がZ区切りで入っているのを3つの<path>に分け、ペン先の
  // インクだまりの部分だけ塗り色をCSS変数--marker-tip-colorに差し替え、
  // 選択中のマーカー色を反映できるようにしている——toolbar.tsが
  // markerColorが変わるたびにこの変数を更新する（ユーザー指示）。本体・
  // 陰影線はpenと同じ理由で--ink-55の薄いインクにしている。
  marker: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <path fill="var(--ink-55)" d="M252.49,107.51a12,12,0,0,0-17,0L192,151,113,72l43.52-43.51a12,12,0,0,0-17-17L93.17,57.86a20,20,0,0,0-4.72,20.72L69.17,97.86a20,20,0,0,0,0,28.28L71,128,15.51,183.51a12,12,0,0,0,4.7,19.87l72,24A11.8,11.8,0,0,0,96,228a12,12,0,0,0,8.49-3.52L136,193l1.86,1.86a20,20,0,0,0,28.28,0l19.27-19.27a20.27,20.27,0,0,0,6.59,1.13,19.86,19.86,0,0,0,14.14-5.86l46.35-46.34A12,12,0,0,0,252.49,107.51Z"/>
      <path fill="var(--ink-55)" d="M152,175,96.49,119.52h0L89,112l15-15,63,63Z"/>
      <path fill="var(--marker-tip-color, currentColor)" d="M92.76,202.27,46.21,186.76,88,145l31,31Z"/>
    </svg>`,
  eraser: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M216,204H141l86.84-86.84a28,28,0,0,0,0-39.6L186.43,36.19a28,28,0,0,0-39.6,0L28.19,154.82a28,28,0,0,0,0,39.6l30.06,30.07A12,12,0,0,0,66.74,228H216a12,12,0,0,0,0-24ZM163.8,53.16a4,4,0,0,1,5.66,0l41.38,41.38a4,4,0,0,1,0,5.65L160,151l-47-47ZM71.71,204,45.16,177.45a4,4,0,0,1,0-5.65L96,121l47,47-36,36Z"/>
    </svg>`,
  // 消しゴムの大きさ（小/中/大）を選ぶボタン用。他のアイコンと違い、実際の大きさの
  // 違いをそのまま見せたいので線画ではなく丸にしている（GoodNotesの消しゴム
  // サイズ選択と同じ考え方——ユーザー指示）。中身をcurrentColorの塗りつぶし（黒っぽく
  // 見えてインクの色スウォッチと紛らわしい）にしていたが、「白色のモザイクのように」
  // という指摘を受け、白と薄いグレーの2x2の市松模様（モザイク）に変更した。
  // アイコンの実際の描画サイズが20x20pxしかなく、細かい市松模様にすると潰れて
  // ただの白い丸に見えてしまうため、円を4分割した粗いチェックにして小さくても
  // はっきり模様と分かるようにしている。紙のような明るい背景に対しても輪郭が
  // 見えるよう、丸の外周だけcurrentColorで縁取りしている。
  eraserSizeSmall: `
    <svg viewBox="0 0 24 24">
      <defs>
        <clipPath id="eraser-clip-s"><circle cx="12" cy="12" r="3" /></clipPath>
      </defs>
      <g clip-path="url(#eraser-clip-s)">
        <rect x="9" y="9" width="6" height="6" fill="#ffffff" />
        <rect x="9" y="9" width="3" height="3" fill="var(--ink-35)" />
        <rect x="12" y="12" width="3" height="3" fill="var(--ink-35)" />
      </g>
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.2" />
    </svg>`,
  eraserSizeMedium: `
    <svg viewBox="0 0 24 24">
      <defs>
        <clipPath id="eraser-clip-m"><circle cx="12" cy="12" r="5.5" /></clipPath>
      </defs>
      <g clip-path="url(#eraser-clip-m)">
        <rect x="6.5" y="6.5" width="11" height="11" fill="#ffffff" />
        <rect x="6.5" y="6.5" width="5.5" height="5.5" fill="var(--ink-35)" />
        <rect x="12" y="12" width="5.5" height="5.5" fill="var(--ink-35)" />
      </g>
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" stroke-width="1.2" />
    </svg>`,
  eraserSizeLarge: `
    <svg viewBox="0 0 24 24">
      <defs>
        <clipPath id="eraser-clip-l"><circle cx="12" cy="12" r="8.5" /></clipPath>
      </defs>
      <g clip-path="url(#eraser-clip-l)">
        <rect x="3.5" y="3.5" width="17" height="17" fill="#ffffff" />
        <rect x="3.5" y="3.5" width="8.5" height="8.5" fill="var(--ink-35)" />
        <rect x="12" y="12" width="8.5" height="8.5" fill="var(--ink-35)" />
      </g>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.2" />
    </svg>`,
  text: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M212,56V88a12,12,0,0,1-24,0V68H140V188h20a12,12,0,0,1,0,24H96a12,12,0,0,1,0-24h20V68H68V88a12,12,0,0,1-24,0V56A12,12,0,0,1,56,44H200A12,12,0,0,1,212,56Z"/>
    </svg>`,
  move: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M87.51,64.49a12,12,0,0,1,0-17l32-32a12,12,0,0,1,17,0l32,32a12,12,0,0,1-17,17L140,53V96a12,12,0,0,1-24,0V53L104.49,64.49A12,12,0,0,1,87.51,64.49Zm64,127L140,203V160a12,12,0,0,0-24,0v43l-11.51-11.52a12,12,0,0,0-17,17l32,32a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Zm89-72-32-32a12,12,0,0,0-17,17L203,116H160a12,12,0,0,0,0,24h43l-11.52,11.51a12,12,0,0,0,17,17l32-32A12,12,0,0,0,240.49,119.51ZM53,140H96a12,12,0,0,0,0-24H53l11.52-11.51a12,12,0,1,0-17-17l-32,32a12,12,0,0,0,0,17l32,32a12,12,0,1,0,17-17Z"/>
    </svg>`,
  trace: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M3.5 15c2.5-6 5-6 7-3s4.5 3 7-3" stroke-dasharray="2.2 3" opacity="0.55" />
      <path d="M12.7 11.3c1-1.5 2.2-1.9 3.3-1.3" />
      <circle cx="17.5" cy="8.3" r="1.6" fill="currentColor" stroke="none" />
    </svg>`,
  checklist: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M79.51,39.51,56,63l-7.51-7.52a12,12,0,0,0-17,17l16,16a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Zm0,64L56,127l-7.51-7.52a12,12,0,1,0-17,17l16,16a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Zm0,64L56,191l-7.51-7.52a12,12,0,1,0-17,17l16,16a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17ZM228,128a12,12,0,0,1-12,12H128a12,12,0,0,1,0-24h88A12,12,0,0,1,228,128ZM128,76h88a12,12,0,0,0,0-24H128a12,12,0,0,0,0,24Zm88,104H128a12,12,0,0,0,0,24h88a12,12,0,0,0,0-24Z"/>
    </svg>`,
  // 道具バーの「戻る」ボタン（issue #90）。反時計回りに巻き戻る矢印。
  undo: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M236,144a68.07,68.07,0,0,1-68,68H80a12,12,0,0,1,0-24h88a44,44,0,0,0,0-88H61l27.52,27.51a12,12,0,0,1-17,17l-48-48a12,12,0,0,1,0-17l48-48a12,12,0,1,1,17,17L61,76H168A68.08,68.08,0,0,1,236,144Z"/>
    </svg>`,
  shapeRound: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,192a84,84,0,1,1,84-84A84.09,84.09,0,0,1,128,212Z"/>
    </svg>`,
  // Phosphorに楕円専用のアイコンが無いため、円（shapeRoundと同じcircle-bold）を
  // そのまま縦方向に押し潰して楕円に見せている——線の太さ等の描き味は円と揃う。
  shapeOval: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <g transform="translate(128 128) scale(1, 0.72) translate(-128 -128)">
        <path d="M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,192a84,84,0,1,1,84-84A84.09,84.09,0,0,1,128,212Z"/>
      </g>
    </svg>`,
  shapeSquare: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M208,28H48A20,20,0,0,0,28,48V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V48A20,20,0,0,0,208,28Zm-4,176H52V52H204Z"/>
    </svg>`,
  // 「共有」を、円2つの重なりではなく人物2人（Phosphorのusers-bold）で表す方が
  // 意味が伝わりやすいと判断した。
  sharedRooms: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M125.18,156.94a64,64,0,1,0-82.36,0,100.23,100.23,0,0,0-39.49,32,12,12,0,0,0,19.35,14.2,76,76,0,0,1,122.64,0,12,12,0,0,0,19.36-14.2A100.33,100.33,0,0,0,125.18,156.94ZM44,108a40,40,0,1,1,40,40A40,40,0,0,1,44,108Zm206.1,97.67a12,12,0,0,1-16.78-2.57A76.31,76.31,0,0,0,172,172a12,12,0,0,1,0-24,40,40,0,1,0-10.3-78.67,12,12,0,1,1-6.16-23.19,64,64,0,0,1,57.64,110.8,100.23,100.23,0,0,1,39.49,32A12,12,0,0,1,250.1,205.67Z"/>
    </svg>`,
  // アプリのメインメニュー(旧「設定」)トリガー用の三本線(ハンバーガー)
  // (issue #161)。中身がテーマだけでなくアプリ全体の機能へのアクセスを
  // 含むため、設定を意味する歯車ではなく、メニュー全般を意味するこちらに
  // 差し替えた(Claude風、ユーザー指示)。
  menu: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M228,128a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128ZM40,76H216a12,12,0,0,0,0-24H40a12,12,0,0,0,0,24ZM216,180H40a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24Z"/>
    </svg>`,
  // 柄・質感の4アイコンは、既存のライン系アイコンと違い形ではなく質感そのものの
  // プレビューなので、線でなく塗りのスワッチとして描く（common属性は使わない）。
  patternMatte: `
    <svg viewBox="0 0 24 24">
      <defs>
        <linearGradient id="pm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="oklch(25% 0.02 55)" />
          <stop offset="0.5" stop-color="oklch(36% 0.022 55)" />
          <stop offset="1" stop-color="oklch(25% 0.02 55)" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="url(#pm-g)" />
    </svg>`,
  patternTortoiseshell: `
    <svg viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="oklch(46% 0.09 70)" />
      <ellipse cx="8" cy="8" rx="4" ry="3" transform="rotate(20 8 8)" fill="oklch(20% 0.03 50)" opacity="0.55" />
      <ellipse cx="16" cy="9" rx="3.2" ry="2.4" transform="rotate(-15 16 9)" fill="oklch(28% 0.07 40)" opacity="0.6" />
      <ellipse cx="7" cy="16" rx="3.5" ry="2.6" transform="rotate(-10 7 16)" fill="oklch(30% 0.08 45)" opacity="0.5" />
      <ellipse cx="16" cy="16.5" rx="4" ry="3" transform="rotate(15 16 16.5)" fill="oklch(18% 0.02 40)" opacity="0.6" />
    </svg>`,
  patternClear: `
    <svg viewBox="0 0 24 24">
      <defs>
        <linearGradient id="pc-g" x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stop-color="oklch(80% 0.03 90 / 0.6)" />
          <stop offset="0.35" stop-color="oklch(97% 0.015 95 / 0.9)" />
          <stop offset="0.5" stop-color="oklch(72% 0.035 90 / 0.55)" />
          <stop offset="0.7" stop-color="oklch(97% 0.015 95 / 0.9)" />
          <stop offset="1" stop-color="oklch(80% 0.03 90 / 0.6)" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="url(#pc-g)" stroke="oklch(60% 0.03 90 / 0.5)" stroke-width="1" />
    </svg>`,
  patternWood: `
    <svg viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="oklch(53% 0.07 60)" />
      <path d="M3 8c3-2 6 2 9 0s6-2 9 0" fill="none" stroke="oklch(32% 0.06 50)" stroke-width="1.1" opacity="0.55" />
      <path d="M3 13c3-2 6 2 9 0s6-2 9 0" fill="none" stroke="oklch(38% 0.07 55)" stroke-width="1.3" opacity="0.5" />
      <path d="M3 18c3-2 6 2 9 0s6-2 9 0" fill="none" stroke="oklch(30% 0.05 45)" stroke-width="1" opacity="0.5" />
    </svg>`,
  trash: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M216,48H180V36A28,28,0,0,0,152,8H104A28,28,0,0,0,76,36V48H40a12,12,0,0,0,0,24h4V208a20,20,0,0,0,20,20H192a20,20,0,0,0,20-20V72h4a12,12,0,0,0,0-24ZM100,36a4,4,0,0,1,4-4h48a4,4,0,0,1,4,4V48H100Zm88,168H68V72H188ZM116,104v64a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Zm48,0v64a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Z"/>
    </svg>`,
  // 共同アイデア出しセッション(sessionPanel.ts)のトリガーボタン用。
  timer: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M128,44a96,96,0,1,0,96,96A96.11,96.11,0,0,0,128,44Zm0,168a72,72,0,1,1,72-72A72.08,72.08,0,0,1,128,212ZM164.49,99.51a12,12,0,0,1,0,17l-28,28a12,12,0,0,1-17-17l28-28A12,12,0,0,1,164.49,99.51ZM92,16A12,12,0,0,1,104,4h48a12,12,0,0,1,0,24H104A12,12,0,0,1,92,16Z"/>
    </svg>`,
  // 接続中のルーム（sharedRoomMenu.ts）を表す小さな家のアイコン。IDの文字列
  // だけでは何を表しているボタンか分かりにくい、というユーザー指摘のため。
  room: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M222.14,105.85l-80-80a20,20,0,0,0-28.28,0l-80,80A19.86,19.86,0,0,0,28,120v96a12,12,0,0,0,12,12h64a12,12,0,0,0,12-12V164h24v52a12,12,0,0,0,12,12h64a12,12,0,0,0,12-12V120A19.86,19.86,0,0,0,222.14,105.85ZM204,204H164V152a12,12,0,0,0-12-12H104a12,12,0,0,0-12,12v52H52V121.65l76-76,76,76Z"/>
    </svg>`,
  // 「新しいルームを作成」(sharedRoomMenu.ts)用の単純な十字。
  plus: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M228,128a12,12,0,0,1-12,12H140v76a12,12,0,0,1-24,0V140H40a12,12,0,0,1,0-24h76V40a12,12,0,0,1,24,0v76h76A12,12,0,0,1,228,128Z"/>
    </svg>`,
  // 「共有URLをコピー」(sharedRoomMenu.ts)用の鎖の輪2つ。
  link: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M117.18,188.74a12,12,0,0,1,0,17l-5.12,5.12A58.26,58.26,0,0,1,70.6,228h0A58.62,58.62,0,0,1,29.14,127.92L63.89,93.17a58.64,58.64,0,0,1,98.56,28.11,12,12,0,1,1-23.37,5.44,34.65,34.65,0,0,0-58.22-16.58L46.11,144.89A34.62,34.62,0,0,0,70.57,204h0a34.41,34.41,0,0,0,24.49-10.14l5.11-5.12A12,12,0,0,1,117.18,188.74ZM226.83,45.17a58.65,58.65,0,0,0-82.93,0l-5.11,5.11a12,12,0,0,0,17,17l5.12-5.12a34.63,34.63,0,1,1,49,49L175.1,145.86A34.39,34.39,0,0,1,150.61,156h0a34.63,34.63,0,0,1-33.69-26.72,12,12,0,0,0-23.38,5.44A58.64,58.64,0,0,0,150.56,180h.05a58.28,58.28,0,0,0,41.47-17.17l34.75-34.75a58.62,58.62,0,0,0,0-82.91Z"/>
    </svg>`,
};
