(() => {
  const STYLE_ID = "spreadsheet-wide-comment-style";
  const COMMENT_HANDLE_CLASS = "widen-ext-comment-handle";

  const css = `
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
      overflow: visible !important;
    }
    .docos-anchoreddocoview-content {
      min-height: 0 !important;
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
    .${COMMENT_HANDLE_CLASS} {
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
    .${COMMENT_HANDLE_CLASS} svg {
      pointer-events: none;
      opacity: 0.45;
      transition: opacity 0.15s;
    }
    .${COMMENT_HANDLE_CLASS}:hover svg {
      opacity: 0.85;
    }
  `;

  /**
   * コメント popup の幅調整 CSS を指定 document に一度だけ注入する。
   *
   * @param {Document} doc - CSS を注入する document。Google Sheets 内 iframe の document も含む。
   * @returns {void}
   */
  const injectStyle = (doc) => {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    (doc.head || doc.documentElement).appendChild(style);
  };

  // メインドキュメントに注入
  injectStyle(document);

  // iframe にも注入するため MutationObserver で監視
  /**
   * root 配下に存在する iframe と、後から追加される iframe へコメント用 CSS を注入する。
   *
   * @param {Document} root - 監視対象の document。
   * @returns {void}
   */
  const observeIframes = (root) => {
    /**
     * iframe の load 後に同一 origin の document へ CSS を注入する。
     *
     * @param {HTMLIFrameElement} iframe - 注入対象 iframe。
     * @returns {void}
     */
    const injectToIframe = (iframe) => {
      /**
       * iframe の contentDocument が読める場合だけ CSS と nested iframe 監視を設定する。
       *
       * @returns {void}
       */
      const tryInject = () => {
        try {
          const iframeDoc = iframe.contentDocument;
          if (iframeDoc) {
            injectStyle(iframeDoc);
            // iframe 内の更なる iframe も監視
            observeIframes(iframeDoc);
          }
        } catch {
          // cross-origin iframe はスキップ
        }
      };

      if (
        iframe.contentDocument &&
        iframe.contentDocument.readyState === "complete"
      ) {
        tryInject();
      } else {
        iframe.addEventListener("load", tryInject);
      }
    };

    // 既存の iframe に注入
    root.querySelectorAll("iframe").forEach(injectToIframe);

    // 新たに追加される iframe を監視
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.tagName === "IFRAME") {
            injectToIframe(node);
          }
          node.querySelectorAll?.("iframe").forEach(injectToIframe);
        }
      }
    });

    observer.observe(root, { childList: true, subtree: true });
  };

  observeIframes(document);

  // popup が画面端を超えないよう位置と幅を補正する
  const LEFT_EDGE_OFFSET = 16; // 左端に残す px
  const MARGIN = 16; // マージンとスクロールバー分を考慮した px
  const RIGHT_SIDEBAR_OFFSET = 56; // 右端メニューバー（56px）分
  const BOTTOM_EDGE_OFFSET = 48; // 下端に残す px

  /**
   * popup が画面端からはみ出す場合、left と width を補正する。
   *
   * 右端には Sheets のサイドバー分の余白を残す。右端に到達した後もドラッグで幅を
   * 広げられるよう、まず left を左へ逃がす。左端の余白を割る場合は、それ以上
   * 左へ逃がさず width を縮めて最大幅として扱う。
   *
   * @param {HTMLElement} el - 補正対象 popup。
   * @returns {void}
   */
  const clampPopupBounds = (el) => {
    if (!el.isConnected) return;

    const view = el.ownerDocument.defaultView ?? window;
    let rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const overflowRight =
      rect.right - view.innerWidth + MARGIN + RIGHT_SIDEBAR_OFFSET;
    if (overflowRight > 0) {
      const currentLeft = parseFloat(el.style.left) || 0;
      el.style.setProperty(
        "left",
        `${currentLeft - overflowRight}px`,
        "important",
      );
    }

    rect = el.getBoundingClientRect();
    const overflowLeft = LEFT_EDGE_OFFSET - rect.left;
    if (overflowLeft > 0) {
      const currentLeft = parseFloat(el.style.left) || 0;
      const nextLeft = currentLeft + overflowLeft;
      const maxWidth = Math.max(0, rect.right - LEFT_EDGE_OFFSET);
      el.style.setProperty("left", `${nextLeft}px`, "important");
      el.style.setProperty("width", `${maxWidth}px`, "important");
    }
  };

  /**
   * コメント popup が画面端からはみ出す場合、left と width を補正する。
   *
   * @param {HTMLElement} el - `.docos-anchoreddocoview` 要素。
   * @returns {void}
   */
  const clampPosition = clampPopupBounds;

  const renderResizeHandleIcon = () => `
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(90deg)">
      <line x1="13" y1="13" x2="1"  y2="1"  stroke="#555" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="13" y1="9"  x2="5"  y2="1"  stroke="#555" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="13" y1="5"  x2="9"  y2="1"  stroke="#555" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;

  /**
   * popup にドラッグ可能なリサイズハンドルを追加する。
   *
   * @param {HTMLElement} el - リサイズ対象 popup。
   * @param {object} options - ハンドル設定。
   * @param {string} options.handleClass - ハンドル要素に付ける class。
   * @param {number} options.minWidth - 最小幅 px。
   * @param {number} options.minHeight - 最小高さ px。
   * @param {(el: HTMLElement) => HTMLElement} [options.getHeightTarget] - 高さを変更する要素。省略時は popup 自身。
   * @param {boolean} [options.syncMaxHeight=false] - 手動 height を max-height にも反映するか。
   * @param {(el: HTMLElement) => void} [options.onResize] - サイズ更新後に実行する処理。
   * @returns {void}
   */
  const addResizeHandle = (
    el,
    {
      handleClass,
      minWidth,
      minHeight,
      getHeightTarget,
      syncMaxHeight = false,
      onResize,
    },
  ) => {
    if (el.querySelector(`.${handleClass}`)) return;

    // position が static なら relative に昇格してハンドルを正しく配置する
    const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (computed?.position === "static") {
      el.style.position = "relative";
    }

    const handle = el.ownerDocument.createElement("div");
    handle.className = handleClass;
    handle.innerHTML = renderResizeHandleIcon();
    el.appendChild(handle);

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Pointer Capture でハンドル自身にポインターイベントを束縛する
      // → Google Sheets が stopPropagation しても確実に pointermove/pointerup を受け取れる
      handle.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = el.offsetWidth;
      // 編集履歴 popup は footer や feedback を含むため、高さだけ本文領域に逃がせるようにする。
      const heightTarget = getHeightTarget?.(el) ?? el;
      const startHeight = heightTarget.offsetHeight;

      /**
       * pointerdown 開始位置からの差分で popup サイズを更新する。
       *
       * @param {PointerEvent} ev - pointermove イベント。
       * @returns {void}
       */
      const onPointerMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        const newWidth = Math.max(minWidth, startWidth + dx);
        const newHeight = Math.max(minHeight, startHeight + dy);

        el.style.setProperty("width", `${newWidth}px`, "important");
        const heightValue = `${newHeight}px`;
        heightTarget.style.setProperty("height", heightValue, "important");
        if (syncMaxHeight) {
          heightTarget.style.setProperty(
            "max-height",
            heightValue,
            "important",
          );
        }
        onResize?.(el);
      };

      /**
       * pointer capture を解放し、ドラッグ中だけ登録した listener を解除する。
       *
       * @param {PointerEvent} ev - pointerup または pointercancel イベント。
       * @returns {void}
       */
      const onPointerUp = (ev) => {
        handle.releasePointerCapture(ev.pointerId);
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
   * コメント popup にドラッグ可能なリサイズハンドルを追加する。
   *
   * @param {HTMLElement} el - `.docos-anchoreddocoview` 要素。
   * @returns {void}
   */
  const addCommentResizeHandle = (el) => {
    addResizeHandle(el, {
      handleClass: COMMENT_HANDLE_CLASS,
      minWidth: 240,
      minHeight: 160,
      // コメント popup は入力欄なども含むため、高さ変更は本文 content だけに限定する。
      getHeightTarget: (popup) =>
        popup.querySelector(".docos-anchoreddocoview-content") ?? popup,
      onResize: clampPosition,
    });
  };

  /**
   * document 内の popup 追加と inline style 変更を監視し、同期処理を適用する。
   *
   * Google Sheets はスクロールやセル移動のたびに popup の left/top を inline style で
   * 書き換える。コメントと編集履歴で同じ追従処理が必要なので、selector と同期関数だけを
   * 差し替えられる共通 observer にしている。
   *
   * @param {Document} doc - 監視対象 document。
   * @param {string} selector - popup を特定する CSS selector。
   * @param {(el: HTMLElement) => void} syncPopup - popup に適用する処理。
   * @returns {void}
   */
  const observePopupInDoc = (doc, selector, syncPopup) => {
    try {
      if (!doc) return;
      doc.querySelectorAll(selector).forEach(syncPopup);

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          // style 属性の変化（Google SpreadsheetがleftをinlineStyleで設定する）
          if (
            mutation.type === "attributes" &&
            mutation.attributeName === "style"
          ) {
            const el = mutation.target;
            if (el.matches?.(selector)) syncPopup(el);
          }

          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.matches?.(selector)) syncPopup(node);
            // popup の外枠だけ先に作られ、本文 DOM が後から入るケースを拾う。
            const parentPopup = node.closest?.(selector);
            if (parentPopup) syncPopup(parentPopup);
            node.querySelectorAll?.(selector).forEach(syncPopup);
          }
        }
      });

      observer.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"],
      });
    } catch {
      // cross-origin iframe はスキップ
    }
  };

  /**
   * コメント popup の表示状態を同期する。
   *
   * @param {HTMLElement} el - `.docos-anchoreddocoview` 要素。
   * @returns {void}
   */
  const syncCommentPopup = (el) => {
    addCommentResizeHandle(el);
    clampPosition(el);
  };

  /**
   * document 内のコメント popup 追加と inline style 変更を監視し、位置を補正する。
   *
   * @param {Document} doc - 監視対象 document。
   * @returns {void}
   */
  const observePositionInDoc = (doc) => {
    observePopupInDoc(doc, ".docos-anchoreddocoview", syncCommentPopup);
  };

  observePositionInDoc(document);

  // iframe 内のコメントウィンドウにも適用
  /**
   * root 配下の iframe 内 document にもコメント popup 位置監視を設定する。
   *
   * @param {Document} root - iframe を検索する document。
   * @returns {void}
   */
  const observePositionInIframes = (root) => {
    root.querySelectorAll("iframe").forEach((iframe) => {
      /**
       * iframe の contentDocument が読める場合だけ位置監視を設定する。
       *
       * @returns {void}
       */
      const tryObserve = () => {
        try {
          observePositionInDoc(iframe.contentDocument);
        } catch {}
      };
      if (iframe.contentDocument?.readyState === "complete") {
        tryObserve();
      } else {
        iframe.addEventListener("load", tryObserve);
      }
    });
  };

  observePositionInIframes(document);

  // ── 編集履歴ポップアップ: 差分をgit-diff風に再描画 ───────────────────────

  const BLAME_DIFF_ATTR = "data-widen-diff-rendered";
  const BLAME_DIFF_LAYOUT_KEY = "widen-ext-blame-diff-layout";
  const BLAME_DIFF_TOGGLE_CLASS = "widen-diff-layout-toggle";
  const BLAME_DIFF_TOGGLE_ROW_CLASS = "widen-diff-layout-toggle-row";

  const blameDiffCSS = `
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
    :root[data-widen-diff-layout="horizontal"] .widen-diff-replacement {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    :root[data-widen-diff-layout="horizontal"] .widen-diff-replacement .widen-diff-row {
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
   * 編集履歴 diff とレイアウト切替ボタンの CSS を指定 document に一度だけ注入する。
   *
   * @param {Document} doc - CSS を注入する document。
   * @returns {void}
   */
  const injectBlameDiffStyle = (doc) => {
    const id = "widen-ext-blame-diff-style";
    if (!doc || doc.getElementById(id)) return;
    const style = doc.createElement("style");
    style.id = id;
    style.textContent = blameDiffCSS;
    (doc.head || doc.documentElement).appendChild(style);
  };

  injectBlameDiffStyle(document);

  /**
   * 保存済みの diff レイアウト設定を読む。
   *
   * @returns {"vertical" | "horizontal"} 保存値。不正値や読み取り失敗時は `"vertical"`。
   */
  const readStoredDiffLayout = () => {
    try {
      return localStorage.getItem(BLAME_DIFF_LAYOUT_KEY) === "horizontal"
        ? "horizontal"
        : "vertical";
    } catch {
      return "vertical";
    }
  };

  /**
   * diff レイアウト設定を localStorage に保存する。
   *
   * @param {"vertical" | "horizontal"} layout - 保存する表示方向。
   * @returns {void}
   */
  const writeStoredDiffLayout = (layout) => {
    try {
      localStorage.setItem(BLAME_DIFF_LAYOUT_KEY, layout);
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
    doc.documentElement.setAttribute("data-widen-diff-layout", layout);
  };

  setDiffLayout(document, readStoredDiffLayout());

  /**
   * manifest で先読みしている jsdiff の global export を取得する。
   *
   * @returns {typeof globalThis.Diff | null} jsdiff API。読み込み失敗時は null。
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
    const node = className
      ? doc.createElement("span")
      : doc.createTextNode(text);
    if (className) {
      node.className = className;
      node.textContent = text;
    }
    parent.appendChild(node);
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

    const diff = getJsDiff();
    const parts = diff?.diffWordsWithSpace?.(oldText, newText) ?? [
      { value: oldText, removed: true },
      { value: newText, added: true },
    ];

    block.appendChild(createDiffRow(doc, "del", parts));
    block.appendChild(createDiffRow(doc, "add", parts));
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
   * document 内の diff レイアウト切替ボタンのアイコンとアクセシビリティ属性を更新する。
   *
   * @param {Document} doc - 更新対象 document。
   * @returns {void}
   */
  const updateDiffLayoutButtons = (doc) => {
    const layout =
      doc.documentElement.getAttribute("data-widen-diff-layout") || "vertical";
    doc.querySelectorAll(`.${BLAME_DIFF_TOGGLE_CLASS}`).forEach((button) => {
      button.innerHTML = renderLayoutIcon(layout);
      button.title =
        layout === "horizontal" ? "差分を縦に並べる" : "差分を横に並べる";
      button.setAttribute(
        "aria-label",
        layout === "horizontal" ? "差分を縦に並べる" : "差分を横に並べる",
      );
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
      doc.documentElement.getAttribute("data-widen-diff-layout") || "vertical";
    const next = current === "horizontal" ? "vertical" : "horizontal";
    setDiffLayout(doc, next);
    writeStoredDiffLayout(next);
    updateDiffLayoutButtons(doc);
  };

  /**
   * 編集履歴の action label と切替ボタンを flex row にまとめる。
   *
   * @param {Element} target - `.docs-blameview-value-content` またはその中の `.docs-blame-bold-text`。
   * @returns {void}
   */
  const addDiffLayoutToggle = (target) => {
    const valueContent =
      target.closest?.(".docs-blameview-value-content") ?? target;
    if (valueContent.querySelector(`.${BLAME_DIFF_TOGGLE_CLASS}`)) return;

    const doc = valueContent.ownerDocument;
    const anchor = target.classList?.contains("docs-blame-bold-text")
      ? target
      : valueContent.querySelector(".docs-blame-bold-text");
    if (!anchor) return;

    injectBlameDiffStyle(doc);
    if (!doc.documentElement.hasAttribute("data-widen-diff-layout")) {
      setDiffLayout(doc, readStoredDiffLayout());
    }

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
   * 編集履歴 popup に追加される action label を監視し、diff レイアウト切替ボタンを補完する。
   *
   * @param {Document} root - 監視対象 document。
   * @returns {void}
   */
  const observeDiffLayoutToggles = (root) => {
    root
      .querySelectorAll(".docs-blameview-value-content .docs-blame-bold-text")
      .forEach(addDiffLayoutToggle);

    const obs = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (
            node.classList?.contains("docs-blame-bold-text") &&
            node.closest?.(".docs-blameview-value-content")
          ) {
            addDiffLayoutToggle(node);
          }
          node
            .querySelectorAll?.(
              ".docs-blameview-value-content .docs-blame-bold-text",
            )
            .forEach(addDiffLayoutToggle);
        }
      }
    });

    try {
      obs.observe(root.body || root.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch {}
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
   * Google Sheets の編集履歴値 DOM を読み取り、差分表示用 DOM に置き換える。
   *
   * 通常セルは text node、数式セルは `.waffle-blameview-formula-text` に値が入るため、
   * どちらも同じ抽出処理に流す。再描画済みの要素は属性でスキップする。
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

    // 直下テキストノードを順にたどる
    const childNodes = Array.from(valueContent.childNodes);
    /**
     * Google Sheets が通常値の外側に付ける引用符を除去する。
     *
     * @param {string} s - 元文字列。
     * @returns {string} 前後空白と外側 quote を除いた文字列。
     */
    const strip = (s) => s.trim().replace(/^["「]|["」]$/g, "");
    /**
     * 編集履歴の値として扱える直下ノードか判定する。
     *
     * @param {Node} node - `.docs-blameview-value-content` の直下ノード。
     * @returns {boolean} 通常値 text node または数式値 span なら true。
     */
    const isValueNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return strip(node.textContent).length > 0;
      }
      return (
        node.nodeType === Node.ELEMENT_NODE &&
        node.classList?.contains("waffle-blameview-formula-text") &&
        node.textContent.trim()
      );
    };
    /**
     * 値ノードから diff に渡す文字列を取り出す。
     *
     * 数式 span の中にあるダブルクォートは数式本体なので保持し、
     * 通常 text node では Google Sheets が外側に付ける引用符だけを除去する。
     *
     * @param {Node} node - 値として扱うノード。
     * @returns {string} diff 対象文字列。
     */
    const valueText = (node) => {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        node.classList?.contains("waffle-blameview-formula-text")
      ) {
        return (node.textContent ?? "").trim();
      }
      return strip(node.textContent ?? "");
    };

    // 「からX」パターン: boldSpan(置き換えました:) + textNode(旧) + boldSpan(から) + textNode(新)
    const boldSpans = childNodes.filter(
      (n) =>
        n.nodeType === Node.ELEMENT_NODE &&
        n.classList?.contains("docs-blame-bold-text"),
    );

    // ── パターンA: span(置き換えました:) + 値 + span(から) + 値 ──
    // 「から」を含むspanを探してパターン確認
    const fromSpan = boldSpans.find((s) => s.textContent?.trim() === "から");
    if (fromSpan) {
      const fromSpanIdx = childNodes.indexOf(fromSpan);
      // 「から」の直前の値が旧テキスト、直後の値が新テキスト
      const oldValueNode = childNodes
        .slice(0, fromSpanIdx)
        .reverse()
        .find(isValueNode);
      const newValueNode = childNodes.slice(fromSpanIdx + 1).find(isValueNode);

      if (!oldValueNode || !newValueNode) return;

      const oldText = valueText(oldValueNode);
      const newText = valueText(newValueNode);

      // マーク済みにしてから再描画
      valueContent.setAttribute(BLAME_DIFF_ATTR, "1");

      // アクションラベル（「置き換えました:」など）だけ残して後ろを差し替える
      const actionSpan = boldSpans.find((s) => s !== fromSpan);
      // 「から」以降の既存ノードを削除
      const toRemove = childNodes.filter((n) => {
        const idx = childNodes.indexOf(n);
        // actionSpan より後ろを全部削除
        return actionSpan ? idx > childNodes.indexOf(actionSpan) : true;
      });
      toRemove.forEach((n) => n.parentNode?.removeChild(n));

      const block = createReplacementDiffBlock(
        valueContent.ownerDocument,
        oldText,
        newText,
      );
      if (actionSpan) addDiffLayoutToggle(actionSpan);
      valueContent.appendChild(block);
      return;
    }

    // ── パターンB: span(追加しました: / 削除しました:) + textNode(テキスト) ──
    if (boldSpans.length === 1) {
      const actionSpan = boldSpans[0];
      const actionText = actionSpan.textContent ?? "";
      const contentNode = childNodes
        .slice(childNodes.indexOf(actionSpan) + 1)
        .find(isValueNode);

      if (!contentNode) return;

      const content = valueText(contentNode);
      // マーク済みにしてから再描画
      valueContent.setAttribute(BLAME_DIFF_ATTR, "1");

      // actionSpan より後ろを削除
      const toRemove = childNodes.filter(
        (n) => childNodes.indexOf(n) > childNodes.indexOf(actionSpan),
      );
      toRemove.forEach((n) => n.parentNode?.removeChild(n));

      const type = actionText.includes("追加")
        ? "add"
        : actionText.includes("削除")
          ? "del"
          : "neutral";
      const block = createSingleDiffBlock(
        valueContent.ownerDocument,
        type,
        content,
      );
      addDiffLayoutToggle(actionSpan);
      valueContent.appendChild(block);
    }
  };

  /**
   * 編集履歴 value content の追加・更新を監視し、差分表示へ変換する。
   *
   * @param {Document} root - 監視対象 document。
   * @returns {void}
   */
  const observeDiff = (root) => {
    injectBlameDiffStyle(root.ownerDocument || root);

    // 既存要素に適用
    root
      .querySelectorAll(".docs-blameview-value-content")
      .forEach(transformDiff);

    // 動的に追加・更新される要素を監視
    const obs = new MutationObserver((mutations) => {
      const touched = new Set();
      for (const m of mutations) {
        const vc = m.target.closest?.(".docs-blameview-value-content") ?? null;
        if (vc) touched.add(vc);
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== Node.ELEMENT_NODE) return;
          if (n.classList?.contains("docs-blameview-value-content"))
            touched.add(n);
          n.querySelectorAll?.(".docs-blameview-value-content").forEach((el) =>
            touched.add(el),
          );
        });
      }
      touched.forEach((el) => {
        el.removeAttribute(BLAME_DIFF_ATTR); // 再描画許可
        transformDiff(el);
      });
    });

    try {
      obs.observe(root.body || root.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch {}
  };

  observeDiff(document);
  observeDiffLayoutToggles(document);

  // ── 編集履歴ポップアップ（.waffle-blameview）リサイズハンドル ──────────────

  const BLAME_HANDLE_CLASS = "widen-ext-blame-handle";
  const BLAME_DEFAULT_WIDTH = 320;
  const BLAME_VALUE_MAX_HEIGHT = 240;
  const BLAME_VALUE_MIN_HEIGHT = 120;
  const scheduledBlameBottomClamps = new WeakSet();

  const blameHandleCSS = `
    .waffle-blameview {
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
    .waffle-blameview .docs-blameview {
      /*
       * Google Sheets 標準の .docs-blameview は width: 240px を持つ。
       * 外側 popup を広げても中身だけ固定幅になるため、内側も親幅へ追従させる。
       */
      width: 100% !important;
      max-width: none !important;
    }
    .waffle-blameview .docs-blameview-content,
    .waffle-blameview .docs-blameview-valuecontainer,
    .waffle-blameview .docs-blameview-value-content {
      /*
       * 値表示まわりにも固定幅や shrink しやすい計算が残ることがある。
       * diff block を含む本文を、広げた popup の横幅いっぱいに使わせる。
       */
      width: 100% !important;
      max-width: none !important;
      min-width: 0 !important;
    }
    .waffle-blameview > *:not(.${BLAME_HANDLE_CLASS}),
    .waffle-blameview * {
      box-sizing: border-box !important;
    }
    .waffle-blameview .docs-blameview-valuecontainer {
      /*
       * 編集履歴本文だけをスクロール領域にする。popup 全体に max-height を付けると
       * warning や feedback の高さまで圧縮対象になり、Google Sheets 標準 UI が崩れる。
       */
      min-height: 0 !important;
      max-height: ${BLAME_VALUE_MAX_HEIGHT}px !important;
      overflow: auto !important;
    }
    .${BLAME_HANDLE_CLASS} {
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
    .${BLAME_HANDLE_CLASS} svg {
      pointer-events: none;
      opacity: 0.45;
      transition: opacity 0.15s;
    }
    .${BLAME_HANDLE_CLASS}:hover svg {
      opacity: 0.85;
    }
  `;

  /**
   * 編集履歴 popup のリサイズハンドル CSS を指定 document に一度だけ注入する。
   *
   * @param {Document} doc - CSS を注入する document。
   * @returns {void}
   */
  const injectBlameHandleStyle = (doc) => {
    const id = "widen-ext-blame-handle-style";
    if (!doc || doc.getElementById(id)) return;
    const style = doc.createElement("style");
    style.id = id;
    style.textContent = blameHandleCSS;
    (doc.head || doc.documentElement).appendChild(style);
  };

  injectBlameHandleStyle(document);

  /**
   * 編集履歴 popup を次回表示用の初期状態へ戻す。
   *
   * `.waffle-blameview` は閉じても DOM に残るため、ドラッグで付けた inline style も
   * 次回表示に持ち越される。幅はユーザ設定のデフォルトへ戻し、高さは Sheets 側の
   * 自然な計算に戻すため inline height を削除する。
   *
   * @param {HTMLElement} el - `.waffle-blameview` 要素。
   * @returns {void}
   */
  const resetBlamePopupState = (el) => {
    const width = `${BLAME_DEFAULT_WIDTH}px`;
    if (el.style.getPropertyValue("width") !== width) {
      el.style.setProperty("width", width, "important");
    }
    const blameView = el.querySelector(".docs-blameview");
    if (blameView?.style.getPropertyValue("width") !== "100%") {
      blameView?.style.setProperty("width", "100%", "important");
    }
    if (el.style.getPropertyValue("height")) {
      el.style.removeProperty("height");
    }
    // 高さのドラッグ対象は本文領域だけ。閉じたら本文の inline height も消す。
    const valueContainer = el.querySelector(".docs-blameview-valuecontainer");
    if (valueContainer?.style.getPropertyValue("height")) {
      valueContainer.style.removeProperty("height");
    }
    if (valueContainer?.style.getPropertyValue("max-height")) {
      valueContainer.style.removeProperty("max-height");
    }
  };

  /**
   * 編集履歴 popup が画面上に表示されているか判定する。
   *
   * 閉じた popup は DOM に残るため、isConnected だけでは表示状態を判定できない。
   * 非表示中は次回表示用の初期化、表示中は境界補正を行うために使う。
   *
   * @param {HTMLElement} el - `.waffle-blameview` 要素。
   * @returns {boolean} 表示中なら true。
   */
  const isBlamePopupVisible = (el) => {
    if (!el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style?.display !== "none" &&
      style?.visibility !== "hidden"
    );
  };

  /**
   * 編集履歴 popup が画面下端からはみ出す場合、Sheets が決めた top を最小限だけ上へ補正する。
   *
   * 通常の配置は Sheets に任せる。下端に届いた場合だけ、本文をさらに小さくする代わりに
   * popup 全体を上へ逃がして BOTTOM_EDGE_OFFSET を確保する。
   *
   * @param {HTMLElement} el - `.waffle-blameview` 要素。
   * @returns {void}
   */
  const clampBlameBottomPosition = (el) => {
    const view = el.ownerDocument.defaultView ?? window;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const overflowBottom = rect.bottom - view.innerHeight + BOTTOM_EDGE_OFFSET;
    if (overflowBottom <= 0) return;

    const currentTop = Number.isNaN(parseFloat(el.style.top))
      ? rect.top
      : parseFloat(el.style.top);
    const nextTop = Math.max(MARGIN, currentTop - overflowBottom);
    el.style.setProperty("top", `${nextTop}px`, "important");
  };

  /**
   * 編集履歴本文の描画完了を待ちながら、数 frame だけ下端補正を再試行する。
   *
   * Sheets は popup 外枠と位置を先に更新し、その後に valuecontainer の内容を描画する
   * ことがある。同期直後の 1 回だけでは高さ計算が早すぎるため、短い rAF チェーンで
   * 後続描画を拾う。
   *
   * @param {HTMLElement} el - `.waffle-blameview` 要素。
   * @returns {void}
   */
  const scheduleBlameBottomClamp = (el) => {
    if (scheduledBlameBottomClamps.has(el)) return;
    scheduledBlameBottomClamps.add(el);

    const view = el.ownerDocument.defaultView;
    if (!view) {
      scheduledBlameBottomClamps.delete(el);
      return;
    }

    let remaining = 4;
    const tick = () => {
      if (!el.isConnected || !isBlamePopupVisible(el)) {
        scheduledBlameBottomClamps.delete(el);
        return;
      }

      clampPopupBounds(el);
      clampBlameBottomPosition(el);
      remaining -= 1;
      if (remaining > 0) {
        view.requestAnimationFrame(tick);
      } else {
        scheduledBlameBottomClamps.delete(el);
      }
    };

    view.requestAnimationFrame(tick);
  };

  /**
   * 編集履歴 popup の手動リサイズ直後に、左右と下端の境界補正を同期実行する。
   *
   * ハンドルを下へドラッグして BOTTOM_EDGE_OFFSET を割る場合は、次の frame を待たず
   * その場で top を上へ逃がす。これにより、下端余白を保ったまま本文領域を広げられる。
   *
   * @param {HTMLElement} el - `.waffle-blameview` 要素。
   * @returns {void}
   */
  const syncBlameResizeBounds = (el) => {
    clampPopupBounds(el);
    clampBlameBottomPosition(el);
  };

  /**
   * 編集履歴 popup にドラッグ可能なリサイズハンドルを追加する。
   *
   * @param {HTMLElement} el - `.waffle-blameview` 要素。
   * @returns {void}
   */
  const addBlameResizeHandle = (el) => {
    if (!el.querySelector(`.${BLAME_HANDLE_CLASS}`)) {
      resetBlamePopupState(el);
      addResizeHandle(el, {
        handleClass: BLAME_HANDLE_CLASS,
        minWidth: 200,
        minHeight: BLAME_VALUE_MIN_HEIGHT,
        // 高さ変更は履歴本文だけに限定し、warning / feedback / navigation の高さを保つ。
        getHeightTarget: (popup) =>
          popup.querySelector(".docs-blameview-valuecontainer") ?? popup,
        syncMaxHeight: true,
        onResize: syncBlameResizeBounds,
      });
    }

    if (isBlamePopupVisible(el)) {
      clampPopupBounds(el);
      clampBlameBottomPosition(el);
      scheduleBlameBottomClamp(el);
    } else {
      resetBlamePopupState(el);
    }
  };

  /**
   * 編集履歴 popup の追加を監視し、各 popup にリサイズハンドルを追加する。
   *
   * @param {Document} root - 監視対象 document。
   * @returns {void}
   */
  const observeBlameView = (root) => {
    observePopupInDoc(root, ".waffle-blameview", addBlameResizeHandle);
  };

  observeBlameView(document);

  // iframe 内にも適用
  document.querySelectorAll("iframe").forEach((iframe) => {
    /**
     * iframe の contentDocument が読める場合だけ編集履歴 popup のリサイズ監視を設定する。
     *
     * @returns {void}
     */
    const tryObserveBlame = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          injectBlameHandleStyle(doc);
          observeBlameView(doc);
        }
      } catch {}
    };
    if (iframe.contentDocument?.readyState === "complete") tryObserveBlame();
    else iframe.addEventListener("load", tryObserveBlame);
  });
})();
