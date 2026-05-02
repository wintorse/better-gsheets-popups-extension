(() => {
  const STYLE_ID = "spreadsheet-wide-comment-style";

  const css = `
    .docos-anchoreddocoview {
      width: 32vw !important;
      min-width: 240px !important;
      max-width: none !important;
    }
    .docos-anchoreddocoview-internal,
    .docos-anchoreddocoview-content,
    .docos-docoview-replycontainer {
      width: 100% !important;
      max-width: none !important;
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
  `;

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
  const observeIframes = (root) => {
    const injectToIframe = (iframe) => {
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

  // コメントウィンドウが右端を超えないよう left を補正する
  const MARGIN = 16; // マージンとスクロールバー分を考慮した px
  const RIGHT_SIDEBAR_OFFSET = 56; // 右端メニューバー（56px）分

  const clampPosition = (el) => {
    const rect = el.getBoundingClientRect();
    const overflowRight =
      rect.right - window.innerWidth + MARGIN + RIGHT_SIDEBAR_OFFSET;
    if (overflowRight > 0) {
      const currentLeft = parseFloat(el.style.left) || 0;
      el.style.setProperty(
        "left",
        `${currentLeft - overflowRight}px`,
        "important",
      );
    }
  };

  const clampAll = (root) => {
    root.querySelectorAll(".docos-anchoreddocoview").forEach(clampPosition);
  };

  const positionObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // style 属性の変化（Google SpreadsheetがleftをinlineStyleで設定する）
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "style"
      ) {
        const el = mutation.target;
        if (el.classList.contains("docos-anchoreddocoview")) {
          clampPosition(el);
        }
      }
      // 新しく追加されたコメントウィンドウ
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.classList?.contains("docos-anchoreddocoview")) {
          clampPosition(node);
        }
        node
          .querySelectorAll?.(".docos-anchoreddocoview")
          .forEach(clampPosition);
      }
    }
  });

  const observePositionInDoc = (doc) => {
    try {
      if (!doc) return;
      clampAll(doc);
      positionObserver.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"],
      });
    } catch {
      // cross-origin iframe はスキップ
    }
  };

  observePositionInDoc(document);

  // iframe 内のコメントウィンドウにも適用
  const observePositionInIframes = (root) => {
    root.querySelectorAll("iframe").forEach((iframe) => {
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

  const injectBlameDiffStyle = (doc) => {
    const id = "widen-ext-blame-diff-style";
    if (!doc || doc.getElementById(id)) return;
    const style = doc.createElement("style");
    style.id = id;
    style.textContent = blameDiffCSS;
    (doc.head || doc.documentElement).appendChild(style);
  };

  injectBlameDiffStyle(document);

  const readStoredDiffLayout = () => {
    try {
      return localStorage.getItem(BLAME_DIFF_LAYOUT_KEY) === "horizontal"
        ? "horizontal"
        : "vertical";
    } catch {
      return "vertical";
    }
  };

  const writeStoredDiffLayout = (layout) => {
    try {
      localStorage.setItem(BLAME_DIFF_LAYOUT_KEY, layout);
    } catch {}
  };

  const setDiffLayout = (doc, layout) => {
    doc.documentElement.setAttribute("data-widen-diff-layout", layout);
  };

  setDiffLayout(document, readStoredDiffLayout());

  const getJsDiff = () => globalThis.Diff ?? null;

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

  const toggleDiffLayout = (doc) => {
    const current =
      doc.documentElement.getAttribute("data-widen-diff-layout") || "vertical";
    const next = current === "horizontal" ? "vertical" : "horizontal";
    setDiffLayout(doc, next);
    writeStoredDiffLayout(next);
    updateDiffLayoutButtons(doc);
  };

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

  // valueContent 内から旧テキスト・新テキストを抽出してgit-diff風に再描画
  const transformDiff = (valueContent) => {
    if (valueContent.hasAttribute(BLAME_DIFF_ATTR)) return;
    if (valueContent.querySelector(".widen-diff-block")) {
      valueContent.setAttribute(BLAME_DIFF_ATTR, "1");
      addDiffLayoutToggle(valueContent);
      return;
    }

    // 直下テキストノードを順にたどる
    const childNodes = Array.from(valueContent.childNodes);
    // 引用符を除去する
    const strip = (s) => s.trim().replace(/^["「]|["」]$/g, "");

    // 「からX」パターン: boldSpan(置き換えました:) + textNode(旧) + boldSpan(から) + textNode(新)
    const boldSpans = childNodes.filter(
      (n) =>
        n.nodeType === Node.ELEMENT_NODE &&
        n.classList?.contains("docs-blame-bold-text"),
    );

    // ── パターンA: span(置き換えました:) + textNode(旧) + span(から) + textNode(新) ──
    // 「から」を含むspanを探してパターン確認
    const fromSpan = boldSpans.find((s) => s.textContent?.trim() === "から");
    if (fromSpan) {
      const fromSpanIdx = childNodes.indexOf(fromSpan);
      // 「から」の直前のテキストノードが旧テキスト、直後が新テキスト
      const oldTextNode = childNodes
        .slice(0, fromSpanIdx)
        .reverse()
        .find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      const newTextNode = childNodes
        .slice(fromSpanIdx + 1)
        .find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());

      if (!oldTextNode || !newTextNode) return;

      const oldText = strip(oldTextNode.textContent);
      const newText = strip(newTextNode.textContent);

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
      const textNode = childNodes
        .slice(childNodes.indexOf(actionSpan) + 1)
        .find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());

      if (!textNode) return;

      const content = strip(textNode.textContent);
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

  const blameHandleCSS = `
    .waffle-blameview {
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
    .waffle-blameview > *:not(.${BLAME_HANDLE_CLASS}),
    .waffle-blameview * {
      max-height: none !important;
      box-sizing: border-box !important;
    }
    .waffle-blameview > *:not(.${BLAME_HANDLE_CLASS}) {
      min-height: 0 !important;
      overflow: auto !important;
      width: 100% !important;
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

  const injectBlameHandleStyle = (doc) => {
    const id = "widen-ext-blame-handle-style";
    if (!doc || doc.getElementById(id)) return;
    const style = doc.createElement("style");
    style.id = id;
    style.textContent = blameHandleCSS;
    (doc.head || doc.documentElement).appendChild(style);
  };

  injectBlameHandleStyle(document);

  const addBlameResizeHandle = (el) => {
    if (el.querySelector(`.${BLAME_HANDLE_CLASS}`)) return;

    // position が static なら relative に昇格してハンドルを正しく配置する
    const computed = window.getComputedStyle(el);
    if (computed.position === "static") {
      el.style.position = "relative";
    }

    // 初期高さを設定
    el.style.setProperty("height", "200px", "important");

    const handle = document.createElement("div");
    handle.className = BLAME_HANDLE_CLASS;
    handle.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(90deg)">
        <line x1="13" y1="13" x2="1"  y2="1"  stroke="#555" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="13" y1="9"  x2="5"  y2="1"  stroke="#555" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="13" y1="5"  x2="9"  y2="1"  stroke="#555" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;
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
      const startHeight = el.offsetHeight;

      const onPointerMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        const newWidth = Math.max(200, startWidth + dx);
        const newHeight = Math.max(120, startHeight + dy);

        el.style.setProperty("width", `${newWidth}px`, "important");
        el.style.setProperty("height", `${newHeight}px`, "important");
      };

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

  const observeBlameView = (root) => {
    // 既存の要素に適用
    root.querySelectorAll(".waffle-blameview").forEach(addBlameResizeHandle);

    // 動的に追加された要素を監視
    const obs = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.classList?.contains("waffle-blameview")) {
            addBlameResizeHandle(node);
          }
          node
            .querySelectorAll?.(".waffle-blameview")
            .forEach(addBlameResizeHandle);
        }
      }
    });

    try {
      obs.observe(root.body || root.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch {
      // cross-origin などは無視
    }
  };

  observeBlameView(document);

  // iframe 内にも適用
  document.querySelectorAll("iframe").forEach((iframe) => {
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
