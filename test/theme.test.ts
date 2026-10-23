import { describe, expect, it } from "vitest";
import { DEFAULT_DARK_INK, DEFAULT_LIGHT_INK, resolveInkColor } from "../src/theme";

describe("resolveInkColor", () => {
  it("ライトモードでは色をそのまま返す", () => {
    expect(resolveInkColor("oklch(52% 0.2 25)", false)).toBe("oklch(52% 0.2 25)");
    expect(resolveInkColor(DEFAULT_LIGHT_INK, false)).toBe(DEFAULT_LIGHT_INK);
  });

  it("ダークモードでは既定の黒インクが白系に反転する", () => {
    expect(resolveInkColor(DEFAULT_LIGHT_INK, true)).toBe(DEFAULT_DARK_INK);
    expect(resolveInkColor("#000", true)).toBe(DEFAULT_DARK_INK);
  });

  it("ダークモードのペンの赤・青は、暗い紙で読める明るい同系色に置き換わる", () => {
    expect(resolveInkColor("oklch(52% 0.2 25)", true)).toBe("oklch(72% 0.17 25)");
    expect(resolveInkColor("oklch(48% 0.16 258)", true)).toBe("oklch(72% 0.13 258)");
  });

  it("マーカーなどその他の色は、ダークモードでもそのまま", () => {
    expect(resolveInkColor("oklch(85% 0.08 210)", true)).toBe("oklch(85% 0.08 210)");
  });
});
