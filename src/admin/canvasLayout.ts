/** Read the flex gap between map/detail and cards from CSS. */
export function getCanvasRowGap(canvas: HTMLElement): number {
  const row = canvas.querySelector(".admin-canvas__row") as HTMLElement | null;
  if (!row) return 16;
  const styles = getComputedStyle(row);
  const stacked = styles.flexDirection === "column";
  const gap = parseFloat(stacked ? styles.rowGap : styles.columnGap);
  return Number.isFinite(gap) && gap > 0 ? gap : 16;
}

export function getCanvasCardsMinWidth(cardsPanel: HTMLElement | null): number {
  if (!cardsPanel) return 320;
  const minWidth = parseFloat(getComputedStyle(cardsPanel).minWidth);
  return Number.isFinite(minWidth) && minWidth > 0 ? minWidth : 320;
}

/** Match main-panel sizing to the map canvas row (map + 320px cards). */
export function fitCanvasMainPanel(
  canvas: HTMLElement,
  mainPanel: HTMLElement,
  aspectWidth: number,
  aspectHeight: number
): void {
  const fitContainer =
    (canvas.closest(".admin-layout") as HTMLElement | null) ?? canvas;
  const styles = getComputedStyle(canvas);
  const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  const bounds = fitContainer.getBoundingClientRect();
  const innerWidth = Math.max(1, bounds.width - padX);
  const innerHeight = Math.max(1, bounds.height - padY);

  const cardsPanel = canvas.querySelector(".admin-canvas__cards") as HTMLElement | null;
  const row = canvas.querySelector(".admin-canvas__row") as HTMLElement | null;
  const gap = getCanvasRowGap(canvas);

  if (!cardsPanel || !row) return;

  const stacked = getComputedStyle(row).flexDirection === "column";
  let fitWidth: number;
  let fitHeight: number;

  if (stacked) {
    const cardsHeight = cardsPanel.getBoundingClientRect().height || 360;
    fitWidth = innerWidth;
    fitHeight = Math.max(1, innerHeight - cardsHeight - gap);
  } else {
    const cardsMinWidth = getCanvasCardsMinWidth(cardsPanel);
    fitWidth = Math.max(1, innerWidth - cardsMinWidth - gap);
    fitHeight = innerHeight;
  }

  const fitScale = Math.min(fitWidth / aspectWidth, fitHeight / aspectHeight);
  const stageWidth = aspectWidth * fitScale;
  const stageHeight = aspectHeight * fitScale;

  mainPanel.style.width = `${stageWidth}px`;
  mainPanel.style.height = `${stageHeight}px`;
  row.style.height = `${stageHeight}px`;
  cardsPanel.style.height = `${stageHeight}px`;
}

export function resetCanvasMainPanel(canvas: HTMLElement, mainPanel: HTMLElement): void {
  const row = canvas.querySelector(".admin-canvas__row") as HTMLElement | null;
  const cardsPanel = canvas.querySelector(".admin-canvas__cards") as HTMLElement | null;

  mainPanel.style.width = "";
  mainPanel.style.height = "";
  if (row) row.style.height = "";
  if (cardsPanel) cardsPanel.style.height = "";
}
