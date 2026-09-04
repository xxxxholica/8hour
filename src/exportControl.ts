import { appendExportEvent } from "./storage";

export interface ExportSource {
  createExportImage(): Promise<Blob>;
  getExportText(): string;
}

function timestampForFile(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Firefox may still be reading the object URL immediately after click().
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** 設定メニュー内の「エクスポート」区画（ユーザー指示：ヘッダー独立の
 *  書き出しボタンを設定メニューへ統合し、「PNG」「TXT」を1行に並べる）。
 *  以前あった「両方」を一度に書き出す選択肢は廃止した——設定メニューは
 *  既に開いている状態でこの区画を出すため、このクラス自身は独自の
 *  トリガー・ポップオーバーの開閉状態を持たない。 */
export class ExportSection {
  readonly element: HTMLElement;
  private statusEl: HTMLElement;
  private pngBtn: HTMLButtonElement;
  private txtBtn: HTMLButtonElement;
  private getSource: () => ExportSource;
  private onExported?: () => void;

  /** onExportedは書き出し成功後に設定メニュー自体を閉じるために使う
   *  （旧ExportControlのclose()相当）。 */
  constructor(getSource: () => ExportSource, onExported?: () => void) {
    this.getSource = getSource;
    this.onExported = onExported;

    this.element = document.createElement("div");
    this.element.className = "shared-menu-section";

    const label = document.createElement("div");
    label.className = "shared-section-label";
    label.textContent = "エクスポート";
    this.element.appendChild(label);

    const row = document.createElement("div");
    row.className = "export-row";
    this.pngBtn = this.buildButton("PNG", () => void this.runExport("image"));
    this.txtBtn = this.buildButton("TXT", () => void this.runExport("text"));
    row.append(this.pngBtn, this.txtBtn);
    this.element.appendChild(row);

    // 失敗時のエラーだけをここに出す(成功時はダウンロードが始まること自体が
    // 合図になるため、成功メッセージは出さない)。
    this.statusEl = document.createElement("p");
    this.statusEl.className = "export-status";
    this.element.appendChild(this.statusEl);
  }

  private buildButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-btn export-row-btn";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private async runExport(kind: "text" | "image"): Promise<void> {
    const source = this.getSource();
    this.statusEl.textContent = "";
    this.pngBtn.disabled = true;
    this.txtBtn.disabled = true;
    try {
      const stamp = timestampForFile(new Date());
      if (kind === "image") {
        const image = await source.createExportImage();
        download(image, `ensou-${stamp}.png`);
      } else {
        const text = source.getExportText();
        // AndroidのダウンロードマネージャはMIMEのcharsetヒントを保持しないことが
        // 多く、テキストビューアがBOM無しだとShift-JIS等と誤判定して文字化けする
        // ため、UTF-8 BOMを本体に付与してエンコーディングを明示する。
        const BOM = "﻿";
        download(new Blob([BOM + text], { type: "text/plain;charset=utf-8" }), `ensou-${stamp}.txt`);
      }
      // コアループの利用実態の計測（E8-06）。ダッシュボード等は持たず、後から
      // localStorageの中身を直接見て集計する前提のイベントログ（storage.ts参照）。
      appendExportEvent({ timestamp: Date.now(), kind });
      this.onExported?.();
    } catch (e) {
      this.statusEl.textContent = e instanceof Error ? e.message : "書き出しに失敗しました";
    } finally {
      this.pngBtn.disabled = false;
      this.txtBtn.disabled = false;
    }
  }
}
