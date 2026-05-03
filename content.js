(() => {
  "use strict";

  /**
   * Google Sheets のコメント popup とセル編集履歴 popup を読みやすくする。
   *
   * 主な責務:
   * - コメント popup の横幅拡張、リサイズ、画面端補正
   * - 編集履歴 popup のリサイズ、画面端補正
   * - 編集履歴値の追加・削除・置換を git diff 風に再描画
   * - Google Sheets 内の同一 origin iframe への同じ処理の適用
   */

  /**
   * この拡張が各 document に注入する style 要素の id。
   *
   * 同じ content script が top document と iframe の両方で走るため、document ごとに
   * 同じ CSS を二重注入しないためのキーとして使う。
   *
   * @type {{comment: string, diff: string, blameHandle: string}}
   */
  const STYLE_IDS = {
    comment: "spreadsheet-wide-comment-style",
    diff: "widen-ext-blame-diff-style",
    blameHandle: "widen-ext-blame-handle-style",
  };

  /**
   * Google Sheets が生成する popup DOM を捕まえるための selector 集。
   *
   * 編集履歴 popup は `.waffle-blameview` を外枠に持ち、その中に
   * `.docs-blameview-valuecontainer > .docs-blameview-value-content` が配置される。
   * 値の変更内容は `.docs-blame-bold-text` の action label と text node の組み合わせで
   * 表現されるため、diff 変換ではこの構造を前提に DOM を読む。
   *
   * @type {{
   *   iframe: string,
   *   commentPopup: string,
   *   blamePopup: string,
   *   blameView: string,
   *   blameValueContainer: string,
   *   blameValueContent: string,
   *   blameBoldText: string
   * }}
   */
  const SELECTORS = {
    iframe: "iframe",
    commentPopup: ".docos-anchoreddocoview",
    blamePopup: ".waffle-blameview",
    blameView: ".docs-blameview",
    blameValueContainer: ".docs-blameview-valuecontainer",
    blameValueContent: ".docs-blameview-value-content",
    blameBoldText: ".docs-blame-bold-text",
  };

  /**
   * コメント popup に追加するリサイズハンドルの class。
   *
   * @type {string}
   */
  const COMMENT_HANDLE_CLASS = "widen-ext-comment-handle";

  /**
   * 編集履歴 popup に追加するリサイズハンドルの class。
   *
   * @type {string}
   */
  const BLAME_HANDLE_CLASS = "widen-ext-blame-handle";

  /**
   * 編集履歴値を diff 表示へ変換済みかを示す data 属性名。
   *
   * MutationObserver が同じ `.docs-blameview-value-content` を何度も拾うため、
   * 再変換による DOM の二重生成を防ぐ。
   *
   * @type {string}
   */
  const BLAME_DIFF_ATTR = "data-widen-diff-rendered";

  /**
   * diff の縦並び・横並びを document root に保持する data 属性名。
   *
   * CSS 側では `:root[data-widen-diff-layout="horizontal"]` として参照する。
   *
   * @type {string}
   */
  const BLAME_DIFF_LAYOUT_ATTR = "data-widen-diff-layout";

  /**
   * diff レイアウト設定を localStorage に保存するためのキー。
   *
   * @type {string}
   */
  const BLAME_DIFF_LAYOUT_KEY = "widen-ext-blame-diff-layout";

  /**
   * 編集履歴の action label 横に追加する diff レイアウト切替ボタンの class。
   *
   * @type {string}
   */
  const BLAME_DIFF_TOGGLE_CLASS = "widen-diff-layout-toggle";

  /**
   * action label と diff レイアウト切替ボタンを横並びにする wrapper の class。
   *
   * @type {string}
   */
  const BLAME_DIFF_TOGGLE_ROW_CLASS = "widen-diff-layout-toggle-row";

  /**
   * popup が viewport からはみ出さないよう補正するときの余白設定。
   *
   * `rightSidebarOffset` は Google Sheets 右側メニューぶんを残すための値。
   * `bottomEdgeOffset` は編集履歴 popup の下端に操作可能な余白を残すために使う。
   *
   * @type {{
   *   leftEdgeOffset: number,
   *   margin: number,
   *   rightSidebarOffset: number,
   *   bottomEdgeOffset: number
   * }}
   */
  const POPUP_BOUNDS = {
    leftEdgeOffset: 16,
    margin: 16,
    rightSidebarOffset: 56,
    bottomEdgeOffset: 48,
  };

  /**
   * コメント popup をリサイズできる最小の幅 (px)。
   *
   * 元の Google Sheets の width に合わせている。
   *
   * @type {number}
   */
  const COMMENT_MIN_WIDTH = 282;

  /**
   * コメント popup をリサイズできる最小の高さ (px)。
   *
   * 現在コメント popup は横方向だけが手動変更可能だが、共通リサイズ API の必須値として
   * 元の Google Sheets の最小の height を渡している。
   *
   * @type {number}
   */
  const COMMENT_MIN_HEIGHT = 103;

  /**
   * 編集履歴 popup を開き直したときに戻す初期幅 (px)。
   *
   * `.waffle-blameview` は閉じても DOM が残るため、手動リサイズ後の inline width を
   * 次回表示へ持ち越さないようにする。
   *
   * @type {number}
   */
  const BLAME_DEFAULT_WIDTH = 320;

  /**
   * 編集履歴 popup の最小幅 (px)。
   *
   * 元々の Google Sheets の width に合わせている。
   *
   * @type {number}
   */
  const BLAME_MIN_WIDTH = 240;

  /**
   * 編集履歴本文領域の既定 max-height (px)。
   *
   * warning、feedback、navigation を含む popup 全体ではなく、
   * `.docs-blameview-valuecontainer` だけをスクロール領域にする。
   *
   * @type {number}
   */
  const BLAME_VALUE_MAX_HEIGHT = 240;

  /**
   * 編集履歴本文領域の min-height (px)。
   *
   * @type {number}
   */
  const BLAME_VALUE_MIN_HEIGHT = 78;

  /**
   * setup 済み document を記録する。
   *
   * content script は `all_frames: true` で実行され、さらに同一 origin iframe も手動で
   * 初期化するため、同じ document に observer を重複登録しないために使う。
   *
   * @type {WeakSet<Document>}
   */
  const initializedDocuments = new WeakSet();

  /**
   * iframe 追加を監視済みの document を記録する。
   *
   * @type {WeakSet<Document>}
   */
  const observedFrameDocuments = new WeakSet();

  /**
   * load listener を登録済みの iframe 要素を記録する。
   *
   * @type {WeakSet<HTMLIFrameElement>}
   */
  const observedFrames = new WeakSet();

  /**
   * document ごとに、popup selector 単位の MutationObserver 登録状況を保持する。
   *
   * @type {WeakMap<Document, Set<string>>}
   */
  const observedPopupSelectors = new WeakMap();

  /**
   * 編集履歴 diff 変換用 observer を登録済みの document を記録する。
   *
   * @type {WeakSet<Document>}
   */
  const observedDiffDocuments = new WeakSet();

  /**
   * diff レイアウト切替ボタン補完用 observer を登録済みの document を記録する。
   *
   * @type {WeakSet<Document>}
   */
  const observedDiffToggleDocuments = new WeakSet();

  /**
   * requestAnimationFrame による編集履歴 popup 下端補正を予約済みの要素。
   *
   * @type {WeakSet<HTMLElement>}
   */
  const scheduledBlameBottomClamps = new WeakSet();

  /**
   * リサイズハンドル用の共通 CSS を生成する。
   *
   * @param {string} handleClass - ハンドル要素の class。
   * @returns {string} CSS 文字列。
   */
  const createResizeHandleCSS = (handleClass) => `
    .${handleClass} {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 18px;
      height: 18px;
      cursor: se-resize;
      z-index: 99999;
      box-sizing: border-box;
      background: transparent;
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      padding: 2px;
      flex: none !important;
    }
    .${handleClass} svg {
      pointer-events: none;
      opacity: 0.45;
      transition: opacity 0.15s;
    }
    .${handleClass}:hover svg {
      opacity: 0.85;
    }
  `;

  /**
   * コメント popup の幅拡張、本文折り返し、リサイズハンドルに必要な CSS。
   *
   * @type {string}
   */
  const commentCSS = `
    .docos-anchoreddocoview {
      min-width: 300px !important;
      max-width: none !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
    .docos-anchoreddocoview-internal,
    .docos-anchoreddocoview-content,
    .docos-docoview-replycontainer {
      width: 100% !important;
      max-width: none !important;
      box-sizing: border-box !important;
    }
    .docos-anchoreddocoview-internal {
      max-height: none !important;
      overflow: auto !important;
    }
    .docos-docoview-input-pane,
    .docos-input-textarea {
      width: 100% !important;
      box-sizing: border-box !important;
    }
    .docos-replyview-body {
      word-wrap: break-word !important;
      white-space: pre-wrap !important;
    }
    ${createResizeHandleCSS(COMMENT_HANDLE_CLASS)}
  `;

  /**
   * 編集履歴値を git diff 風に表示するための CSS。
   *
   * `.widen-diff-replacement` は通常は削除行・追加行を縦に並べる。
   * document root の `data-widen-diff-layout` が `"horizontal"` のときだけ横並びにする。
   *
   * @type {string}
   */
  const diffCSS = `
    .widen-diff-block {
      margin-top: 6px;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
      border-radius: 3px;
      overflow: hidden;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      border: 1px solid #e1e1e1;
    }
    :root[${BLAME_DIFF_LAYOUT_ATTR}="horizontal"] .widen-diff-replacement {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    :root[${BLAME_DIFF_LAYOUT_ATTR}="horizontal"] .widen-diff-replacement .widen-diff-row {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .widen-diff-row {
      padding: 4px 8px;
      display: block;
      font-style: normal !important;
    }
    .widen-diff-del {
      background: #ffeef0;
      color: #b31d28;
      border-left: 3px solid #f97583;
    }
    .widen-diff-add {
      background: #e6ffed;
      color: #22863a;
      border-left: 3px solid #34d058;
    }
    .widen-diff-neutral {
      background: #f6f8fa;
      color: #24292e;
      border-left: 3px solid #959da5;
    }
    .widen-diff-token-del {
      background: #ffd7d5;
      color: #82071e;
      border-radius: 2px;
      text-decoration: line-through;
    }
    .widen-diff-token-add {
      background: #aceebb;
      color: #116329;
      border-radius: 2px;
    }
    .${BLAME_DIFF_TOGGLE_ROW_CLASS} {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      box-sizing: border-box;
    }
    .${BLAME_DIFF_TOGGLE_ROW_CLASS} > .docs-blame-bold-text {
      min-width: 0;
    }
    .${BLAME_DIFF_TOGGLE_CLASS} {
      width: 24px;
      height: 24px;
      padding: 3px;
      border: 1px solid #e1e1e1;
      border-radius: 4px;
      background: #fff;
      color: #3c4043;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      flex: 0 0 auto;
      z-index: 1;
    }
    .${BLAME_DIFF_TOGGLE_CLASS}:hover {
      background: #f1f3f4;
      border-color: #bdc1c6;
    }
    .${BLAME_DIFF_TOGGLE_CLASS}:focus-visible {
      outline: 2px solid #1a73e8;
      outline-offset: 1px;
    }
    .${BLAME_DIFF_TOGGLE_CLASS} svg {
      width: 16px;
      height: 16px;
      pointer-events: none;
    }
  `;

  /**
   * 編集履歴 popup の幅追従、本文スクロール、リサイズハンドルに必要な CSS。
   *
   * 元の DOM では `.docs-blameview-valuecontainer` が編集値の本文領域なので、
   * popup 全体ではなくこの要素だけを高さ変更・スクロール対象にしている。
   *
   * @type {string}
   */
  const blameHandleCSS = `
    .waffle-blameview {
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
    .waffle-blameview .docs-blameview {
      width: 100% !important;
      max-width: none !important;
    }
    .waffle-blameview .docs-blameview-content,
    .waffle-blameview .docs-blameview-valuecontainer,
    .waffle-blameview .docs-blameview-value-content {
      width: 100% !important;
      max-width: none !important;
      min-width: 0 !important;
    }
    .waffle-blameview > *:not(.${BLAME_HANDLE_CLASS}),
    .waffle-blameview * {
      box-sizing: border-box !important;
    }
    .waffle-blameview .docs-blameview-valuecontainer {
      min-height: 0 !important;
      max-height: ${BLAME_VALUE_MAX_HEIGHT}px !important;
      overflow: auto !important;
    }
    ${createResizeHandleCSS(BLAME_HANDLE_CLASS)}
  `;

  /**
   * CSS を document に一度だけ注入する。
   *
   * @param {Document} doc - 注入先 document。
   * @param {string} id - style 要素の id。
   * @param {string} css - 注入する CSS。
   * @returns {void}
   */
  const injectCSS = (doc, id, css) => {
    if (!doc || doc.getElementById(id)) return;

    const style = doc.createElement("style");
    style.id = id;
    style.textContent = css;
    (doc.head || doc.documentElement).appendChild(style);
  };

  /**
   * Element node だけを後続処理へ流すための type guard。
   *
   * @param {Node} node - 判定対象 node。
   * @returns {node is Element} Element node なら true。
   */
  const isElementNode = (node) => node.nodeType === Node.ELEMENT_NODE;

  /**
   * 指定 selector に一致する要素と、その子孫に同じ処理を適用する。
   *
   * @param {Element} root - 検索開始要素。
   * @param {string} selector - 対象 selector。
   * @param {(element: HTMLElement) => void} callback - 対象ごとの処理。
   * @returns {void}
   */
  const forEachMatchedElement = (root, selector, callback) => {
    if (root.matches?.(selector)) callback(/** @type {HTMLElement} */ (root));
    root
      .querySelectorAll?.(selector)
      .forEach((element) => callback(/** @type {HTMLElement} */ (element)));
  };

  /**
   * 同一 origin iframe の document を安全に取得する。
   *
   * @param {HTMLIFrameElement} iframe - 対象 iframe。
   * @returns {Document | null} 読み取れる document。cross-origin などで失敗したら null。
   */
  const getIframeDocument = (iframe) => {
    try {
      return iframe.contentDocument ?? null;
    } catch {
      return null;
    }
  };

  /**
   * iframe の document が読めるタイミングで callback を実行する。
   *
   * @param {HTMLIFrameElement} iframe - 対象 iframe。
   * @param {(doc: Document) => void} callback - iframe document に適用する処理。
   * @returns {void}
   */
  const registerIframeSetup = (iframe, callback) => {
    if (observedFrames.has(iframe)) return;
    observedFrames.add(iframe);

    const setup = () => {
      const frameDocument = getIframeDocument(iframe);
      if (frameDocument) callback(frameDocument);
    };

    setup();
    iframe.addEventListener("load", setup);
  };

  /**
   * document 配下の既存 iframe と、後から追加される iframe を監視して初期化する。
   *
   * @param {Document} doc - 監視対象 document。
   * @returns {void}
   */
  const observeIframes = (doc) => {
    if (!doc || observedFrameDocuments.has(doc)) return;
    observedFrameDocuments.add(doc);

    const setupIframe = (iframe) =>
      registerIframeSetup(
        /** @type {HTMLIFrameElement} */ (iframe),
        setupDocument,
      );

    doc.querySelectorAll(SELECTORS.iframe).forEach(setupIframe);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!isElementNode(node)) continue;
          forEachMatchedElement(node, SELECTORS.iframe, setupIframe);
        }
      }
    });

    observer.observe(doc.body || doc.documentElement, {
      childList: true,
      subtree: true,
    });
  };

  /**
   * 指定 document と selector の組み合わせが監視済みか判定し、未監視なら記録する。
   *
   * @param {Document} doc - 対象 document。
   * @param {string} selector - 対象 selector。
   * @returns {boolean} 今回初めて記録した場合は true。
   */
  const markPopupObserver = (doc, selector) => {
    const selectors = observedPopupSelectors.get(doc) ?? new Set();
    if (selectors.has(selector)) return false;
    selectors.add(selector);
    observedPopupSelectors.set(doc, selectors);
    return true;
  };

  /**
   * popup の追加と inline style 変更を監視し、対象ごとの同期処理を適用する。
   *
   * @param {Document} doc - 監視対象 document。
   * @param {string} selector - popup を特定する selector。
   * @param {(element: HTMLElement) => void} syncPopup - popup 同期処理。
   * @returns {void}
   */
  const observePopupInDoc = (doc, selector, syncPopup) => {
    if (!doc) return;

    doc
      .querySelectorAll(selector)
      .forEach((element) => syncPopup(/** @type {HTMLElement} */ (element)));

    if (!markPopupObserver(doc, selector)) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "style" &&
          isElementNode(mutation.target) &&
          mutation.target.matches(selector)
        ) {
          syncPopup(/** @type {HTMLElement} */ (mutation.target));
        }

        for (const node of mutation.addedNodes) {
          if (!isElementNode(node)) continue;

          if (node.matches(selector)) {
            syncPopup(/** @type {HTMLElement} */ (node));
          }

          const parentPopup = node.closest?.(selector);
          if (parentPopup) {
            syncPopup(/** @type {HTMLElement} */ (parentPopup));
          }

          node
            .querySelectorAll?.(selector)
            .forEach((element) =>
              syncPopup(/** @type {HTMLElement} */ (element)),
            );
        }
      }
    });

    observer.observe(doc.body || doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
  };

  /**
   * popup が画面端からはみ出す場合、left と width を補正する。
   *
   * 右端に到達した場合はまず left を左へ逃がす。左端の余白を割る場合だけ width を
   * 縮め、Sheets の右サイドバーとスクロールバー分の余白を残す。
   *
   * @param {HTMLElement} element - 補正対象 popup。
   * @returns {void}
   */
  const clampPopupBounds = (element) => {
    if (!element.isConnected) return;

    const view = element.ownerDocument.defaultView ?? window;
    let rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const overflowRight =
      rect.right -
      view.innerWidth +
      POPUP_BOUNDS.margin +
      POPUP_BOUNDS.rightSidebarOffset;

    if (overflowRight > 0) {
      const currentLeft = parseFloat(element.style.left) || 0;
      element.style.setProperty(
        "left",
        `${currentLeft - overflowRight}px`,
        "important",
      );
    }

    rect = element.getBoundingClientRect();
    const overflowLeft = POPUP_BOUNDS.leftEdgeOffset - rect.left;
    if (overflowLeft <= 0) return;

    const currentLeft = parseFloat(element.style.left) || 0;
    const nextLeft = currentLeft + overflowLeft;
    const maxWidth = Math.max(0, rect.right - POPUP_BOUNDS.leftEdgeOffset);
    element.style.setProperty("left", `${nextLeft}px`, "important");
    element.style.setProperty("width", `${maxWidth}px`, "important");
  };

  /**
   * リサイズハンドルの SVG を返す。
   *
   * @returns {string} SVG markup。
   */
  const renderResizeHandleIcon = () => `
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(90deg)" aria-hidden="true" focusable="false">
      <line x1="13" y1="13" x2="1"  y2="1"  stroke="#555" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="13" y1="9"  x2="5"  y2="1"  stroke="#555" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="13" y1="5"  x2="9"  y2="1"  stroke="#555" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;

  /**
   * @typedef {object} ResizeHandleOptions
   * @property {string} handleClass - ハンドル要素の class。
   * @property {number} minWidth - 最小幅 px。
   * @property {number} minHeight - 最小高さ px。
   * @property {boolean} [resizeHeight=true] - 高さも変更するか。
   * @property {(element: HTMLElement) => HTMLElement} [getHeightTarget] - 高さを変更する要素。
   * @property {boolean} [syncMaxHeight=false] - height と max-height を同じ値にするか。
   * @property {(element: HTMLElement) => void} [onResize] - サイズ更新後の同期処理。
   */

  /**
   * popup にドラッグ可能なリサイズハンドルを追加する。
   *
   * @param {HTMLElement} element - リサイズ対象 popup。
   * @param {ResizeHandleOptions} options - ハンドル設定。
   * @returns {void}
   */
  const addResizeHandle = (
    element,
    {
      handleClass,
      minWidth,
      minHeight,
      resizeHeight = true,
      getHeightTarget,
      syncMaxHeight = false,
      onResize,
    },
  ) => {
    if (element.querySelector(`.${handleClass}`)) return;

    const computed =
      element.ownerDocument.defaultView?.getComputedStyle(element);
    if (computed?.position === "static") {
      element.style.position = "relative";
    }

    const handle = element.ownerDocument.createElement("div");
    handle.className = handleClass;
    handle.innerHTML = renderResizeHandleIcon();
    element.appendChild(handle);

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);

      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = element.offsetWidth;
      const heightTarget = getHeightTarget?.(element) ?? element;
      const startHeight = heightTarget.offsetHeight;

      const onPointerMove = (moveEvent) => {
        const nextWidth = Math.max(
          minWidth,
          startWidth + moveEvent.clientX - startX,
        );
        element.style.setProperty("width", `${nextWidth}px`, "important");

        if (resizeHeight) {
          const nextHeight = Math.max(
            minHeight,
            startHeight + moveEvent.clientY - startY,
          );
          const heightValue = `${nextHeight}px`;
          heightTarget.style.setProperty("height", heightValue, "important");
          if (syncMaxHeight) {
            heightTarget.style.setProperty(
              "max-height",
              heightValue,
              "important",
            );
          }
        }

        onResize?.(element);
      };

      const onPointerUp = (upEvent) => {
        if (handle.hasPointerCapture(upEvent.pointerId)) {
          handle.releasePointerCapture(upEvent.pointerId);
        }
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", onPointerUp);
        handle.removeEventListener("pointercancel", onPointerUp);
      };

      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp);
      handle.addEventListener("pointercancel", onPointerUp);
    });
  };

  /**
   * コメント popup の状態を同期する。
   *
   * @param {HTMLElement} element - `.docos-anchoreddocoview` 要素。
   * @returns {void}
   */
  const syncCommentPopup = (element) => {
    addResizeHandle(element, {
      handleClass: COMMENT_HANDLE_CLASS,
      minWidth: COMMENT_MIN_WIDTH,
      minHeight: COMMENT_MIN_HEIGHT,
      resizeHeight: false,
      onResize: clampPopupBounds,
    });
    clampPopupBounds(element);
  };

  /**
   * 保存済みの diff レイアウト設定を読む。
   *
   * @param {Document} doc - localStorage を読む document。
   * @returns {"vertical" | "horizontal"} 保存値。不正値や読み取り失敗時は `"vertical"`。
   */
  const readStoredDiffLayout = (doc) => {
    try {
      return doc.defaultView?.localStorage.getItem(BLAME_DIFF_LAYOUT_KEY) ===
        "horizontal"
        ? "horizontal"
        : "vertical";
    } catch {
      return "vertical";
    }
  };

  /**
   * diff レイアウト設定を localStorage に保存する。
   *
   * @param {Document} doc - localStorage を持つ document。
   * @param {"vertical" | "horizontal"} layout - 保存する表示方向。
   * @returns {void}
   */
  const writeStoredDiffLayout = (doc, layout) => {
    try {
      doc.defaultView?.localStorage.setItem(BLAME_DIFF_LAYOUT_KEY, layout);
    } catch {}
  };

  /**
   * CSS セレクタで参照する diff レイアウト属性を document root に設定する。
   *
   * @param {Document} doc - 対象 document。
   * @param {"vertical" | "horizontal"} layout - 設定する表示方向。
   * @returns {void}
   */
  const setDiffLayout = (doc, layout) => {
    doc.documentElement.setAttribute(BLAME_DIFF_LAYOUT_ATTR, layout);
  };

  /**
   * document に diff レイアウトの初期値を設定する。
   *
   * @param {Document} doc - 対象 document。
   * @returns {void}
   */
  const ensureDiffLayout = (doc) => {
    if (!doc.documentElement.hasAttribute(BLAME_DIFF_LAYOUT_ATTR)) {
      setDiffLayout(doc, readStoredDiffLayout(doc));
    }
  };

  /**
   * manifest で先読みしている jsdiff の global export を取得する。
   *
   * @returns {{diffWordsWithSpace?: (oldText: string, newText: string) => Array<{value: string, added?: boolean, removed?: boolean}>} | null} jsdiff API。
   */
  const getJsDiff = () => globalThis.Diff ?? null;

  /**
   * テキストまたは class 付き span を親要素へ追加する。
   *
   * @param {Document} doc - ノードを作成する document。
   * @param {Node} parent - 追加先ノード。
   * @param {string} text - 追加する文字列。
   * @param {string} [className=""] - span に付与する class。空なら Text node を追加する。
   * @returns {void}
   */
  const appendText = (doc, parent, text, className = "") => {
    if (!text) return;

    if (!className) {
      parent.appendChild(doc.createTextNode(text));
      return;
    }

    const span = doc.createElement("span");
    span.className = className;
    span.textContent = text;
    parent.appendChild(span);
  };

  /**
   * jsdiff の change objects から削除側または追加側の 1 行を作る。
   *
   * @param {Document} doc - ノードを作成する document。
   * @param {"del" | "add"} type - 作成する行の種類。
   * @param {Array<{value: string, added?: boolean, removed?: boolean}>} parts - jsdiff の差分結果。
   * @returns {HTMLSpanElement} diff 行。
   */
  const createDiffRow = (doc, type, parts) => {
    const row = doc.createElement("span");
    row.className = `widen-diff-row widen-diff-${type}`;

    for (const part of parts) {
      if (type === "del" && part.added) continue;
      if (type === "add" && part.removed) continue;

      const tokenClass =
        type === "del" && part.removed
          ? "widen-diff-token-del"
          : type === "add" && part.added
            ? "widen-diff-token-add"
            : "";
      appendText(doc, row, part.value, tokenClass);
    }

    return row;
  };

  /**
   * 置換履歴用の削除行・追加行を含む diff block を作成する。
   *
   * @param {Document} doc - ノードを作成する document。
   * @param {string} oldText - 変更前テキスト。
   * @param {string} newText - 変更後テキスト。
   * @returns {HTMLDivElement} 置換 diff block。
   */
  const createReplacementDiffBlock = (doc, oldText, newText) => {
    const block = doc.createElement("div");
    block.className = "widen-diff-block widen-diff-replacement";

    const parts = getJsDiff()?.diffWordsWithSpace?.(oldText, newText) ?? [
      { value: oldText, removed: true },
      { value: newText, added: true },
    ];

    block.appendChild(createDiffRow(doc, "del", parts));
    block.appendChild(createDiffRow(doc, "add", parts));
    return block;
  };

  /**
   * 追加のみ・削除のみ・中立表示の diff block を作成する。
   *
   * @param {Document} doc - ノードを作成する document。
   * @param {"add" | "del" | "neutral"} type - diff 行の種類。
   * @param {string} content - 表示するテキスト。
   * @returns {HTMLDivElement} 単一行 diff block。
   */
  const createSingleDiffBlock = (doc, type, content) => {
    const block = doc.createElement("div");
    block.className = "widen-diff-block";

    const row = doc.createElement("span");
    row.className = `widen-diff-row widen-diff-${type}`;
    appendText(
      doc,
      row,
      content,
      type === "add"
        ? "widen-diff-token-add"
        : type === "del"
          ? "widen-diff-token-del"
          : "",
    );

    block.appendChild(row);
    return block;
  };

  /**
   * 現在の diff レイアウトを表す SVG アイコン文字列を返す。
   *
   * @param {"vertical" | "horizontal"} layout - 現在の表示方向。
   * @returns {string} ボタン内に挿入する SVG markup。
   */
  const renderLayoutIcon = (layout) => {
    if (layout === "horizontal") {
      return `
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="2.5" y="3" width="4.5" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/>
          <rect x="9" y="3" width="4.5" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/>
        </svg>`;
    }

    return `
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <rect x="3" y="2.5" width="10" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/>
        <rect x="3" y="9" width="10" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/>
      </svg>`;
  };

  /**
   * document 内の diff レイアウト切替ボタンの表示を更新する。
   *
   * @param {Document} doc - 更新対象 document。
   * @returns {void}
   */
  const updateDiffLayoutButtons = (doc) => {
    const layout =
      doc.documentElement.getAttribute(BLAME_DIFF_LAYOUT_ATTR) || "vertical";
    const nextLabel =
      layout === "horizontal" ? "差分を縦に並べる" : "差分を横に並べる";

    doc.querySelectorAll(`.${BLAME_DIFF_TOGGLE_CLASS}`).forEach((button) => {
      button.innerHTML = renderLayoutIcon(
        /** @type {"vertical" | "horizontal"} */ (layout),
      );
      button.title = nextLabel;
      button.setAttribute("aria-label", nextLabel);
      button.setAttribute("aria-pressed", String(layout === "horizontal"));
    });
  };

  /**
   * diff レイアウトを縦並びと横並びで切り替え、保存値とボタン表示へ反映する。
   *
   * @param {Document} doc - 対象 document。
   * @returns {void}
   */
  const toggleDiffLayout = (doc) => {
    const current =
      doc.documentElement.getAttribute(BLAME_DIFF_LAYOUT_ATTR) || "vertical";
    const next = current === "horizontal" ? "vertical" : "horizontal";
    setDiffLayout(doc, next);
    writeStoredDiffLayout(doc, next);
    updateDiffLayoutButtons(doc);
  };

  /**
   * 編集履歴の action label と切替ボタンを flex row にまとめる。
   *
   * @param {Element} target - `.docs-blameview-value-content` またはその中の action label。
   * @returns {void}
   */
  const addDiffLayoutToggle = (target) => {
    const valueContent =
      target.closest?.(SELECTORS.blameValueContent) ?? target;
    if (valueContent.querySelector(`.${BLAME_DIFF_TOGGLE_CLASS}`)) return;

    const doc = valueContent.ownerDocument;
    const anchor = target.classList?.contains("docs-blame-bold-text")
      ? target
      : valueContent.querySelector(SELECTORS.blameBoldText);
    if (!anchor) return;

    injectCSS(doc, STYLE_IDS.diff, diffCSS);
    ensureDiffLayout(doc);

    const button = doc.createElement("button");
    button.type = "button";
    button.className = BLAME_DIFF_TOGGLE_CLASS;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleDiffLayout(doc);
    });

    const row = doc.createElement("span");
    row.className = BLAME_DIFF_TOGGLE_ROW_CLASS;
    anchor.parentNode?.insertBefore(row, anchor);
    row.appendChild(anchor);
    row.appendChild(button);
    updateDiffLayoutButtons(doc);
  };

  /**
   * Google Sheets が通常値の外側に付ける引用符を除去する。
   *
   * @param {string} value - 元文字列。
   * @returns {string} 前後空白と外側 quote を除いた文字列。
   */
  const stripBlameValueQuotes = (value) =>
    value.trim().replace(/^["「]|["」]$/g, "");

  /**
   * 編集履歴値として扱える数式 span か判定する。
   *
   * @param {Node} node - 判定対象 node。
   * @returns {boolean} 数式値 span なら true。
   */
  const isFormulaValueNode = (node) =>
    isElementNode(node) &&
    node.classList.contains("waffle-blameview-formula-text") &&
    Boolean(node.textContent?.trim());

  /**
   * 編集履歴値として扱える直下 node か判定する。
   *
   * @param {Node} node - `.docs-blameview-value-content` の直下 node。
   * @returns {boolean} 通常値 text node または数式値 span なら true。
   */
  const isBlameValueNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return stripBlameValueQuotes(node.textContent ?? "").length > 0;
    }

    return isFormulaValueNode(node);
  };

  /**
   * 編集履歴値 node から diff 対象文字列を取り出す。
   *
   * 数式 span の中にあるダブルクォートは数式本体なので保持し、通常 text node では
   * Google Sheets が外側に付ける引用符だけを除去する。
   *
   * @param {Node} node - 値として扱う node。
   * @returns {string} diff 対象文字列。
   */
  const getBlameValueText = (node) =>
    isFormulaValueNode(node)
      ? (node.textContent ?? "").trim()
      : stripBlameValueQuotes(node.textContent ?? "");

  /**
   * action label として扱う bold span か判定する。
   *
   * @param {Node} node - 判定対象 node。
   * @returns {node is Element} action label なら true。
   */
  const isBlameBoldText = (node) =>
    isElementNode(node) && node.classList.contains("docs-blame-bold-text");

  /**
   * action label より後ろの既存 node を削除する。
   *
   * @param {Element} valueContent - 編集履歴値の root 要素。
   * @param {Element | null} actionLabel - 残す action label。null の場合は全 node を削除。
   * @returns {void}
   */
  const removeNodesAfterActionLabel = (valueContent, actionLabel) => {
    const childNodes = Array.from(valueContent.childNodes);
    const actionIndex = actionLabel ? childNodes.indexOf(actionLabel) : -1;

    childNodes
      .filter((node, index) => (actionLabel ? index > actionIndex : true))
      .forEach((node) => node.parentNode?.removeChild(node));
  };

  /**
   * @typedef {object} ReplacementBlameChange
   * @property {"replace"} type - 置換履歴。
   * @property {Element | null} actionLabel - 表示に残す action label。
   * @property {string} oldText - 変更前テキスト。
   * @property {string} newText - 変更後テキスト。
   *
   * @typedef {object} SingleBlameChange
   * @property {"add" | "del" | "neutral"} type - 追加・削除・その他履歴。
   * @property {Element} actionLabel - 表示に残す action label。
   * @property {string} content - 表示テキスト。
   *
   * @typedef {ReplacementBlameChange | SingleBlameChange} BlameChange
   */

  /**
   * Google Sheets の編集履歴値 DOM から、差分表示に必要な情報だけを取り出す。
   *
   * @param {Element} valueContent - `.docs-blameview-value-content` 要素。
   * @returns {BlameChange | null} 対応できる変更情報。未対応 DOM なら null。
   */
  const parseBlameChange = (valueContent) => {
    const childNodes = Array.from(valueContent.childNodes);
    const boldLabels = childNodes.filter(isBlameBoldText);
    const fromLabel = boldLabels.find(
      (label) => label.textContent?.trim() === "から",
    );

    if (fromLabel) {
      const fromIndex = childNodes.indexOf(fromLabel);
      const oldValueNode = childNodes
        .slice(0, fromIndex)
        .reverse()
        .find(isBlameValueNode);
      const newValueNode = childNodes
        .slice(fromIndex + 1)
        .find(isBlameValueNode);

      if (!oldValueNode || !newValueNode) return null;

      return {
        type: "replace",
        actionLabel: boldLabels.find((label) => label !== fromLabel) ?? null,
        oldText: getBlameValueText(oldValueNode),
        newText: getBlameValueText(newValueNode),
      };
    }

    if (boldLabels.length !== 1) return null;

    const actionLabel = boldLabels[0];
    const actionText = actionLabel.textContent ?? "";
    const contentNode = childNodes
      .slice(childNodes.indexOf(actionLabel) + 1)
      .find(isBlameValueNode);

    if (!contentNode) return null;

    return {
      type: actionText.includes("追加")
        ? "add"
        : actionText.includes("削除")
          ? "del"
          : "neutral",
      actionLabel,
      content: getBlameValueText(contentNode),
    };
  };

  /**
   * Google Sheets の編集履歴値 DOM を読み取り、差分表示用 DOM に置き換える。
   *
   * @param {Element} valueContent - `.docs-blameview-value-content` 要素。
   * @returns {void}
   */
  const transformDiff = (valueContent) => {
    if (valueContent.hasAttribute(BLAME_DIFF_ATTR)) return;

    if (valueContent.querySelector(".widen-diff-block")) {
      valueContent.setAttribute(BLAME_DIFF_ATTR, "1");
      addDiffLayoutToggle(valueContent);
      return;
    }

    const change = parseBlameChange(valueContent);
    if (!change) return;

    valueContent.setAttribute(BLAME_DIFF_ATTR, "1");
    removeNodesAfterActionLabel(valueContent, change.actionLabel);

    if (change.actionLabel) {
      addDiffLayoutToggle(change.actionLabel);
    }

    const doc = valueContent.ownerDocument;
    const block =
      change.type === "replace"
        ? createReplacementDiffBlock(doc, change.oldText, change.newText)
        : createSingleDiffBlock(doc, change.type, change.content);
    valueContent.appendChild(block);
  };

  /**
   * 編集履歴 value content の追加・更新を監視し、差分表示へ変換する。
   *
   * @param {Document} doc - 監視対象 document。
   * @returns {void}
   */
  const observeDiff = (doc) => {
    if (!doc || observedDiffDocuments.has(doc)) return;
    observedDiffDocuments.add(doc);

    injectCSS(doc, STYLE_IDS.diff, diffCSS);
    ensureDiffLayout(doc);
    doc.querySelectorAll(SELECTORS.blameValueContent).forEach(transformDiff);

    const observer = new MutationObserver((mutations) => {
      const touched = new Set();

      for (const mutation of mutations) {
        const valueContent = isElementNode(mutation.target)
          ? mutation.target.closest?.(SELECTORS.blameValueContent)
          : null;
        if (valueContent) touched.add(valueContent);

        for (const node of mutation.addedNodes) {
          if (!isElementNode(node)) continue;
          if (node.matches(SELECTORS.blameValueContent)) touched.add(node);
          node
            .querySelectorAll?.(SELECTORS.blameValueContent)
            .forEach((element) => touched.add(element));
        }
      }

      touched.forEach((element) => {
        element.removeAttribute(BLAME_DIFF_ATTR);
        transformDiff(element);
      });
    });

    observer.observe(doc.body || doc.documentElement, {
      childList: true,
      subtree: true,
    });
  };

  /**
   * 編集履歴 popup に追加される action label を監視し、diff レイアウト切替ボタンを補完する。
   *
   * @param {Document} doc - 監視対象 document。
   * @returns {void}
   */
  const observeDiffLayoutToggles = (doc) => {
    if (!doc || observedDiffToggleDocuments.has(doc)) return;
    observedDiffToggleDocuments.add(doc);

    doc
      .querySelectorAll(
        `${SELECTORS.blameValueContent} ${SELECTORS.blameBoldText}`,
      )
      .forEach(addDiffLayoutToggle);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!isElementNode(node)) continue;

          if (
            node.matches(SELECTORS.blameBoldText) &&
            node.closest?.(SELECTORS.blameValueContent)
          ) {
            addDiffLayoutToggle(node);
          }

          node
            .querySelectorAll?.(
              `${SELECTORS.blameValueContent} ${SELECTORS.blameBoldText}`,
            )
            .forEach(addDiffLayoutToggle);
        }
      }
    });

    observer.observe(doc.body || doc.documentElement, {
      childList: true,
      subtree: true,
    });
  };

  /**
   * 編集履歴 popup を次回表示用の初期状態へ戻す。
   *
   * `.waffle-blameview` は閉じても DOM に残るため、ドラッグで付けた inline style も
   * 次回表示に持ち越される。幅はデフォルトへ戻し、高さは Sheets 側の自然な計算に戻す。
   *
   * @param {HTMLElement} element - `.waffle-blameview` 要素。
   * @returns {void}
   */
  const resetBlamePopupState = (element) => {
    const width = `${BLAME_DEFAULT_WIDTH}px`;
    if (element.style.getPropertyValue("width") !== width) {
      element.style.setProperty("width", width, "important");
    }

    const blameView = element.querySelector(SELECTORS.blameView);
    if (blameView?.style.getPropertyValue("width") !== "100%") {
      blameView?.style.setProperty("width", "100%", "important");
    }

    element.style.removeProperty("height");

    const valueContainer = element.querySelector(SELECTORS.blameValueContainer);
    valueContainer?.style.removeProperty("height");
    valueContainer?.style.removeProperty("max-height");
  };

  /**
   * 編集履歴 popup が画面上に表示されているか判定する。
   *
   * @param {HTMLElement} element - `.waffle-blameview` 要素。
   * @returns {boolean} 表示中なら true。
   */
  const isBlamePopupVisible = (element) => {
    if (!element.isConnected) return false;

    const rect = element.getBoundingClientRect();
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style?.display !== "none" &&
      style?.visibility !== "hidden"
    );
  };

  /**
   * 編集履歴 popup が画面下端からはみ出す場合、top を最小限だけ上へ補正する。
   *
   * @param {HTMLElement} element - `.waffle-blameview` 要素。
   * @returns {void}
   */
  const clampBlameBottomPosition = (element) => {
    const view = element.ownerDocument.defaultView ?? window;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const overflowBottom =
      rect.bottom - view.innerHeight + POPUP_BOUNDS.bottomEdgeOffset;
    if (overflowBottom <= 0) return;

    const inlineTop = parseFloat(element.style.top);
    const currentTop = Number.isNaN(inlineTop) ? rect.top : inlineTop;
    const nextTop = Math.max(POPUP_BOUNDS.margin, currentTop - overflowBottom);
    element.style.setProperty("top", `${nextTop}px`, "important");
  };

  /**
   * 編集履歴本文の描画完了を待ちながら、数 frame だけ下端補正を再試行する。
   *
   * @param {HTMLElement} element - `.waffle-blameview` 要素。
   * @returns {void}
   */
  const scheduleBlameBottomClamp = (element) => {
    if (scheduledBlameBottomClamps.has(element)) return;
    scheduledBlameBottomClamps.add(element);

    const view = element.ownerDocument.defaultView;
    if (!view) {
      scheduledBlameBottomClamps.delete(element);
      return;
    }

    let remainingFrames = 4;
    const tick = () => {
      if (!element.isConnected || !isBlamePopupVisible(element)) {
        scheduledBlameBottomClamps.delete(element);
        return;
      }

      clampPopupBounds(element);
      clampBlameBottomPosition(element);
      remainingFrames -= 1;

      if (remainingFrames > 0) {
        view.requestAnimationFrame(tick);
      } else {
        scheduledBlameBottomClamps.delete(element);
      }
    };

    view.requestAnimationFrame(tick);
  };

  /**
   * 編集履歴 popup の手動リサイズ直後に、左右と下端の境界補正を同期実行する。
   *
   * @param {HTMLElement} element - `.waffle-blameview` 要素。
   * @returns {void}
   */
  const syncBlameResizeBounds = (element) => {
    clampPopupBounds(element);
    clampBlameBottomPosition(element);
  };

  /**
   * 編集履歴 popup の状態を同期する。
   *
   * @param {HTMLElement} element - `.waffle-blameview` 要素。
   * @returns {void}
   */
  const syncBlamePopup = (element) => {
    if (!element.querySelector(`.${BLAME_HANDLE_CLASS}`)) {
      resetBlamePopupState(element);
      addResizeHandle(element, {
        handleClass: BLAME_HANDLE_CLASS,
        minWidth: BLAME_MIN_WIDTH,
        minHeight: BLAME_VALUE_MIN_HEIGHT,
        getHeightTarget: (popup) =>
          popup.querySelector(SELECTORS.blameValueContainer) ?? popup,
        syncMaxHeight: true,
        onResize: syncBlameResizeBounds,
      });
    }

    if (isBlamePopupVisible(element)) {
      clampPopupBounds(element);
      clampBlameBottomPosition(element);
      scheduleBlameBottomClamp(element);
      return;
    }

    resetBlamePopupState(element);
  };

  /**
   * 1 つの document に、この拡張が必要とする style と DOM 監視を設定する。
   *
   * @param {Document} doc - 対象 document。
   * @returns {void}
   */
  function setupDocument(doc) {
    if (!doc || initializedDocuments.has(doc)) return;
    initializedDocuments.add(doc);

    injectCSS(doc, STYLE_IDS.comment, commentCSS);
    injectCSS(doc, STYLE_IDS.diff, diffCSS);
    injectCSS(doc, STYLE_IDS.blameHandle, blameHandleCSS);
    ensureDiffLayout(doc);

    observePopupInDoc(doc, SELECTORS.commentPopup, syncCommentPopup);
    observePopupInDoc(doc, SELECTORS.blamePopup, syncBlamePopup);
    observeDiff(doc);
    observeDiffLayoutToggles(doc);
    observeIframes(doc);
  }

  setupDocument(document);
})();
